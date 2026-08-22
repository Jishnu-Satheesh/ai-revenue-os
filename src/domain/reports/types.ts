/**
 * A governed report package is an immutable, untrusted source file plus the
 * context an operator explicitly declared for it.  It is intentionally not a
 * report contract or an economics projection.
 */
export const REPORT_PACKAGE_STATUSES = [
  "awaiting_upload",
  "uploaded",
  "profiling",
  "awaiting_contract",
  "awaiting_approval",
  "awaiting_validation",
  "validating",
  "validated",
  "partially_validated",
  "validation_failed",
  "awaiting_projection",
  "projecting",
  "projected",
  "partially_projected",
  "reconciliation_required",
  "projection_failed",
  "failed",
] as const;

export type ReportPackageStatus = (typeof REPORT_PACKAGE_STATUSES)[number];

/**
 * `pdf` is admitted only where the figures already exist as text; see ADR 0028.
 * Legacy binary `.xls` is deliberately absent — it is refused at upload with a
 * message naming the format, rather than parsed by a second spreadsheet engine.
 */
export const REPORT_FILE_KINDS = ["csv", "xlsx", "pdf"] as const;
export type ReportFileKind = (typeof REPORT_FILE_KINDS)[number];

export const REPORT_PACKAGE_FAILURE_CODES = [
  "UPLOAD_EXPIRED",
  "OBJECT_UNAVAILABLE",
  "OBJECT_IDENTITY_CHANGED",
  "INVALID_FILE_TYPE",
  "FILE_TOO_LARGE",
  "TOO_MANY_SHEETS",
  "TOO_MANY_ROWS",
  "TOO_MANY_POPULATED_CELLS",
  "EXPANDED_CONTENT_TOO_LARGE",
  "UNSAFE_WORKBOOK",
  "UNREADABLE_WORKBOOK",
  "LEGACY_XLS_UNSUPPORTED",
  "PDF_NO_TEXT_LAYER",
  "PDF_NO_TABLE_STRUCTURE",
  "TOO_MANY_PAGES",
  "PROFILE_FAILED",
  "PACKAGE_EXPIRED",
  "CONTRACT_VERSION_NOT_APPROVED",
  "CONTRACT_BINDING_INACTIVE",
  "CONTRACT_CONTEXT_MISMATCH",
  "REQUIRED_SHEET_MISSING",
  "REQUIRED_SOURCE_HEADER_MISSING",
  "REQUIRED_FIELD_MISSING",
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
  "UNDECLARED_SHEET_PRESENT",
  "VALIDATION_PROCESSING_FAILED",
  "PROJECTION_VERSION_NOT_APPROVED",
  "PROJECTION_BINDING_INACTIVE",
  "PROJECTION_CONTEXT_MISMATCH",
  "PROJECTION_FIELD_VALUE_KIND_MISMATCH",
  "REQUIRED_PROJECTED_VALUE_MISSING",
  "PROJECTION_PROCESSING_FAILED",
] as const;

export type ReportPackageFailureCode = (typeof REPORT_PACKAGE_FAILURE_CODES)[number];

export type ReportPackageLimits = {
  maxCompressedBytes: number;
  maxSheets: number;
  maxRows: number;
  maxPopulatedCells: number;
  maxExpandedBytes: number;
};

export const REPORT_PACKAGE_LIMITS: Readonly<ReportPackageLimits> = {
  maxCompressedBytes: 50 * 1024 * 1024,
  maxSheets: 25,
  maxRows: 250_000,
  maxPopulatedCells: 2_500_000,
  maxExpandedBytes: 250 * 1024 * 1024,
};

export type ReportPackageDeclaredContext = {
  channelId: string;
  branchId: string;
  reportType: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  fileKind: ReportFileKind;
  originalFilename: string;
  contentType: string;
  contentLength: number;
};

export function reportPackageStoragePath(input: {
  organizationId: string;
  channelId: string;
  packageId: string;
  fileKind: ReportFileKind;
}): string {
  return `${input.organizationId}/${input.channelId}/${input.packageId}/1/original/report.${input.fileKind}`;
}
