import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import ExcelJS from "exceljs";
import { parse } from "csv-parse";

import { isAbsentValue } from "@/domain/reports/absent";
import {
  parsePeriodKey,
  type PeriodKeyContext,
  type PeriodKeyEncoding,
} from "@/domain/reports/period-key";
import { ungroupNumber, type ReportNumberFormat } from "@/domain/reports/number-format";
import { reconstructPdfGrid } from "@/domain/reports/pdf-grid";
import { selectContractSheet } from "@/domain/reports/sheet-locator";
import { transposePeriodColumns } from "@/domain/reports/transpose";
import { findTotalsRow } from "@/domain/reports/totals-row";
import {
  normalizeReportStructureIdentifier,
  reportContractDocumentSchema,
  type ReportContractDocument,
} from "@/domain/reports/contracts";
import { inspectXlsxArchive } from "@/workflows/reports/profile-report-package";
import { extractPdfTextLayer } from "@/workflows/reports/pdf-text-layer";
import { reportValidationTaskSchema } from "@/domain/reports/schemas";
import type { ReportPackageRow } from "@/modules/reports/application/ports";

export const REPORT_VALIDATION_CODES = [
  "REQUIRED_SHEET_MISSING",
  "OPTIONAL_SHEET_MISSING",
  "UNDECLARED_SHEET_PRESENT",
  "REQUIRED_SOURCE_HEADER_MISSING",
  "REQUIRED_FIELD_MISSING",
  "OPTIONAL_FIELD_MISSING",
  "INVALID_INTEGER",
  "INVALID_DECIMAL",
  "INVALID_MONEY",
  "INVALID_LOCAL_DATE",
  "INVALID_TIMESTAMP",
  "INVALID_DURATION",
  "INVALID_PERCENTAGE",
  "INVALID_TEXT",
  "INVALID_ENUM",
  "FORMULA_REJECTED",
  "FORMULA_VALUE_UNSUPPORTED",
  "MERGED_CELLS_REJECTED",
  "CONTROL_MISMATCH",
  "AMBIGUOUS_ROW_LABEL",
] as const;

export type ReportValidationCode = (typeof REPORT_VALIDATION_CODES)[number];
export type ReportValidationStatus = "validated" | "partially_validated" | "failed";

export type ValidationProfileSheet = {
  normalizedSheetName: string;
  rowCount: number;
  populatedCellCount: number;
  hasFormula: boolean;
  hasMergedCells: boolean;
};

export type ReportValidationSheetResult = {
  normalizedSheetName: string;
  required: boolean;
  rowCount: number;
  populatedCellCount: number;
  parsedFieldSuccessCount: number;
  parsedFieldFailureCount: number;
  errorCodes: ReportValidationCode[];
  warningCodes: ReportValidationCode[];
};

export type ReportValidationControlResult = {
  key: string;
  kind: "row_count" | "populated_cell_count";
  normalizedSheetName: string;
  expectedCount: number;
  actualCount: number;
  tolerance: number;
  passed: boolean;
};

export type ReportValidationResult = {
  status: ReportValidationStatus;
  qualityState: "complete" | "partial" | "failed";
  completenessState: "complete" | "partial" | "unavailable";
  sheetResults: ReportValidationSheetResult[];
  controlResults: ReportValidationControlResult[];
  errorCodes: ReportValidationCode[];
  warningCodes: ReportValidationCode[];
};

export type ReportValidationFailureCode =
  | "OBJECT_IDENTITY_CHANGED"
  | "OBJECT_UNAVAILABLE"
  | "UNREADABLE_WORKBOOK"
  | "VALIDATION_PROCESSING_FAILED";

export class ReportValidationFailure extends Error {
  constructor(public readonly code: ReportValidationFailureCode) {
    super(code);
    this.name = "ReportValidationFailure";
  }
}

