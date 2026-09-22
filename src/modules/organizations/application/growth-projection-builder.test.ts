import { describe, expect, it } from "vitest";

import {
  BASELINE_ONLY_LIMITATION,
  buildGrowthProjectionCandidate,
  GROWTH_BASELINE_FALLBACK_RUNGS,
  GROWTH_BASELINE_MAX_AGE_DAYS,
  GROWTH_BASELINE_MIN_REPORTED_DAYS,
  resolveTrailingBaselineWindow,
  type BuildGrowthProjectionCandidateInput,
} from "@/modules/organizations/application/growth-projection-builder";
import { frozenGrowthProjectionSchema } from "@/domain/organizations/growth-progress";
import type { RevenueFact } from "@/domain/organizations/growth-progress";

/**
 * Candidate documents for the fixed-projection worker (data contract D03).
 *
 * Like estimating a shop's monthly pace from its recent till receipts: the
 * estimate only exists when enough recent days actually reported, each day is
 * counted exactly once, and the freshest receipt is new enough to trust.
 * Missing days are left out and named — never zero-filled, never invented —
 * otherwise the answer is a typed refusal, never a guessed figure.
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
    minReportedDays: 7,
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

describe("resolveTrailingBaselineWindow", () => {
  it("names the 30 local days ending at the source cutoff", () => {
    expect(resolveTrailingBaselineWindow("2029-12-31")).toEqual({
      startDate: "2029-12-02",
      endDateExclusive: "2030-01-01",
    });
    expect(resolveTrailingBaselineWindow("2030-03-01")).toEqual({
      startDate: "2030-01-31",
      endDateExclusive: "2030-03-02",
    });
  });

  it("pins the freshness and minimum-day floors as named constants", () => {
    expect(GROWTH_BASELINE_MAX_AGE_DAYS).toBe(45);
    expect(GROWTH_BASELINE_MIN_REPORTED_DAYS).toBe(7);
  });

  it("names a wider window when the rung reaches further back", () => {
    expect(resolveTrailingBaselineWindow("2029-12-31", 60)).toEqual({
      startDate: "2029-11-02",
      endDateExclusive: "2030-01-01",
    });
  });

  it("pins the fallback ladder: older data earns its place with more of it", () => {
    expect(GROWTH_BASELINE_FALLBACK_RUNGS).toEqual([
      { minReportedDays: 7, windowDays: 30 },
      { minReportedDays: 14, windowDays: 60 },
      { minReportedDays: 21, windowDays: 90 },
      { minReportedDays: 28, windowDays: 120 },
    ]);
  });
});

describe("buildGrowthProjectionCandidate", () => {
  it("builds a ready document scaled from the trailing reported days", () => {
    const result = buildGrowthProjectionCandidate(baseInput(qualifiedInputs()));
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    const parsed = frozenGrowthProjectionSchema.safeParse(result.document);
    expect(parsed.success).toBe(true);
    expect(result.document.metricKey).toBe("revenue.gross");
    // 31 reported days at 100k: the mean scales to a 30-day month of 3M.
    expect(result.document.monthlyLowMinor).toBe(3_000_000 + 50_000);
    expect(result.document.monthlyHighMinor).toBe(3_000_000 + 100_000);
    // 31-day horizon: anchor plus one point per day, final day exact.
    expect(result.document.points).toHaveLength(32);
    const final = result.document.points[31]!;
    expect(final.date).toBe("2030-01-31");
    expect(final.lowMinor).toBe(3_050_000);
    expect(final.highMinor).toBe(3_100_000);
    expect(result.document.actionAssumptions).toHaveLength(1);
    expect(result.document.limitations.join(" ")).not.toContain(BASELINE_ONLY_LIMITATION);
    expect(result.document.limitations.join(" ")).toContain(
      "Baseline from 31 reported days (ending 2029-12-31)",
    );
  });

  it("labels the history from the latest reported day, never from an arbitrary bucket", () => {
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
    // and the label stays the latest reported day rather than anything the stray implies.
    expect(result.document.monthlyLowMinor).toBe(3_050_000);
    expect(result.document.baselineWindow).toEqual({
      startDate: "2029-12-01",
      endDateExclusive: "2030-01-01",
    });
  });

  it("prefers the daily cover over an equivalent coarse span, never adding both", () => {
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
    expect(result.document.monthlyLowMinor).toBe(3_000_000);
    expect(result.document.monthlyHighMinor).toBe(3_000_000);
  });

  it("prefers the daily cover when a coarse span disagrees with it", () => {
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
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    expect(result.document.monthlyLowMinor).toBe(3_000_000);
  });

  it("scales a gapped window from its reported days instead of refusing it", () => {
    const facts = dailyDecemberFacts().filter((fact) => fact.rowId !== "day-10");
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: facts }));
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    // 30 reported days at 100k scale to the same 3M pace; the gap is named.
    expect(result.document.monthlyLowMinor).toBe(3_000_000);
    expect(result.document.limitations.join(" ")).toContain(
      "Baseline from 30 reported days (ending 2029-12-31)",
    );
  });

  it("refuses fewer than 7 reported days instead of guessing from a sliver", () => {
    const facts = dailyDecemberFacts().slice(0, 6);
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: facts }));
    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("honours a higher rung floor instead of the default 7", () => {
    const ten = dailyDecemberFacts().slice(0, 10);
    const refused = buildGrowthProjectionCandidate(
      baseInput({ baselineFacts: ten, minReportedDays: 14 }),
    );
    expect(refused).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
    const ready = buildGrowthProjectionCandidate(
      baseInput({ baselineFacts: dailyDecemberFacts().slice(0, 14), minReportedDays: 14 }),
    );
    if (ready.status !== "ready") throw new Error(`expected ready, got ${ready.status}`);
    expect(ready.document.limitations.join(" ")).toContain("Baseline from 14 reported days");
  });

  it("spreads one weekly span over its own reported days, never inventing money", () => {
    const weeks: RevenueFact[] = [];
    const starts = ["2029-12-02", "2029-12-09", "2029-12-16", "2029-12-23"];
    for (const [index, start] of starts.entries()) {
      const end =
        index === 3 ? "2029-12-30" : `2029-12-${String(Number(start.slice(8, 10)) + 7).padStart(2, "0")}`;
      weeks.push({
        sourceTable: "exact_range_metric_observations",
        rowId: `week-${index}`,
        organizationId: ORG,
        partitionKey: "pk-1",
        startDate: start,
        endDateExclusive: end,
        amountMinor: 700_000,
        currency: "AED",
        createdAt: "2029-12-15T00:00:00Z",
        reconciliationDigest: `digest-week-${index}`,
      });
    }
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: weeks }));
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    // 28 reported days at exactly 100k/day scale to the same 3M monthly pace
    // as daily grain would: the mean is honest about what reported.
    expect(result.document.monthlyLowMinor).toBe(3_000_000);
    expect(result.document.limitations.join(" ")).toContain(
      "Baseline from 28 reported days (ending 2029-12-29)",
    );
  });

  it("refuses disagreeing spans instead of picking a winner", () => {
    const spans = [3_100_000, 3_100_001].map(
      (amountMinor, index): RevenueFact => ({
        sourceTable: "exact_range_metric_observations",
        rowId: `span-${index}`,
        organizationId: ORG,
        partitionKey: "pk-1",
        startDate: "2029-12-01",
        endDateExclusive: "2030-01-01",
        amountMinor,
        currency: "AED",
        createdAt: "2029-12-15T00:00:00Z",
        reconciliationDigest: `digest-span-${index}`,
      }),
    );
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: spans }));
    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("excludes one foreign-currency day instead of converting it", () => {
    const facts = dailyDecemberFacts().map((fact, index) =>
      index === 0 ? { ...fact, currency: "USD" } : fact,
    );
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: facts }));
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    expect(result.document.monthlyLowMinor).toBe(3_000_000);
    expect(result.document.limitations.join(" ")).toContain("Baseline from 30 reported days");
  });

  it("refuses an all-foreign-currency window instead of converting it", () => {
    const facts = dailyDecemberFacts().map((fact) => ({ ...fact, currency: "USD" }));
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: facts }));
    expect(result).toMatchObject({ status: "refused", reason: "BASELINE_INCOMPLETE" });
  });

  it("accepts a partial trailing window scaled from its reported days", () => {
    const result = buildGrowthProjectionCandidate(
      baseInput({
        baselineWindow: { startDate: "2029-12-05", endDateExclusive: "2030-01-01" },
      }),
    );
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    // 27 reported days at 100k scale to the same 3M pace; the window is a
    // trailing slice, never a blessed calendar month.
    expect(result.document.monthlyLowMinor).toBe(3_000_000);
    expect(result.document.limitations.join(" ")).toContain("Baseline from 27 reported days");
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

  it("accepts a 45-day-old latest report and refuses a 46-day-old one", () => {
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
      sourceCutoffDate: "2030-01-31",
      baselineWindow: { startDate: "2030-01-01", endDateExclusive: "2030-02-01" },
      baselineFacts: januaryFacts,
    });
    // Latest report Jan 31 to issue Mar 17 is exactly 45 days: fresh.
    const fresh = buildGrowthProjectionCandidate(baseInput(aged("2030-03-17T12:00:00Z")));
    if (fresh.status !== "ready") throw new Error(`expected ready, got ${fresh.status}`);
    // One day later the same evidence is stale.
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
    expect(result.document.monthlyLowMinor).toBe(3_050_000);
    expect(result.document.monthlyHighMinor).toBe(3_150_000);
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
      expect(result.document.monthlyLowMinor).toBe(3_000_000);
      expect(result.document.monthlyHighMinor).toBe(3_000_000);
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

  it("refuses an overflowing monthly pace instead of wrapping it", () => {
    // Seven maximum days: the observed mean already touches the safe-integer
    // ceiling, so scaling it to a standard month must refuse, not wrap.
    const huge: RevenueFact[] = [];
    for (let day = 25; day <= 31; day += 1) {
      const start = `2029-12-${day}`;
      const end = day === 31 ? "2030-01-01" : `2029-12-${day + 1}`;
      huge.push({
        sourceTable: "normalized_metrics",
        rowId: `huge-${day}`,
        organizationId: ORG,
        partitionKey: "pk-1",
        startDate: start,
        endDateExclusive: end,
        amountMinor: Number.MAX_SAFE_INTEGER,
        currency: "AED",
        createdAt: "2029-12-15T00:00:00Z",
        reconciliationDigest: `digest-huge-${day}`,
      });
    }
    const result = buildGrowthProjectionCandidate(baseInput({ baselineFacts: huge }));
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

  it("freezes baseline-only manifests empty rather than unbound (Task-5 decision a)", () => {
    const result = buildGrowthProjectionCandidate(baseInput());
    if (result.status !== "ready") throw new Error(`expected ready, got ${result.reason}`);
    // Empty is contract-valid: the publication boundary binds every
    // manifest row to a ledger revision the fact DTO does not carry, so a
    // populated-but-unbound manifest could never publish.
    expect(result.document.sources).toEqual([]);
    expect(frozenGrowthProjectionSchema.safeParse(result.document).success).toBe(true);
    expect(result.document.baselineWindow).toEqual({
      startDate: "2029-12-01",
      endDateExclusive: "2030-01-01",
    });
    expect(result.document.limitations).toContain(BASELINE_ONLY_LIMITATION);
    expect(result.document.limitations.join(" ")).toContain("Baseline from 31 reported days");
  });
});
