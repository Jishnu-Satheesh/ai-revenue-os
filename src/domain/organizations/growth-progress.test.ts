import { describe, expect, it } from "vitest";

import {
  buildActualGrowthSeries,
  buildEvenPaceProjection,
  compareGrowthPoint,
  frozenGrowthProjectionSchema,
  growthComparisonSchema,
  GrowthProgressError,
  sparseGrowthPointsSchema,
  type FrozenGrowthProjection,
  type GrowthProgressPoint,
  type RevenueFact,
  type ScopePartition,
} from "@/domain/organizations/growth-progress";
import {
  growthProgressPointViewSchema,
  growthProgressViewSchema,
} from "@/modules/organizations/application/growth-progress-view";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const METRIC_ID = "33333333-3333-4333-8333-333333333333";
const BRANCH_A = "44444444-4444-4444-8444-444444444444";

const PARTITION: ScopePartition = {
  partitionKey: "org-total",
  channelId: null,
  branchId: null,
  metricDefinitionId: METRIC_ID,
  dimensionsDigest: "empty-object-digest",
  periodTimezone: "Asia/Dubai",
};

const PARTITION_BRANCH_A: ScopePartition = {
  partitionKey: "branch-a",
  channelId: null,
  branchId: BRANCH_A,
  metricDefinitionId: METRIC_ID,
  dimensionsDigest: "empty-object-digest",
  periodTimezone: "Asia/Dubai",
};

function fact(
  rowId: string,
  startDate: string,
  endDateExclusive: string,
  amountMinor: number,
  overrides: Partial<RevenueFact> = {},
): RevenueFact {
  return {
    sourceTable: "normalized_metrics",
    rowId,
    organizationId: ORG_ID,
    partitionKey: PARTITION.partitionKey,
    startDate,
    endDateExclusive,
    amountMinor,
    currency: "AED",
    createdAt: "2026-09-05T00:00:00.000Z",
    reconciliationDigest: `digest-${rowId}`,
    ...overrides,
  };
}

function errorCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(GrowthProgressError);
    return (error as GrowthProgressError).code;
  }
  throw new Error("expected a GrowthProgressError");
}

function dayPoint(date: string, low: number, central: number, high: number): GrowthProgressPoint {
  return { date, lowMinor: low, centralMinor: central, highMinor: high, anchor: false };
}

function septemberPoints(): GrowthProgressPoint[] {
  const points: GrowthProgressPoint[] = [
    { date: "2026-09-01", lowMinor: 0, centralMinor: 0, highMinor: 0, anchor: true },
  ];
  for (let day = 1; day <= 30; day += 1) {
    points.push(dayPoint(`2026-09-${String(day).padStart(2, "0")}`, 100, 150, 200));
  }
  return points;
}

function baseProjection(overrides: Partial<FrozenGrowthProjection> = {}): FrozenGrowthProjection {
  return {
    organizationId: ORG_ID,
    scheduleOriginDate: "2026-09-01",
    cycleIndex: 0,
    horizonMonths: 1,
    startDate: "2026-09-01",
    endDateExclusive: "2026-10-01",
    issuedAt: "2026-08-31T20:00:00.000Z",
    sourceCutoffDate: "2026-08-31",
    timeZone: "Asia/Dubai",
    currency: "AED",
    metricKey: "revenue.gross",
    scopePartitions: [PARTITION],
    baselineWindow: { startDate: "2026-08-01", endDateExclusive: "2026-09-01" },
    monthlyLowMinor: 11_200_000,
    monthlyHighMinor: 12_800_000,
    points: septemberPoints(),
    sources: [],
    actionAssumptions: [],
    limitations: [],
    ...overrides,
  };
}