export type ReportValidationDependencies = {
  claim(input: {
    organizationId: string;
    packageId: string;
    contractVersionId: string;
    validationRunId: string;
    idempotencyKey: string;
    claimToken: string;
    correlationId: string;
  }): Promise<
    | {
        outcome: "acquired";
        reportPackage: ReportPackageRow;
        contractVersion: { mapping_document: unknown };
        sheetManifests: ValidationProfileSheet[];
      }
    | {
        outcome:
          | "completed"
          | "not_found"
          | "not_ready"
          | "in_progress"
          | "conflict"
          | "expired"
          | "object_mismatch";
      }
  >;
  objectStore: {
    stat(input: { path: string }): Promise<{ id: string; metadata: Record<string, unknown> }>;
    download(input: { path: string }): Promise<Buffer>;
  };
  complete(input: {
    organizationId: string;
    packageId: string;
    validationRunId: string;
    claimToken: string;
    resultDigest: string;
    result: ReportValidationResult;
  }): Promise<void>;
  fail(input: {
    organizationId: string;
    packageId: string;
    validationRunId: string;
    claimToken: string;
    code: ReportValidationFailureCode;
    resultDigest: string;
  }): Promise<void>;
};

type ParsedSheet = {
  normalizedSheetName: string;
  rows: unknown[][];
  rowCount: number;
  populatedCellCount: number;
  hasFormula: boolean;
  hasMergedCells: boolean;
};

const numericPattern = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;
const integerPattern = /^[+-]?\d+$/;
const durationPattern = /^\d{1,3}:\d{2}(?::\d{2})?$/;

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

export function createValidationResultDigest(result: ReportValidationResult): string {
  return createHash("sha256").update(canonicalize(result)).digest("hex");
}

function populatedValueCount(values: unknown[]): number {
  return values.reduce<number>((count, value) => {
    if (value === null || value === undefined || value === "") return count;
    return count + 1;
  }, 0);
}

function metadataSize(metadata: Record<string, unknown>): number {
  const value = metadata.size;
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
}

function sourceHeaderMap(row: unknown[]): Map<string, number> {
  const map = new Map<string, number>();
  row.forEach((value, index) => {
    if (typeof value !== "string" || value.trim().length === 0) return;
    const normalized = normalizeReportStructureIdentifier(value);
    if (!map.has(normalized)) map.set(normalized, index);
  });
  return map;
}

function isFormulaCell(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    "formula" in value &&
    typeof (value as { formula?: unknown }).formula === "string"
  );
}

function formulaCachedValue(value: unknown): unknown {
  if (!isFormulaCell(value)) return value;
  return (value as { result?: unknown }).result;
}

function parserCode(
  parser: ReportContractDocument["sheets"][number]["fields"][number]["parser"],
): ReportValidationCode {
  const codes: Record<
    ReportContractDocument["sheets"][number]["fields"][number]["parser"],
    ReportValidationCode
  > = {
    integer: "INVALID_INTEGER",
    decimal: "INVALID_DECIMAL",
    money: "INVALID_MONEY",
    local_date: "INVALID_LOCAL_DATE",
    timestamp: "INVALID_TIMESTAMP",
    duration: "INVALID_DURATION",
    percentage: "INVALID_PERCENTAGE",
    text: "INVALID_TEXT",
    enum: "INVALID_ENUM",
  };
  return codes[parser];
}

/**
 * Whether a cell is a date this provider could have written.
 *
 * Read through the same parser the projection uses, so a column cannot pass
 * validation and then fail projection on the same value. Keeta's billing report
 * writes `1 Jan 2026` and EatEasily writes `01/Jan`; both are dates, and
 * neither is ISO.
 */
function isValidDate(
  value: unknown,
  encoding: PeriodKeyEncoding = "iso_date",
  declaredPeriod?: PeriodKeyContext,
): boolean {
  try {
    parsePeriodKey(value, encoding, declaredPeriod);
    return true;
  } catch {
    return false;
  }
}

function isValidTimestamp(value: unknown): boolean {
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return typeof value === "string" && !Number.isNaN(Date.parse(value.trim()));
}

function isValidParserValue(
  value: unknown,
  field: ReportContractDocument["sheets"][number]["fields"][number],
  declaredPeriod?: PeriodKeyContext,
): boolean {
  if (isFormulaCell(value)) return false;
  // A statement prints `1,234.56`. The separators come off here, under the
  // contract's own declaration, so the validator and the projector read the
  // same cell the same way.
  const ungrouped = ungroupNumber(value, field.numberFormat);
  const text = typeof ungrouped === "string" ? ungrouped.trim() : String(ungrouped);
  switch (field.parser) {
    case "integer":
      return typeof ungrouped === "number"
        ? Number.isSafeInteger(ungrouped)
        : integerPattern.test(text);
    case "decimal":
    case "money":
      return typeof ungrouped === "number" ? Number.isFinite(ungrouped) : numericPattern.test(text);
    case "local_date":
      return isValidDate(value, field.dateEncoding, declaredPeriod);
    case "timestamp":
      return isValidTimestamp(value);
    case "duration":
      return durationPattern.test(text);
    case "percentage": {
      const numeric = text.endsWith("%") ? text.slice(0, -1) : text;
      return numericPattern.test(numeric);
    }
    case "text":
    case "enum":
      return text.length > 0 && text.length <= 10_000;
  }
}

