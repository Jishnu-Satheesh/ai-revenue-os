import { describe, expect, it } from "vitest";

import {
  BASELINE_ONLY_LIMITATION,
  buildGrowthProjectionCandidate,
  GROWTH_BASELINE_MAX_AGE_DAYS,
  resolvePriorCalendarMonthWindow,
  type BuildGrowthProjectionCandidateInput,
} from "@/modules/organizations/application/growth-projection-builder";
import { frozenGrowthProjectionSchema } from "@/domain/organizations/growth-progress";
import type { RevenueFact } from "@/domain/organizations/growth-progress";

/**
 * Candidate documents for the fixed-projection worker (data contract D03).
 *
 * Like checking a month's shop ledger before writing next month's rota: the
 * rota only exists when the whole prior month is counted, counted once, and
 * fresh enough to trust — otherwise the answer is a typed refusal, never a
 * guessed rota.
 */

const ORG = "11111111-1111-4111-8111-111111111111";
const DEF = "22222222-2222-4222-8222-222222222222";
const FINDING = "33333333-3333-4333-8333-333333333333";

const SCOPE = [
  {
    partitionKey: "pk-1",
    channelId: null,
    branchId: null,
    metricDefinitionId: DEF,
    dimensionsDigest: "empty",
    periodTimezone: "UTC",
  },
] as const;

function dailyDecemberFacts(amountMinor = 100_000): RevenueFact[] {
  const facts: RevenueFact[] = [];
  for (let day = 1; day <= 31; day += 1) {
    const start = `2029-12-${String(day).padStart(2, "0")}`;
    const end = day === 31 ? "2030-01-01" : `2029-12-${String(day + 1).padStart(2, "0")}`;
    facts.push({
      sourceTable: "normalized_metrics",
      rowId: `day-${day}`,
      organizationId: ORG,
      partitionKey: "pk-1",
      startDate: start,
      endDateExclusive: end,
      amountMinor,
      currency: "AED",
      createdAt: "2029-12-15T00:00:00Z",
      reconciliationDigest: `digest-${day}`,
    });
  }
  return facts;
}

function baseInput(overrides: Partial<BuildGrowthProjectionCandidateInput> = {}) {
  return {
    organizationId: ORG,
    scheduleOriginDate: "2030-01-01",
    period: {
      horizonMonths: 1 as const,
      cycleIndex: 0,
      startDate: "2030-01-01",
      endDateExclusive: "2030-02-01",
    },
    issuedAt: "2029-12-31T12:00:00Z",
    sourceCutoffDate: "2029-12-31",
    timeZone: "UTC",
    currency: "AED",
    scopePartitions: [...SCOPE],
    baselineWindow: { startDate: "2029-12-01", endDateExclusive: "2030-01-01" },
    baselineFacts: dailyDecemberFacts(),
    findingBases: [],
    actionCandidates: [],
    ...overrides,
  } satisfies BuildGrowthProjectionCandidateInput;
}

function qualifiedInputs(): Pick<
  BuildGrowthProjectionCandidateInput,
  "findingBases" | "actionCandidates"
> {
  return {
    findingBases: [
      {
        findingId: FINDING,
        organizationId: ORG,
        basisMinorUnits: 500_000,
        currency: "AED",
        windowStartDate: "2029-12-01",
        windowEndExclusive: "2030-01-01",
        channelId: null,
        branchId: null,
      },
    ],
    actionCandidates: [
      {
        sourceKind: "growth-recommendation",
        sourceId: "rec-1",
        sourceRevision: "7",
        citedFindingId: FINDING,
        lowFraction: 0.1,
        highFraction: 0.2,
      },
    ],
  };
}