describe("frozen growth projection documents", () => {
  it("accepts a well-formed fixed projection", () => {
    expect(frozenGrowthProjectionSchema.safeParse(baseProjection()).success).toBe(true);
  });

  it("rejects duplicate dates, impossible dates and unsupported horizons", () => {
    const points = septemberPoints();
    const duplicated = [...points, dayPoint("2026-09-15", 100, 150, 200)];
    expect(
      frozenGrowthProjectionSchema.safeParse(baseProjection({ points: duplicated })).success,
    ).toBe(false);

    const impossible = septemberPoints().map((point) =>
      point.date === "2026-09-15" ? { ...point, date: "2026-02-30" } : point,
    );
    expect(
      frozenGrowthProjectionSchema.safeParse(baseProjection({ points: impossible })).success,
    ).toBe(false);

    expect(
      frozenGrowthProjectionSchema.safeParse({ ...baseProjection(), horizonMonths: 2 }).success,
    ).toBe(false);
  });

  it("rejects unsafe integers, inverted ranges and inconsistent metadata", () => {
    expect(
      frozenGrowthProjectionSchema.safeParse(
        baseProjection({ monthlyLowMinor: Number.MAX_SAFE_INTEGER + 1 }),
      ).success,
    ).toBe(false);

    expect(
      frozenGrowthProjectionSchema.safeParse(
        baseProjection({ startDate: "2026-10-01", endDateExclusive: "2026-09-01" }),
      ).success,
    ).toBe(false);

    expect(
      frozenGrowthProjectionSchema.safeParse(
        baseProjection({ monthlyLowMinor: 12_800_000, monthlyHighMinor: 11_200_000 }),
      ).success,
    ).toBe(false);

    const outsideBounds = septemberPoints().map((point) =>
      point.date === "2026-09-15" ? { ...point, centralMinor: 500 } : point,
    );
    expect(
      frozenGrowthProjectionSchema.safeParse(baseProjection({ points: outsideBounds })).success,
    ).toBe(false);

    const missingAnchor = septemberPoints().map((point) => ({ ...point, anchor: false }));
    expect(
      frozenGrowthProjectionSchema.safeParse(baseProjection({ points: missingAnchor })).success,
    ).toBe(false);

    const sparse = septemberPoints().filter((point) => point.date !== "2026-09-15");
    expect(frozenGrowthProjectionSchema.safeParse(baseProjection({ points: sparse })).success).toBe(
      false,
    );
  });
});

