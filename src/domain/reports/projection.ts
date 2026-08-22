import { createHash } from "node:crypto";

import { z } from "zod";

import {
  normalizeReportStructureIdentifier,
  type ReportContractDocument,
} from "@/domain/reports/contracts";
import { parsePeriodKey, periodStartFor } from "@/domain/reports/period-key";
import { ReportProjectionError } from "@/domain/reports/projection-error";

export { ReportProjectionError };

const normalizedIdentifierSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const metricKeySchema = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/);

const reportProjectionOutputSchema = z
  .object({
    key: normalizedIdentifierSchema,
    normalizedSheetName: normalizedIdentifierSchema,
    canonicalField: normalizedIdentifierSchema,
    metricKey: metricKeySchema,
    valueKind: z.enum(["money", "count"]),
    aggregation: z.literal("sum"),
  })
  .strict();

const exactRangeDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    outputKind: z.literal("exact_range"),
    outputs: z.array(reportProjectionOutputSchema).min(1).max(50),
  })
  .strict();

/**
 * A declaration over a file that carries one row per period.
 *
 * Most of the client's real exports are daily: Talabat is one row per day over
 * 56 columns, and three of Keeta's five reports are the same. The grain is
 * declared here and never inferred from the data, so a file whose rows do not
 * match what was approved is a failure rather than a silent reinterpretation.
 *
 * See ADR 0029.
 */
const periodGrainDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    outputKind: z.literal("period_grain"),
    grain: z.enum(["day", "week", "month"]),
    periodKey: z
      .object({
        normalizedSheetName: normalizedIdentifierSchema,
        canonicalField: normalizedIdentifierSchema,
        encoding: z.enum(["iso_date", "compact_date", "text_date"]),
      })
      .strict(),
    outputs: z.array(reportProjectionOutputSchema).min(1).max(50),
  })
  .strict();

/**
 * An immutable, human-approved extension of an exact report contract. It has
 * no expressions, filters, dimensions, ratios, or code references.
 */
export const reportProjectionDocumentSchema = z
  .discriminatedUnion("outputKind", [exactRangeDocumentSchema, periodGrainDocumentSchema])
  .superRefine((document, context) => {
    if (document.outputKind === "period_grain") {
      // The date has to come from the same sheet as the values it dates.
      // Reading it from another sheet would pair a row with a period that has
      // no relationship to it.
      const foreign = document.outputs.some(
        (output) => output.normalizedSheetName !== document.periodKey.normalizedSheetName,
      );
      if (foreign) {
        context.addIssue({
          code: "custom",
          path: ["periodKey"],
          message: "The period field must live on the same sheet as the values it dates.",
        });
      }
      const collides = document.outputs.some(
        (output) => output.canonicalField === document.periodKey.canonicalField,
      );
      if (collides) {
        context.addIssue({
          code: "custom",
          path: ["periodKey"],
          message: "The period field cannot also be projected as a value.",
        });
      }
    }
  })
  .superRefine((document, context) => {
    const outputKeys = new Set<string>();
    const metricKeys = new Set<string>();
    const sourceFields = new Set<string>();
    for (const output of document.outputs) {
      const source = `${output.normalizedSheetName}:${output.canonicalField}`;
      if (outputKeys.has(output.key)) {
        context.addIssue({ code: "custom", path: ["outputs"], message: "Projection output keys must be unique." });
      }
      if (metricKeys.has(output.metricKey)) {
        context.addIssue({ code: "custom", path: ["outputs"], message: "A projection may emit each metric key once." });
      }
      if (sourceFields.has(source)) {
        context.addIssue({ code: "custom", path: ["outputs"], message: "A source field may feed one exact-range metric." });
      }
      outputKeys.add(output.key);
      metricKeys.add(output.metricKey);
      sourceFields.add(source);
    }
  });

export type ReportProjectionDocument = z.output<typeof reportProjectionDocumentSchema>;

export type ExactRangeProjectionOutput = {
  key: string;
  metricKey: string;
  valueKind: "money" | "count";
  valueNumerator: string;
  currency: string | null;
  normalizedSheetName: string;
  canonicalField: string;
  firstDataRow: number;
  lastDataRow: number;
  contributorCount: number;
};

