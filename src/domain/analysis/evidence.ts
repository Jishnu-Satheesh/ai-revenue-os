import type { MetricPeriodGrain, MetricQualityTier } from "@/domain/metrics/types";
import type { AnalysisEvidence, AnalysisSeriesPoint } from "@/domain/analysis/types";

/**
 * Choosing what a detector is allowed to look at.
 *
 * Every rule here is a refusal to compare things that are not comparable. A
 * week and a month are not two of the same thing; a figure bucketed in Riyadh
 * and one bucketed in Dubai do not share a Tuesday; an estimated figure is not
 * a measured one. The alternative to refusing is a number that looks right and
 * is not, which is the failure mode this whole path exists to avoid.
 */

/** Descending trust, matching `context/09-business-memory.md`. */
const QUALITY_RANK: Readonly<Record<MetricQualityTier, number>> = {
  measured: 0,
  derived: 1,
  estimated: 2,
  assumed: 3,
};

export function meetsQuality(tier: MetricQualityTier, minimum: MetricQualityTier): boolean {
  return QUALITY_RANK[tier] <= QUALITY_RANK[minimum];
}

/**
 * Why a row the loader found took no part in the answer.
 *
 * Recorded per row rather than totalled, because "we have nothing for these
 * days" and "we have these days at another grain" are different facts about the
 * business and an operator acts on them differently. The first means chase the
 * provider; the second means the evidence is already here.
 */
export type SetAsideReason = "grain" | "timezone" | "window" | "scope" | "quality" | "unreported";

export type ComparableSelection = {
  accepted: readonly AnalysisSeriesPoint[];
  /**
   * How many rows were found and set aside. Non-zero means the detector is
   * reporting over less than the loader saw, which the outcome has to say.
   */
  setAsideCount: number;
  /** How many rows each rule set aside. The first failing rule owns the row. */
  setAside: Readonly<Record<SetAsideReason, number>>;
  /**
   * The grains that were present but were not the window's, in a stable order.
   * A refusal can name them, so "no evidence" is never said over evidence that
   * is sitting right there at another grain.
   */
  setAsideGrains: readonly MetricPeriodGrain[];
};

/**
 * The first rule a point fails, or null when it is comparable.
 *
 * The order is the order the reasons are worth reporting in, not an arbitrary
 * one: grain and timezone describe evidence that exists and cannot be lined up,
 * while window and scope describe evidence about something else entirely.
 */
function setAsideReasonFor(
  point: AnalysisSeriesPoint,
  window: AnalysisEvidence["window"],
  minimumQualityTier: MetricQualityTier,
): SetAsideReason | null {
  if (point.grain !== window.grain) return "grain";
  if (point.periodTimezone !== window.timeZone) return "timezone";
  // Whole periods only, matching how the window's expected periods are
  // enumerated. A week whose last two days are the only ones the caller asked
  // about is not a week this window can compare anything against.
  if (point.periodStart < window.windowStart || point.periodEnd > window.windowEnd) return "window";
  if (window.channelId !== null && point.channelId !== window.channelId) return "scope";
  if (window.branchId !== null && point.branchId !== window.branchId) return "scope";
  if (!meetsQuality(point.qualityTier, minimumQualityTier)) return "quality";
  return null;
}

export function selectComparablePoints(
  evidence: AnalysisEvidence,
  options: { metricKey: string; minimumQualityTier: MetricQualityTier },
): ComparableSelection {
  const { window } = evidence;
  const candidates = evidence.points.filter((point) => point.metricKey === options.metricKey);

  const accepted: AnalysisSeriesPoint[] = [];
  const setAside: Record<SetAsideReason, number> = {
    grain: 0,
    timezone: 0,
    window: 0,
    scope: 0,
    quality: 0,
    // Rows the loader itself could not offer. It reports a count, not the rows,
    // so nothing more specific can honestly be said about them.
    unreported: evidence.incomparablePointCount,
  };
  const grains = new Set<MetricPeriodGrain>();

  for (const point of candidates) {
    const reason = setAsideReasonFor(point, window, options.minimumQualityTier);
    if (reason === null) {
      accepted.push(point);
      continue;
    }
    setAside[reason] += 1;
    if (reason === "grain") grains.add(point.grain);
  }

  return {
    accepted,
    setAsideCount: candidates.length - accepted.length + evidence.incomparablePointCount,
    setAside,
    setAsideGrains: [...grains].sort(),
  };
}

/**
 * The one currency a set of money figures shares.
 *
 * `"mixed"` is a refusal, not a problem to solve. Converting between currencies
 * needs a rate, a rate needs a date and a source, and inventing either would
 * turn an import into an estimate nobody asked for.
 */
export function singleCurrency(points: readonly AnalysisSeriesPoint[]): string | null | "mixed" {
  const currencies = new Set(points.map((point) => point.currency));
  if (currencies.size === 0) return null;
  if (currencies.size > 1) return "mixed";
  return [...currencies][0];
}

/** Distinct values of one field, for the checks that refuse a mixed set. */
export function distinct<Value>(
  points: readonly AnalysisSeriesPoint[],
  select: (point: AnalysisSeriesPoint) => Value,
): Value[] {
  return [...new Set(points.map(select))];
}

/** Sums integer figures. Money never leaves minor units, so nothing rounds. */
export function sumNumerators(points: readonly AnalysisSeriesPoint[]): number {
  return points.reduce((total, point) => total + point.numerator, 0);
}