describe("buildEvenPaceProjection", () => {
  const MONTHLY_LOW = 11_200_000;
  const MONTHLY_HIGH = 12_800_000;

  function september() {
    return buildEvenPaceProjection({
      scheduleOriginDate: "2026-09-01",
      periodStart: "2026-09-01",
      periodEndExclusive: "2026-10-01",
      monthlyLowMinor: MONTHLY_LOW,
      monthlyHighMinor: MONTHLY_HIGH,
    });
  }

  it("paces a 30-day segment evenly to the frozen monthly bounds", () => {
    const points = september();
    // Start anchor plus one day-end point per calendar day.
    expect(points).toHaveLength(31);
    expect(points[0]).toMatchObject({
      date: "2026-09-01",
      lowMinor: 0,
      centralMinor: 0,
      highMinor: 0,
      anchor: true,
    });
    const day21 = points.find((point) => point.date === "2026-09-21");
    expect(day21).toMatchObject({
      lowMinor: 7_840_000,
      centralMinor: 8_400_000,
      highMinor: 8_960_000,
      anchor: false,
    });
    const final = points.find((point) => point.date === "2026-09-30");
    expect(final).toMatchObject({
      lowMinor: 11_200_000,
      centralMinor: 12_000_000,
      highMinor: 12_800_000,
    });
  });

  it("rounds zero and negative amounts with mathematical floor", () => {
    const zero = buildEvenPaceProjection({
      scheduleOriginDate: "2026-09-01",
      periodStart: "2026-09-01",
      periodEndExclusive: "2026-10-01",
      monthlyLowMinor: 0,
      monthlyHighMinor: 0,
    });
    for (const point of zero) {
      expect(point).toMatchObject({ lowMinor: 0, centralMinor: 0, highMinor: 0 });
    }

    const positive = buildEvenPaceProjection({
      scheduleOriginDate: "2026-09-01",
      periodStart: "2026-09-01",
      periodEndExclusive: "2026-10-01",
      monthlyLowMinor: 100,
      monthlyHighMinor: 100,
    });
    // floor(100 x 7 / 30) = floor(23.33) = 23.
    expect(positive.find((point) => point.date === "2026-09-07")).toMatchObject({
      lowMinor: 23,
      centralMinor: 23,
      highMinor: 23,
    });

    const negative = buildEvenPaceProjection({
      scheduleOriginDate: "2026-09-01",
      periodStart: "2026-09-01",
      periodEndExclusive: "2026-10-01",
      monthlyLowMinor: -100,
      monthlyHighMinor: -100,
    });
    // floor(-100 x 7 / 30) = floor(-23.33) = -24, not truncated -23.
    expect(negative.find((point) => point.date === "2026-09-07")).toMatchObject({
      lowMinor: -24,
      centralMinor: -24,
      highMinor: -24,
    });
  });

  it("rounds midpoints half away from zero", () => {
    const positive = buildEvenPaceProjection({
      scheduleOriginDate: "2026-09-01",
      periodStart: "2026-09-01",
      periodEndExclusive: "2026-10-01",
      monthlyLowMinor: 0,
      monthlyHighMinor: 30,
    });
    // Day 1: low 0, high 1, midpoint 0.5 rounds to 1. The anchor shares the
    // date, so the day-end point is selected by its flag.
    expect(positive.find((point) => point.date === "2026-09-01" && !point.anchor)).toMatchObject({
      lowMinor: 0,
      centralMinor: 1,
      highMinor: 1,
    });

    const negative = buildEvenPaceProjection({
      scheduleOriginDate: "2026-09-01",
      periodStart: "2026-09-01",
      periodEndExclusive: "2026-10-01",
      monthlyLowMinor: -30,
      monthlyHighMinor: 0,
    });
    // Day 1: low -1, high 0, midpoint -0.5 rounds to -1.
    expect(negative.find((point) => point.date === "2026-09-01" && !point.anchor)).toMatchObject({
      lowMinor: -1,
      centralMinor: -1,
      highMinor: 0,
    });
  });

  it("refuses overflowed and inverted projections", () => {
    expect(
      errorCode(() =>
        buildEvenPaceProjection({
          scheduleOriginDate: "2026-01-01",
          periodStart: "2026-01-01",
          periodEndExclusive: "2026-04-01",
          monthlyLowMinor: Number.MAX_SAFE_INTEGER,
          monthlyHighMinor: Number.MAX_SAFE_INTEGER,
        }),
      ),
    ).toBe("MONEY_OVERFLOW");

    expect(
      errorCode(() =>
        buildEvenPaceProjection({
          scheduleOriginDate: "2026-09-01",
          periodStart: "2026-09-01",
          periodEndExclusive: "2026-10-01",
          monthlyLowMinor: 12_800_000,
          monthlyHighMinor: 11_200_000,
        }),
      ),
    ).toBe("INVALID_RANGE");

    expect(
      errorCode(() =>
        buildEvenPaceProjection({
          scheduleOriginDate: "2026-09-01",
          periodStart: "2026-10-01",
          periodEndExclusive: "2026-09-01",
          monthlyLowMinor: MONTHLY_LOW,
          monthlyHighMinor: MONTHLY_HIGH,
        }),
      ),
    ).toBe("INVALID_RANGE");
  });

  it("carries the same monthly amounts forward with no compounding", () => {
    for (const horizon of [3, 6, 12] as const) {
      const endExclusive =
        horizon === 3 ? "2026-04-01" : horizon === 6 ? "2026-07-01" : "2027-01-01";
      const points = buildEvenPaceProjection({
        scheduleOriginDate: "2026-01-01",
        periodStart: "2026-01-01",
        periodEndExclusive: endExclusive,
        monthlyLowMinor: MONTHLY_LOW,
        monthlyHighMinor: MONTHLY_HIGH,
      });
      const final = points[points.length - 1];
      expect(final).toMatchObject({
        lowMinor: MONTHLY_LOW * horizon,
        centralMinor: 12_000_000 * horizon,
        highMinor: MONTHLY_HIGH * horizon,
      });
    }
    // Each completed monthly segment lands exactly on its frozen total.
    const threeMonths = buildEvenPaceProjection({
      scheduleOriginDate: "2026-01-01",
      periodStart: "2026-01-01",
      periodEndExclusive: "2026-04-01",
      monthlyLowMinor: MONTHLY_LOW,
      monthlyHighMinor: MONTHLY_HIGH,
    });
    expect(threeMonths.find((point) => point.date === "2026-01-31")).toMatchObject({
      lowMinor: MONTHLY_LOW,
      highMinor: MONTHLY_HIGH,
    });
    expect(threeMonths.find((point) => point.date === "2026-02-28")).toMatchObject({
      lowMinor: MONTHLY_LOW * 2,
      highMinor: MONTHLY_HIGH * 2,
    });
  });

  it("keeps every central point inside its bounds", () => {
    for (const point of september()) {
      expect(point.lowMinor).toBeLessThanOrEqual(point.centralMinor);
      expect(point.centralMinor).toBeLessThanOrEqual(point.highMinor);
    }
  });
});

