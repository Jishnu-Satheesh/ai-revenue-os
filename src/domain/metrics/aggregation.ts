import { metricError } from "@/domain/metrics/errors";
import { findMissingPeriodStarts } from "@/domain/metrics/periods";
import type {
  MetricAggregateOutcome,
  MetricDefinition,
  MetricGapPolicy,
  MetricObservation,
  MetricQualityTier,
} from "@/domain/metrics/types";

/**
 * Combining a metric series across periods, subjects, or channels.
 *
 * The rules here are the reason the read port exists. Each one is a way a
 * series is silently wrong if a caller writes the obvious query instead:
 *
 *   - A rate is the ratio of sums, never the mean of rates. Those agree only
 *     when every period carried identical volume, which is never true in
 *     practice, and the error is largest exactly when volume is most uneven.
 *   - A percentile cannot be recombined at all. Daily medians hold no
 *     information about the weekly median, so this refuses rather than
 *     returning a plausible number.
 *   - Money in two currencies is not money. No implicit conversion.
 *   - A gap is not a zero, so a sparse series either reports its gaps or
 *     refuses, and never averages over holes.
 *
 * See `specs/015-metric-registry-and-normalized-metrics.md` sections 4.2-4.5.
 */

/** Ascending trust, so the weakest contributor is the lowest index. */
const QUALITY_TIER_RANK: Readonly<Record<MetricQualityTier, number>> = {
  assumed: 0,
  estimated: 1,
  derived: 2,
  measured: 3,
};

export type AggregateInput = {
  definition: MetricDefinition;
  observations: readonly MetricObservation[];
  /**
   * The periods the caller expected. Supplying them is what makes gap detection
   * possible; without them a sparse series is indistinguishable from a short one.
   */
  expectedPeriodStarts?: readonly Date[];
  gapPolicy?: MetricGapPolicy;
};

export function aggregateObservations({
  definition,
  observations,
  expectedPeriodStarts,
  gapPolicy = "mark_missing",
}: AggregateInput): MetricAggregateOutcome {
  if (definition.aggregation === "percentile")
    throw metricError("METRIC_AGGREGATION_UNSUPPORTED", {
      key: definition.key,
      aggregation: definition.aggregation,
      reason: "a percentile of periods is not a percentile of the whole",
    });

  const missingPeriodCount = expectedPeriodStarts
    ? findMissingPeriodStarts(
        expectedPeriodStarts,
        observations.map((observation) => observation.periodStart),
      ).length
    : 0;

  if (observations.length === 0)
    return {
      status: "insufficient_data",
      reason: "no_observations",
      observationCount: 0,
      missingPeriodCount,
    };

  if (gapPolicy === "reject" && missingPeriodCount > 0)
    return {
      status: "insufficient_data",
      reason: "gaps_present",
      observationCount: observations.length,
      missingPeriodCount,
    };

  const currency = resolveCurrency(definition, observations);
  const numerator = sum(observations.map((observation) => observation.numerator));
  const denominator = resolveDenominator(definition, observations);

  return {
    status: "ok",
    value: deriveValue(definition, observations, numerator, denominator),
    numerator,
    denominator,
    currency,
    qualityTier: weakestQualityTier(observations),
    observationCount: observations.length,
    missingPeriodCount,
  };
}

function deriveValue(
  definition: MetricDefinition,
  observations: readonly MetricObservation[],
  numerator: number,
  denominator: number | null,
): number {
  switch (definition.aggregation) {
    case "sum":
      return numerator;

    // Both are a quotient of summed parts. They differ only in intent: a rate
    // divides by its own volume, a rating divides by the number of ratings.
    case "ratio_of_sums":
    case "weighted_mean":
      if (denominator === null)
        throw metricError("METRIC_DENOMINATOR_MISSING", { key: definition.key });
      return numerator / denominator;

    case "mean":
      return numerator / observations.length;

    case "last":
      return latestObservationValue(observations);

    case "percentile":
      throw metricError("METRIC_AGGREGATION_UNSUPPORTED", { key: definition.key });
  }
}

function latestObservationValue(observations: readonly MetricObservation[]): number {
  const latest = observations.reduce((newest, candidate) =>
    candidate.periodStart.getTime() > newest.periodStart.getTime() ? candidate : newest,
  );

  if (latest.denominator === null) return latest.numerator;
  if (latest.denominator === 0) throw metricError("METRIC_DENOMINATOR_INVALID");
  return latest.numerator / latest.denominator;
}

function resolveDenominator(
  definition: MetricDefinition,
  observations: readonly MetricObservation[],
): number | null {
  const needsDenominator =
    definition.valueKind === "ratio" ||
    definition.valueKind === "rating" ||
    definition.aggregation === "ratio_of_sums" ||
    definition.aggregation === "weighted_mean";

  if (!needsDenominator) return null;

  const denominators = observations.map((observation) => observation.denominator);
  if (denominators.some((value) => value === null))
    throw metricError("METRIC_DENOMINATOR_MISSING", { key: definition.key });

  const total = sum(denominators as number[]);
  if (total <= 0) throw metricError("METRIC_DENOMINATOR_INVALID", { key: definition.key });

  return total;
}

function resolveCurrency(
  definition: MetricDefinition,
  observations: readonly MetricObservation[],
): string | null {
  if (definition.valueKind !== "money") return null;

  const currencies = new Set(observations.map((observation) => observation.currency ?? ""));
  if (currencies.size > 1)
    throw metricError("METRIC_CURRENCY_MISMATCH", {
      key: definition.key,
      currencies: [...currencies].sort().join(","),
    });

  const [only] = [...currencies];
  return only === "" ? null : only;
}

function weakestQualityTier(observations: readonly MetricObservation[]): MetricQualityTier {
  return observations.reduce<MetricQualityTier>(
    (weakest, observation) =>
      QUALITY_TIER_RANK[observation.qualityTier] < QUALITY_TIER_RANK[weakest]
        ? observation.qualityTier
        : weakest,
    "measured",
  );
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
