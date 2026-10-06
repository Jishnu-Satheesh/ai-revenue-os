import { z } from "zod";

/**
 * Fixed growth-projection periods (data contract D01).
 *
 * Like a magazine subscription that always renews on the same day of the
 * month: every horizon (1/3/6/12 months) starts from one shared origin date
 * and each horizon rolls on its own cycle. Picking a different horizon never
 * restarts the clock for the others.
 *
 * Pure calendar arithmetic only. No database, clock, model or Node built-in
 * is touched, so this module is safe to import from browser code.
 */

export const GROWTH_HORIZON_MONTHS = [1, 3, 6, 12] as const;
export type GrowthHorizonMonths = (typeof GROWTH_HORIZON_MONTHS)[number];

export const growthHorizonMonthsSchema = z.union(
  [z.literal(1), z.literal(3), z.literal(6), z.literal(12)],
  { message: "Growth horizons run 1, 3, 6 or 12 whole months." },
);

const ISO_DATE_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;

function isRealCalendarDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Validated YYYY-MM-DD local date. Rejects impossible dates such as 2026-02-30. */
export const isoDateSchema = z
  .string()
  .refine(isRealCalendarDate, { message: "Dates read YYYY-MM-DD and must exist." });

export const growthPeriodSchema = z
  .strictObject({
    horizonMonths: growthHorizonMonthsSchema,
    cycleIndex: z.number().int().min(0),
    /** Inclusive local start date. */
    startDate: isoDateSchema,
    /** Exclusive local end date; the UI prints this minus one day. */
    endDateExclusive: isoDateSchema,
  })
  .refine((value) => value.startDate < value.endDateExclusive, {
    message: "A growth period must end after it starts.",
  });
export type GrowthPeriod = z.output<typeof growthPeriodSchema>;

export type GrowthPeriodErrorCode =
  | "INVALID_DATE"
  | "UNSUPPORTED_HORIZON"
  | "INVALID_CYCLE"
  | "INVALID_TIMEZONE"
  | "INVALID_INSTANT"
  | "PERIOD_NOT_STARTED";

/** Domain-specific error for fixed-period arithmetic; carries a stable code. */
export class GrowthPeriodError extends Error {
  readonly code: GrowthPeriodErrorCode;

  constructor(code: GrowthPeriodErrorCode, message: string) {
    super(message);
    this.name = "GrowthPeriodError";
    this.code = code;
  }
}

/**
 * Whole months after a local date, clamped to the target month's last day
 * (31 Jan + 1 month reads 28 Feb, never 3 Mar). Mirrors the existing
 * revenue-scenario helper without importing that engine, which stays
 * unchanged; the duplication is deliberate and covered by the clamp tests.
 */
export function addLocalMonths(date: string, months: number): string {
  if (!isRealCalendarDate(date)) {
    throw new GrowthPeriodError("INVALID_DATE", "Period dates read YYYY-MM-DD and must exist.");
  }
  if (!Number.isInteger(months)) {
    throw new GrowthPeriodError("INVALID_CYCLE", "Month steps must be whole months.");
  }
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const targetMonthIndex = month - 1 + months;
  const targetYear = year + Math.floor(targetMonthIndex / 12);
  const targetMonth = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const targetDay = Math.min(day, lastDay);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(targetDay)}`;
}

/**
 * Whole calendar days after a local date. Uses UTC date arithmetic so a
 * 23-hour spring-forward day or a 25-hour autumn day still steps exactly one
 * printed date — daylight saving never skips or repeats a day here.
 */
export function addLocalDays(date: string, days: number): string {
  if (!isRealCalendarDate(date)) {
    throw new GrowthPeriodError("INVALID_DATE", "Period dates read YYYY-MM-DD and must exist.");
  }
  if (!Number.isInteger(days)) {
    throw new GrowthPeriodError("INVALID_CYCLE", "Day steps must be whole days.");
  }
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const stepped = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${stepped.getUTCFullYear()}-${pad(stepped.getUTCMonth() + 1)}-${pad(stepped.getUTCDate())}`;
}

/** Whole calendar days from `from` (inclusive) to `to` (exclusive). */
export function daysBetweenLocal(from: string, to: string): number {
  if (!isRealCalendarDate(from) || !isRealCalendarDate(to)) {
    throw new GrowthPeriodError("INVALID_DATE", "Period dates read YYYY-MM-DD and must exist.");
  }
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number) as [number, number, number];
  const [toYear, toMonth, toDay] = to.split("-").map(Number) as [number, number, number];
  return Math.round(
    (Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) /
      86_400_000,
  );
}

