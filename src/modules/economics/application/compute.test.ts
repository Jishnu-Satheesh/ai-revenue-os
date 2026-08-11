import { describe, expect, it } from "vitest";

import type { StoredCostRate } from "@/domain/economics/rates";
import type { CostComponentDefinition } from "@/domain/economics/types";
import { computeEntries, groupPeriods } from "@/modules/economics/application/compute";
import type { MetricObservationRecord } from "@/modules/metrics/application/ports";

const commission: CostComponentDefinition = {
  key: "commission",
  label: "Marketplace commission",
  computationKind: "rate_of_revenue",
  appliesToChannels: null,
};

const foodCost: CostComponentDefinition = {
  key: "food_cost",
  label: "Food cost",
  computationKind: "rate_of_revenue",
  appliesToChannels: null,
};

function rate(overrides: Partial<StoredCostRate> & { id: string }): StoredCostRate {
  return {
    key: "commission",
    definitionKey: "commission",
    qualityTier: "measured",
    channel: null,
    branchId: null,
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    ...overrides,
  };
}

function point(
  periodStart: string,
  numerator: number,
  overrides: Partial<MetricObservationRecord> = {},
): MetricObservationRecord {
  return {
    periodStart: new Date(periodStart),
    periodTimezone: "Asia/Dubai",
    channel: "talabat",
    numerator,
    denominator: null,
    currency: "AED",
    qualityTier: "measured",
    ...overrides,
  };
}

const nextDay = (start: Date) => new Date(start.getTime() + 86_400_000);

describe("groupPeriods", () => {
  it("joins the series on period and channel", () => {
    const periods = groupPeriods({
      revenue: [
        point("2026-05-31T20:00:00Z", 1_000_000),
        point("2026-05-31T20:00:00Z", 400_000, { channel: "deliveroo" }),
      ],
      transactions: [
        point("2026-05-31T20:00:00Z", 200, { currency: null }),
        point("2026-05-31T20:00:00Z", 80, { channel: "deliveroo", currency: null }),
      ],
      periodEndFor: nextDay,
    });

    expect(periods).toHaveLength(2);
    expect(periods[0]).toMatchObject({
      channel: "talabat",
      grossRevenueMinor: 1_000_000,
      transactionCount: 200,
      currency: "AED",
    });
    // The same day on another channel is a separate period, not a merge.
    expect(periods[1]).toMatchObject({ channel: "deliveroo", transactionCount: 80 });
  });

  it("takes revenue as the spine and ignores a stray count with no revenue", () => {
    const periods = groupPeriods({
      revenue: [point("2026-05-31T20:00:00Z", 1_000_000)],
      transactions: [
        point("2026-05-31T20:00:00Z", 200, { currency: null }),
        point("2026-06-01T20:00:00Z", 5, { currency: null }),
      ],
      periodEndFor: nextDay,
    });

    // A day with a count but no revenue has nothing to take a margin of.
    expect(periods).toHaveLength(1);
  });

  it("carries a reported margin through when the source supplied one", () => {
    const periods = groupPeriods({
      revenue: [point("2026-05-31T20:00:00Z", 1_000_000)],
      reportedMargin: [point("2026-05-31T20:00:00Z", 345_000)],
      periodEndFor: nextDay,
    });

    expect(periods[0].reportedMarginMinor).toBe(345_000);
  });
});

describe("computeEntries", () => {
  const periods = [
    {
      periodStart: new Date("2026-05-31T20:00:00Z"),
      periodEnd: new Date("2026-06-01T20:00:00Z"),
      periodTimezone: "Asia/Dubai",
      channel: "talabat",
      grossRevenueMinor: 1_000_000,
      transactionCount: 200,
      currency: "AED",
    },
  ];

  it("prices a period from its components", () => {
    const entries = computeEntries({
      periods,
      branchId: null,
      definitions: [commission, foodCost],
      rates: [
        rate({ id: "c", rateOfRevenue: 0.28 }),
        rate({ id: "f", definitionKey: "food_cost", key: "food_cost", rateOfRevenue: 0.3 }),
      ],
    });

    expect(entries[0].margin).toMatchObject({
      grade: "complete",
      contributionMarginMinor: 420_000,
    });
  });

  it("prices each period with the rate in force for it, not the latest one", () => {
    // The reason this cannot be one aggregate query with today's percentage
    // applied to a total: a June increase must leave May alone.
    const may = periods[0];
    const july = {
      ...may,
      periodStart: new Date("2026-06-30T20:00:00Z"),
      periodEnd: new Date("2026-07-01T20:00:00Z"),
    };

    const entries = computeEntries({
      periods: [may, july],
      branchId: null,
      definitions: [commission],
      rates: [
        rate({ id: "old", rateOfRevenue: 0.28, effectiveFrom: new Date("2026-03-01T00:00:00Z") }),
        rate({ id: "new", rateOfRevenue: 0.32, effectiveFrom: new Date("2026-06-15T00:00:00Z") }),
      ],
    });

    expect(entries[0].margin).toMatchObject({ contributionMarginMinor: 720_000 });
    expect(entries[1].margin).toMatchObject({ contributionMarginMinor: 680_000 });
  });

  it("refuses a figure while any component is unpriced", () => {
    const entries = computeEntries({
      periods,
      branchId: null,
      definitions: [commission, foodCost],
      rates: [rate({ id: "c", rateOfRevenue: 0.28 })],
    });

    expect(entries[0].margin.grade).toBe("indicative");
    if (entries[0].margin.grade !== "indicative") return;
    expect(entries[0].margin.atMostMinor).toBe(720_000);
    expect(entries[0].margin.missingComponentKeys).toEqual(["food_cost"]);
  });

  it("raises a disagreement with a reported figure rather than reconciling it", () => {
    const entries = computeEntries({
      periods: [{ ...periods[0], reportedMarginMinor: 400_000 }],
      branchId: null,
      definitions: [commission, foodCost],
      rates: [
        rate({ id: "c", rateOfRevenue: 0.28 }),
        rate({ id: "f", definitionKey: "food_cost", key: "food_cost", rateOfRevenue: 0.3 }),
      ],
    });

    // Either a rate is wrong or the export is, and the operator needs to know.
    expect(entries[0].reportedDisagreement).toEqual({
      reportedMinor: 400_000,
      differenceMinor: 20_000,
    });
  });

  it("stays silent when the difference is inside tolerance", () => {
    const entries = computeEntries({
      periods: [{ ...periods[0], reportedMarginMinor: 419_990 }],
      branchId: null,
      definitions: [commission, foodCost],
      rates: [
        rate({ id: "c", rateOfRevenue: 0.28 }),
        rate({ id: "f", definitionKey: "food_cost", key: "food_cost", rateOfRevenue: 0.3 }),
      ],
      reconciliationToleranceMinor: 50,
    });

    expect(entries[0].reportedDisagreement).toBeUndefined();
  });

  it("does not compare a reported figure against an unpriced period", () => {
    // An indicative margin disagreeing with a report says nothing about either.
    const entries = computeEntries({
      periods: [{ ...periods[0], reportedMarginMinor: 400_000 }],
      branchId: null,
      definitions: [commission, foodCost],
      rates: [],
    });

    expect(entries[0].margin.grade).toBe("indicative");
    expect(entries[0].reportedDisagreement).toBeUndefined();
  });
});
