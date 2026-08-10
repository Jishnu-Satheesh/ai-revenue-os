import { describe, expect, it } from "vitest";

import { aggregateObservations } from "@/domain/metrics/aggregation";
import { MetricError } from "@/domain/metrics/errors";
import { enumeratePeriodStarts } from "@/domain/metrics/periods";
import type { MetricDefinition, MetricObservation } from "@/domain/metrics/types";

const conversionRate: MetricDefinition = {
  key: "listing.conversion_rate",
  valueKind: "ratio",
  aggregation: "ratio_of_sums",
};

const grossRevenue: MetricDefinition = {
  key: "revenue.gross",
  valueKind: "money",
  aggregation: "sum",
};

function observation(
  periodStart: string,
  numerator: number,
  overrides: Partial<MetricObservation> = {},
): MetricObservation {
  return {
    periodStart: new Date(periodStart),
    numerator,
    denominator: null,
    currency: null,
    qualityTier: "measured",
    ...overrides,
  };
}

describe("aggregateObservations", () => {
  it("aggregates a rate as the ratio of sums, not the mean of rates", () => {
    // 5/1000 on a heavy day and 1/10 on a quiet one. The period rate is
    // 6/1010, a little under 0.6%. The mean of the daily rates is 5.25%, an
    // order of magnitude out, because it lets ten visits count as much as a
    // thousand.
    const outcome = aggregateObservations({
      definition: conversionRate,
      observations: [
        observation("2026-08-01T00:00:00Z", 5, { denominator: 1000 }),
        observation("2026-08-02T00:00:00Z", 1, { denominator: 10 }),
      ],
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.value).toBeCloseTo(6 / 1010, 10);
    expect(outcome.value).not.toBeCloseTo((5 / 1000 + 1 / 10) / 2, 5);
    expect(outcome.numerator).toBe(6);
    expect(outcome.denominator).toBe(1010);
  });

  it("gives the same rate however the period is partitioned", () => {
    const daily = [
      observation("2026-08-01T00:00:00Z", 5, { denominator: 1000 }),
      observation("2026-08-02T00:00:00Z", 1, { denominator: 10 }),
      observation("2026-08-03T00:00:00Z", 7, { denominator: 400 }),
      observation("2026-08-04T00:00:00Z", 2, { denominator: 90 }),
    ];

    const whole = aggregateObservations({ definition: conversionRate, observations: daily });
    const firstHalf = aggregateObservations({
      definition: conversionRate,
      observations: daily.slice(0, 2),
    });
    const secondHalf = aggregateObservations({
      definition: conversionRate,
      observations: daily.slice(2),
    });

    if (whole.status !== "ok" || firstHalf.status !== "ok" || secondHalf.status !== "ok")
      throw new Error("expected every partition to aggregate");

    const recombined =
      (firstHalf.numerator + secondHalf.numerator) /
      ((firstHalf.denominator ?? 0) + (secondHalf.denominator ?? 0));

    expect(recombined).toBeCloseTo(whole.value, 12);
  });

  it("refuses to recombine a percentile across periods", () => {
    expect(() =>
      aggregateObservations({
        definition: {
          key: "kitchen.preparation_time",
          valueKind: "duration",
          aggregation: "percentile",
          percentileP: 0.5,
        },
        observations: [observation("2026-08-01T00:00:00Z", 900_000)],
      }),
    ).toThrow(MetricError);
  });

  it("refuses to combine two currencies", () => {
    expect(() =>
      aggregateObservations({
        definition: grossRevenue,
        observations: [
          observation("2026-08-01T00:00:00Z", 125_000, { currency: "AED" }),
          observation("2026-08-02T00:00:00Z", 90_000, { currency: "USD" }),
        ],
      }),
    ).toThrow(MetricError);
  });

  it("sums money and carries its single currency through", () => {
    const outcome = aggregateObservations({
      definition: grossRevenue,
      observations: [
        observation("2026-08-01T00:00:00Z", 125_000, { currency: "AED" }),
        observation("2026-08-02T00:00:00Z", 90_000, { currency: "AED" }),
      ],
    });

    expect(outcome).toMatchObject({ status: "ok", value: 215_000, currency: "AED" });
  });

  it("reports the weakest contributing quality tier", () => {
    const outcome = aggregateObservations({
      definition: grossRevenue,
      observations: [
        observation("2026-08-01T00:00:00Z", 1, { currency: "AED", qualityTier: "measured" }),
        observation("2026-08-02T00:00:00Z", 1, { currency: "AED", qualityTier: "assumed" }),
        observation("2026-08-03T00:00:00Z", 1, { currency: "AED", qualityTier: "derived" }),
      ],
    });

    expect(outcome).toMatchObject({ status: "ok", qualityTier: "assumed" });
  });

  it("returns insufficient_data rather than zero when nothing was observed", () => {
    const outcome = aggregateObservations({ definition: grossRevenue, observations: [] });

    expect(outcome).toEqual({
      status: "insufficient_data",
      reason: "no_observations",
      observationCount: 0,
      missingPeriodCount: 0,
    });
  });

  it("never treats a gap as a zero", () => {
    // Three expected days, one observed. A zero-filled mean would be 40; the
    // honest answer is 120 over one observed day, with the gap declared.
    const expectedPeriodStarts = enumeratePeriodStarts(
      "day",
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-04T00:00:00Z"),
      "UTC",
    );

    const outcome = aggregateObservations({
      definition: { key: "transactions.count", valueKind: "count", aggregation: "mean" },
      observations: [observation("2026-08-01T00:00:00Z", 120)],
      expectedPeriodStarts,
    });

    expect(outcome).toMatchObject({
      status: "ok",
      value: 120,
      observationCount: 1,
      missingPeriodCount: 2,
    });
  });

  it("refuses to aggregate a gapped series when the caller demands completeness", () => {
    const expectedPeriodStarts = enumeratePeriodStarts(
      "day",
      new Date("2026-08-01T00:00:00Z"),
      new Date("2026-08-04T00:00:00Z"),
      "UTC",
    );

    const outcome = aggregateObservations({
      definition: grossRevenue,
      observations: [observation("2026-08-01T00:00:00Z", 120, { currency: "AED" })],
      expectedPeriodStarts,
      gapPolicy: "reject",
    });

    expect(outcome).toEqual({
      status: "insufficient_data",
      reason: "gaps_present",
      observationCount: 1,
      missingPeriodCount: 2,
    });
  });

  it("takes the latest period for a last-valued metric regardless of input order", () => {
    const outcome = aggregateObservations({
      definition: { key: "branch.headcount", valueKind: "count", aggregation: "last" },
      observations: [
        observation("2026-08-03T00:00:00Z", 12),
        observation("2026-08-05T00:00:00Z", 15),
        observation("2026-08-04T00:00:00Z", 13),
      ],
    });

    expect(outcome).toMatchObject({ status: "ok", value: 15 });
  });

  it("derives a rating as its weighted mean", () => {
    // Sixteen stars over four reviews, then nine over two: 25/6.
    const outcome = aggregateObservations({
      definition: { key: "review.rating", valueKind: "rating", aggregation: "weighted_mean" },
      observations: [
        observation("2026-08-01T00:00:00Z", 16, { denominator: 4 }),
        observation("2026-08-02T00:00:00Z", 9, { denominator: 2 }),
      ],
    });

    expect(outcome.status).toBe("ok");
    if (outcome.status !== "ok") return;
    expect(outcome.value).toBeCloseTo(25 / 6, 12);
  });

  it("refuses a ratio whose observations lack a denominator", () => {
    expect(() =>
      aggregateObservations({
        definition: conversionRate,
        observations: [observation("2026-08-01T00:00:00Z", 5)],
      }),
    ).toThrow(MetricError);
  });

  it("refuses a ratio whose denominators sum to zero", () => {
    expect(() =>
      aggregateObservations({
        definition: conversionRate,
        observations: [observation("2026-08-01T00:00:00Z", 0, { denominator: 0 })],
      }),
    ).toThrow(MetricError);
  });
});