describe("buildActualGrowthSeries", () => {
  const PERIOD = {
    periodStart: "2026-09-01",
    periodEndExclusive: "2026-10-01",
    currency: "AED",
    scopePartitions: [PARTITION] as readonly ScopePartition[],
    todayLocalDate: "2026-09-30",
  };

  it("combines daily facts and an equivalent span into one total", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      facts: [
        fact("a", "2026-09-01", "2026-09-02", 10),
        fact("b", "2026-09-02", "2026-09-03", 20),
        fact("c", "2026-09-01", "2026-09-03", 30),
      ],
    });
    expect(series.points).toHaveLength(2);
    expect(series.points[0]).toMatchObject({
      date: "2026-09-02",
      cumulativeMinor: 10,
      coverage: "complete",
      reasonCode: null,
    });
    // Two complete covers agree, so the endpoint carries one total, not 60.
    expect(series.points[1]).toMatchObject({
      date: "2026-09-03",
      cumulativeMinor: 30,
      coverage: "complete",
      reasonCode: null,
    });
  });

  it("marks conflicting full covers as OVERLAP_CONFLICT", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      facts: [
        fact("a", "2026-09-01", "2026-09-02", 10),
        fact("b", "2026-09-02", "2026-09-03", 20),
        fact("c", "2026-09-01", "2026-09-03", 35),
      ],
    });
    expect(series.points[0]).toMatchObject({
      date: "2026-09-02",
      cumulativeMinor: 10,
      coverage: "complete",
    });
    expect(series.points[1]).toMatchObject({
      date: "2026-09-03",
      cumulativeMinor: null,
      coverage: "conflict",
      reasonCode: "OVERLAP_CONFLICT",
    });
  });

  it("leaves duplicate rows unchanged", () => {
    const input = {
      ...PERIOD,
      facts: [fact("a", "2026-09-01", "2026-09-02", 10), fact("b", "2026-09-02", "2026-09-03", 20)],
    };
    const once = buildActualGrowthSeries(input);
    const twice = buildActualGrowthSeries({
      ...input,
      facts: [...input.facts, fact("a", "2026-09-01", "2026-09-02", 10)],
    });
    expect(twice).toEqual(once);
    expect(twice.points[1]).toMatchObject({ cumulativeMinor: 30, coverage: "complete" });
  });

  it("leaves a prefix gap without coverage", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      facts: [fact("a", "2026-09-01", "2026-09-02", 10), fact("c", "2026-09-03", "2026-09-04", 40)],
    });
    // Day 1 plus day 3 alone cannot establish a day-3 cumulative total.
    expect(series.points).toHaveLength(2);
    expect(series.points[0]).toMatchObject({
      date: "2026-09-02",
      cumulativeMinor: 10,
      coverage: "complete",
    });
    expect(series.points[1]).toMatchObject({
      date: "2026-09-04",
      cumulativeMinor: null,
      coverage: "missing",
      reasonCode: "COVERAGE_GAP",
    });
  });

  it("establishes a month-end total from one coarse fact without daily values", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      // The month-end observation is reportable only once that day arrives.
      todayLocalDate: "2026-10-01",
      facts: [fact("m", "2026-09-01", "2026-10-01", 500)],
    });
    expect(series.points).toHaveLength(1);
    expect(series.points[0]).toMatchObject({
      date: "2026-10-01",
      cumulativeMinor: 500,
      coverage: "complete",
    });
  });

  it("returns unavailable when one partition lacks coverage", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      scopePartitions: [PARTITION, PARTITION_BRANCH_A],
      facts: [fact("a", "2026-09-01", "2026-09-02", 10)],
    });
    expect(series.points).toHaveLength(1);
    expect(series.points[0]).toMatchObject({
      date: "2026-09-02",
      cumulativeMinor: null,
      coverage: "missing",
      reasonCode: "COVERAGE_GAP",
    });
  });

  it("counts equivalent cross-store duplicates once", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      facts: [
        fact("a", "2026-09-01", "2026-09-02", 10),
        fact("e", "2026-09-01", "2026-09-02", 10, {
          sourceTable: "exact_range_metric_observations",
        }),
      ],
    });
    expect(series.points).toHaveLength(1);
    expect(series.points[0]).toMatchObject({
      date: "2026-09-02",
      cumulativeMinor: 10,
      coverage: "complete",
    });
    expect(series.points[0]?.sourceIds).toHaveLength(1);
  });

  it("never clips partial overlaps into invented totals", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      facts: [
        fact("s1", "2026-09-01", "2026-09-03", 30),
        fact("s2", "2026-09-02", "2026-09-04", 40),
      ],
    });
    expect(series.points[0]).toMatchObject({
      date: "2026-09-03",
      cumulativeMinor: 30,
      coverage: "complete",
    });
    // The second span starts mid-cover, so it cannot extend the total to 70.
    expect(series.points[1]).toMatchObject({
      date: "2026-09-04",
      cumulativeMinor: null,
      coverage: "missing",
    });
    for (const point of series.points) {
      expect(point.cumulativeMinor).not.toBe(70);
    }
  });

  it("treats an explicit zero as a valid observation", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      facts: [fact("a", "2026-09-01", "2026-09-02", 0), fact("b", "2026-09-02", "2026-09-03", 0)],
    });
    expect(series.points[1]).toMatchObject({
      date: "2026-09-03",
      cumulativeMinor: 0,
      coverage: "complete",
    });
  });

  it("marks cross-currency facts incomparable instead of mixing them", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      facts: [
        fact("a", "2026-09-01", "2026-09-02", 10),
        fact("b", "2026-09-01", "2026-09-02", 10, { currency: "USD" }),
      ],
    });
    expect(series.points[0]).toMatchObject({
      cumulativeMinor: null,
      coverage: "incomparable",
      reasonCode: "CURRENCY_MISMATCH",
    });
  });

  it("refuses more facts than one view may read", () => {
    const facts = Array.from({ length: 10_001 }, (_, index) =>
      fact(`row-${index}`, "2026-09-01", "2026-09-02", 1),
    );
    expect(errorCode(() => buildActualGrowthSeries({ ...PERIOD, facts }))).toBe(
      "SOURCE_LIMIT_EXCEEDED",
    );
  });

  it("keeps row order, duplicates, dates and serialization stable", () => {
    const facts = [
      fact("a", "2026-09-01", "2026-09-02", 10),
      fact("b", "2026-09-02", "2026-09-03", 20),
      fact("c", "2026-09-01", "2026-09-03", 30),
    ];
    const input = { ...PERIOD, facts };
    const baseline = JSON.stringify(buildActualGrowthSeries(input));
    // Row-order invariance: shuffling source rows never moves a total.
    expect(JSON.stringify(buildActualGrowthSeries({ ...input, facts: [...facts].reverse() }))).toBe(
      baseline,
    );
    expect(
      JSON.stringify(
        buildActualGrowthSeries({ ...input, facts: [facts[2]!, facts[0]!, facts[1]!] }),
      ),
    ).toBe(baseline);
    // Duplicate idempotence.
    expect(JSON.stringify(buildActualGrowthSeries({ ...input, facts: [...facts, ...facts] }))).toBe(
      baseline,
    );
    // Every point date stays inside the period and serializes without BigInt.
    const parsed = JSON.parse(baseline) as { points: { date: string }[] };
    expect(parsed.points.length).toBeGreaterThan(0);
    for (const point of parsed.points) {
      expect(point.date > PERIOD.periodStart && point.date <= PERIOD.periodEndExclusive).toBe(true);
    }
  });

  it("emits no future blue points", () => {
    const daily = Array.from({ length: 10 }, (_, index) =>
      fact(
        `day-${index + 1}`,
        `2026-09-${String(index + 1).padStart(2, "0")}`,
        `2026-09-${String(index + 2).padStart(2, "0")}`,
        5,
      ),
    );
    const series = buildActualGrowthSeries({
      ...PERIOD,
      facts: daily,
      todayLocalDate: "2026-09-10",
      candidateDates: ["2026-09-05", "2026-09-15", "2026-09-25"],
    });
    expect(series.points.find((point) => point.date === "2026-09-05")).toMatchObject({
      cumulativeMinor: 20,
      coverage: "complete",
    });
    for (const future of ["2026-09-15", "2026-09-25"]) {
      expect(series.points.find((point) => point.date === future)).toMatchObject({
        cumulativeMinor: null,
        coverage: "missing",
        reasonCode: "FUTURE_DATE",
      });
    }
    for (const point of series.points) {
      if (point.cumulativeMinor !== null) {
        expect(point.date <= "2026-09-10").toBe(true);
      }
    }
  });
});

