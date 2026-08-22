export type ReportContractRequiredFieldSummary = {
  canonicalField: string;
  sourceHeader: string;
  parser: string;
  financialSign?: "positive" | "negative";
};

export type ReportContractSheetSummary = {
  normalizedSheetName: string;
  headerRow: number;
  dataStartRow: number;
  allowFormula: boolean;
  allowMergedCells: boolean;
  requiredFields: ReportContractRequiredFieldSummary[];
};

export type ReportContractSummary = {
  currency: string;
  outletGrain: string;
  unmappedFieldDisposition: string;
  sheets: ReportContractSheetSummary[];
};

export type ReportValidationExplanation = {
  title: string;
  detail: string;
  nextStep: string;
};

const VALIDATION_EXPLANATIONS: Record<string, ReportValidationExplanation> = {
  REQUIRED_SHEET_MISSING: {
    title: "A required sheet is missing",
    detail: "The report does not contain a sheet selected by the approved contract.",
    nextStep: "Check the workbook sheet names, or ask an owner/admin to review the contract.",
  },
  UNDECLARED_SHEET_PRESENT: {
    title: "The workbook contains an undeclared sheet",
    detail: "The report includes a sheet that was not part of the approved contract.",
    nextStep:
      "Remove the extra sheet or ask an owner/admin to approve a contract that includes it.",
  },
  REQUIRED_SOURCE_HEADER_MISSING: {
    title: "A required column is missing",
    detail:
      "A required source header from the approved contract was not found in the selected sheet.",
    nextStep:
      "Use the exact required headers from the contract, or revise the contract after reviewing the profile.",
  },
  REQUIRED_FIELD_MISSING: {
    title: "A required mapped field is blank",
    detail: "At least one field marked as required had no usable value in the report data rows.",
    nextStep:
      "Check the required fields listed in the approved contract, then upload a corrected report or revise the contract if the field is not supplied.",
  },
  OPTIONAL_FIELD_MISSING: {
    title: "An optional mapped field is missing",
    detail: "An optional field was not present or had no usable value in the report.",
    nextStep:
      "Review the warning; no retry is needed unless that field is important for your use case.",
  },
  INVALID_INTEGER: {
    title: "A count is not a valid integer",
    detail:
      "A field declared as an integer contained a value that could not be parsed as a whole number.",
    nextStep: "Correct the count values or ask an owner/admin to review the field parser.",
  },
  INVALID_DECIMAL: {
    title: "A decimal value is invalid",
    detail: "A field declared as a decimal contained a value that could not be parsed safely.",
    nextStep: "Correct the decimal values or review the field mapping.",
  },
  INVALID_MONEY: {
    title: "A money value is invalid",
    detail: "A money field could not be parsed safely or did not match its approved sign rule.",
    nextStep: "Check the money values and the approved positive/negative sign semantics.",
  },
  INVALID_LOCAL_DATE: {
    title: "A date is invalid",
    detail: "A field declared as a local date did not contain a valid date in the approved format.",
    nextStep: "Correct the date format or review the field mapping.",
  },
  INVALID_TIMESTAMP: {
    title: "A timestamp is invalid",
    detail: "A field declared as a timestamp could not be parsed as a valid timestamp.",
    nextStep: "Correct the timestamp values or review the field mapping.",
  },
  INVALID_DURATION: {
    title: "A duration is invalid",
    detail: "A field declared as a duration did not match the approved duration format.",
    nextStep: "Correct the duration values or review the field mapping.",
  },
  INVALID_PERCENTAGE: {
    title: "A percentage is invalid",
    detail: "A field declared as a percentage could not be parsed safely.",
    nextStep: "Correct the percentage values or review the field mapping.",
  },
  INVALID_TEXT: {
    title: "A text field is invalid",
    detail: "A field declared as text was blank or exceeded the allowed bounded length.",
    nextStep: "Correct the text values or review the field mapping.",
  },
  INVALID_ENUM: {
    title: "A category value is invalid",
    detail: "A field declared as an enum did not contain a usable text value.",
    nextStep: "Correct the category values or review the field mapping.",
  },
  FORMULA_REJECTED: {
    title: "A formula was rejected",
    detail: "The approved contract does not allow formulas in this sheet or field.",
    nextStep: "Upload values instead of formulas, or ask an owner/admin to review the contract.",
  },
  FORMULA_VALUE_UNSUPPORTED: {
    title: "A formula value could not be read safely",
    detail: "The workbook did not provide a usable cached value for a formula cell.",
    nextStep: "Replace the formula with a stored value and upload the report again.",
  },
  MERGED_CELLS_REJECTED: {
    title: "Merged cells were rejected",
    detail: "The approved contract does not allow merged cells in this sheet.",
    nextStep: "Unmerge the report cells or ask an owner/admin to review the contract.",
  },
  CONTROL_MISMATCH: {
    title: "A structural control did not match",
    detail: "A declared row or populated-cell count differed from the profiled report structure.",
    nextStep: "Re-upload the complete report or ask an owner/admin to review the control rule.",
  },
  OBJECT_IDENTITY_CHANGED: {
    title: "The uploaded file changed",
    detail: "The private Storage object no longer matches the immutable upload identity.",
    nextStep: "Start a new upload; do not retry a replaced or modified object.",
  },
  OBJECT_UNAVAILABLE: {
    title: "The uploaded file is unavailable",
    detail: "The private Storage object could not be read during validation.",
    nextStep: "Retry once. If it continues, upload the report again.",
  },
  UNREADABLE_WORKBOOK: {
    title: "The workbook could not be read",
    detail: "The file is not a readable workbook in the declared format.",
    nextStep: "Export a fresh CSV/XLSX file from the marketplace and upload it again.",
  },
  VALIDATION_PROCESSING_FAILED: {
    title: "Validation could not finish",
    detail: "The deterministic validator could not complete the approved checks.",
    nextStep:
      "Retry validation once. If it continues, ask an administrator to review the run evidence.",
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function summarizeReportContract(document: unknown): ReportContractSummary | null {
  if (!isRecord(document)) return null;
  const currency = nonEmptyString(document.currency);
  const outletGrain = nonEmptyString(document.outletGrain);
  const unmappedFieldDisposition = nonEmptyString(document.unmappedFieldDisposition);
  if (!currency || !outletGrain || !unmappedFieldDisposition || !Array.isArray(document.sheets)) {
    return null;
  }

  const sheets: ReportContractSheetSummary[] = [];
  for (const sheet of document.sheets) {
    if (!isRecord(sheet)) continue;
    if (
      typeof sheet.normalizedSheetName !== "string" ||
      typeof sheet.headerRow !== "number" ||
      typeof sheet.dataStartRow !== "number" ||
      typeof sheet.allowFormula !== "boolean" ||
      typeof sheet.allowMergedCells !== "boolean" ||
      !Array.isArray(sheet.fields)
    ) {
      continue;
    }
    const requiredFields: ReportContractRequiredFieldSummary[] = [];
    for (const field of sheet.fields) {
      if (!isRecord(field) || field.required !== true) continue;
      const canonicalField = nonEmptyString(field.canonicalField);
      const sourceHeader = nonEmptyString(field.sourceHeader);
      const parser = nonEmptyString(field.parser);
      if (!canonicalField || !sourceHeader || !parser) continue;
      requiredFields.push({
        canonicalField,
        sourceHeader,
        parser,
        ...(field.financialSign === "positive" || field.financialSign === "negative"
          ? { financialSign: field.financialSign }
          : {}),
      });
    }
    sheets.push({
      normalizedSheetName: sheet.normalizedSheetName,
      headerRow: sheet.headerRow,
      dataStartRow: sheet.dataStartRow,
      allowFormula: sheet.allowFormula,
      allowMergedCells: sheet.allowMergedCells,
      requiredFields,
    });
  }
  return { currency, outletGrain, unmappedFieldDisposition, sheets };
}

export function explainReportValidationCode(code: string): ReportValidationExplanation {
  return (
    VALIDATION_EXPLANATIONS[code] ?? {
      title: "A deterministic validation rule needs attention",
      detail: "The report did not satisfy one of the approved contract rules.",
      nextStep:
        "Review the contract details and retry only after the report or contract is corrected.",
    }
  );
}

export function parserLabel(parser: string, financialSign?: "positive" | "negative"): string {
  const base = parser === "integer" ? "integer count" : parser;
  return financialSign ? `${base}, ${financialSign}` : base;
}
