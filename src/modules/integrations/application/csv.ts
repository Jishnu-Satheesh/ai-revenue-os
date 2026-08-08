import { parse } from "csv-parse/sync";
import { z } from "zod";
import { createHash } from "node:crypto";

import { DomainError } from "@/lib/errors";

export const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_CSV_COLUMNS = 200;
const MAX_CSV_ROWS = 100_000;

const uuidSchema = z.string().uuid();
const mappingSchema = z.record(
  z.string().trim().min(1).max(120),
  z.string().trim().min(1).max(255),
);

export function csvContentDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildOperationSubkey(idempotencyKey: string, suffix: string): string {
  return `${idempotencyKey.slice(0, 160)}:${createHash("sha256").update(suffix).digest("hex").slice(0, 16)}`;
}

/** Stable operation-scoped upload ID so a retried request addresses one object. */
export function buildDeterministicUploadId(organizationId: string, idempotencyKey: string): string {
  uuidSchema.parse(organizationId);
  const digest = createHash("sha256")
    .update(`${organizationId}:${idempotencyKey}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  const variant = ["8", "9", "a", "b"][parseInt(digest[16], 16) % 4];
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-${variant}${digest.slice(17, 20)}-${digest.slice(20)}`;
}

function validationError(message: string): never {
  throw new DomainError("VALIDATION_ERROR", message);
}

/** A path-safe filename that cannot introduce a new storage path segment. */
export function normalizeCsvFilename(filename: string): string {
  const original = filename.trim();
  if (!original || original.includes("/") || original.includes("\\") || original.includes("..")) {
    validationError("The CSV filename is invalid.");
  }
  if (!/\.csv$/i.test(original)) validationError("Only .csv files are supported.");
  const normalized = original
    .normalize("NFKC")
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 180);
  if (
    !normalized ||
    normalized === ".csv" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.csv$/i.test(normalized)
  ) {
    validationError("The CSV filename is invalid.");
  }
  return normalized;
}

export function buildDataSourceStoragePath(
  organizationId: string,
  dataSourceId: string,
  uploadId: string,
  filename: string,
): string {
  uuidSchema.parse(organizationId);
  uuidSchema.parse(dataSourceId);
  uuidSchema.parse(uploadId);
  return `${organizationId}/${dataSourceId}/${uploadId}/${normalizeCsvFilename(filename)}`;
}

export function validateDataSourceStoragePath(
  storagePath: string,
  organizationId: string,
  dataSourceId: string,
): true {
  uuidSchema.parse(organizationId);
  uuidSchema.parse(dataSourceId);
  const segments = storagePath.split("/");
  if (
    segments.length !== 4 ||
    segments[0] !== organizationId ||
    segments[1] !== dataSourceId ||
    !uuidSchema.safeParse(segments[2]).success ||
    !segments[3] ||
    segments[3].includes("..") ||
    segments[3].includes("\\") ||
    !/\.csv$/i.test(segments[3])
  ) {
    validationError("The CSV storage path is invalid.");
  }
  return true;
}

export function validateColumnMapping(
  mapping: unknown,
  headers: readonly string[],
): Record<string, string> {
  const parsed = mappingSchema.safeParse(mapping ?? {});
  if (!parsed.success) validationError("The CSV column mapping is invalid.");
  const headerSet = new Set(headers);
  const seen = new Set<string>();
  for (const [target, source] of Object.entries(parsed.data)) {
    if (
      seen.has(source) ||
      !headerSet.has(source) ||
      /token|secret|password|credential|authorization/i.test(target)
    ) {
      validationError("The CSV column mapping is invalid.");
    }
    seen.add(source);
  }
  return parsed.data;
}

export type CsvValidationResult = {
  headers: string[];
  rowCount: number;
  byteSize: number;
  filename: string;
  mediaType: "text/csv";
  errors: Array<{ row: number; code: "INVALID_ROW" | "COLUMN_COUNT_MISMATCH" }>;
};

export function parseAndValidateCsv(input: {
  bytes: Uint8Array;
  filename: string;
  mediaType: string;
}): CsvValidationResult {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength > MAX_CSV_BYTES) {
    validationError("CSV files must be no larger than 10 MiB.");
  }
  const filename = normalizeCsvFilename(input.filename);
  if (input.mediaType.trim().toLowerCase() !== "text/csv") {
    validationError("CSV files must use the text/csv media type.");
  }

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(input.bytes);
  } catch {
    validationError("The CSV file must be valid UTF-8.");
  }
  // csv-parse's bom option strips a UTF-8 BOM while preserving all data fields.
  let records: string[][];
  try {
    records = parse(text, {
      bom: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      max_record_size: 64 * 1024,
      skip_records_with_error: false,
    }) as string[][];
  } catch {
    validationError("The CSV file could not be parsed.");
  }
  if (!records.length) validationError("The CSV file must include a header row.");
  const headers = records[0].map((header) => header.trim());
  if (
    !headers.length ||
    headers.length > MAX_CSV_COLUMNS ||
    headers.some((header) => !header) ||
    new Set(headers).size !== headers.length
  ) {
    validationError("The CSV header row must contain unique, non-empty columns.");
  }
  if (records.length - 1 > MAX_CSV_ROWS) validationError("The CSV contains too many rows.");
  const errors: CsvValidationResult["errors"] = [];
  for (const [index, row] of records.slice(1).entries()) {
    if (row.length !== headers.length) {
      if (errors.length < 100) {
        errors.push({
          row: index + 2,
          code: "COLUMN_COUNT_MISMATCH",
        });
      }
    }
  }
  return {
    headers,
    rowCount: records.length - 1,
    byteSize: input.bytes.byteLength,
    filename,
    mediaType: "text/csv",
    errors,
  };
}