function matchesFinancialSign(
  value: unknown,
  sign: "positive" | "negative",
  numberFormat: ReportNumberFormat | undefined,
): boolean {
  const candidate = ungroupNumber(formulaCachedValue(value), numberFormat);
  const numeric = typeof candidate === "number" ? candidate : Number(String(candidate).trim());
  return Number.isFinite(numeric) && (sign === "positive" ? numeric >= 0 : numeric <= 0);
}

function distinctCodes(codes: Iterable<ReportValidationCode>): ReportValidationCode[] {
  return [...new Set(codes)].sort();
}

function validateSheets(
  sheets: ParsedSheet[],
  contract: ReportContractDocument,
  profiles: readonly ValidationProfileSheet[],
  /** Needed only by the `day_month` encoding, whose values carry no year. */
  declaredPeriod?: PeriodKeyContext,
): ReportValidationResult {
  const sheetResults: ReportValidationSheetResult[] = [];
  const errors: ReportValidationCode[] = [];
  const warnings: ReportValidationCode[] = [];

  for (const rule of contract.sheets) {
    const required = rule.fields.some((field) => field.required);
    const sheet = selectContractSheet(rule, sheets);
    if (!sheet) {
      const code = required ? "REQUIRED_SHEET_MISSING" : "OPTIONAL_SHEET_MISSING";
      (required ? errors : warnings).push(code);
      sheetResults.push({
        normalizedSheetName: rule.normalizedSheetName,
        required,
        rowCount: 0,
        populatedCellCount: 0,
        parsedFieldSuccessCount: 0,
        parsedFieldFailureCount: 0,
        errorCodes: required ? [code] : [],
        warningCodes: required ? [] : [code],
      });
      continue;
    }

    const sheetErrors: ReportValidationCode[] = [];
    const sheetWarnings: ReportValidationCode[] = [];
    if (sheet.hasFormula && !rule.allowFormula) sheetErrors.push("FORMULA_REJECTED");
    if (sheet.hasMergedCells && !rule.allowMergedCells) sheetErrors.push("MERGED_CELLS_REJECTED");

    // A statement keeps its periods in the column headings, so it is rotated
    // once here and read exactly like any other sheet afterwards.
    const transposed =
      rule.recordOrientation === "period_columns"
        ? transposePeriodColumns({
            rows: sheet.rows,
            periodHeaderRow: rule.periodHeaderRow ?? 1,
          })
        : null;
    const rows = transposed ? transposed.rows : sheet.rows;
    const ambiguousLabels = transposed ? transposed.ambiguousLabels : null;

    const header = rows[rule.headerRow - 1] ?? [];
    const headers = sourceHeaderMap(header);
    const fieldColumns = new Map<string, number>();
    let success = 0;
    let failure = 0;
    for (const field of rule.fields) {
      // A label the statement uses twice with different figures underneath is
      // refused rather than resolved. The header map keeps the first match, and
      // picking it would be a silent guess about which total was meant.
      if (ambiguousLabels?.has(field.sourceHeader)) {
        sheetErrors.push("AMBIGUOUS_ROW_LABEL");
        failure += 1;
        continue;
      }
      const column = headers.get(field.sourceHeader);
      if (column === undefined) {
        if (field.required) {
          sheetErrors.push("REQUIRED_SOURCE_HEADER_MISSING");
          failure += 1;
        } else {
          sheetWarnings.push("OPTIONAL_FIELD_MISSING");
        }
      } else {
        fieldColumns.set(field.canonicalField, column);
      }
    }

    // The provider's own total is set aside here as well as in projection.
    // EatEasily leaves Total Orders and Total Commission blank on that row, so
    // validating it as data would fail the whole package on required fields
    // that were never meant to be filled. A totals row the file does not carry
    // is not failed here: projection is where that decision belongs, and it
    // makes it with a code of its own.
    const totalsRow = findTotalsRow({ rule, rows, fieldColumns });
    const totalsRowIndex = totalsRow.outcome === "found" ? totalsRow.rowIndex : null;

    for (let rowIndex = rule.dataStartRow - 1; rowIndex < rows.length; rowIndex += 1) {
      if (rowIndex === totalsRowIndex) continue;
      const row = rows[rowIndex];
      if (!row) continue;
      for (const field of rule.fields) {
        const column = fieldColumns.get(field.canonicalField);
        if (column === undefined) continue;
        const value = row[column];
        // `-` used to be treated as absent here and nowhere else, so a Keeta
        // dash passed validation and then failed projection as an unreadable
        // number. Absence is now declared per field and read the same way by
        // both. See `@/domain/reports/absent`.
        if (isAbsentValue(value, field.absentMarkers)) {
          if (field.required) {
            sheetErrors.push("REQUIRED_FIELD_MISSING");
            failure += 1;
          } else {
            sheetWarnings.push("OPTIONAL_FIELD_MISSING");
          }
          continue;
        }
        if (isFormulaCell(value) && !rule.allowFormula) {
          sheetErrors.push("FORMULA_REJECTED");
          failure += 1;
          continue;
        }
        const parsedValue = formulaCachedValue(value);
        if (isFormulaCell(value) && (parsedValue === undefined || parsedValue === null)) {
          sheetErrors.push("FORMULA_VALUE_UNSUPPORTED");
          failure += 1;
          continue;
        }
        if (!isValidParserValue(parsedValue, field, declaredPeriod)) {
          const code = parserCode(field.parser);
          sheetErrors.push(code);
          failure += 1;
          continue;
        }
        if (
          field.parser === "money" &&
          field.financialSign !== undefined &&
          !matchesFinancialSign(parsedValue, field.financialSign, field.numberFormat)
        ) {
          sheetErrors.push("INVALID_MONEY");
          failure += 1;
          continue;
        }
        success += 1;
      }
    }

    const result: ReportValidationSheetResult = {
      normalizedSheetName: rule.normalizedSheetName,
      required,
      rowCount: sheet.rowCount,
      populatedCellCount: sheet.populatedCellCount,
      parsedFieldSuccessCount: success,
      parsedFieldFailureCount: failure,
      errorCodes: distinctCodes(sheetErrors),
      warningCodes: distinctCodes(sheetWarnings),
    };
    errors.push(...result.errorCodes);
    warnings.push(...result.warningCodes);
    sheetResults.push(result);
  }

  // A sheet is declared if some contract sheet resolves to it, by name or by
  // position. Comparing names alone would report a positionally-located sheet
  // as an intruder in the very file its contract was approved against.
  const declaredSheets = new Set(
    contract.sheets.map((rule) => selectContractSheet(rule, sheets)).filter(Boolean),
  );
  const ignoreUnmappedSheets = contract.unmappedSheetDisposition === "reviewed_ignore";
  for (const sheet of sheets) {
    if (declaredSheets.has(sheet) || ignoreUnmappedSheets) continue;
    errors.push("UNDECLARED_SHEET_PRESENT");
    sheetResults.push({
      normalizedSheetName: sheet.normalizedSheetName,
      required: false,
      rowCount: sheet.rowCount,
      populatedCellCount: sheet.populatedCellCount,
      parsedFieldSuccessCount: 0,
      parsedFieldFailureCount: 0,
      errorCodes: ["UNDECLARED_SHEET_PRESENT"],
      warningCodes: [],
    });
  }

  const controlResults = contract.controls.map((control) => {
    // A control names a contract sheet by the contract's own identifier for it,
    // so the file sheet and its profile are both reached through that rule's
    // locator rather than by matching the name against the file.
    const rule = contract.sheets.find(
      (candidate) => candidate.normalizedSheetName === control.normalizedSheetName,
    );
    const sheet = rule ? selectContractSheet(rule, sheets) : undefined;
    const profile = rule ? selectContractSheet(rule, profiles) : undefined;
    const expectedCount =
      control.kind === "row_count" ? (profile?.rowCount ?? 0) : (profile?.populatedCellCount ?? 0);
    const actualCount =
      control.kind === "row_count" ? (sheet?.rowCount ?? 0) : (sheet?.populatedCellCount ?? 0);
    const passed =
      Boolean(profile && sheet) && Math.abs(actualCount - expectedCount) <= control.tolerance;
    if (!passed) errors.push("CONTROL_MISMATCH");
    return {
      key: control.key,
      kind: control.kind,
      normalizedSheetName: control.normalizedSheetName,
      expectedCount,
      actualCount,
      tolerance: control.tolerance,
      passed,
    };
  });

  const errorCodes = distinctCodes(errors);
  const warningCodes = distinctCodes(warnings);
  const status: ReportValidationStatus =
    errorCodes.length > 0
      ? "failed"
      : warningCodes.includes("OPTIONAL_SHEET_MISSING")
        ? "partially_validated"
        : "validated";
  return {
    status,
    qualityState:
      status === "validated" ? "complete" : status === "partially_validated" ? "partial" : "failed",
    completenessState:
      status === "validated"
        ? "complete"
        : status === "partially_validated"
          ? "partial"
          : "unavailable",
    sheetResults,
    controlResults,
    errorCodes,
    warningCodes,
  };
}