function requireHorizon(horizonMonths: number): GrowthHorizonMonths {
  const parsed = growthHorizonMonthsSchema.safeParse(horizonMonths);
  if (!parsed.success) {
    throw new GrowthPeriodError(
      "UNSUPPORTED_HORIZON",
      "Growth horizons run 1, 3, 6 or 12 whole months.",
    );
  }
  return parsed.data;
}

/**
 * Resolves one fixed period. Both boundaries are always recomputed from the
 * original schedule origin (start = origin + H*N months, end = origin +
 * H*(N+1) months), so a February clamp never drifts later months.
 */
export function resolveGrowthPeriod(
  scheduleOriginDate: string,
  horizonMonths: number,
  cycleIndex: number,
): GrowthPeriod {
  if (!isRealCalendarDate(scheduleOriginDate)) {
    throw new GrowthPeriodError(
      "INVALID_DATE",
      "The schedule origin reads YYYY-MM-DD and must exist.",
    );
  }
  const horizon = requireHorizon(horizonMonths);
  if (!Number.isInteger(cycleIndex) || cycleIndex < 0) {
    throw new GrowthPeriodError("INVALID_CYCLE", "Cycle indexes start at 0 and stay whole.");
  }
  return growthPeriodSchema.parse({
    horizonMonths: horizon,
    cycleIndex,
    startDate: addLocalMonths(scheduleOriginDate, horizon * cycleIndex),
    endDateExclusive: addLocalMonths(scheduleOriginDate, horizon * (cycleIndex + 1)),
  });
}

/**
 * Finds the cycle whose period contains `localDate`. Each horizon is checked
 * against its own grid, so one horizon rolling never moves another.
 */
export function resolveGrowthCycleForDate(
  scheduleOriginDate: string,
  horizonMonths: number,
  localDate: string,
): number {
  if (!isRealCalendarDate(scheduleOriginDate) || !isRealCalendarDate(localDate)) {
    throw new GrowthPeriodError("INVALID_DATE", "Period dates read YYYY-MM-DD and must exist.");
  }
  requireHorizon(horizonMonths);
  if (localDate < scheduleOriginDate) {
    throw new GrowthPeriodError(
      "PERIOD_NOT_STARTED",
      "The date falls before the first scheduled period.",
    );
  }
  let cycle = 0;
  for (;;) {
    const period = resolveGrowthPeriod(scheduleOriginDate, horizonMonths, cycle);
    if (localDate < period.endDateExclusive) return cycle;
    cycle += 1;
    if (cycle > 1200) {
      throw new GrowthPeriodError("INVALID_CYCLE", "No scheduled cycle contains the date.");
    }
  }
}

/**
 * Reads the organization's local date for a UTC instant. The same instant can
 * be a different printed date per zone, and period boundaries always follow
 * the organization's zone — never the viewer's clock or plain UTC.
 */
export function organizationLocalDate(utcInstant: string, timeZone: string): string {
  const epoch = Date.parse(utcInstant);
  if (Number.isNaN(epoch)) {
    throw new GrowthPeriodError("INVALID_INSTANT", "Instants must parse as UTC timestamps.");
  }
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  } catch {
    throw new GrowthPeriodError(
      "INVALID_TIMEZONE",
      "The organization timezone is not a valid IANA zone.",
    );
  }
  const rendered = formatter.format(new Date(epoch));
  if (!isRealCalendarDate(rendered)) {
    throw new GrowthPeriodError("INVALID_TIMEZONE", "The organization timezone is not usable.");
  }
  return rendered;
}

/**
 * A projection must start strictly after the current organization-local date.
 * Starting today or earlier would let hindsight pose as an original outlook.
 */
export function isProspectiveStart(periodStartDate: string, currentLocalDate: string): boolean {
  if (!isRealCalendarDate(periodStartDate) || !isRealCalendarDate(currentLocalDate)) {
    throw new GrowthPeriodError("INVALID_DATE", "Period dates read YYYY-MM-DD and must exist.");
  }
  return periodStartDate > currentLocalDate;
}

/** The local day during which the nightly worker may publish a period: the day before it starts. */
export function nextProjectionIssueDate(periodStartDate: string): string {
  return addLocalDays(periodStartDate, -1);
}
