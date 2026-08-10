import { describe, expect, it } from "vitest";

import { MetricError } from "@/domain/metrics/errors";
import { readMetricSeries } from "@/modules/metrics/application/service";
import type {
  MetricDefinitionRecord,
  MetricObservationRecord,
  MetricSeriesPort,
  MetricSeriesQuery,
} from "@/modules/metrics/application/ports";

const revenueDefinition: MetricDefinitionRecord = {
  id: "d1",
  key: "revenue.gross",
  valueKind: "money",
  aggregation: "sum",
  percentileP: null,
  isActive: true,
};

function stubPort(
  definition: MetricDefinitionRecord | null,
  observations: MetricObservationRecord[],
): MetricSeriesPort {
  return {
    loadDefinition: async () => definition,
    loadObservations: async () => observations,
  };
}

function observation(
  periodStart: string,
  numerator: number,
  overrides: Partial<MetricObservationRecord> = {},
): MetricObservationRecord {
  return {
    periodStart: new Date(periodStart),
    periodTimezone: "Asia/Dubai",
    numerator,
    denominator: null,
    currency: "AED",
    qualityTier: "measured",
    ...overrides,
  };
}

const dubaiWeek: MetricSeriesQuery = {
  organizationId: "org-1",
  metricKey: "revenue.gross",
  grain: "day",
  // Local midnight in Dubai is 20:00 UTC the previous day.
  rangeStart: new Date("2026-07-31T20:00:00Z"),
  rangeEndExclusive: new Date("2026-08-03T20:00:00Z"),
  timeZone: "Asia/Dubai",
};

describe("readMetricSeries", () => {
  it("counts expected periods from the requested range, not from the rows returned", async () => {
    const result = await readMetricSeries(
      stubPort(revenueDefinition, [observation("2026-07-31T20:00:00Z", 125_000)]),
      dubaiWeek,
    );

    // Three Dubai days were asked for and one came back. Without the requested
    // range this would be indistinguishable from a complete one-day series.
    expect(result.expectedPeriodCount).toBe(3);
    expect(result.outcome).toMatchObject({
      status: "ok",
      value: 125_000,
      currency: "AED",
      observationCount: 1,
      missingPeriodCount: 2,
    });
  });

  it("refuses the whole series when the caller requires completeness", async () => {
    const result = await readMetricSeries(
      stubPort(revenueDefinition, [observation("2026-07-31T20:00:00Z", 125_000)]),
      dubaiWeek,
      { gapPolicy: "reject" },
    );

    expect(result.outcome).toMatchObject({
      status: "insufficient_data",
      reason: "gaps_present",
      missingPeriodCount: 2,
    });
  });

  it("reports an empty window as insufficient rather than zero", async () => {
    const result = await readMetricSeries(stubPort(revenueDefinition, []), dubaiWeek);

    expect(result.outcome).toMatchObject({
      status: "insufficient_data",
      reason: "no_observations",
      missingPeriodCount: 3,
    });
  });

  it("refuses a series bucketed in a different zone than the caller asked for", async () => {
    // A branch timezone corrected after data exists leaves historical rows in
    // the old zone. Their periods are not comparable with the new ones.
    await expect(
      readMetricSeries(
        stubPort(revenueDefinition, [
          observation("2026-07-31T20:00:00Z", 125_000),
          observation("2026-08-01T20:00:00Z", 90_000, { periodTimezone: "Asia/Riyadh" }),
        ]),
        dubaiWeek,
      ),
    ).rejects.toThrow(MetricError);
  });

  it("rejects an unknown metric key instead of returning an empty series", async () => {
    await expect(readMetricSeries(stubPort(null, []), dubaiWeek)).rejects.toThrow(MetricError);
  });

  it("rejects a deactivated definition", async () => {
    await expect(
      readMetricSeries(stubPort({ ...revenueDefinition, isActive: false }, []), dubaiWeek),
    ).rejects.toThrow(MetricError);
  });

  it("applies the definition's declared aggregation rather than the caller's guess", async () => {
    const conversion: MetricDefinitionRecord = {
      id: "d2",
      key: "listing.conversion_rate",
      valueKind: "ratio",
      aggregation: "ratio_of_sums",
      percentileP: null,
      isActive: true,
    };

    const result = await readMetricSeries(
      stubPort(conversion, [
        observation("2026-07-31T20:00:00Z", 5, { denominator: 1000, currency: null }),
        observation("2026-08-01T20:00:00Z", 1, { denominator: 10, currency: null }),
        observation("2026-08-02T20:00:00Z", 3, { denominator: 500, currency: null }),
      ]),
      { ...dubaiWeek, metricKey: "listing.conversion_rate" },
    );

    expect(result.outcome.status).toBe("ok");
    if (result.outcome.status !== "ok") return;
    expect(result.outcome.value).toBeCloseTo(9 / 1510, 12);
    expect(result.outcome.missingPeriodCount).toBe(0);
  });
});