describe("compareGrowthPoint", () => {
  const PROJECTION = {
    projectedLowMinor: 8_000_000,
    projectedCentralMinor: 8_400_000,
    projectedHighMinor: 8_800_000,
  };

  it("classifies behind, ahead, within range and equal from the frozen bounds", () => {
    expect(compareGrowthPoint({ actualMinor: 6_000_000, ...PROJECTION })).toMatchObject({
      state: "behind",
      differenceMinor: -2_400_000,
      differencePercent: -29,
    });
    expect(compareGrowthPoint({ actualMinor: 9_800_000, ...PROJECTION })).toMatchObject({
      state: "ahead",
      differenceMinor: 1_400_000,
      differencePercent: 17,
    });
    // Below the midpoint but inside the range is not underperforming.
    expect(compareGrowthPoint({ actualMinor: 8_200_000, ...PROJECTION })).toMatchObject({
      state: "within_range",
      differenceMinor: -200_000,
      differencePercent: -2,
    });
    expect(compareGrowthPoint({ actualMinor: 8_400_000, ...PROJECTION })).toMatchObject({
      state: "equal",
      differenceMinor: 0,
      differencePercent: 0,
    });
  });

  it("leaves the percentage empty when the centre is zero", () => {
    expect(
      compareGrowthPoint({
        actualMinor: 5,
        projectedLowMinor: 0,
        projectedCentralMinor: 0,
        projectedHighMinor: 10,
      }),
    ).toMatchObject({ state: "within_range", differenceMinor: 5, differencePercent: null });
  });

  it("returns unavailable for missing or inconsistent inputs", () => {
    expect(
      compareGrowthPoint({
        actualMinor: null,
        ...PROJECTION,
      }),
    ).toMatchObject({ state: "unavailable", differenceMinor: null, differencePercent: null });

    expect(
      compareGrowthPoint({
        actualMinor: 6_000_000,
        projectedLowMinor: 8_000_000,
        projectedCentralMinor: null,
        projectedHighMinor: 8_800_000,
      }),
    ).toMatchObject({ state: "unavailable", differenceMinor: null, differencePercent: null });

    expect(
      compareGrowthPoint({
        actualMinor: 6_000_000,
        projectedLowMinor: 8_800_000,
        projectedCentralMinor: 8_400_000,
        projectedHighMinor: 8_000_000,
      }),
    ).toMatchObject({ state: "unavailable" });

    // A malformed bound is a projection problem, never a missing actual.
    expect(
      compareGrowthPoint({
        actualMinor: 6_000_000,
        projectedLowMinor: 8_000_000,
        projectedCentralMinor: 8_400_000,
        projectedHighMinor: 1.5,
      }),
    ).toMatchObject({ state: "unavailable", reasonCode: "MISSING_PROJECTION" });
    expect(compareGrowthPoint({ actualMinor: 1.5, ...PROJECTION })).toMatchObject({
      state: "unavailable",
      reasonCode: "MISSING_ACTUAL",
    });
  });

  it("returns schema-valid comparisons", () => {
    for (const actual of [6_000_000, 8_200_000, 8_400_000, 9_800_000, null]) {
      expect(
        growthComparisonSchema.safeParse(compareGrowthPoint({ actualMinor: actual, ...PROJECTION }))
          .success,
      ).toBe(true);
    }
  });
});

