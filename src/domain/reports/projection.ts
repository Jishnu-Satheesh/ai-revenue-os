import { createHash } from "node:crypto";

import { z } from "zod";

import { isAbsentValue, isEmptyCell } from "@/domain/reports/absent";
import {
  normalizeReportStructureIdentifier,
  type ReportContractDocument,
} from "@/domain/reports/contracts";
import {
  parsePeriodKey,
  periodStartFor,
  type PeriodKeyContext,
} from "@/domain/reports/period-key";
import { selectContractSheet } from "@/domain/reports/sheet-locator";
import { findTotalsRow } from "@/domain/reports/totals-row";
import {
  ReportControlTotalMismatch,
  ReportProjectionError,
} from "@/domain/reports/projection-error";

export { ReportControlTotalMismatch, ReportProjectionError };

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
 * A money figure the provider itself states as the total for this period, which
 * the projected rows have to reach.
 *
 * The figure is recorded by the operator at approval time from the provider's
 * own statement — Keeta states January's credit sales on its commission
 * invoice, and nothing in the workbook repeats it. That makes the import
 * checkable by arithmetic instead of trust: if the rows do not add up to what
 * the provider says they should, the mapping or the period is wrong and the
 * import is refused rather than admitted.
 *
 * Money only, per ADR 0029. A count total is the same code and no new evidence
 * asks for it yet.
 */
const projectionControlTotalSchema = z
  .object({
    outputKey: normalizedIdentifierSchema,
    /**
     * Where the figure comes from.
     *
     * `operator_stated` is a figure read off the provider's separate statement
     * and recorded at approval time — Keeta invoices a month's credit sales and
     * repeats it nowhere in the workbook. `sheet_totals_row` is the total the
     * file states about itself, which EatEasily and Smile both render.
     */
    source: z.enum(["operator_stated", "sheet_totals_row"]).default("operator_stated"),
    /** Minor units of the declaration's currency, signed. Operator-stated only. */
    statedTotalMinorUnits: z.string().regex(/^-?(0|[1-9]\d{0,17})$/).optional(),
    /** Minor units. Zero means the figures have to agree exactly. */
    toleranceMinorUnits: z.number().int().min(0).max(100_000_000),
    /** Which statement the figure was read from. Operator-stated only. */
    statedSource: z.string().min(1).max(200).optional(),
  })
  .strict()
  .superRefine((control, context) => {
    const stated = control.source === "operator_stated";
    if (stated && (control.statedTotalMinorUnits === undefined || control.statedSource === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["statedTotalMinorUnits"],
        // An unattributed figure is not evidence, and a figure with no value
        // cannot be checked against anything.
        message: "An operator-stated total needs both the figure and the statement it came from.",
      });
    }
    if (!stated && (control.statedTotalMinorUnits !== undefined || control.statedSource !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["statedTotalMinorUnits"],
        message: "A total taken from the sheet cannot also be stated by hand.",
      });
    }
  });

const exactRangeDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    outputKind: z.literal("exact_range"),
    outputs: z.array(reportProjectionOutputSchema).min(1).max(50),
    controlTotals: z.array(projectionControlTotalSchema).max(50).default([]),
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
        encoding: z.enum(["iso_date", "compact_date", "text_date", "day_month"]),
      })
      .strict(),
    outputs: z.array(reportProjectionOutputSchema).min(1).max(50),
    controlTotals: z.array(projectionControlTotalSchema).max(50).default([]),
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

    const byOutputKey = new Map(document.outputs.map((output) => [output.key, output]));
    const checked = new Set<string>();
    for (const control of document.controlTotals) {
      const output = byOutputKey.get(control.outputKey);
      if (!output) {
        context.addIssue({
          code: "custom",
          path: ["controlTotals"],
          message: "A control total must name an output this declaration emits.",
        });
        continue;
      }
      if (output.valueKind !== "money") {
        context.addIssue({
          code: "custom",
          path: ["controlTotals"],
          message: "Only a money output can be reconciled to a stated total.",
        });
      }
      if (checked.has(control.outputKey)) {
        context.addIssue({
          code: "custom",
          path: ["controlTotals"],
          // Two totals for one output would either agree, and be redundant, or
          // disagree, and leave no honest answer about which one governs.
          message: "An output may be reconciled to one stated total.",
        });
      }
      checked.add(control.outputKey);
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

/**
 * A stated total and what the projected rows actually came to.
 *
 * Returned even when it reconciles, so an operator can be shown that the import
 * was checked against the provider's own figure rather than merely accepted.
 */
export type ControlTotalReconciliation = {
  outputKey: string;
  statedMinorUnits: string;
  projectedMinorUnits: string;
  /** Projected minus stated. Negative means the file came up short. */
  differenceMinorUnits: string;
  toleranceMinorUnits: number;
  statedSource: string;
};

export type ExactRangeProjectionResult = {
  outputs: ExactRangeProjectionOutput[];
  controlTotals: ControlTotalReconciliation[];
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

/**
 * Identifies the projected figures, and only those.
 *
 * A reconciled control total is a check that passed, not a figure, so it stays
 * out: including it would change the digest of every existing declaration and
 * make an unchanged import look like a correction.
 */
export function createReportProjectionResultDigest(result: {
  outputs: readonly ExactRangeProjectionOutput[];
}): string {
  return createHash("sha256").update(canonicalize(result)).digest("hex");
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

function negateIntegerString(value: string): string {
  if (value === "0") return "0";
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

/**
 * Check every projected figure against the total the provider stated.
 *
 * Throws on the first gap outside tolerance rather than collecting them: an
 * import that is wrong about one figure is not admitted because the rest agreed,
 * and the first mismatch is the one an operator should look at.
 */
type DeclaredControlTotal = z.output<typeof projectionControlTotalSchema>;

function reconcileControlTotals(
  controls: readonly DeclaredControlTotal[],
  projectedByOutputKey: ReadonlyMap<string, string>,
  /** Figures read from the sheet's own totals row, keyed by output. */
  sheetTotalsByOutputKey: ReadonlyMap<string, string>,
): ControlTotalReconciliation[] {
  return controls.map((control) => {
    const fromSheet = control.source === "sheet_totals_row";
    const statedMinorUnits = fromSheet
      ? sheetTotalsByOutputKey.get(control.outputKey)
      : control.statedTotalMinorUnits;
    // The declaration named a totals row the file did not yield a figure in.
    // Comparing against nothing would report a pass nobody checked.
    if (statedMinorUnits === undefined) throw new ReportProjectionError("TOTALS_ROW_NOT_RESOLVED");
    const statedSource = fromSheet ? "sheet totals row" : (control.statedSource ?? "");
    // An output that produced no figure at all is not "zero" anywhere else in
    // this engine, but a stated total is an assertion that the file carries
    // figures. Reporting the whole stated amount as the gap describes that
    // truthfully, and the comparison below refuses the import.
    const projected = projectedByOutputKey.get(control.outputKey) ?? "0";
    const difference = addIntegerStrings(projected, negateIntegerString(statedMinorUnits));
    const reconciliation: ControlTotalReconciliation = {
      outputKey: control.outputKey,
      statedMinorUnits,
      projectedMinorUnits: projected,
      differenceMinorUnits: difference,
      toleranceMinorUnits: control.toleranceMinorUnits,
      statedSource,
    };
    const overshoot = compareAbsolute(
      difference.replace("-", ""),
      String(control.toleranceMinorUnits),
    );
    if (overshoot > 0) {
      throw new ReportControlTotalMismatch(
        control.outputKey,
        statedMinorUnits,
        projected,
        difference,
        control.toleranceMinorUnits,
      );
    }
    return reconciliation;
  });
}

/**
 * Which row of this sheet the provider rendered as its own total, if any.
 *
 * A declared totals row that cannot be pinned to exactly one row stops the
 * import. The alternative is summing the total in with the data, which doubles
 * every figure and looks entirely successful while doing it.
 */
function resolveTotalsRowIndex(
  rule: ReportContractDocument["sheets"][number],
  rows: readonly (readonly unknown[])[],
): number | null {
  if (!rule.totalsRow) return null;
  const header = rows[rule.headerRow - 1];
  if (!header) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");
  const headers = sourceHeaderMap(header);
  const fieldColumns = new Map<string, number>();
  for (const field of rule.fields) {
    const index = headers.get(field.sourceHeader);
    if (index !== undefined) fieldColumns.set(field.canonicalField, index);
  }
  const found = findTotalsRow({ rule, rows, fieldColumns });
  if (found.outcome === "found") return found.rowIndex;
  throw new ReportProjectionError("TOTALS_ROW_NOT_RESOLVED");
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
  const outputs: ExactRangeProjectionOutput[] = [];
  const totalsRowIndexes = new Map<string, number | null>();
  const sheetTotals = new Map<string, string>();

  for (const output of input.document.outputs) {
    const { sheet: rule, field } = findSourceField(input.contract, output);
    const source = selectContractSheet(rule, input.sheets);
    if (!source) throw new ReportProjectionError("REQUIRED_SHEET_MISSING");
    const header = source.rows[rule.headerRow - 1];
    if (!header) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");
    const columnIndex = sourceHeaderMap(header).get(field.sourceHeader);
    if (columnIndex === undefined) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");

    if (!totalsRowIndexes.has(output.normalizedSheetName)) {
      totalsRowIndexes.set(output.normalizedSheetName, resolveTotalsRowIndex(rule, source.rows));
    }
    const totalsRowIndex = totalsRowIndexes.get(output.normalizedSheetName) ?? null;

    let total = "0";
    let contributorCount = 0;
    for (let rowIndex = rule.dataStartRow - 1; rowIndex < source.rows.length; rowIndex += 1) {
      // The provider's own total is set aside, never summed. Adding it to the
      // rows it totals would double the figure and look like a clean import.
      if (rowIndex === totalsRowIndex) continue;
      const value = source.rows[rowIndex]?.[columnIndex];
      // An exact-range sum covers the whole declared period, so a row that said
      // nothing leaves the total unknowable rather than merely smaller.
      if (isAbsentValue(value, field.absentMarkers)) {
        throw new ReportProjectionError("REQUIRED_PROJECTED_VALUE_MISSING");
      }
      total = addIntegerStrings(
        total,
        output.valueKind === "money" ? moneyMinorUnits(value, input.declaredCurrency) : integer(value),
      );
      contributorCount += 1;
    }

    if (totalsRowIndex !== null && output.valueKind === "money") {
      const stated = source.rows[totalsRowIndex]?.[columnIndex];
      if (!isAbsentValue(stated, field.absentMarkers)) {
        sheetTotals.set(output.key, moneyMinorUnits(stated, input.declaredCurrency));
      }
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

  return {
    outputs,
    controlTotals: reconcileControlTotals(
      input.document.controlTotals,
      new Map(outputs.map((output) => [output.key, output.valueNumerator])),
      sheetTotals,
    ),
  };
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
  /**
   * Stated totals are checked against the sum across every period, which is the
   * grain a provider states them at: Keeta invoices a month, and the file it
   * came from carries a row per day.
   */
  controlTotals: ControlTotalReconciliation[];
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
  /**
   * The period the package declares it covers. Required only by the `day_month`
   * encoding, whose values carry no year of their own.
   */
  declaredPeriod?: PeriodKeyContext;
  sheets: readonly { normalizedSheetName: string; rows: readonly (readonly unknown[])[] }[];
}): PeriodGrainProjectionResult {
  const { periodKey, grain } = input.document;
  const rule = input.contract.sheets.find(
    (sheet) => sheet.normalizedSheetName === periodKey.normalizedSheetName,
  );
  if (!rule) throw new ReportProjectionError("PROJECTION_SHEET_NOT_DECLARED");

  const source = selectContractSheet(rule, input.sheets);
  if (!source) throw new ReportProjectionError("REQUIRED_SHEET_MISSING");

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
    return { output, index, absentMarkers: field.absentMarkers };
  });

  const totalsRowIndex = resolveTotalsRowIndex(rule, source.rows);
  const sheetTotals = new Map<string, string>();
  if (totalsRowIndex !== null) {
    for (const { output, index, absentMarkers } of columns) {
      if (output.valueKind !== "money") continue;
      const stated = source.rows[totalsRowIndex]?.[index];
      if (isAbsentValue(stated, absentMarkers)) continue;
      sheetTotals.set(output.key, moneyMinorUnits(stated, input.declaredCurrency));
    }
  }

  // Keyed by period then output, so the same period appearing on two rows sums
  // rather than producing two observations that later collide.
  const totals = new Map<string, Map<string, { total: string; contributors: number }>>();
  let absentRowCount = 0;

  for (let rowIndex = rule.dataStartRow - 1; rowIndex < source.rows.length; rowIndex += 1) {
    // The provider's own total is not a period, and it carries no date to be
    // one. Reading it as data would both double the figures and fail the date
    // parser on whatever label sits in the period column.
    if (rowIndex === totalsRowIndex) continue;
    const row = source.rows[rowIndex];
    if (!row) continue;
    // Padding is a structurally empty row. An absent marker is a statement
    // about one field's value, so it does not make the row disappear: a dated
    // row of dashes is a day the provider reported on and had nothing to say.
    if (row.every((value) => isEmptyCell(value))) continue;

    const periodStart = periodStartFor(
      parsePeriodKey(row[periodColumn], periodKey.encoding, input.declaredPeriod),
      grain,
    );
    const byOutput = totals.get(periodStart) ?? new Map();
    totals.set(periodStart, byOutput);

    for (const { output, index, absentMarkers } of columns) {
      const value = row[index];
      if (isAbsentValue(value, absentMarkers)) {
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

  const projectedByOutputKey = new Map<string, string>();
  for (const observation of observations) {
    projectedByOutputKey.set(
      observation.key,
      addIntegerStrings(projectedByOutputKey.get(observation.key) ?? "0", observation.valueNumerator),
    );
  }

  return {
    observations,
    absentRowCount,
    controlTotals: reconcileControlTotals(
      input.document.controlTotals,
      projectedByOutputKey,
      sheetTotals,
    ),
  };
}
