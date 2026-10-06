import { describe, expect, it, vi } from "vitest";

import type { RevenueFact } from "@/domain/organizations/growth-progress";
import type { RevenueScenarioInput } from "@/domain/organizations/revenue-scenario";
import type { BaselineFact } from "@/modules/organizations/application/growth-projection-builder";
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

  it("publishes from a single reported day at the first rung", async () => {
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        readBaselineFacts: async () => ({ status: "ready", facts: septemberFacts({ from: 21 }) }),
      }),
    );

    // ADR 0069: the floor is 1 reported day, so one day builds on its own —
    // labelled with its exact count, never presented as a full month of data.
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.document.monthlyLowMinor).toBe(3000000);
    expect(result.document.baselineWindow).toEqual({
      startDate: "2026-08-23",
      endDateExclusive: "2026-09-22",
    });
    expect(result.document.limitations.join(" ")).toContain(
      "Baseline from 1 reported days (ending 2026-09-21)",
    );
  });

  it("refuses when no rung reports a single day", async () => {
    const readBaselineFacts = vi.fn(async (): Promise<RevenueFactsEnvelope> => ({
      status: "ready",
      facts: [],
    }));
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({ readBaselineFacts }),
    );

    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
    // An empty window widens through every rung before the assembly gives
    // up; it never publishes a guess.
    expect(readBaselineFacts).toHaveBeenCalledTimes(4);
  });

  it("builds at the first rung instead of widening a thin recent window", async () => {
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

    // Six September days meet the 1-day floor, so rung one builds on its own
    // even though deeper history holds more: the first rung with at least
    // one reported day wins.
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.document.baselineWindow).toEqual({
      startDate: "2026-08-23",
      endDateExclusive: "2026-09-22",
    });
    expect(result.document.monthlyLowMinor).toBe(3000000);
    expect(result.document.limitations.join(" ")).toContain(
      "Baseline from 6 reported days (ending 2026-09-21)",
    );
  });

  it("publishes the qualifying partition while naming the excluded one", async () => {
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
          facts: septemberFacts({ key: keyA }),
        }),
      }),
    );

    // Only keyA reported: the baseline covers exactly it, and keyB is named
    // as excluded rather than silently dropped.
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.document.monthlyLowMinor).toBe(3000000);
    expect(result.document.scopePartitions.map((partition) => partition.partitionKey)).toEqual([
      keyA,
    ]);
    const text = result.document.limitations.join(" ");
    expect(text).toContain("Baseline covers 1 of 2 scope partitions");
    expect(text).toContain("Excluded partitions with no qualifying baseline");
    expect(text).toContain(keyB);
  });

  it("counts ghost partitions' unreconciled days instead of zeroing the assessment", async () => {
    // Live-case shape: org-level rows plus a single-day channel row, all
    // unreconciled with no digest. The old joint rule needed every partition
    // to cover a day, so these ghosts zeroed the whole assessment; assessed
    // per partition, each contributes its own reported days.
    const channel = "55555555-5555-4555-8555-555555555555";
    const channelKey = `channel-${channel}-branch-org`;
    const dayFact = (
      date: string,
      next: string,
      key: string,
      amountMinor: number,
      rowId: string,
    ): BaselineFact => ({
      sourceTable: "normalized_metrics",
      rowId,
      organizationId: ORG_ID,
      partitionKey: key,
      startDate: date,
      endDateExclusive: next,
      amountMinor,
      currency: "AED",
      createdAt: "2026-09-21T00:00:00.000Z",
      reconciliationDigest: null,
      provenance: "unreconciled",
    });
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        listBaselineCoordinates: async () => [{ channelId: null, branchId: null }, { channelId: channel, branchId: null }],
        readBaselineFacts: async () => ({
          status: "ready",
          facts: [
            dayFact("2026-09-19", "2026-09-20", "organization-total", 100000, "ghost-org-1"),
            dayFact("2026-09-20", "2026-09-21", "organization-total", 100000, "ghost-org-2"),
            dayFact("2026-09-21", "2026-09-22", "organization-total", 100000, "ghost-org-3"),
            dayFact("2026-09-21", "2026-09-22", channelKey, 50000, "ghost-channel-1"),
          ],
        }),
      }),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    // 100k/day plus 50k/day paces sum to a 150k/day combined pace.
    expect(result.document.monthlyLowMinor).toBe(4500000);
    expect(
      result.document.scopePartitions.map((partition) => partition.partitionKey).sort(),
    ).toEqual(["organization-total", channelKey].sort());
    const text = result.document.limitations.join(" ");
    expect(text).toContain("Baseline from 4 reported days (ending 2026-09-21)");
    expect(text).toContain("treat figures as estimates pending reconciliation");
  });

  it("publishes the clean partition when another partition conflicts", async () => {
    const channelA = "33333333-3333-4333-8333-333333333333";
    const channelB = "44444444-4444-4444-8444-444444444444";
    const keyA = `channel-${channelA}-branch-org`;
    const keyB = `channel-${channelB}-branch-org`;
    const clash: BaselineFact[] = [3_100_000, 3_100_001].map(
      (amountMinor, index): BaselineFact => ({
        sourceTable: "exact_range_metric_observations",
        rowId: `span-clash-${index}`,
        organizationId: ORG_ID,
        partitionKey: keyA,
        startDate: "2026-09-01",
        endDateExclusive: "2026-09-22",
        amountMinor,
        currency: "AED",
        createdAt: "2026-09-21T00:00:00.000Z",
        reconciliationDigest: DIGEST,
        provenance: "reconciled",
      }),
    );
    const readBaselineFacts = vi.fn(async (): Promise<RevenueFactsEnvelope> => ({
      status: "ready",
      facts: [...clash, ...septemberFacts({ key: keyB, from: 19 })],
    }));
    const result = await assembleLedgerBaselineCandidate(
      material(),
      context(),
      dependencies({
        listBaselineCoordinates: async () => [
          { channelId: channelA, branchId: null },
          { channelId: channelB, branchId: null },
        ],
        readBaselineFacts,
      }),
    );

    // keyA's conflict refuses only keyA; keyB's three days build at rung one.
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(readBaselineFacts).toHaveBeenCalledTimes(1);
    expect(result.document.scopePartitions.map((partition) => partition.partitionKey)).toEqual([
      keyB,
    ]);
    const text = result.document.limitations.join(" ");
    expect(text).toContain("Excluded partitions with no qualifying baseline");
    expect(text).toContain(keyA);
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