export type ExactRangeProjectionResult = {
  outputs: ExactRangeProjectionOutput[];
};



const currencyExponents: Readonly<Record<string, number>> = {
  BHD: 3,
  IQD: 3,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  OMR: 3,
  TND: 3,
};
const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const integerPattern = /^[+-]?\d+$/;

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function createReportProjectionResultDigest(result: ExactRangeProjectionResult): string {
  return createHash("sha256").update(canonicalize(result)).digest("hex");
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

function isFormula(value: unknown): boolean {
  return value !== null && typeof value === "object" && "formula" in value;
}

function sourceHeaderMap(row: readonly unknown[]): Map<string, number> {
  const headers = new Map<string, number>();
  row.forEach((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0) return;
    const header = normalizeReportStructureIdentifier(value);
    if (!headers.has(header)) headers.set(header, index);
  });
  return headers;
}

function stringValue(value: unknown, code: string): string {
  if (isFormula(value) || value instanceof Date || typeof value === "object") {
    throw new ReportProjectionError(code);
  }
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!numericPattern.test(text)) throw new ReportProjectionError(code);
  return text;
}

function normalizeInteger(value: string): string {
  const negative = value.startsWith("-");
  const digits = value.replace(/^[+-]/, "").replace(/^0+(?=\d)/, "") || "0";
  return digits === "0" ? "0" : negative ? `-${digits}` : digits;
}

function compareAbsolute(left: string, right: string): number {
  if (left.length !== right.length) return left.length - right.length;
  return left.localeCompare(right);
}

function addAbsolute(left: string, right: string): string {
  let carry = 0;
  let result = "";
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const leftDigit = Number(left.at(-index - 1) ?? "0");
    const rightDigit = Number(right.at(-index - 1) ?? "0");
    const sum = leftDigit + rightDigit + carry;
    result = `${sum % 10}${result}`;
    carry = Math.floor(sum / 10);
  }
  return carry ? `${carry}${result}` : result;
}

function subtractAbsolute(larger: string, smaller: string): string {
  let borrow = 0;
  let result = "";
  for (let index = 0; index < larger.length; index += 1) {
    let digit = Number(larger.at(-index - 1)) - borrow - Number(smaller.at(-index - 1) ?? "0");
    if (digit < 0) {
      digit += 10;
      borrow = 1;
    } else {
      borrow = 0;
    }
    result = `${digit}${result}`;
  }
  return result.replace(/^0+(?=\d)/, "") || "0";
}

function addIntegerStrings(left: string, right: string): string {
  const leftNegative = left.startsWith("-");
  const rightNegative = right.startsWith("-");
  const leftAbsolute = left.replace("-", "");
  const rightAbsolute = right.replace("-", "");
  if (leftNegative === rightNegative) {
    const sum = addAbsolute(leftAbsolute, rightAbsolute);
    return sum === "0" ? "0" : leftNegative ? `-${sum}` : sum;
  }
  const comparison = compareAbsolute(leftAbsolute, rightAbsolute);
  if (comparison === 0) return "0";
  const difference = comparison > 0
    ? subtractAbsolute(leftAbsolute, rightAbsolute)
    : subtractAbsolute(rightAbsolute, leftAbsolute);
  return comparison > 0 ? (leftNegative ? `-${difference}` : difference) : rightNegative ? `-${difference}` : difference;
}

function moneyMinorUnits(value: unknown, currency: string): string {
  const text = stringValue(value, "INVALID_MONEY");
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const exponent = currencyExponents[currency] ?? 2;
  if (fraction.length > exponent) throw new ReportProjectionError("INVALID_MONEY");
  const digits = `${whole || "0"}${fraction.padEnd(exponent, "0")}`.replace(/^0+(?=\d)/, "");
  return normalizeInteger(`${negative ? "-" : ""}${digits || "0"}`);
}

function integer(value: unknown): string {
  if (isFormula(value) || value instanceof Date || typeof value === "object") {
    throw new ReportProjectionError("INVALID_INTEGER");
  }
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!integerPattern.test(text)) throw new ReportProjectionError("INVALID_INTEGER");
  return normalizeInteger(text);
}

