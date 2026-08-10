import { TZDate } from "@date-fns/tz";
import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
  startOfDay,
  startOfHour,
  startOfMonth,
  startOfWeek,
} from "date-fns";

import { metricError } from "@/domain/metrics/errors";
import type { MetricPeriodGrain } from "@/domain/metrics/types";

/**
 * Period boundaries are computed in the branch timezone, never in UTC.
 *
 * A Dubai branch's day runs from local midnight. Bucketing on UTC shifts every
 * boundary by four hours, which moves the tail of each evening into the next
 * day and corrupts exactly the daypart analysis the platform exists to do. The
 * same reasoning applies with more force to zones that observe DST, where a
 * fixed 24-hour step drifts an hour twice a year.
 *
 * See `specs/015-metric-registry-and-normalized-metrics.md` section 4.4.
 */

/** Weeks start Monday. Stated explicitly because date-fns defaults to Sunday. */
const WEEK_STARTS_ON = 1 as const;

/** Guards against a malformed range enumerating without end. */
const MAX_PERIODS = 100_000;

export function assertValidTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw metricError("METRIC_TIMEZONE_INVALID", { timeZone });
  }
}

/**
 * The start of the period containing `instant`. The result may precede
 * `instant`, which is intended: an instant mid-period belongs to that period.
 */
export function startOfPeriod(instant: Date, grain: MetricPeriodGrain, timeZone: string): Date {
  assertValidTimeZone(timeZone);
  const zoned = new TZDate(instant.getTime(), timeZone);

  switch (grain) {
    case "hour":
      return new Date(startOfHour(zoned).getTime());
    case "day":
      return new Date(startOfDay(zoned).getTime());
    case "week":
      return new Date(startOfWeek(zoned, { weekStartsOn: WEEK_STARTS_ON }).getTime());
    case "month":
      return new Date(startOfMonth(zoned).getTime());
  }
}

/**
 * Steps by calendar unit rather than by a fixed duration, so a DST transition
 * produces a 23- or 25-hour day instead of silently shifting every later
 * boundary by an hour.
 */
export function nextPeriodStart(
  periodStart: Date,
  grain: MetricPeriodGrain,
  timeZone: string,
): Date {
  assertValidTimeZone(timeZone);
  const zoned = new TZDate(periodStart.getTime(), timeZone);

  switch (grain) {
    case "hour":
      return new Date(addHours(zoned, 1).getTime());
    case "day":
      return new Date(addDays(zoned, 1).getTime());
    case "week":
      return new Date(addWeeks(zoned, 1).getTime());
    case "month":
      return new Date(addMonths(zoned, 1).getTime());
  }
}

/**
 * Every period start from the one containing `rangeStart` up to, but not
 * including, `rangeEndExclusive`.
 */
export function enumeratePeriodStarts(
  grain: MetricPeriodGrain,
  rangeStart: Date,
  rangeEndExclusive: Date,
  timeZone: string,
): Date[] {
  assertValidTimeZone(timeZone);

  if (!(rangeEndExclusive.getTime() > rangeStart.getTime()))
    throw metricError("METRIC_PERIOD_RANGE_INVALID", {
      rangeStart: rangeStart.toISOString(),
      rangeEndExclusive: rangeEndExclusive.toISOString(),
    });

  const starts: Date[] = [];
  let cursor = startOfPeriod(rangeStart, grain, timeZone);

  while (cursor.getTime() < rangeEndExclusive.getTime()) {
    starts.push(cursor);

    const next = nextPeriodStart(cursor, grain, timeZone);
    if (next.getTime() <= cursor.getTime())
      throw metricError("METRIC_PERIOD_RANGE_INVALID", { grain, timeZone });

    cursor = next;

    if (starts.length > MAX_PERIODS)
      throw metricError("METRIC_PERIOD_RANGE_INVALID", { grain, reason: "range too large" });
  }

  return starts;
}

/**
 * Period starts that were expected but carry no observation.
 *
 * A missing period is absent, not zero. Returning it explicitly is what lets a
 * caller choose between refusing to aggregate and reporting the gap, and stops
 * a sparse series from quietly averaging as though the gaps were real zeroes.
 */
export function findMissingPeriodStarts(
  expectedPeriodStarts: readonly Date[],
  observedPeriodStarts: readonly Date[],
): Date[] {
  const observed = new Set(observedPeriodStarts.map((date) => date.getTime()));
  return expectedPeriodStarts.filter((expected) => !observed.has(expected.getTime()));
}
