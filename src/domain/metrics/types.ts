/**
 * Read-side domain types for the metric registry.
 *
 * Deliberately free of `server-only`: aggregation is pure arithmetic and the
 * same rules must hold wherever a number is derived, including a chart in the
 * browser. Anything touching the database lives in the module layer.
 *
 * See `specs/015-metric-registry-and-normalized-metrics.md`.
 */

export type MetricValueKind = "count" | "money" | "ratio" | "duration" | "rating";

export type MetricAggregation =
  | "sum"
  | "ratio_of_sums"
  | "mean"
  | "weighted_mean"
  | "percentile"
  | "last";

/** Descending trust, mirroring the source hierarchy in `context/09-business-memory.md`. */
export type MetricQualityTier = "measured" | "derived" | "estimated" | "assumed";

export type MetricPeriodGrain = "hour" | "day" | "week" | "month";

/**
 * What a caller wants done about periods with no observation. There is no
 * option that treats a gap as a zero: a closed Monday is not a Monday with zero
 * orders, and conflating them corrupts every baseline computed downstream.
 */
export type MetricGapPolicy = "reject" | "mark_missing";

export type MetricDefinition = {
  key: string;
  valueKind: MetricValueKind;
  aggregation: MetricAggregation;
  percentileP?: number | null;
};

/**
 * One period-grain observation. A ratio or rating carries both parts of its
 * fraction; the quotient is never stored and is derived only on read.
 */
export type MetricObservation = {
  periodStart: Date;
  numerator: number;
  denominator: number | null;
  currency: string | null;
  qualityTier: MetricQualityTier;
};

export type MetricAggregate = {
  status: "ok";
  /** The scalar a caller should display, derived per the declared aggregation. */
  value: number;
  numerator: number;
  denominator: number | null;
  currency: string | null;
  /** The weakest tier among contributors: a series is only as good as its worst input. */
  qualityTier: MetricQualityTier;
  observationCount: number;
  missingPeriodCount: number;
};

export type MetricInsufficientData = {
  status: "insufficient_data";
  reason: "no_observations" | "gaps_present";
  observationCount: number;
  missingPeriodCount: number;
};

/**
 * A discriminated result rather than a nullable number, so a caller cannot
 * accidentally render "no data" as zero.
 */
export type MetricAggregateOutcome = MetricAggregate | MetricInsufficientData;