function findSourceField(
  contract: ReportContractDocument,
  output: ReportProjectionDocument["outputs"][number],
) {
  const sheet = contract.sheets.find(
    (candidate) => candidate.normalizedSheetName === output.normalizedSheetName,
  );
  if (!sheet) throw new ReportProjectionError("PROJECTION_SHEET_NOT_DECLARED");
  const field = sheet.fields.find((candidate) => candidate.canonicalField === output.canonicalField);
  if (!field) throw new ReportProjectionError("PROJECTION_FIELD_NOT_DECLARED");
  if (!field.required) throw new ReportProjectionError("PROJECTION_FIELD_NOT_REQUIRED");
  if ((output.valueKind === "money" && field.parser !== "money") ||
      (output.valueKind === "count" && field.parser !== "integer")) {
    throw new ReportProjectionError("PROJECTION_FIELD_VALUE_KIND_MISMATCH");
  }
  return { sheet, field };
}

export function projectExactRangeMetrics(input: {
  contract: ReportContractDocument;
  document: ReportProjectionDocument;
  declaredCurrency: string;
  sheets: readonly { normalizedSheetName: string; rows: readonly (readonly unknown[])[] }[];
}): ExactRangeProjectionResult {
  const sheetsByName = new Map(input.sheets.map((sheet) => [sheet.normalizedSheetName, sheet]));
  const outputs: ExactRangeProjectionOutput[] = [];

  for (const output of input.document.outputs) {
    const { sheet: rule, field } = findSourceField(input.contract, output);
    const source = sheetsByName.get(output.normalizedSheetName);
    if (!source) throw new ReportProjectionError("REQUIRED_SHEET_MISSING");
    const header = source.rows[rule.headerRow - 1];
    if (!header) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");
    const columnIndex = sourceHeaderMap(header).get(field.sourceHeader);
    if (columnIndex === undefined) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");

    let total = "0";
    let contributorCount = 0;
    for (let rowIndex = rule.dataStartRow - 1; rowIndex < source.rows.length; rowIndex += 1) {
      const value = source.rows[rowIndex]?.[columnIndex];
      if (isBlank(value)) throw new ReportProjectionError("REQUIRED_PROJECTED_VALUE_MISSING");
      total = addIntegerStrings(
        total,
        output.valueKind === "money" ? moneyMinorUnits(value, input.declaredCurrency) : integer(value),
      );
      contributorCount += 1;
    }

    outputs.push({
      key: output.key,
      metricKey: output.metricKey,
      valueKind: output.valueKind,
      valueNumerator: total,
      currency: output.valueKind === "money" ? input.declaredCurrency : null,
      normalizedSheetName: output.normalizedSheetName,
      canonicalField: output.canonicalField,
      firstDataRow: rule.dataStartRow,
      lastDataRow: Math.max(rule.dataStartRow - 1, source.rows.length),
      contributorCount,
    });
  }

  return { outputs };
}

export type PeriodGrainObservation = {
  key: string;
  metricKey: string;
  valueKind: "money" | "count";
  /** Inclusive local dates. No timezone arithmetic happens anywhere. */
  periodStart: string;
  periodEnd: string;
  valueNumerator: string;
  currency: string | null;
  normalizedSheetName: string;
  canonicalField: string;
  contributorCount: number;
};

export type PeriodGrainProjectionResult = {
  observations: PeriodGrainObservation[];
  /**
   * Rows whose value was blank for a given output.
   *
   * Reported rather than swallowed. A gap is a fact about the evidence, and
   * `specs/018` section 10.1 says gaps stay absent — but an operator still has
   * to be able to see that eleven of thirty days said nothing.
   */
  absentRowCount: number;
};

function periodEndFor(start: string, grain: "day" | "week" | "month"): string {
  const [year, month, day] = start.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (grain === "day") return start;
  if (grain === "week") utc.setUTCDate(utc.getUTCDate() + 6);
  else utc.setUTCMonth(utc.getUTCMonth() + 1, 0);
  return `${utc.getUTCFullYear()}-${String(utc.getUTCMonth() + 1).padStart(2, "0")}-${String(
    utc.getUTCDate(),
  ).padStart(2, "0")}`;
}

