import { ReportProjectionError } from "@/domain/reports/projection-error";

/**
 * Reading the date a row belongs to.
 *
 * Providers do not agree on how to write a date, and the differences are not
 * cosmetic: Talabat sends a real date, Keeta sends the integer `20260228`, and
 * Keeta's billing report sends the text `1 Jan 2026`. The encoding is declared
 * in the approved contract rather than sniffed, because `03/04/2026` is the
 * third of April or the fourth of March depending on who exported it, and no
 * amount of cleverness can tell which from the value alone.
 *
 * The result is a local calendar date. No timezone arithmetic happens here and
 * none should: the date on a marketplace row is the merchant's own day, and
 * converting it would move sales across midnight.
 */

export type PeriodKeyEncoding =
  /** `2026-01-31`, or a spreadsheet date cell. */
  | "iso_date"
  /** `20260131`, as a number or a string. */
  | "compact_date"
  /** `1 Jan 2026`, the form Keeta's billing report uses. */
  | "text_date";

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
const TEXT = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/;

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Rejects the 31st of February rather than rolling it into March. */
function assertRealDate(year: number, month: number, day: number): void {
  if (month < 1 || month > 12 || day < 1) throw new ReportProjectionError("INVALID_LOCAL_DATE");
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) throw new ReportProjectionError("INVALID_LOCAL_DATE");
}

function fromParts(year: number, month: number, day: number): string {
  assertRealDate(year, month, day);
  return `${year}-${pad(month)}-${pad(day)}`;
}

export function parsePeriodKey(value: unknown, encoding: PeriodKeyEncoding): string {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) {
    throw new ReportProjectionError("INVALID_LOCAL_DATE");
  }

  // A spreadsheet date cell arrives as a Date already anchored to UTC midnight
  // by the reader. Its UTC parts are the calendar date the file displayed, and
  // reading them locally would shift the day for anyone west of Greenwich.
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new ReportProjectionError("INVALID_LOCAL_DATE");
    return fromParts(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
  }

  if (typeof value === "object") throw new ReportProjectionError("INVALID_LOCAL_DATE");

  const text = String(value).trim();

  if (encoding === "iso_date") {
    const match = ISO.exec(text);
    if (!match) throw new ReportProjectionError("INVALID_LOCAL_DATE");
    return fromParts(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  if (encoding === "compact_date") {
    const match = COMPACT.exec(text);
    if (!match) throw new ReportProjectionError("INVALID_LOCAL_DATE");
    return fromParts(Number(match[1]), Number(match[2]), Number(match[3]));
  }

  const match = TEXT.exec(text);
  if (!match) throw new ReportProjectionError("INVALID_LOCAL_DATE");
  const month = MONTHS[match[2].slice(0, 3).toLowerCase()];
  if (!month) throw new ReportProjectionError("INVALID_LOCAL_DATE");
  return fromParts(Number(match[3]), month, Number(match[1]));
}

/**
 * The period a date falls in, at the declared grain.
 *
 * A week starts on Monday. That is a choice, and it is declared here rather
 * than left to a locale, because a rollup whose week boundary depends on the
 * server's locale is not reproducible.
 */
export function periodStartFor(date: string, grain: "day" | "week" | "month"): string {
  if (grain === "day") return date;
  const [year, month, day] = date.split("-").map(Number);
  if (grain === "month") return `${year}-${pad(month)}-01`;
  const utc = new Date(Date.UTC(year, month - 1, day));
  const weekday = (utc.getUTCDay() + 6) % 7;
  utc.setUTCDate(utc.getUTCDate() - weekday);
  return fromParts(utc.getUTCFullYear(), utc.getUTCMonth() + 1, utc.getUTCDate());
}
