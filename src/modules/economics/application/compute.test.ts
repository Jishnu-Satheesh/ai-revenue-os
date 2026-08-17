import { describe, expect, it } from "vitest";

import { EconomicsError } from "@/domain/economics/errors";
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
    effectiveFrom: "2026-01-01",
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

  it("carries a reported margin and its tier through", () => {
    const periods = groupPeriods({
      revenue: [point("2026-05-31T20:00:00Z", 1_000_000)],
      reportedMargin: [point("2026-05-31T20:00:00Z", 345_000, { qualityTier: "derived" })],
      periodEndFor: nextDay,
    });

    expect(periods[0]).toMatchObject({
      reportedMarginMinor: 345_000,
      reportedQualityTier: "derived",
    });
  });

  it("refuses a revenue figure with no currency", () => {
    // Substituting a default would price the period in the wrong money.
    expect(() =>
      groupPeriods({
        revenue: [point("2026-05-31T20:00:00Z", 1_000_000, { currency: null })],
        periodEndFor: nextDay,
      }),
    ).toThrow(EconomicsError);
  });

  it("attaches a sourced cost to its period, with the reporter's tier", () => {
    const periods = groupPeriods({
      revenue: [point("2026-05-31T20:00:00Z", 1_000_000)],
      sourced: {
        promotion_funding: [point("2026-05-31T20:00:00Z", 31_500, { qualityTier: "measured" })],
      },
      periodEndFor: nextDay,
    });

    expect(periods[0].sourcedAmounts).toEqual({
      promotion_funding: { amountMinor: 31_500, qualityTier: "measured" },
    });
  });

  it("refuses a sourced cost denominated in another currency", () => {
    // A cost in another currency is a different number, not the same one in
    // other units.
    expect(() =>
      groupPeriods({
        revenue: [point("2026-05-31T20:00:00Z", 1_000_000)],
        sourced: {
          promotion_funding: [point("2026-05-31T20:00:00Z", 31_500, { currency: "SAR" })],
        },
        periodEndFor: nextDay,
      }),
    ).toThrow(EconomicsError);
  });

  it("refuses a reported margin denominated in another currency", () => {
    // specs/012 section 11: no implicit conversion, ever.
    expect(() =>
      groupPeriods({
        revenue: [point("2026-05-31T20:00:00Z", 1_000_000)],
        reportedMargin: [point("2026-05-31T20:00:00Z", 345_000, { currency: "SAR" })],
        periodEndFor: nextDay,
      }),
    ).toThrow(EconomicsError);
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
    // The rate that produced each component, so the figure can be traced back.
    expect(entries[0].rateIdByComponentKey).toEqual({ commission: "c", food_cost: "f" });
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
        rate({ id: "old", rateOfRevenue: 0.28, effectiveFrom: "2026-03-01" }),
        rate({ id: "new", rateOfRevenue: 0.32, effectiveFrom: "2026-06-15" }),
      ],
    });

    expect(entries[0].margin).toMatchObject({ contributionMarginMinor: 720_000 });
    expect(entries[1].margin).toMatchObject({ contributionMarginMinor: 680_000 });
  });

  it("applies a rate change on the operator's own day, not on UTC's", () => {
    // The Dubai day of 1 June begins at 20:00 UTC on 31 May. Comparing the
    // period's instant against the date would leave this day on the old tier
    // and apply every rate change a day late.
    const firstOfJune = {
      ...periods[0],
      periodStart: new Date("2026-05-31T20:00:00Z"),
      periodEnd: new Date("2026-06-01T20:00:00Z"),
    };

    const entries = computeEntries({
      periods: [firstOfJune],
      branchId: null,
      definitions: [commission],
      rates: [
        rate({ id: "old", rateOfRevenue: 0.28, effectiveFrom: "2026-03-01" }),
        rate({ id: "new", rateOfRevenue: 0.32, effectiveFrom: "2026-06-01" }),
      ],
    });

    expect(entries[0].rateIdByComponentKey.commission).toBe("new");
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
    // A missing component was priced by no rate, so it attributes to none.
    expect(entries[0].rateIdByComponentKey).toEqual({ commission: "c" });
  });

  it("raises a disagreement with a reported figure rather than reconciling it", () => {
    const entries = computeEntries({
      periods: [{ ...periods[0], reportedMarginMinor: 400_000, reportedQualityTier: "measured" }],
      branchId: null,
      definitions: [commission, foodCost],
      rates: [
        rate({ id: "c", rateOfRevenue: 0.28 }),
        rate({ id: "f", definitionKey: "food_cost", key: "food_cost", rateOfRevenue: 0.3 }),
      ],
    });

    // Either a rate is wrong or the export is, and the operator needs to know.
    expect(entries[0].margin).toMatchObject({ marginSource: "derived" });
    expect(entries[0].reportedDisagreement).toEqual({
      reportedMinor: 400_000,
      differenceMinor: 20_000,
    });
  });

  it("stays silent when the difference is inside tolerance", () => {
    const entries = computeEntries({
      periods: [{ ...periods[0], reportedMarginMinor: 419_990, reportedQualityTier: "measured" }],
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

  it("records the reported figure when nothing can be derived", () => {
    // No rates at all, so there is no derived margin to keep. Grading this
    // indicative would discard a measured number the operator already has.
    const entries = computeEntries({
      periods: [{ ...periods[0], reportedMarginMinor: 400_000, reportedQualityTier: "measured" }],
      branchId: null,
      definitions: [commission, foodCost],
      rates: [],
    });

    expect(entries[0].margin).toMatchObject({
      marginSource: "reported",
      grade: "complete",
      contributionMarginMinor: 400_000,
    });
    // Nothing to reconcile, and no waterfall to offer.
    expect(entries[0].reportedDisagreement).toBeUndefined();
    expect(entries[0].rateIdByComponentKey).toEqual({});
  });

  it("stays indicative when nothing can be derived and nothing was reported", () => {
    const entries = computeEntries({
      periods,
      branchId: null,
      definitions: [commission, foodCost],
      rates: [],
    });

    expect(entries[0].margin).toMatchObject({ grade: "indicative", atMostMinor: 1_000_000 });
  });
});
