import { aggregateObservations } from "@/domain/metrics/aggregation";
import { metricError } from "@/domain/metrics/errors";
import { enumeratePeriodStarts } from "@/domain/metrics/periods";
import type { MetricAggregateOutcome, MetricGapPolicy } from "@/domain/metrics/types";
import type {
  MetricDefinitionRecord,
  MetricObservationRecord,
  MetricSeriesPort,
  MetricSeriesQuery,
} from "@/modules/metrics/application/ports";

export type ReadMetricSeriesOptions = {
  gapPolicy?: MetricGapPolicy;
};

export type MetricSeriesResult = {
  metricKey: string;
  grain: MetricSeriesQuery["grain"];
  timeZone: string;
  expectedPeriodCount: number;
  outcome: MetricAggregateOutcome;
};

export type MetricPointsResult = {
  definition: MetricDefinitionRecord;
  points: readonly MetricObservationRecord[];
  expectedPeriodStarts: readonly Date[];
};

/**
 * Reads a series without combining it.
 *
 * The economics ledger prices each period separately — a commission rate that
 * changed in June must apply to June and not to May — so it needs the points,
 * not a total. This still goes through the port rather than the tables, so
 * revision resolution and the single-timezone rule are enforced exactly once.
 */
export async function readMetricPoints(
  port: MetricSeriesPort,
  query: MetricSeriesQuery,
): Promise<MetricPointsResult> {
  const definition = await port.loadDefinition(query.organizationId, query.metricKey);

  if (!definition || !definition.isActive)
    throw metricError("METRIC_DEFINITION_UNAVAILABLE", {
      key: query.metricKey,
      reason: definition ? "definition is inactive" : "no such metric key",
    });

  const expectedPeriodStarts = enumeratePeriodStarts(
    query.grain,
    query.rangeStart,
    query.rangeEndExclusive,
    query.timeZone,
  );

  const points = await port.loadObservations({ ...query, metricDefinitionId: definition.id });
  assertSingleTimeZone(points, query.timeZone);

  return { definition, points, expectedPeriodStarts };
}

/**
 * Reads a metric series and combines it under its own declared rules.
 *
 * The expected periods are enumerated from the requested range rather than
 * inferred from the rows that came back. That is the whole point: a series with
 * three of seven days present is indistinguishable from a three-day series
 * unless you know what you asked for.
 */
export async function readMetricSeries(
  port: MetricSeriesPort,
  query: MetricSeriesQuery,
  options: ReadMetricSeriesOptions = {},
): Promise<MetricSeriesResult> {
  const definition = await port.loadDefinition(query.organizationId, query.metricKey);

  if (!definition || !definition.isActive)
    throw metricError("METRIC_DEFINITION_UNAVAILABLE", {
      key: query.metricKey,
      reason: definition ? "definition is inactive" : "no such metric key",
    });

  const expectedPeriodStarts = enumeratePeriodStarts(
    query.grain,
    query.rangeStart,
    query.rangeEndExclusive,
    query.timeZone,
  );

  const observations = await port.loadObservations({
    ...query,
    metricDefinitionId: definition.id,
  });
  assertSingleTimeZone(observations, query.timeZone);

  const outcome = aggregateObservations({
    definition: {
      key: definition.key,
      valueKind: definition.valueKind,
      aggregation: definition.aggregation,
      percentileP: definition.percentileP,
    },
    observations: observations.map((observation) => ({
      periodStart: observation.periodStart,
      numerator: observation.numerator,
      denominator: observation.denominator,
      currency: observation.currency,
      qualityTier: observation.qualityTier,
    })),
    expectedPeriodStarts,
    gapPolicy: options.gapPolicy,
  });

  return {
    metricKey: definition.key,
    grain: query.grain,
    timeZone: query.timeZone,
    expectedPeriodCount: expectedPeriodStarts.length,
    outcome,
  };
}

/**
 * Observations bucketed in different zones do not describe comparable periods,
 * so combining them would produce a number with no defensible meaning. This
 * happens for real when a branch's timezone is corrected after data exists:
 * historical rows keep the zone in force when they were written, exactly so the
 * mismatch is visible here rather than silently averaged away.
 */
function assertSingleTimeZone(
  observations: readonly { periodTimezone: string }[],
  requested: string,
): void {
  const zones = new Set(observations.map((observation) => observation.periodTimezone));
  zones.add(requested);

  if (zones.size > 1)
    throw metricError("METRIC_TIMEZONE_MIXED", {
      requested,
      found: [...zones].sort().join(","),
    });
}