export async function validateCsvBuffer(
  buffer: Buffer,
  contract: ReportContractDocument,
  profiles: readonly ValidationProfileSheet[],
  declaredPeriod?: PeriodKeyContext,
): Promise<ReportValidationResult> {
  const rows: unknown[][] = [];
  let populatedCellCount = 0;
  const parser = Readable.from([buffer]).pipe(
    parse({
      bom: true,
      relax_column_count: false,
      skip_empty_lines: true,
      max_record_size: 1024 * 1024,
    }),
  );
  for await (const row of parser as AsyncIterable<unknown>) {
    if (!Array.isArray(row)) throw new Error("CSV validation could not read a row.");
    rows.push(row);
    populatedCellCount += populatedValueCount(row);
  }
  return validateSheets(
    [
      {
        normalizedSheetName: "csv",
        rows,
        rowCount: rows.length,
        populatedCellCount,
        hasFormula: false,
        hasMergedCells: false,
      },
    ],
    contract,
    profiles,
    declaredPeriod,
  );
}

export async function validateXlsxBuffer(
  buffer: Buffer,
  contract: ReportContractDocument,
  profiles: readonly ValidationProfileSheet[],
  declaredPeriod?: PeriodKeyContext,
): Promise<ReportValidationResult> {
  const archive = await inspectXlsxArchive(buffer);
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buffer]), {
    entries: "ignore",
    hyperlinks: "ignore",
    sharedStrings: "cache",
    styles: "ignore",
    worksheets: "emit",
  });
  const sheets: ParsedSheet[] = [];
  for await (const worksheet of workbook) {
    const rows: unknown[][] = [];
    let populatedCellCount = 0;
    let hasFormula = false;
    for await (const row of worksheet) {
      const values = Array.isArray(row.values) ? row.values : [];
      rows.push(values);
      populatedCellCount += populatedValueCount(values);
      hasFormula ||= values.some(isFormulaCell);
    }
    const reader = worksheet as unknown as { name?: string; id?: number };
    const position = sheets.length + 1;
    const archiveFlags = archive.worksheetFlags.get(reader.id ?? position);
    sheets.push({
      normalizedSheetName: normalizeReportStructureIdentifier(reader.name || `Sheet ${position}`),
      rows,
      rowCount: rows.length,
      populatedCellCount,
      hasFormula: hasFormula || archiveFlags?.hasFormula === true,
      hasMergedCells: archiveFlags?.hasMergedCells ?? false,
    });
  }
  return validateSheets(sheets, contract, profiles, declaredPeriod);
}