describe("resolvePriorCalendarMonthWindow", () => {
  it("names the calendar month before the issue date", () => {
    expect(resolvePriorCalendarMonthWindow("2030-01-15")).toEqual({
      startDate: "2029-12-01",
      endDateExclusive: "2030-01-01",
    });
    expect(resolvePriorCalendarMonthWindow("2030-03-01")).toEqual({
      startDate: "2030-02-01",
      endDateExclusive: "2030-03-01",
    });
  });

  it("pins the 45-day freshness bound as a named constant", () => {
    expect(GROWTH_BASELINE_MAX_AGE_DAYS).toBe(45);
  });
});

describe("buildGrowthProjectionCandidate", () => {
  it("builds a ready document from a complete prior month", () => {
    const result = buildGrowthProjectionCandidate(baseInput(qualifiedInputs()));
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    const parsed = frozenGrowthProjectionSchema.safeParse(result.document);
    expect(parsed.success).toBe(true);
    expect(result.document.metricKey).toBe("revenue.gross");
    expect(result.document.monthlyLowMinor).toBe(3_100_000 + 50_000);
    expect(result.document.monthlyHighMinor).toBe(3_100_000 + 100_000);
    // 31-day horizon: anchor plus one point per day, final day exact.
    expect(result.document.points).toHaveLength(32);
    const final = result.document.points[31]!;
    expect(final.date).toBe("2030-01-31");
    expect(final.lowMinor).toBe(3_150_000);
    expect(final.highMinor).toBe(3_200_000);
    expect(result.document.actionAssumptions).toHaveLength(1);
    expect(result.document.limitations.join(" ")).not.toContain(BASELINE_ONLY_LIMITATION);
  });

  it("labels the history month from the window, never from an arbitrary bucket", () => {
    const stray: RevenueFact = {
      sourceTable: "normalized_metrics",
      rowId: "stray-nov",
      organizationId: ORG,
      partitionKey: "pk-1",
      startDate: "2029-11-30",
      endDateExclusive: "2029-12-01",
      amountMinor: 999_999,
      currency: "AED",
      createdAt: "2029-12-15T00:00:00Z",
      reconciliationDigest: "digest-stray",
    };
    const result = buildGrowthProjectionCandidate(
      baseInput({ ...qualifiedInputs(), baselineFacts: [...dailyDecemberFacts(), stray] }),
    );
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    // The stray November day is outside the window, so the total is unchanged
    // and the label stays the window month rather than anything the stray implies.
    expect(result.document.monthlyLowMinor).toBe(3_150_000);
    expect(result.document.baselineWindow).toEqual({
      startDate: "2029-12-01",
      endDateExclusive: "2030-01-01",
    });
  });

  it("treats an equivalent coarse span as one value, not a double count", () => {
    const span: RevenueFact = {
      sourceTable: "exact_range_metric_observations",
      rowId: "span-dec",
      organizationId: ORG,
      partitionKey: "pk-1",
      startDate: "2029-12-01",
      endDateExclusive: "2030-01-01",
      amountMinor: 3_100_000,
      currency: "AED",
      createdAt: "2029-12-15T00:00:00Z",
      reconciliationDigest: "digest-span",
    };
    const result = buildGrowthProjectionCandidate(
      baseInput({ baselineFacts: [...dailyDecemberFacts(), span] }),
    );
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    expect(result.document.monthlyLowMinor).toBe(3_100_000);
    expect(result.document.monthlyHighMinor).toBe(3_100_000);
  });

  it("refuses a gapped baseline instead of inventing the missing days", () => {
    const facts = dailyDecemberFacts().filter((fact) => fact.rowId !== "day-10");
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: facts }));
    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("refuses a conflicting baseline instead of picking a winner", () => {
    const span: RevenueFact = {
      sourceTable: "exact_range_metric_observations",
      rowId: "span-wrong",
      organizationId: ORG,
      partitionKey: "pk-1",
      startDate: "2029-12-01",
      endDateExclusive: "2030-01-01",
      amountMinor: 3_100_001,
      currency: "AED",
      createdAt: "2029-12-15T00:00:00Z",
      reconciliationDigest: "digest-span-wrong",
    };
    const result = buildGrowthProjectionCandidate(
      baseInput({ baselineFacts: [...dailyDecemberFacts(), span] }),
    );
    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("refuses a foreign-currency baseline instead of converting it", () => {
    const facts = dailyDecemberFacts().map((fact, index) =>
      index === 0 ? { ...fact, currency: "USD" } : fact,
    );
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: facts }));
    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("refuses a non-calendar-month window instead of blessing an arbitrary bucket", () => {
    const result = buildGrowthProjectionCandidate(
      baseInput({
        baselineWindow: { startDate: "2029-12-05", endDateExclusive: "2030-01-01" },
      }),
    );
    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("refuses a baseline overlapping the projection period", () => {
    const result = buildGrowthProjectionCandidate(
      baseInput({
        baselineWindow: { startDate: "2030-01-01", endDateExclusive: "2030-02-01" },
        baselineFacts: [],
      }),
    );
    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("accepts a 45-day-old baseline and refuses a 46-day-old one", () => {
    const januaryFacts: RevenueFact[] = [];
    for (let day = 1; day <= 31; day += 1) {
      const start = `2030-01-${String(day).padStart(2, "0")}`;
      const end = day === 31 ? "2030-02-01" : `2030-01-${String(day + 1).padStart(2, "0")}`;
      januaryFacts.push({
        sourceTable: "normalized_metrics",
        rowId: `jan-${day}`,
        organizationId: ORG,
        partitionKey: "pk-1",
        startDate: start,
        endDateExclusive: end,
        amountMinor: 10_000,
        currency: "AED",
        createdAt: "2030-02-01T00:00:00Z",
        reconciliationDigest: `digest-jan-${day}`,
      });
    }
    const aged = (issuedAt: string) => ({
      scheduleOriginDate: "2030-01-01",
      period: {
        horizonMonths: 3 as const,
        cycleIndex: 1,
        startDate: "2030-04-01",
        endDateExclusive: "2030-07-01",
      },
      issuedAt,
      baselineWindow: { startDate: "2030-01-01", endDateExclusive: "2030-02-01" },
      baselineFacts: januaryFacts,
    });
    // Month end Jan 31 to issue Mar 17 is exactly 45 days: fresh.
    const fresh = buildGrowthProjectionCandidate(baseInput(aged("2030-03-17T12:00:00Z")));
    expect(fresh.status).toBe("ready");
    // One day later the same month is stale.
    const stale = buildGrowthProjectionCandidate(baseInput(aged("2030-03-18T12:00:00Z")));
    expect(stale).toMatchObject({ status: "refused", reason: "BASELINE_STALE" });
  });

  it("shares one joint figure between actions citing the same finding", () => {
    const inputs = qualifiedInputs();
    const result = buildGrowthProjectionCandidate(
      baseInput({
        ...inputs,
        actionCandidates: [
          inputs.actionCandidates[0]!,
          {
            sourceKind: "growth-recommendation",
            sourceId: "rec-2",
            sourceRevision: "7",
            citedFindingId: FINDING,
            lowFraction: 0.05,
            highFraction: 0.3,
          },
        ],
      }),
    );
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    // Joint maximum, never the sum: low max(50k, 25k), high max(100k, 150k).
    expect(result.document.monthlyLowMinor).toBe(3_150_000);
    expect(result.document.monthlyHighMinor).toBe(3_250_000);
    expect(result.document.actionAssumptions).toHaveLength(2);
  });

  it("keeps the advice visible but drops its money when the basis is unqualified", () => {
    const cases: Array<Partial<ReturnType<typeof qualifiedInputs>["findingBases"][number]>> = [
      { currency: "USD" },
      { organizationId: "99999999-9999-4999-8999-999999999999" },
      { windowStartDate: "2029-11-01", windowEndExclusive: "2029-12-01" },
      { branchId: "44444444-4444-4444-8444-444444444444" },
    ];
    for (const patch of cases) {
      const inputs = qualifiedInputs();
      const result = buildGrowthProjectionCandidate(
        baseInput({
          findingBases: [{ ...inputs.findingBases[0]!, ...patch }],
          actionCandidates: inputs.actionCandidates,
        }),
      );
      if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
      // The range stays out of the frozen numbers, and the estimate says so.
      expect(result.document.actionAssumptions).toHaveLength(0);
      expect(result.document.monthlyLowMinor).toBe(3_100_000);
      expect(result.document.monthlyHighMinor).toBe(3_100_000);
      expect(result.document.limitations).toContain(BASELINE_ONLY_LIMITATION);
    }
  });

  it("drops a range citing an unknown finding and labels the baseline-only estimate", () => {
    const inputs = qualifiedInputs();
    const result = buildGrowthProjectionCandidate(
      baseInput({
        findingBases: [],
        actionCandidates: inputs.actionCandidates,
      }),
    );
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    expect(result.document.actionAssumptions).toHaveLength(0);
    expect(result.document.limitations).toContain(BASELINE_ONLY_LIMITATION);
  });

  it("refuses an off-grid period and a period that already started", () => {
    const offGrid = buildGrowthProjectionCandidate(
      baseInput({
        period: {
          horizonMonths: 1,
          cycleIndex: 0,
          startDate: "2030-01-05",
          endDateExclusive: "2030-02-05",
        },
      }),
    );
    expect(offGrid).toMatchObject({ status: "refused", reason: "SCHEDULE_MISMATCH" });

    const started = buildGrowthProjectionCandidate(baseInput({ issuedAt: "2030-01-01T12:00:00Z" }));
    expect(started).toMatchObject({ status: "refused", reason: "PERIOD_ALREADY_STARTED" });
  });

  it("refuses an unresolved branch-total overlap instead of double counting", () => {
    const branchId = "44444444-4444-4444-8444-444444444444";
    const result = buildGrowthProjectionCandidate(
      baseInput({
        scopePartitions: [
          { ...SCOPE[0]! },
          {
            partitionKey: "pk-branch",
            channelId: null,
            branchId,
            metricDefinitionId: DEF,
            dimensionsDigest: "empty",
            periodTimezone: "UTC",
          },
        ],
      }),
    );
    expect(result).toMatchObject({ status: "refused", reason: "SCOPE_NOT_COMPARABLE" });
  });

  it("refuses an overflowing monthly total instead of wrapping it", () => {
    const big: RevenueFact = {
      sourceTable: "exact_range_metric_observations",
      rowId: "span-big",
      organizationId: ORG,
      partitionKey: "pk-1",
      startDate: "2029-12-01",
      endDateExclusive: "2030-01-01",
      amountMinor: Number.MAX_SAFE_INTEGER - 50,
      currency: "AED",
      createdAt: "2029-12-15T00:00:00Z",
      reconciliationDigest: "digest-big",
    };
    const inputs = qualifiedInputs();
    const result = buildGrowthProjectionCandidate(baseInput({ ...inputs, baselineFacts: [big] }));
    expect(result).toMatchObject({ status: "refused", reason: "MONEY_OVERFLOW" });
  });

  it("refuses more facts than one view may read instead of a partial total", () => {
    const many: RevenueFact[] = Array.from({ length: 10_001 }, (_, index) => ({
      sourceTable: "normalized_metrics" as const,
      rowId: `row-${index}`,
      organizationId: ORG,
      partitionKey: "pk-1",
      startDate: "2029-12-01",
      endDateExclusive: "2029-12-02",
      amountMinor: 1,
      currency: "AED",
      createdAt: "2029-12-15T00:00:00Z",
      reconciliationDigest: `digest-${index}`,
    }));
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: many }));
    expect(result).toMatchObject({ status: "refused", reason: "SOURCE_LIMIT_EXCEEDED" });
  });

  it("refuses malformed input without throwing", () => {
    const result = buildGrowthProjectionCandidate({ nonsense: true });
    expect(result).toMatchObject({ status: "refused", reason: "INVALID_INPUT" });
  });
});
