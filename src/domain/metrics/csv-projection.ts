import { TZDate } from "@date-fns/tz";

import { metricError } from "@/domain/metrics/errors";
import { assertValidTimeZone, nextPeriodStart, startOfPeriod } from "@/domain/metrics/periods";
import type { MetricPeriodGrain, MetricValueKind } from "@/domain/metrics/types";

/**
 * Projects CSV import rows onto metric observations.
 *
 * `integration_data_sources.column_mapping` is already a map of target to CSV
 * header, which suits a wide export directly: reserved targets carry the row's
 * period and dimensions, and every other target is read as a metric key. A
 * daily sales export becomes
 * `{ period: "Date", "revenue.gross": "Total", "transactions.count": "Orders" }`.
 *
 * Deterministic and pure, per `specs/015-metric-registry-and-normalized-metrics.md`
 * section 6. Nothing is dropped silently: every row that cannot be projected
 * yields a rejection naming the row and the reason.
 */

const METRIC_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/;
const DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

/** Targets the projection interprets itself rather than as a metric key. */
export const RESERVED_MAPPING_TARGETS = ["period", "channel", "currency"] as const;

/** Minor units per major unit. Currencies without cents are the exception. */
const DEFAULT_CURRENCY_EXPONENT = 2;
const CURRENCY_EXPONENTS: Readonly<Record<string, number>> = {
  BHD: 3,
  IQD: 3,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  OMR: 3,
  TND: 3,
};

export type CsvMetricMapping = {
  periodColumn: string;
  channelColumn: string | null;
  currencyColumn: string | null;
  /** Metric key to CSV header. */
  metricColumns: ReadonlyMap<string, string>;
};

export type CsvProjectionDefinition = {
  key: string;
  valueKind: MetricValueKind;
};

export type MetricObservationDraft = {
  metricKey: string;
  periodStart: Date;
  periodEnd: Date;
  periodTimezone: string;
  numerator: number;
  denominator: null;
  currency: string | null;
  channel: string | null;
};

export type CsvRejectionReason =
  | "UNKNOWN_METRIC_KEY"
  | "UNSUPPORTED_VALUE_KIND"
  | "MISSING_PERIOD"
  | "INVALID_PERIOD"
  | "MISSING_VALUE"
  | "INVALID_VALUE"
  | "MISSING_CURRENCY";

export type CsvProjectionRejection = {
  row: number;
  metricKey: string | null;
  reason: CsvRejectionReason;
};

export type CsvProjectionResult = {
  observations: MetricObservationDraft[];
  rejections: CsvProjectionRejection[];
};

/**
 * Splits a data source's column mapping into the reserved dimensions and the
 * metric keys. Rejects a mapping that names no period or no metric, because
 * either makes every row unprojectable and is better caught at configuration
 * time than once per row.
 */
export function parseCsvMetricMapping(mapping: Readonly<Record<string, string>>): CsvMetricMapping {
  const reserved = new Set<string>(RESERVED_MAPPING_TARGETS);
  const metricColumns = new Map<string, string>();

  for (const [target, header] of Object.entries(mapping)) {
    if (reserved.has(target)) continue;
    if (!METRIC_KEY_PATTERN.test(target))
      throw metricError("METRIC_CSV_MAPPING_INVALID", { target });
    metricColumns.set(target, header);
  }

  if (!mapping.period) throw metricError("METRIC_CSV_MAPPING_INVALID", { missing: "period" });
  if (metricColumns.size === 0)
    throw metricError("METRIC_CSV_MAPPING_INVALID", { missing: "metric column" });

  return {
    periodColumn: mapping.period,
    channelColumn: mapping.channel ?? null,
    currencyColumn: mapping.currency ?? null,
    metricColumns,
  };
}

export type ProjectCsvRowsInput = {
  rows: readonly Readonly<Record<string, string>>[];
  mapping: CsvMetricMapping;
  grain: MetricPeriodGrain;
  timeZone: string;
  /** Definitions for the mapped keys. An unmapped key rejects rather than guesses. */
  definitions: readonly CsvProjectionDefinition[];
  /** Fallback when the mapping names no currency column. */
  defaultCurrency?: string | null;
};

export function projectCsvRows(input: ProjectCsvRowsInput): CsvProjectionResult {
  assertValidTimeZone(input.timeZone);

  const definitionsByKey = new Map(input.definitions.map((entry) => [entry.key, entry]));
  const observations: MetricObservationDraft[] = [];
  const rejections: CsvProjectionRejection[] = [];

  input.rows.forEach((row, index) => {
    const rowNumber = index + 1;

    const periodStart = readPeriodStart(row, input, rowNumber, rejections);
    if (!periodStart) return;

    const periodEnd = nextPeriodStart(periodStart, input.grain, input.timeZone);
    const channel = readOptional(row, input.mapping.channelColumn);
    const rowCurrency = readOptional(row, input.mapping.currencyColumn) ?? input.defaultCurrency;

    for (const [metricKey, header] of input.mapping.metricColumns) {
      const definition = definitionsByKey.get(metricKey);
      if (!definition) {
        rejections.push({ row: rowNumber, metricKey, reason: "UNKNOWN_METRIC_KEY" });
        continue;
      }

      // A ratio or rating needs a numerator and a denominator, and a single
      // CSV column can only supply a quotient. Ingesting one would store
      // exactly the shape the schema forbids, so it is refused rather than
      // silently flattened.
      if (definition.valueKind === "ratio" || definition.valueKind === "rating") {
        rejections.push({ row: rowNumber, metricKey, reason: "UNSUPPORTED_VALUE_KIND" });
        continue;
      }

      const raw = readOptional(row, header);
      if (raw === null) {
        rejections.push({ row: rowNumber, metricKey, reason: "MISSING_VALUE" });
        continue;
      }

      const currency = definition.valueKind === "money" ? (rowCurrency ?? null) : null;
      if (definition.valueKind === "money" && !currency) {
        rejections.push({ row: rowNumber, metricKey, reason: "MISSING_CURRENCY" });
        continue;
      }

      const numerator = readNumerator(raw, definition.valueKind, currency);
      if (numerator === null) {
        rejections.push({ row: rowNumber, metricKey, reason: "INVALID_VALUE" });
        continue;
      }

      observations.push({
        metricKey,
        periodStart,
        periodEnd,
        periodTimezone: input.timeZone,
        numerator,
        denominator: null,
        currency,
        channel,
      });
    }
  });

  return { observations, rejections };
}

