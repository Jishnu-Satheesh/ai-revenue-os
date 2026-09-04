import { ChannelAnalysisError } from "@/domain/analysis/errors";
import type { AnalysisGrain, PeriodAnalysisGrain } from "@/domain/analysis/types";
import { periodStartFor } from "@/domain/reports/period-key";

/**
 * Calendar arithmetic on local dates, with no timezone in sight.
 *
 * That is correct rather than lazy. A period boundary was already resolved in
 * the branch's zone when the projection wrote the row; what survives on the row
 * is a calendar label -- "the week beginning Monday 5 January". Re-deriving
 * those labels through a zone would be a second opinion about a boundary that
 * is already settled, and it would drift across a daylight-saving change.
 *
 * Weeks start Monday, matching `periodStartFor` and the database's own grain
 * check, so the two never disagree about which Monday a week belongs to.
 */

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const ANALYSIS_MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
/** A year of days is the widest window a run may cover. */
const MAX_PERIODS = 400;
const MS_PER_DAY = 86_400_000;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toUtc(date: string): Date {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new ChannelAnalysisError("INVALID_LOCAL_DATE");
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const instant = new Date(Date.UTC(year, month - 1, day));
  // Rejects the 31st of February rather than rolling it into March.
  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    throw new ChannelAnalysisError("INVALID_LOCAL_DATE");
  }
  return instant;
}

function fromUtc(instant: Date): string {
  return `${instant.getUTCFullYear()}-${pad(instant.getUTCMonth() + 1)}-${pad(instant.getUTCDate())}`;
}

export function addLocalDays(date: string, days: number): string {
  return fromUtc(new Date(toUtc(date).getTime() + days * MS_PER_DAY));
}

/** How many days one local date is after another. */
export function localDaysBetween(from: string, to: string): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / MS_PER_DAY);
}

/** The start of the period containing `date`, at the given grain. */
export function localPeriodStart(date: string, grain: PeriodAnalysisGrain): string {
  toUtc(date);
  return periodStartFor(date, grain);
}

/**
 * The last day of the period beginning at `start`, bounded by the window it
 * came from.
 *
 * Only the window can close a span. `localPeriodEnd` derives an end from a
 * start and a repeating length, and a span has no length to repeat -- its end
 * is wherever the provider's export stopped, which is the window end.
 */
export function localPeriodEndInWindow(
  start: string,
  grain: AnalysisGrain,
  windowEnd: string,
): string {
  return grain === "span" ? windowEnd : localPeriodEnd(start, grain);
}

/** The last day of the period beginning at `start`, inclusive. */
export function localPeriodEnd(start: string, grain: PeriodAnalysisGrain): string {
  if (grain === "day") return start;
  if (grain === "week") return addLocalDays(start, 6);
  const instant = toUtc(start);
  return fromUtc(new Date(Date.UTC(instant.getUTCFullYear(), instant.getUTCMonth() + 1, 0)));
}

export function nextLocalPeriodStart(start: string, grain: PeriodAnalysisGrain): string {
  return addLocalDays(localPeriodEnd(start, grain), 1);
}

export function previousLocalPeriodStart(start: string, grain: PeriodAnalysisGrain): string {
  return localPeriodStart(addLocalDays(start, -1), grain);
}

/**
 * A channel analysis selection is one local calendar month, carried as a
 * canonical `YYYY-MM` value. The server derives the window; the picker never
 * supplies raw dates, so an invented past or future window cannot enter
 * through this path.
 */
