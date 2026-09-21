import { describe, expect, it, vi } from "vitest";

import type { RevenueFact } from "@/domain/organizations/growth-progress";
import type { RevenueScenarioInput } from "@/domain/organizations/revenue-scenario";
import {
  assembleLedgerBaselineCandidate,
  type GrowthCandidateAssemblyDependencies,
} from "@/modules/organizations/application/growth-candidate-assembly";
import type { GrowthCandidateBuildContext } from "@/modules/organizations/application/growth-projection-publisher";
import type { RevenueFactsEnvelope } from "@/modules/organizations/application/growth-progress-ports";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const DEFINITION_ID = "a1a1a1a1-1111-4111-8111-111111111111";
const DIGEST = "d".repeat(64);

/** Dubai local 2026-09-21: the prior month (August) has fully closed. */
const ISSUED_AT = "2026-09-21T00:00:00.000Z";

function material(): RevenueScenarioInput {
  return {
    organizationId: ORG_ID,
    grain: "month",
    history: [{ label: "2026-08", minorUnits: 3100000, currency: "AED" }],
    losses: [],
    actions: [],
    lastObservationDate: "2026-08-31",
    today: "2026-09-21",
    cutoffNote: "Reports through 2026-08-31.",
    coverageNote: "Monthly baseline.",
  };
}

function context(overrides: Partial<GrowthCandidateBuildContext> = {}): GrowthCandidateBuildContext {
  return {
    organizationId: ORG_ID,
    scheduleOriginDate: "2026-09-22",
    horizonMonths: 1,
    cycleIndex: 0,
    issuedAt: ISSUED_AT,
    sourceCutoffDate: "2026-09-21",
    timeZone: "Asia/Dubai",
    ...overrides,
  };
}

function augustFacts(options: { drop?: string; currency?: string; key?: string } = {}): RevenueFact[] {
  const key = options.key ?? "organization-total";
  const facts: RevenueFact[] = [];
  for (let day = 1; day <= 31; day += 1) {
    const date = `2026-08-${String(day).padStart(2, "0")}`;
    if (options.drop === date) continue;
    const next =
      day === 31
        ? "2026-09-01"
        : `2026-08-${String(day + 1).padStart(2, "0")}`;
    facts.push({
      sourceTable: "normalized_metrics",
      rowId: `fact-${key}-${date}`,
      organizationId: ORG_ID,
      partitionKey: key,
      startDate: date,
      endDateExclusive: next,
      amountMinor: 100000,
      currency: options.currency ?? "AED",
      createdAt: "2026-09-01T00:00:00.000Z",
      reconciliationDigest: DIGEST,
    });
  }
  return facts;
}

function dependencies(
  overrides: Partial<GrowthCandidateAssemblyDependencies> = {},
): GrowthCandidateAssemblyDependencies {
  return {
    resolveRevenueDefinitionId: async () => DEFINITION_ID,
    listBaselineCoordinates: async () => [{ channelId: null, branchId: null }],
    readBaselineFacts: async (): Promise<RevenueFactsEnvelope> => ({
      status: "ready",
      facts: augustFacts(),
    }),
    ...overrides,
  };
}

describe("assembleLedgerBaselineCandidate", () => {
  it("freezes a baseline-only document over the complete prior month", async () => {
    const result = await assembleLedgerBaselineCandidate(material(), context(), dependencies());

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.document).toMatchObject({
      organizationId: ORG_ID,
      scheduleOriginDate: "2026-09-22",
      horizonMonths: 1,
      cycleIndex: 0,
      startDate: "2026-09-22",
      endDateExclusive: "2026-10-22",
      currency: "AED",
      metricKey: "revenue.gross",
      monthlyLowMinor: 3100000,
      monthlyHighMinor: 3100000,
      baselineWindow: { startDate: "2026-08-01", endDateExclusive: "2026-09-01" },
    });
    expect(result.document.scopePartitions).toEqual([
      {
        partitionKey: "organization-total",
        channelId: null,
        branchId: null,
        metricDefinitionId: DEFINITION_ID,
        dimensionsDigest: "empty",
        periodTimezone: "Asia/Dubai",
      },
    ]);
    expect(result.document.limitations).toContain(
      "Action impact is not included in this estimate.",
    );
  });

  it("refuses a gapped baseline month instead of guessing", async () => {
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        readBaselineFacts: async () => ({ status: "ready", facts: augustFacts({ drop: "2026-08-15" }) }),
      }),
    );

    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("refuses without a bound revenue definition before reading facts", async () => {
    const readBaselineFacts = vi.fn(async (): Promise<RevenueFactsEnvelope> => ({
      status: "ready",
      facts: augustFacts(),
    }));
    const deps = dependencies({ resolveRevenueDefinitionId: async () => null, readBaselineFacts });
    const result = await assembleLedgerBaselineCandidate(material(), context(), deps);

    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
    expect(readBaselineFacts).not.toHaveBeenCalled();
  });

  it("refuses when the baseline read throws instead of publishing partial", async () => {
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        readBaselineFacts: async () => {
          throw new Error("transport down");
        },
      }),
    );

    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("refuses a denied baseline read instead of publishing partial", async () => {
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        readBaselineFacts: async () => ({ status: "denied", reason: "PERMISSION_DENIED" }),
      }),
    );

    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("refuses a mixed-currency baseline it cannot name", async () => {
    const facts = augustFacts();
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        readBaselineFacts: async () => ({
          status: "ready",
          facts: facts.map((fact, index) =>
            index === 0 ? { ...fact, currency: "USD" } : fact,
          ),
        }),
      }),
    );

    expect(result).toMatchObject({ status: "refused", reason: "INVALID_INPUT" });
  });

  it("freezes one partition per reporting coordinate", async () => {
    const channelA = "33333333-3333-4333-8333-333333333333";
    const channelB = "44444444-4444-4444-8444-444444444444";
    const keyA = `channel-${channelA}-branch-org`;
    const keyB = `channel-${channelB}-branch-org`;
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        listBaselineCoordinates: async () => [
          { channelId: channelA, branchId: null },
          { channelId: channelB, branchId: null },
        ],
        readBaselineFacts: async () => ({
          status: "ready",
          facts: [
            ...augustFacts({ key: keyA }).map((fact) => ({ ...fact, amountMinor: 60000 })),
            ...augustFacts({ key: keyB }).map((fact) => ({ ...fact, amountMinor: 40000 })),
          ],
        }),
      }),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.document.monthlyLowMinor).toBe(3100000);
    expect(result.document.scopePartitions.map((partition) => partition.partitionKey).sort()).toEqual(
      [keyA, keyB].sort(),
    );
  });

  it("refuses when one reporting coordinate is gapped", async () => {
    const channelA = "33333333-3333-4333-8333-333333333333";
    const channelB = "44444444-4444-4444-8444-444444444444";
    const keyA = `channel-${channelA}-branch-org`;
    const keyB = `channel-${channelB}-branch-org`;
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        listBaselineCoordinates: async () => [
          { channelId: channelA, branchId: null },
          { channelId: channelB, branchId: null },
        ],
        readBaselineFacts: async () => ({
          status: "ready",
          facts: [
            ...augustFacts({ key: keyA }),
            ...augustFacts({ key: keyB, drop: "2026-08-15" }),
          ],
        }),
      }),
    );

    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("refuses an empty baseline month with no coordinates", async () => {
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({ listBaselineCoordinates: async () => [] }),
    );

    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });
});