function readPeriodStart(
  row: Readonly<Record<string, string>>,
  input: ProjectCsvRowsInput,
  rowNumber: number,
  rejections: CsvProjectionRejection[],
): Date | null {
  const raw = readOptional(row, input.mapping.periodColumn);
  if (raw === null) {
    rejections.push({ row: rowNumber, metricKey: null, reason: "MISSING_PERIOD" });
    return null;
  }

  const instant = parsePeriodInstant(raw, input.timeZone);
  if (!instant) {
    rejections.push({ row: rowNumber, metricKey: null, reason: "INVALID_PERIOD" });
    return null;
  }

  return startOfPeriod(instant, input.grain, input.timeZone);
}

/**
 * Only three unambiguous forms are accepted, and `Date.parse` is deliberately
 * not the fallback for anything else.
 *
 * `Date.parse("03/04/2026")` succeeds and yields 4 March, guessing US
 * month-first order. A Dubai or London client exporting 3 April would be filed
 * a month early with no error anywhere, which is the precise class of silent
 * corruption the rest of this module exists to prevent. A format we cannot read
 * unambiguously is a rejection, not a guess.
 */
function parsePeriodInstant(value: string, timeZone: string): Date | null {
  const dateOnly = DATE_ONLY_PATTERN.exec(value);
  if (dateOnly) {
    const [, year, month, day] = dateOnly;
    return localDateInstant(Number(year), Number(month), Number(day), timeZone);
  }

  const timestamp = TIMESTAMP_PATTERN.exec(value);
  if (!timestamp) return null;

  const [, year, month, day, hour, minute, second = "0", offset] = timestamp;

  // An explicit offset makes the instant absolute; without one the timestamp is
  // a wall-clock reading at the branch, which is how an operator would write it.
  const anchored = offset
    ? new Date(Date.parse(value.replace(" ", "T")))
    : new Date(
        new TZDate(
          Number(year),
          Number(month) - 1,
          Number(day),
          Number(hour),
          Number(minute),
          Number(second),
          timeZone,
        ).getTime(),
      );

  return Number.isFinite(anchored.getTime()) ? anchored : null;
}

/**
 * Local noon on the given calendar day, so a midnight DST transition cannot
 * push the anchor into the previous day. The round-trip check rejects a date
 * that does not exist, such as 30 February, which would otherwise roll forward
 * silently.
 */
function localDateInstant(year: number, month: number, day: number, timeZone: string): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const anchored = new TZDate(year, month - 1, day, 12, 0, 0, timeZone);
  const instant = new Date(anchored.getTime());
  if (!Number.isFinite(instant.getTime())) return null;

  const rendered = new Intl.DateTimeFormat("en-CA", { timeZone }).format(instant);
  const expected = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return rendered === expected ? instant : null;
}

function readNumerator(
  raw: string,
  valueKind: MetricValueKind,
  currency: string | null,
): number | null {
  if (!DECIMAL_PATTERN.test(raw)) return null;

  if (valueKind === "money") return toMinorUnits(raw, currencyExponent(currency));

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;

  // Counts and durations are whole by definition; a fractional order count is
  // a mapping error, not a value to round.
  return Number.isInteger(parsed) ? parsed : null;
}

/**
 * Converts a major-unit decimal to integer minor units by string manipulation.
 *
 * Float arithmetic is not safe here: `12.34 * 100` is `1233.9999999999998`, and
 * rounding that away would hide genuine precision errors alongside the harmless
 * ones. A value carrying more precision than the currency has is rejected
 * rather than truncated, because silently dropping a fraction of a fils is how
 * a ledger stops reconciling.
 */
export function toMinorUnits(value: string, exponent: number): number | null {
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");

  if (fraction.length > exponent && /[1-9]/.test(fraction.slice(exponent))) return null;

  const padded = fraction.padEnd(exponent, "0").slice(0, exponent);
  const minor = Number(`${whole}${padded}`);
  if (!Number.isSafeInteger(minor)) return null;

  return negative ? -minor : minor;
}

export function currencyExponent(currency: string | null): number {
  if (!currency) return DEFAULT_CURRENCY_EXPONENT;
  return CURRENCY_EXPONENTS[currency.toUpperCase()] ?? DEFAULT_CURRENCY_EXPONENT;
}

function readOptional(row: Readonly<Record<string, string>>, column: string | null): string | null {
  if (!column) return null;
  const value = row[column];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}
