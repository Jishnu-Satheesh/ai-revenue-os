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
    /**
     * A categorical output: the source column carries provider category labels
     * rather than figures, and each label becomes its own observation tagged
     * with a dimension, so a question like "how many days closed for each
     * reason" lands as counted evidence instead of prose.
     *
     * The allowed values are declared here, in the approved document, because
     * the alternative is trusting whatever string arrives. A label outside the
     * list refuses the import rather than becoming an "other" bucket nobody
     * defined.
     */
    categorical: z
      .object({
        dimensionKey: normalizedIdentifierSchema,
        allowedValues: z
          .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/))
          .min(1)
          .max(20),
        /**
         * Also read this field's labels out of the cells a ragged row injects.
         * Talabat continues its reason list into the cells it inserts, so the
         * second cause of a closed day lives in the displacement itself.
         */
        collectInjectedValues: z.boolean(),
      })
      .strict()
      .optional(),
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
      if (output.categorical) {
        if (output.valueKind !== "count") {
          context.addIssue({
            code: "custom",
            path: ["outputs"],
            message: "A categorical output counts occurrences, so its value kind must be count.",
          });
        }
        if (new Set(output.categorical.allowedValues).size !== output.categorical.allowedValues.length) {
          context.addIssue({
            code: "custom",
            path: ["outputs"],
            message: "Each allowed value may be declared once.",
          });
        }
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

/** The furthest right non-empty cell of a row, or -1 when the row is empty. */
function lastPopulatedIndex(row: readonly unknown[]): number {
  let last = -1;
  row.forEach((value, index) => {
    if (!isEmptyCell(value)) last = index;
  });
  return last;
}

/**
 * How far one data row's later columns sit from where the header names them.
 *
 * Zero unless the sheet declares ragged rows and this particular row reaches
 * further right than the header does. The overflow is read off the row rather
 * than declared because the declaration describes the shape of the problem,
 * not each row's private amount of damage.
 */
function rowShift(
  row: readonly unknown[],
  ragged: { injectedFromColumnIndex: number } | null,
  headerLastPopulated: number,
): number {
  if (!ragged) return 0;
  const overflow = lastPopulatedIndex(row) - headerLastPopulated;
  return overflow > 0 ? overflow : 0;
}

function columnInRow(
  headerIndex: number,
  shift: number,
  ragged: { injectedFromColumnIndex: number } | null,
): number {
  if (!ragged || shift === 0) return headerIndex;
  return headerIndex < ragged.injectedFromColumnIndex ? headerIndex : headerIndex + shift;
}

/**
 * The category label a cell carries, under the declared rules.
 *
 * Empty cells say nothing. Numbers in an injected region are the provider's
 * own figures passing through, not categories, and are ignored rather than
 * coerced. Any other text has to be one of the declared labels: a category
 * nobody approved refuses the import instead of quietly becoming part of a
 * breakdown an operator will read as complete.
 */
function categoryLabel(value: unknown, allowed: readonly string[]): string | null {
  if (isEmptyCell(value)) return null;
  if (typeof value === "number") return null;
  if (isFormula(value) || value instanceof Date || typeof value === "object") {
    throw new ReportProjectionError("CATEGORICAL_VALUE_NOT_DECLARED");
  }
  const text = String(value).trim().toUpperCase();
  if (text.length === 0) return null;
  if (!allowed.includes(text)) throw new ReportProjectionError("CATEGORICAL_VALUE_NOT_DECLARED");
  return text;
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

const digitsOnly = /^[0-9]+$/;

function addIntegerStrings(left: string, right: string): string {
  // A decimal slipping in here would not merely mis-sum: its digits would
  // turn into NaN and the result string would triple every round, hanging the
  // projection inside an exponentially growing write. Refusing loudly keeps a
  // wrong-shaped string from ever reaching arithmetic built for integers.
  if (!digitsOnly.test(left.replace("-", "")) || !digitsOnly.test(right.replace("-", ""))) {
    throw new ReportProjectionError("INVALID_INTEGER");
  }
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

/**
 * An exact decimal quantity as a canonical string.
 *
 * Providers measure things in fractions -- Talabat reports closed time as
 * `355.6` minutes -- and a quantity with a unit is not made integral by
 * wishing. The string keeps every digit the provider wrote: parsed through
 * fixed-point addition below, never through floating point, because a sum
 * whose last digit depends on rounding mode is not evidence. Canonical form
 * strips leading zeroes and trailing fractional zeroes so identical inputs
 * always produce byte-identical observations and digests.
 */
function decimalQuantity(value: unknown): string {
  if (isFormula(value) || value instanceof Date || typeof value === "object") {
    throw new ReportProjectionError("INVALID_DECIMAL");
  }
  const text = typeof value === "string" ? value.trim() : String(value);
  if (!numericPattern.test(text)) throw new ReportProjectionError("INVALID_DECIMAL");
  const negative = text.startsWith("-");
  const unsigned = text.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const wholeDigits = (whole || "0").replace(/^0+(?=\d)/, "") || "0";
  const joined = trimmedFraction.length > 0 ? `${wholeDigits}.${trimmedFraction}` : wholeDigits;
  const normalized = joined === "0" || joined === "0.0" ? "0" : joined;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

/** Fixed-point addition of two canonical decimal strings, exactly. */
function addDecimals(left: string, right: string): string {
  const [leftWhole, leftFraction = ""] = left.replace("-", "").split(".");
  const [rightWhole, rightFraction = ""] = right.replace("-", "").split(".");
  const scale = Math.max(leftFraction.length, rightFraction.length);
  const leftScaled = `${leftWhole}${leftFraction.padEnd(scale, "0")}`;
  const rightScaled = `${rightWhole}${rightFraction.padEnd(scale, "0")}`;
  const sum = addIntegerStrings(
    left.startsWith("-") ? `-${leftScaled}` : leftScaled,
    right.startsWith("-") ? `-${rightScaled}` : rightScaled,
  );
  const negative = sum.startsWith("-");
  const unsignedSum = sum.replace("-", "");
  const whole = unsignedSum.slice(0, unsignedSum.length - scale) || "0";
  const fraction = scale > 0 ? unsignedSum.slice(-scale).replace(/0+$/, "") : "";
  const joined = fraction.length > 0 ? `${whole.replace(/^0+(?=\d)/, "")}.${fraction}` : whole.replace(/^0+(?=\d)/, "") || "0";
  return negative && joined !== "0" ? `-${joined}` : joined;
}

function negateIntegerString(value: string): string {
  if (value === "0") return "0";
  return value.startsWith("-") ? value.slice(1) : `-${value}`;
}

/** Negation of a canonical integer-or-decimal quantity string. */
function negateDecimalString(value: string): string {
  if (Number(value) === 0 || value === "0") return "0";
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
    const difference = addDecimals(projected, negateDecimalString(statedMinorUnits));
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
  /**
   * Whether every row has to carry a value.
   *
   * An exact-range sum covers one declared period and is unknowable if any row
   * is silent, so its source field must be required. A period-grain series is
   * the opposite: Talabat's export carries a row for all fifty-nine days and
   * leaves the figures blank on the days it has nothing to say about, and those
   * days are meant to stay absent. Demanding a required field there would make
   * the provider's own normal export unmappable.
   */
  everyRowRequired: boolean,
) {
  const sheet = contract.sheets.find(
    (candidate) => candidate.normalizedSheetName === output.normalizedSheetName,
  );
  if (!sheet) throw new ReportProjectionError("PROJECTION_SHEET_NOT_DECLARED");
  const field = sheet.fields.find((candidate) => candidate.canonicalField === output.canonicalField);
  if (!field) throw new ReportProjectionError("PROJECTION_FIELD_NOT_DECLARED");
  if (everyRowRequired && !field.required) {
    throw new ReportProjectionError("PROJECTION_FIELD_NOT_REQUIRED");
  }
  if (
    (output.valueKind === "money" && field.parser !== "money") ||
    // A count may bind an integer or a decimal column: providers measure
    // continuous quantities in fractions, and refusing them would leave whole
    // chapters unmeasurable. The exact-range sum stays integer-only -- its
    // accumulator refuses decimals loudly rather than rounding silently.
    (output.valueKind === "count" &&
      !output.categorical &&
      field.parser !== "integer" &&
      field.parser !== "decimal") ||
    (output.valueKind === "count" &&
      !!output.categorical &&
      field.parser !== "text" &&
      field.parser !== "enum")
  ) {
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
    const { sheet: rule, field } = findSourceField(input.contract, output, true);
    const source = selectContractSheet(rule, input.sheets);
    if (!source) throw new ReportProjectionError("REQUIRED_SHEET_MISSING");
    const header = source.rows[rule.headerRow - 1];
    if (!header) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");
    const headers = sourceHeaderMap(header);
    const columnIndex = headers.get(field.sourceHeader);
    if (columnIndex === undefined) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");
    if (output.categorical) {
      throw new ReportProjectionError("PROJECTION_FIELD_VALUE_KIND_MISMATCH");
    }

    // An exact-range sum covers a whole declared period, so a ragged row in the
    // span would corrupt its total exactly as it would corrupt a day. The same
    // realignment applies.
    const ragged = rule.raggedRows ?? null;
    const headerLastPopulated = ragged ? lastPopulatedIndex(header) : -1;

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
      const row = source.rows[rowIndex];
      const value = row?.[
        columnInRow(columnIndex, rowShift(row ?? [], ragged, headerLastPopulated), ragged)
      ];
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
  /**
   * The one dimension a categorical output tags its observations with, shaped
   * exactly as `normalized_metrics.dimensions` stores it. Absent on every
   * numeric output: a figure without a category carries no dimensions at all,
   * which is not the same as dimensions it has not read yet.
   */
  dimensions?: { readonly [dimensionKey: string]: string };
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
  if (periodField.parser !== "local_date") {
    throw new ReportProjectionError("PROJECTION_FIELD_VALUE_KIND_MISMATCH");
  }
  // The encoding lives on the contract field, so the validator and the
  // projector read the same column the same way.
  const encoding = periodField.dateEncoding ?? "iso_date";
  const periodColumn = headers.get(periodField.sourceHeader);
  if (periodColumn === undefined) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");

  const ragged = rule.raggedRows ?? null;
  const headerLastPopulated = ragged ? lastPopulatedIndex(header) : -1;

  const columns = input.document.outputs.map((output) => {
    const { field } = findSourceField(input.contract, output, false);
    const index = headers.get(field.sourceHeader);
    if (index === undefined) throw new ReportProjectionError("REQUIRED_SOURCE_HEADER_MISSING");
    return { output, index, absentMarkers: field.absentMarkers, parser: field.parser };
  });

  const totalsRowIndex = resolveTotalsRowIndex(rule, source.rows);
  const sheetTotals = new Map<string, string>();
  if (totalsRowIndex !== null) {
    const totalsShift = rowShift(source.rows[totalsRowIndex] ?? [], ragged, headerLastPopulated);
    for (const { output, index } of columns) {
      if (output.categorical || output.valueKind !== "money") continue;
      const stated =
        source.rows[totalsRowIndex]?.[columnInRow(index, totalsShift, ragged)];
      if (isAbsentValue(stated, [])) continue;
      sheetTotals.set(output.key, moneyMinorUnits(stated, input.declaredCurrency));
    }
  }

  // Numeric outputs accumulate per period; categorical outputs count the rows
  // carrying each declared label. A day that closed for two reasons counts once
  // towards each, because each is a fact about the day and neither implies the
  // other.
  const totals = new Map<string, Map<string, { total: string; contributors: number }>>();
  const categoryCounts = new Map<string, Map<string, number>>();
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

    const shift = rowShift(row, ragged, headerLastPopulated);
    const periodStart = periodStartFor(
      parsePeriodKey(row[columnInRow(periodColumn, shift, ragged)], encoding, input.declaredPeriod),
      grain,
    );
    const byOutput = totals.get(periodStart) ?? new Map();
    totals.set(periodStart, byOutput);
    const byCategory = categoryCounts.get(periodStart) ?? new Map();
    categoryCounts.set(periodStart, byCategory);

    for (const { output, index, absentMarkers, parser } of columns) {
      if (output.categorical) {
        const base = columnInRow(index, shift, ragged);
        const cells = [row[base]];
        if (
          output.categorical.collectInjectedValues &&
          shift > 0 &&
          ragged &&
          index < ragged.injectedFromColumnIndex
        ) {
          // The injected region begins where the shiftable columns begin; every
          // displaced slot is one cell this provider inserted ahead of them.
          for (let offset = ragged.injectedFromColumnIndex; offset < ragged.injectedFromColumnIndex + shift; offset += 1) {
            cells.push(row[offset]);
          }
        }
        for (const cell of cells) {
          const label = categoryLabel(cell, output.categorical.allowedValues);
          if (label === null) continue;
          byCategory.set(`${output.key}\u0000${label}`, (byCategory.get(`${output.key}\u0000${label}`) ?? 0) + 1);
        }
        continue;
      }
      const value = row[columnInRow(index, shift, ragged)];
      if (isAbsentValue(value, absentMarkers)) {
        absentRowCount += 1;
        continue;
      }
      const amount =
        output.valueKind === "money"
          ? moneyMinorUnits(value, input.declaredCurrency)
          : // A decimal column is a quantity measured in fractions, kept exact
            // through fixed-point addition; an integer column stays integral.
            parser === "decimal"
            ? decimalQuantity(value)
            : integer(value);
      const running = byOutput.get(output.key) ?? { total: "0", contributors: 0 };
      byOutput.set(output.key, {
        total: addDecimals(running.total, amount),
        contributors: running.contributors + 1,
      });
    }
  }

  const observations: PeriodGrainObservation[] = [];
  for (const [periodStart, byOutput] of totals) {
    for (const output of input.document.outputs) {
      if (output.categorical) {
        const byCategory = categoryCounts.get(periodStart) ?? new Map();
        for (const label of [...byCategory.keys()]
          .filter((key) => key.startsWith(`${output.key}\u0000`))
          .map((key) => key.slice(output.key.length + 1))
          .sort()) {
          const days = byCategory.get(`${output.key}\u0000${label}`) ?? 0;
          observations.push({
            key: output.key,
            metricKey: output.metricKey,
            valueKind: "count",
            periodStart,
            periodEnd: periodEndFor(periodStart, grain),
            valueNumerator: String(days),
            currency: null,
            normalizedSheetName: output.normalizedSheetName,
            canonicalField: output.canonicalField,
            contributorCount: days,
            dimensions: { [output.categorical.dimensionKey]: label },
          });
        }
        continue;
      }
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
      left.periodStart.localeCompare(right.periodStart) ||
      left.key.localeCompare(right.key) ||
      (left.dimensions?.[Object.keys(left.dimensions)[0]] ?? "").localeCompare(
        right.dimensions?.[Object.keys(right.dimensions)[0]] ?? "",
      ),
  );

  const projectedByOutputKey = new Map<string, string>();
  for (const observation of observations) {
    // Decimal quantities are legal numerators on a period-grain series, so
    // the rollup adds exactly across both shapes.
    projectedByOutputKey.set(
      observation.key,
      addDecimals(projectedByOutputKey.get(observation.key) ?? "0", observation.valueNumerator),
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
