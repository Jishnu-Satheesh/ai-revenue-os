import { createHash } from "node:crypto";

import { z } from "zod";

import {
  normalizeReportStructureIdentifier,
  type ReportContractDocument,
} from "@/domain/reports/contracts";

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

/**
 * An immutable, human-approved extension of an exact report contract. It has
 * no expressions, filters, dimensions, temporal coercion, or code references.
 */
export const reportProjectionDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    outputKind: z.literal("exact_range"),
    outputs: z.array(reportProjectionOutputSchema).min(1).max(50),
  })
  .strict()
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

export class ReportProjectionError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "ReportProjectionError";
  }
}

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