/**
 * A PDF validated as one sheet per page, exactly as it was profiled.
 *
 * The grid is rebuilt from the text layer's coordinates by
 * `@/domain/reports/pdf-grid`, which is the only thing in the pipeline that
 * knows what a PDF is. Everything from here on reads cells.
 *
 * A page that carries no table is kept as an empty sheet rather than failing
 * the document, the way an empty worksheet is: a statement's cover page or its
 * notes are not a reason to refuse the statement. The contract decides which
 * pages it requires, and says so through the fields it cannot find.
 */
export async function validatePdfBuffer(
  buffer: Buffer,
  contract: ReportContractDocument,
  profiles: readonly ValidationProfileSheet[],
  declaredPeriod?: PeriodKeyContext,
): Promise<ReportValidationResult> {
  const extracted = await extractPdfTextLayer(buffer);
  if (extracted.outcome === "failed") throw new ReportValidationFailure("UNREADABLE_WORKBOOK");

  const sheets: ParsedSheet[] = extracted.pages.map((page) => {
    const grid = reconstructPdfGrid(page.items);
    const rows =
      grid.outcome === "reconstructed" ? grid.grid.rows.map((row) => [...row.cells]) : [];
    return {
      normalizedSheetName: `page_${page.pageNumber}`,
      rows,
      rowCount: rows.length,
      populatedCellCount: rows.reduce((sum, row) => sum + populatedValueCount(row), 0),
      // Neither exists in a PDF. A statement's figures are painted text, so
      // there is no formula to reject and no merge to detect.
      hasFormula: false,
      hasMergedCells: false,
    };
  });

  return validateSheets(sheets, contract, profiles, declaredPeriod);
}

