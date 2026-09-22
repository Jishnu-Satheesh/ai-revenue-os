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

/** Dubai local 2026-09-21: the trailing window runs 2026-08-23 → 2026-09-22. */
const ISSUED_AT = "2026-09-21T00:00:00.000Z";

function material(): RevenueScenarioInput {
  return {
    organizationId: ORG_ID,
    grain: "month",
    history: [{ label: "2026-09", minorUnits: 3000000, currency: "AED" }],
    losses: [],
    actions: [],
    lastObservationDate: "2026-09-21",
    today: "2026-09-21",
    cutoffNote: "Reports through 2026-09-21.",
    coverageNote: "Trailing reported-day baseline.",
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

function septemberFacts(
  options: { drop?: string; currency?: string; key?: string; from?: number } = {},
): RevenueFact[] {
  const key = options.key ?? "organization-total";
  const from = options.from ?? 1;
  const facts: RevenueFact[] = [];
  for (let day = from; day <= 21; day += 1) {
    const date = `2026-09-${String(day).padStart(2, "0")}`;
    if (options.drop === date) continue;
    const next = day === 21 ? "2026-09-22" : `2026-09-${String(day + 1).padStart(2, "0")}`;
    facts.push({
      sourceTable: "normalized_metrics",
      rowId: `fact-${key}-${date}`,
      organizationId: ORG_ID,
      partitionKey: key,
      startDate: date,
      endDateExclusive: next,
      amountMinor: 100000,
      currency: options.currency ?? "AED",
      createdAt: "2026-09-21T00:00:00.000Z",
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
      facts: septemberFacts(),
    }),
    ...overrides,
  };
}

describe("assembleLedgerBaselineCandidate", () => {
  it("freezes a baseline-only document over the trailing reported window", async () => {
    const seen: Array<{ from: string; toExclusive: string }> = [];
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        listBaselineCoordinates: async (input) => {
          seen.push({ from: input.from, toExclusive: input.toExclusive });
          return [{ channelId: null, branchId: null }];
        },
        readBaselineFacts: async (input): Promise<RevenueFactsEnvelope> => {
          seen.push({ from: input.from, toExclusive: input.toExclusive });
          return { status: "ready", facts: septemberFacts() };
        },
      }),
    );

    // Both reads run over the 30 days ending at the source cutoff.
    expect(seen).toEqual([
      { from: "2026-08-23", toExclusive: "2026-09-22" },
      { from: "2026-08-23", toExclusive: "2026-09-22" },
    ]);
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
      monthlyLowMinor: 3000000,
      monthlyHighMinor: 3000000,
      baselineWindow: { startDate: "2026-08-23", endDateExclusive: "2026-09-22" },
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
    expect(result.document.limitations.join(" ")).toContain(
      "Baseline from 21 reported days (ending 2026-09-21)",
    );
  });

  it("publishes a gapped window scaled from its reported days", async () => {
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        readBaselineFacts: async () => ({
          status: "ready",
          facts: septemberFacts({ drop: "2026-09-15" }),
        }),
      }),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.document.monthlyLowMinor).toBe(3000000);
    expect(result.document.limitations.join(" ")).toContain("Baseline from 20 reported days");
  });

  it("refuses a sliver of fewer than 7 reported days", async () => {
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        readBaselineFacts: async () => ({ status: "ready", facts: septemberFacts({ from: 16 }) }),
      }),
    );

    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("widens to the second rung when the recent window is thin but history is deep", async () => {
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        readBaselineFacts: async (input): Promise<RevenueFactsEnvelope> => ({
          status: "ready",
          facts:
            input.from === "2026-08-23"
              ? septemberFacts({ from: 16 })
              : septemberFacts(),
        }),
      }),
    );

    // Six September days cannot carry rung one, but the wider window holds 21
    // reported days against rung two's floor of 14: older data earned its
    // place with more of it.
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.document.baselineWindow).toEqual({
      startDate: "2026-07-24",
      endDateExclusive: "2026-09-22",
    });
    expect(result.document.monthlyLowMinor).toBe(3000000);
    expect(result.document.limitations.join(" ")).toContain(
      "Baseline from 21 reported days (ending 2026-09-21)",
    );
  });

  it("refuses when deeper history still misses the higher rung floor", async () => {
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        readBaselineFacts: async (input): Promise<RevenueFactsEnvelope> => ({
          status: "ready",
          facts:
            input.from === "2026-08-23"
              ? septemberFacts({ from: 16 })
              : septemberFacts({ from: 12 }),
        }),
      }),
    );

    // Ten reported days clear rung one's floor of 7 only in count, but rung
    // one never sees them: the recent window holds six, and ten misses rung
    // two's floor of 14 and every rung above it.
    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("refuses a conflict at the first rung instead of widening past it", async () => {
    const clash: RevenueFact[] = [3_100_000, 3_100_001].map(
      (amountMinor, index): RevenueFact => ({
        sourceTable: "exact_range_metric_observations",
        rowId: `span-${index}`,
        organizationId: ORG_ID,
        partitionKey: "organization-total",
        startDate: "2026-09-01",
        endDateExclusive: "2026-09-22",
        amountMinor,
        currency: "AED",
        createdAt: "2026-09-21T00:00:00.000Z",
        reconciliationDigest: DIGEST,
      }),
    );
    const readBaselineFacts = vi.fn(async (): Promise<RevenueFactsEnvelope> => ({
      status: "ready",
      facts: clash,
    }));
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({ readBaselineFacts }),
    );

    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
    expect(readBaselineFacts).toHaveBeenCalledTimes(1);
  });

  it("refuses without a bound revenue definition before reading facts", async () => {
    const readBaselineFacts = vi.fn(async (): Promise<RevenueFactsEnvelope> => ({
      status: "ready",
      facts: septemberFacts(),
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
    const facts = septemberFacts();
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
            ...septemberFacts({ key: keyA }).map((fact) => ({ ...fact, amountMinor: 60000 })),
            ...septemberFacts({ key: keyB }).map((fact) => ({ ...fact, amountMinor: 40000 })),
          ],
        }),
      }),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.document.monthlyLowMinor).toBe(3000000);
    expect(result.document.scopePartitions.map((partition) => partition.partitionKey).sort()).toEqual(
      [keyA, keyB].sort(),
    );
  });

  it("publishes when one reporting coordinate gaps a day", async () => {
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
            ...septemberFacts({ key: keyA }),
            ...septemberFacts({ key: keyB, drop: "2026-09-15" }),
          ],
        }),
      }),
    );

    // The gapped day drops out of the mean; the other 20 reported days carry it.
    // Both partitions report 100k/day here, so the pace is a 6M month.
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.document.monthlyLowMinor).toBe(6000000);
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