describe("review fixes — coverage states reach the view", () => {
  it("carries a conflicted endpoint with its reason into the view point", () => {
    expect(
      growthProgressPointViewSchema.safeParse({
        date: "2026-09-03",
        currentMinor: null,
        projectedLowMinor: 8_000_000,
        projectedCentralMinor: 8_400_000,
        projectedHighMinor: 8_800_000,
        currentCoverage: "conflict",
        reasonCode: "OVERLAP_CONFLICT",
        breakBefore: true,
      }).success,
    ).toBe(true);
    expect(
      growthProgressPointViewSchema.safeParse({
        date: "2026-09-02",
        currentMinor: 10,
        projectedLowMinor: 8_000_000,
        projectedCentralMinor: 8_400_000,
        projectedHighMinor: 8_800_000,
        currentCoverage: "complete",
        reasonCode: null,
        breakBefore: false,
      }).success,
    ).toBe(true);
  });

  it("uppercases view currency like the domain contract", () => {
    const parsed = growthProgressViewSchema.safeParse({
      horizonMonths: 1,
      state: "ready",
      reasonCode: null,
      projectionId: ORG_ID,
      projectionDigest: "digest",
      period: {
        horizonMonths: 1,
        cycleIndex: 0,
        startDate: "2026-09-01",
        endDateExclusive: "2026-10-01",
      },
      currency: "aed",
      scopeLabel: "All reporting channels",
      issuedAt: "2026-08-31T20:00:00.000Z",
      sourceCutoffDate: "2026-08-31",
      latestComparableDate: "2026-09-21",
      points: [],
      latestComparison: null,
      adviceRows: [],
      limitations: [],
      freshness: { status: "fresh", note: null },
      sources: [],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.currency).toBe("AED");
  });
});

describe("review fixes — mismatch scoping and conflict precedence", () => {
  const PERIOD = {
    periodStart: "2026-09-01",
    periodEndExclusive: "2026-10-01",
    currency: "AED",
    scopePartitions: [PARTITION] as readonly ScopePartition[],
    todayLocalDate: "2026-09-30",
  };

  it("taints only the dates a mismatched row spans", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      facts: [
        fact("a", "2026-09-01", "2026-09-02", 10),
        fact("b", "2026-09-02", "2026-09-03", 7, { currency: "USD" }),
      ],
    });
    // 09-02 has a clean complete cover; the mismatch spans (09-02, 09-03].
    expect(series.points.find((point) => point.date === "2026-09-02")).toMatchObject({
      cumulativeMinor: 10,
      coverage: "complete",
      reasonCode: null,
    });
    expect(series.points.find((point) => point.date === "2026-09-03")).toMatchObject({
      cumulativeMinor: null,
      coverage: "incomparable",
      reasonCode: "CURRENCY_MISMATCH",
    });
  });

  it("lets a conflict win over a gap at the shared endpoint", () => {
    const series = buildActualGrowthSeries({
      ...PERIOD,
      scopePartitions: [PARTITION, PARTITION_BRANCH_A],
      facts: [
        fact("a1", "2026-09-01", "2026-09-02", 10),
        fact("b1", "2026-09-01", "2026-09-02", 5, {
          partitionKey: PARTITION_BRANCH_A.partitionKey,
        }),
        fact("b2", "2026-09-02", "2026-09-03", 6, {
          partitionKey: PARTITION_BRANCH_A.partitionKey,
        }),
        fact("c", "2026-09-01", "2026-09-03", 20, {
          partitionKey: PARTITION_BRANCH_A.partitionKey,
        }),
      ],
    });
    // 09-02 is complete across both partitions (10 + 5).
    expect(series.points.find((point) => point.date === "2026-09-02")).toMatchObject({
      cumulativeMinor: 15,
      coverage: "complete",
    });
    // 09-03: first partition has a gap, second has two disagreeing covers.
    // The conflict wins: a correction is needed before any total is statable.
    expect(series.points.find((point) => point.date === "2026-09-03")).toMatchObject({
      cumulativeMinor: null,
      coverage: "conflict",
      reasonCode: "OVERLAP_CONFLICT",
    });
  });
});