export function parseAnalysisMonth(value: string): { year: number; month: number } {
  const match = ANALYSIS_MONTH.exec(value);
  if (!match) throw new ChannelAnalysisError("INVALID_ANALYSIS_MONTH");
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** The inclusive first and last local dates of a canonical analysis month. */
export function analysisMonthBounds(month: string): { windowStart: string; windowEnd: string } {
  const { year, month: monthNumber } = parseAnalysisMonth(month);
  const windowStart = `${year}-${pad(monthNumber)}-01`;
  return { windowStart, windowEnd: localPeriodEnd(windowStart, "month") };
}

export type AnalysisMonthHorizon = {
  /** First canonical month the channel's declared packages cover, inclusive. */
  firstMonth: string;
  /** Last canonical month the channel's declared packages cover, inclusive. */
  lastMonth: string;
};

/**
 * The server-side month check: the selection must be canonical and inside the
 * channel's known timeline. String comparison is exact here because both sides
 * are canonical `YYYY-MM` values that `parseAnalysisMonth` already validated.
 */
export function resolveAnalysisMonth(
  month: string,
  horizon: AnalysisMonthHorizon,
): { windowStart: string; windowEnd: string } {
  parseAnalysisMonth(month);
  parseAnalysisMonth(horizon.firstMonth);
  parseAnalysisMonth(horizon.lastMonth);
  if (month < horizon.firstMonth || month > horizon.lastMonth) {
    throw new ChannelAnalysisError("ANALYSIS_MONTH_OUT_OF_HORIZON");
  }
  return analysisMonthBounds(month);
}

/** A picker shows a decade of months at most; anything wider is a data bug. */
const MAX_HORIZON_MONTHS = 120;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * Every canonical month a horizon covers, oldest first. The Year control
 * lists the distinct years; the Month control always shows the twelve names
 * and disables the pairs outside the edges.
 */
export function enumerateAnalysisMonths(horizon: AnalysisMonthHorizon): string[] {
  const first = parseAnalysisMonth(horizon.firstMonth);
  const last = parseAnalysisMonth(horizon.lastMonth);
  const total = (last.year - first.year) * 12 + (last.month - first.month);
  if (total < 0 || total >= MAX_HORIZON_MONTHS) {
    throw new ChannelAnalysisError("ANALYSIS_HORIZON_UNSHOWABLE");
  }
  const months: string[] = [];
  for (let step = 0; step <= total; step += 1) {
    const index = first.year * 12 + (first.month - 1) + step;
    months.push(`${Math.floor(index / 12)}-${pad((index % 12) + 1)}`);
  }
  return months;
}

/** "February 2026". A calendar label, so no timezone is consulted. */
export function formatAnalysisMonth(month: string): string {
  const { year, month: monthNumber } = parseAnalysisMonth(month);
  return `${MONTH_NAMES[monthNumber - 1]} ${year}`;
}

/**
 * Every whole period the window contains.
 *
 * A period belongs to the window only when it lies entirely inside it. A window
 * running from the first to the twentieth of January expects two whole weeks,
 * not the part-week at either end: reporting a week the caller asked about four
 * days of would claim a gap nobody has, and it would do so at both edges.
 */
export function enumerateLocalPeriodStarts(
  windowStart: string,
  windowEnd: string,
  grain: AnalysisGrain,
): string[] {
  if (localDaysBetween(windowStart, windowEnd) < 0) {
    throw new ChannelAnalysisError("INVALID_WINDOW");
  }

  // A span is one period, and that period is the window. This is not a rounding
  // convenience: the provider reported exactly one figure for exactly this
  // range, so there is one period and it starts where the window starts. The
  // period-boundary helpers stay narrowed to the repeating grains, because a
  // span's end cannot be derived from its start -- only the window knows it.
  if (grain === "span") return [windowStart];

  const starts: string[] = [];
  let cursor = localPeriodStart(windowStart, grain);
  if (cursor < windowStart) cursor = nextLocalPeriodStart(cursor, grain);

  while (localPeriodEnd(cursor, grain) <= windowEnd) {
    starts.push(cursor);
    if (starts.length > MAX_PERIODS) throw new ChannelAnalysisError("WINDOW_TOO_WIDE");
    cursor = nextLocalPeriodStart(cursor, grain);
  }

  return starts;
}