function validationFailureDigest(code: ReportValidationFailureCode): string {
  return createValidationResultDigest({
    status: "failed",
    qualityState: "failed",
    completenessState: "unavailable",
    sheetResults: [],
    controlResults: [],
    errorCodes: [code as ReportValidationCode],
    warningCodes: [],
  });
}

function assertValidationObjectIdentity(
  reportPackage: ReportPackageRow,
  object: { id: string; metadata: Record<string, unknown> },
): void {
  if (object.id !== reportPackage.storage_object_id) {
    throw new ReportValidationFailure("OBJECT_IDENTITY_CHANGED");
  }
  if (
    metadataSize(object.metadata) !== reportPackage.declared_content_length ||
    object.metadata.mimetype !== reportPackage.declared_content_type
  ) {
    throw new ReportValidationFailure("OBJECT_IDENTITY_CHANGED");
  }
}

/**
 * Reads a private object only after Postgres has claimed the exact approved
 * contract. The returned evidence contains counters and typed codes only.
 */
export async function runReportPackageValidation(
  input: unknown,
  dependencies: ReportValidationDependencies,
): Promise<{ outcome: string }> {
  const payload = reportValidationTaskSchema.parse(input);
  const claimToken = crypto.randomUUID();
  const claim = await dependencies.claim({ ...payload, claimToken });
  if (claim.outcome !== "acquired") return { outcome: claim.outcome };
  try {
    const object = await dependencies.objectStore.stat({ path: claim.reportPackage.storage_path });
    assertValidationObjectIdentity(claim.reportPackage, object);
    const buffer = await dependencies.objectStore.download({
      path: claim.reportPackage.storage_path,
    });
    if (buffer.byteLength !== claim.reportPackage.declared_content_length) {
      throw new ReportValidationFailure("OBJECT_IDENTITY_CHANGED");
    }
    const contentDigest = createHash("sha256").update(buffer).digest("hex");
    if (contentDigest !== claim.reportPackage.content_sha256) {
      throw new ReportValidationFailure("OBJECT_IDENTITY_CHANGED");
    }
    const contract = reportContractDocumentSchema.parse(claim.contractVersion.mapping_document);
    if (
      contract.currency !== claim.reportPackage.declared_currency ||
      contract.outletGrain !== "branch"
    ) {
      throw new ReportValidationFailure("VALIDATION_PROCESSING_FAILED");
    }
    // The package already states the period it covers, which is the only thing
    // that can say which year a date like `01/Jan` meant.
    const declaredPeriod = {
      periodStart: claim.reportPackage.declared_period_start,
      periodEnd: claim.reportPackage.declared_period_end,
    };
    const result =
      claim.reportPackage.file_kind === "csv"
        ? await validateCsvBuffer(buffer, contract, claim.sheetManifests, declaredPeriod)
        : claim.reportPackage.file_kind === "pdf"
          ? await validatePdfBuffer(buffer, contract, claim.sheetManifests, declaredPeriod)
          : await validateXlsxBuffer(buffer, contract, claim.sheetManifests, declaredPeriod);
    await dependencies.complete({
      organizationId: payload.organizationId,
      packageId: payload.packageId,
      validationRunId: payload.validationRunId,
      claimToken,
      resultDigest: createValidationResultDigest(result),
      result,
    });
    return { outcome: result.status };
  } catch (error) {
    const code =
      error instanceof ReportValidationFailure ? error.code : "VALIDATION_PROCESSING_FAILED";
    await dependencies.fail({
      organizationId: payload.organizationId,
      packageId: payload.packageId,
      validationRunId: payload.validationRunId,
      claimToken,
      code,
      resultDigest: validationFailureDigest(code),
    });
    return { outcome: "failed" };
  }
}
