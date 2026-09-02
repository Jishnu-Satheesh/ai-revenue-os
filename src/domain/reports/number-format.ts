/**
 * How a provider writes a number.
 *
 * The same reason `dateEncoding` exists. A spreadsheet hands over a number as a
 * number and its display format is nobody's business, but a PDF hands over what
 * was printed -- and an accounting statement prints `1,234.56`. Read literally
 * that is not a number at all, and every money column on a statement fails.
 *
 * Declared on the field rather than sniffed, because `1,234` is one number to a
 * statement and could be two badly split columns in a CSV. Guessing which would
 * be exactly the silent reinterpretation the contract exists to prevent, so a
 * grouped column says so and an undeclared one keeps failing.
 *
 * Only the separators are removed. Nothing here rounds, scales, or changes a
 * value, and a string that is not properly grouped is handed back untouched to
 * fail against the ordinary pattern.
 */

export type ReportNumberFormat = "plain" | "grouped";

/**
 * Thousands grouping, and only that.
 *
 * Anchored and strict: three digits after every separator, one to three before
 * the first. `1,23` and `1,2345` are not grouped numbers and are left alone to
 * be refused, rather than quietly becoming 123 and 12345.
 */
const GROUPED = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

export function ungroupNumber(value: unknown, format: ReportNumberFormat | undefined): unknown {
  if (format !== "grouped" || typeof value !== "string") return value;
  const trimmed = value.trim();
  return GROUPED.test(trimmed) ? trimmed.replaceAll(",", "") : value;
}