/**
 * Sum a file that carries one row per period into one observation per period.
 *
 * Blank is not zero, and the difference is load-bearing. Talabat records a day
 * with no trading as blank and a day that genuinely sold nothing as `0`, and
 * the client's own data contains both within the same week. A blank leaves the
 * period absent, which `specs/012` section 6.2 requires; a zero is summed like
 * any other figure.
 */
export function projectPeriodGrainMetrics(input: {
  contract: ReportContractDocument;
  document: Extract<ReportProjectionDocument, { outputKind: "period_grain" }>;
  declaredCurrency: string;
  sheets: readonly { normalizedSheetName: string; rows: readonly (readonly unknown[])[] }[];
}): PeriodGrainProjectionResult {
  const { periodKey, grain } = input.document;
  const source = input.sheets.find(
    (sheet) => sheet.normalizedSheetName === periodKey.normalizedSheetName,
  );
  if (!source) throw new ReportProjectionError("REQUIRED_SHEET_MISSING");

  const rule = input.contract.sheets.find(
    (sheet) => sheet.normalizedSheetName === periodKey.normalizedSheetName,
  );
  if (!rule) throw new ReportProjectionError("PROJECTION_SHEET_NOT_DECLARED");

  const header = source.rows[rule.headerRow - 1];
  if (!header) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");
  const headers = sourceHeaderMap(header);

  const periodField = rule.fields.find(
    (field) => field.canonicalField === periodKey.canonicalField,
  );
  if (!periodField) throw new ReportProjectionError("PROJECTION_FIELD_NOT_DECLARED");
  const periodColumn = headers.get(periodField.sourceHeader);
  if (periodColumn === undefined) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");

  const columns = input.document.outputs.map((output) => {
    const { field } = findSourceField(input.contract, output);
    const index = headers.get(field.sourceHeader);
    if (index === undefined) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");
    return { output, index };
  });

  // Keyed by period then output, so the same period appearing on two rows sums
  // rather than producing two observations that later collide.
  const totals = new Map<string, Map<string, { total: string; contributors: number }>>();
  let absentRowCount = 0;

  for (let rowIndex = rule.dataStartRow - 1; rowIndex < source.rows.length; rowIndex += 1) {
    const row = source.rows[rowIndex];
    if (!row) continue;
    // A wholly empty trailing row is padding, not a period with no data.
    if (row.every((value) => isBlank(value))) continue;

    const periodStart = periodStartFor(
      parsePeriodKey(row[periodColumn], periodKey.encoding),
      grain,
    );
    const byOutput = totals.get(periodStart) ?? new Map();
    totals.set(periodStart, byOutput);

    for (const { output, index } of columns) {
      const value = row[index];
      if (isBlank(value)) {
        absentRowCount += 1;
        continue;
      }
      const amount =
        output.valueKind === "money"
          ? moneyMinorUnits(value, input.declaredCurrency)
          : integer(value);
      const running = byOutput.get(output.key) ?? { total: "0", contributors: 0 };
      byOutput.set(output.key, {
        total: addIntegerStrings(running.total, amount),
        contributors: running.contributors + 1,
      });
    }
  }

  const observations: PeriodGrainObservation[] = [];
  for (const [periodStart, byOutput] of totals) {
    for (const output of input.document.outputs) {
      const running = byOutput.get(output.key);
      // Absent, not zero. A period every one of whose rows was blank for this
      // output has nothing to say about it, and saying "0" would be a claim.
      if (!running) continue;
      observations.push({
        key: output.key,
        metricKey: output.metricKey,
        valueKind: output.valueKind,
        periodStart,
        periodEnd: periodEndFor(periodStart, grain),
        valueNumerator: running.total,
        currency: output.valueKind === "money" ? input.declaredCurrency : null,
        normalizedSheetName: output.normalizedSheetName,
        canonicalField: output.canonicalField,
        contributorCount: running.contributors,
      });
    }
  }

  // Stable ordering, so the digest of a result depends on the evidence and not
  // on the order a Map happened to iterate in.
  observations.sort(
    (left, right) =>
      left.periodStart.localeCompare(right.periodStart) || left.key.localeCompare(right.key),
  );

  return { observations, absentRowCount };
}