describe("review fixes — generic point array vs frozen curve", () => {
  it("rejects the anchor-share pair generically while the frozen document accepts it", () => {
    const anchorShare = [
      { date: "2026-09-01", lowMinor: 0, centralMinor: 0, highMinor: 0, anchor: true },
      { date: "2026-09-01", lowMinor: 100, centralMinor: 150, highMinor: 200, anchor: false },
    ];
    // The generic sparse array demands unique dates, so the shared date fails.
    expect(sparseGrowthPointsSchema.safeParse(anchorShare).success).toBe(false);
    // The frozen curve allows exactly this pair: the anchor is zero before
    // the first day's activity, told apart by flag rather than by date.
    expect(frozenGrowthProjectionSchema.safeParse(baseProjection()).success).toBe(true);
  });

  it("rejects duplicate scope keys and misplaced or nonzero anchors", () => {
    expect(
      frozenGrowthProjectionSchema.safeParse(
        baseProjection({ scopePartitions: [PARTITION, PARTITION] }),
      ).success,
    ).toBe(false);

    const nonzeroAnchor = septemberPoints().map((point, index) =>
      index === 0 ? { ...point, highMinor: 1 } : point,
    );
    expect(
      frozenGrowthProjectionSchema.safeParse(baseProjection({ points: nonzeroAnchor })).success,
    ).toBe(false);

    const movedAnchor = septemberPoints().map((point, index) =>
      index === 10 ? { ...point, anchor: true } : point,
    );
    expect(
      frozenGrowthProjectionSchema.safeParse(baseProjection({ points: movedAnchor })).success,
    ).toBe(false);
  });
});

describe("review fixes — zero-centre equality", () => {
  it("calls actual equal to a zero centre with no percentage", () => {
    expect(
      compareGrowthPoint({
        actualMinor: 0,
        projectedLowMinor: 0,
        projectedCentralMinor: 0,
        projectedHighMinor: 10,
      }),
    ).toMatchObject({ state: "equal", differenceMinor: 0, differencePercent: null });
  });
});
