import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import ExcelJS from "exceljs";
import { parse } from "csv-parse";
import * as yauzl from "yauzl";

import {
  createReportSchemaFingerprint,
  normalizeReportStructureIdentifier,
} from "@/domain/reports/contracts";
import { reconstructPdfGrid } from "@/domain/reports/pdf-grid";
import { extractPdfTextLayer, isLegacyXlsBuffer } from "@/workflows/reports/pdf-text-layer";
import { REPORT_PACKAGE_LIMITS, type ReportPackageFailureCode } from "@/domain/reports/types";
import { reportProfilingTaskSchema } from "@/domain/reports/schemas";
import type { ReportPackageRow } from "@/modules/reports/application/ports";

export type SheetManifestInput = {
  sheetPosition: number;
  sheetName: string;
  normalizedSheetName: string;
  rowCount: number;
  populatedCellCount: number;
  expandedBytes: number;
  headerCandidateDigests: Array<{
    rowPosition: number;
    fieldCount: number;
    digest: string;
    normalizedHeaderDigests: string[];
  }>;
  hasFormula: boolean;
  hasMergedCells: boolean;
  hasRepeatedHeader: boolean;
  contentDigest?: string;
};

export class ReportProfileFailure extends Error {
  constructor(public readonly code: ReportPackageFailureCode) {
    super(code);
    this.name = "ReportProfileFailure";
  }
}

function fail(code: ReportPackageFailureCode): never {
  throw new ReportProfileFailure(code);
}

function assertWithinLimit(value: number, maximum: number, code: ReportPackageFailureCode): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) fail(code);
}

function populatedValueCount(values: unknown[]): number {
  return values.reduce<number>((count, value) => {
    if (value === null || value === undefined || value === "") return count;
    return count + 1;
  }, 0);
}

function normalizedHeaders(values: unknown[]): string[] {
  const seen = new Set<string>();
  const candidates = values[0] === null || values[0] === undefined ? values.slice(1) : values;
  return candidates.flatMap((value) => {
    if (typeof value !== "string" || value.trim().length === 0) return [];
    const normalized = normalizeReportStructureIdentifier(value);
    if (seen.has(normalized)) return [];
    seen.add(normalized);
    return [normalized];
  });
}

function headerValueDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function headerCandidateDigest(rowPosition: number, values: unknown[]) {
  const candidates = values[0] === null || values[0] === undefined ? values.slice(1) : values;
  const populated = candidates.filter(
    (value) => value !== null && value !== undefined && value !== "",
  );
  if (populated.length < 2 || !populated.every((value) => typeof value === "string")) return null;
  const headers = normalizedHeaders(candidates);
  if (headers.length !== populated.length) return null;
  const normalizedHeaderDigests = headers.map(headerValueDigest);
  return {
    rowPosition,
    fieldCount: headers.length,
    digest: createHash("sha256").update(JSON.stringify(normalizedHeaderDigests)).digest("hex"),
    normalizedHeaderDigests,
  };
}

/**
 * How many candidate header rows a sheet records.
 *
 * One is not enough against real exports. Noon states a field row, an English
 * description row, and an Arabic description row before its single line of
 * values; Keeta's billing summary stacks a category row and a subcategory row
 * above its field names. Recording only the first leaves the contract unable to
 * say which row the headers are actually on, and no amount of guessing
 * downstream can recover a row that was never profiled.
 *
 * Five covers every layout observed and still bounds the fingerprint.
 */
const MAX_HEADER_CANDIDATES = 5;

function hasFormulaValue(values: unknown[]): boolean {
  return values.some(
    (value) =>
      value !== null &&
      typeof value === "object" &&
      "formula" in value &&
      typeof (value as { formula?: unknown }).formula === "string",
  );
}

export async function profileCsvBuffer(buffer: Buffer): Promise<SheetManifestInput[]> {
  assertWithinLimit(
    buffer.byteLength,
    REPORT_PACKAGE_LIMITS.maxExpandedBytes,
    "EXPANDED_CONTENT_TOO_LARGE",
  );
  let rowCount = 0;
  let populatedCellCount = 0;
  const headerCandidateDigests: SheetManifestInput["headerCandidateDigests"] = [];
  let hasRepeatedHeader = false;
  try {
    const parser = Readable.from([buffer]).pipe(
      parse({
        bom: true,
        relax_column_count: false,
        skip_empty_lines: true,
        max_record_size: 1024 * 1024,
      }),
    );
    for await (const row of parser as AsyncIterable<unknown>) {
      rowCount += 1;
      assertWithinLimit(rowCount, REPORT_PACKAGE_LIMITS.maxRows, "TOO_MANY_ROWS");
      if (!Array.isArray(row)) fail("UNREADABLE_WORKBOOK");
      const candidate = headerCandidateDigest(rowCount, row);
      if (candidate && headerCandidateDigests.length < MAX_HEADER_CANDIDATES) {
        headerCandidateDigests.push(candidate);
      }
      if (
        headerCandidateDigests[0] &&
        rowCount > headerCandidateDigests[0].rowPosition &&
        candidate?.digest === headerCandidateDigests[0].digest
      )
        hasRepeatedHeader = true;
      populatedCellCount += populatedValueCount(row);
      assertWithinLimit(
        populatedCellCount,
        REPORT_PACKAGE_LIMITS.maxPopulatedCells,
        "TOO_MANY_POPULATED_CELLS",
      );
    }
  } catch (error) {
    if (error instanceof ReportProfileFailure) throw error;
    fail("UNREADABLE_WORKBOOK");
  }
  return [
    {
      sheetPosition: 1,
      sheetName: "CSV",
      normalizedSheetName: "csv",
      rowCount,
      populatedCellCount,
      expandedBytes: buffer.byteLength,
      headerCandidateDigests,
      hasFormula: false,
      hasMergedCells: false,
      hasRepeatedHeader,
    },
  ];
}

/**
 * A PDF profiled as one sheet per page.
 *
 * A page is the closest thing the format has to a worksheet, and treating it as
 * one keeps everything downstream — the fingerprint, the contract's sheet
 * selection, validation, lineage — working exactly as it does for a workbook,
 * with no branch anywhere else in the pipeline that knows what a PDF is.
 */
export async function profilePdfBuffer(buffer: Buffer): Promise<SheetManifestInput[]> {
  assertWithinLimit(
    buffer.byteLength,
    REPORT_PACKAGE_LIMITS.maxExpandedBytes,
    "EXPANDED_CONTENT_TOO_LARGE",
  );

  const extracted = await extractPdfTextLayer(buffer);
  if (extracted.outcome === "failed") fail(extracted.code);
  assertWithinLimit(extracted.pages.length, REPORT_PACKAGE_LIMITS.maxSheets, "TOO_MANY_SHEETS");

  const sheets: SheetManifestInput[] = [];
  let populatedCellCount = 0;
  let rowCount = 0;

  for (const page of extracted.pages) {
    const grid = reconstructPdfGrid(page.items);
    // A cover page or a page of terms carries no table. It is recorded as an
    // empty sheet rather than failing the document, exactly as an empty
    // worksheet would be; the contract decides which pages it requires.
    const rows = grid.outcome === "reconstructed" ? grid.grid.rows : [];

    rowCount += rows.length;
    assertWithinLimit(rowCount, REPORT_PACKAGE_LIMITS.maxRows, "TOO_MANY_ROWS");

    const headerCandidateDigests: SheetManifestInput["headerCandidateDigests"] = [];
    rows.forEach((row, index) => {
      populatedCellCount += populatedValueCount([...row.cells]);
      const candidate = headerCandidateDigest(index + 1, [...row.cells]);
      if (candidate && headerCandidateDigests.length < MAX_HEADER_CANDIDATES) {
        headerCandidateDigests.push(candidate);
      }
    });
    assertWithinLimit(
      populatedCellCount,
      REPORT_PACKAGE_LIMITS.maxPopulatedCells,
      "TOO_MANY_POPULATED_CELLS",
    );

    sheets.push({
      sheetPosition: page.pageNumber,
      sheetName: `Page ${page.pageNumber}`,
      normalizedSheetName: `page_${page.pageNumber}`,
      rowCount: rows.length,
      populatedCellCount: rows.reduce((sum, row) => sum + populatedValueCount([...row.cells]), 0),
      expandedBytes: 0,
      headerCandidateDigests,
      hasFormula: false,
      hasMergedCells: false,
      hasRepeatedHeader: false,
    });
  }

  // Text came out but not one page held a table. The document is prose, and
  // pretending otherwise is what ADR 0028 forbids.
  if (sheets.every((sheet) => sheet.rowCount === 0)) fail("PDF_NO_TABLE_STRUCTURE");

  return sheets;
}

type XlsxArchiveInfo = {
  worksheetExpandedBytes: Map<number, number>;
  worksheetFlags: Map<number, { hasFormula: boolean; hasMergedCells: boolean }>;
};

function isUnsafeArchiveEntry(entry: yauzl.Entry): boolean {
  const name = entry.fileName.replaceAll("\\", "/");
  return (
    name.startsWith("/") ||
    name.split("/").some((segment) => segment === "..") ||
    entry.isEncrypted() ||
    name === "xl/vbaProject.bin" ||
    name.startsWith("xl/externalLinks/")
  );
}

export async function inspectXlsxArchive(buffer: Buffer): Promise<XlsxArchiveInfo> {
  let zip: yauzl.ZipFile;
  try {
    zip = await yauzl.fromBufferPromise(buffer, { lazyEntries: true, validateEntrySizes: true });
  } catch {
    return fail("UNREADABLE_WORKBOOK");
  }
  try {
    let expandedBytes = 0;
    const worksheets = new Map<number, number>();
    const worksheetFlags = new Map<number, { hasFormula: boolean; hasMergedCells: boolean }>();
    for await (const entry of zip.eachEntry()) {
      if (isUnsafeArchiveEntry(entry)) fail("UNSAFE_WORKBOOK");
      expandedBytes += entry.uncompressedSize;
      assertWithinLimit(
        expandedBytes,
        REPORT_PACKAGE_LIMITS.maxExpandedBytes,
        "EXPANDED_CONTENT_TOO_LARGE",
      );
      const worksheet = /^xl\/worksheets\/sheet(\d+)\.xml$/i.exec(entry.fileName);
      if (worksheet) {
        const worksheetId = Number(worksheet[1]);
        worksheets.set(worksheetId, entry.uncompressedSize);
        worksheetFlags.set(worksheetId, await inspectWorksheetXml(zip, entry));
        assertWithinLimit(worksheets.size, REPORT_PACKAGE_LIMITS.maxSheets, "TOO_MANY_SHEETS");
      }
    }
    if (worksheets.size === 0) fail("UNREADABLE_WORKBOOK");
    return { worksheetExpandedBytes: worksheets, worksheetFlags };
  } finally {
    zip.close();
  }
}

async function inspectWorksheetXml(
  zip: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<{ hasFormula: boolean; hasMergedCells: boolean }> {
  const stream = await new Promise<Readable>((resolve, reject) => {
    zip.openReadStream(entry, (error, result) =>
      error || !result ? reject(error) : resolve(result),
    );
  });
  let trailing = "";
  let hasFormula = false;
  let hasMergedCells = false;
  for await (const chunk of stream) {
    const current = trailing + Buffer.from(chunk).toString("utf8");
    hasFormula ||= current.includes("<f") || current.includes(":f>");
    hasMergedCells ||= current.includes("<mergeCell");
    trailing = current.slice(-16);
  }
  return { hasFormula, hasMergedCells };
}

export async function profileXlsxBuffer(buffer: Buffer): Promise<SheetManifestInput[]> {
  const archive = await inspectXlsxArchive(buffer);
  const workbook = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buffer]), {
    entries: "ignore",
    hyperlinks: "ignore",
    sharedStrings: "cache",
    styles: "ignore",
    worksheets: "emit",
  });
  const manifests: SheetManifestInput[] = [];
  let totalRows = 0;
  let totalCells = 0;
  try {
    for await (const worksheet of workbook) {
      if (manifests.length >= REPORT_PACKAGE_LIMITS.maxSheets) fail("TOO_MANY_SHEETS");
      let rows = 0;
      let cells = 0;
      const headerCandidateDigests: SheetManifestInput["headerCandidateDigests"] = [];
      let hasRepeatedHeader = false;
      let hasFormula = false;
      for await (const row of worksheet) {
        rows += 1;
        totalRows += 1;
        assertWithinLimit(totalRows, REPORT_PACKAGE_LIMITS.maxRows, "TOO_MANY_ROWS");
        const values = Array.isArray(row.values) ? row.values : [];
        const candidate = headerCandidateDigest(rows, values);
        if (candidate && headerCandidateDigests.length < MAX_HEADER_CANDIDATES) {
          headerCandidateDigests.push(candidate);
        }
        if (
          headerCandidateDigests[0] &&
          rows > headerCandidateDigests[0].rowPosition &&
          candidate?.digest === headerCandidateDigests[0].digest
        )
          hasRepeatedHeader = true;
        hasFormula ||= hasFormulaValue(values);
        const count = populatedValueCount(values);
        cells += count;
        totalCells += count;
        assertWithinLimit(
          totalCells,
          REPORT_PACKAGE_LIMITS.maxPopulatedCells,
          "TOO_MANY_POPULATED_CELLS",
        );
      }
      const reader = worksheet as unknown as { name?: string; id?: number };
      const position = manifests.length + 1;
      const archiveFlags = archive.worksheetFlags.get(reader.id ?? position);
      manifests.push({
        sheetPosition: position,
        sheetName: reader.name || `Sheet ${position}`,
        normalizedSheetName: normalizeReportStructureIdentifier(reader.name || `Sheet ${position}`),
        rowCount: rows,
        populatedCellCount: cells,
        expandedBytes: archive.worksheetExpandedBytes.get(reader.id ?? position) ?? 0,
        headerCandidateDigests,
        hasFormula: hasFormula || archiveFlags?.hasFormula === true,
        hasMergedCells: archiveFlags?.hasMergedCells ?? false,
        hasRepeatedHeader,
      });
    }
  } catch (error) {
    if (error instanceof ReportProfileFailure) throw error;
    fail("UNREADABLE_WORKBOOK");
  }
  if (manifests.length === 0) fail("UNREADABLE_WORKBOOK");
  return manifests;
}

function metadataSize(metadata: Record<string, unknown> | null | undefined): number {
  const value = metadata?.size;
  return typeof value === "number" ? value : typeof value === "string" ? Number(value) : 0;
}

export type ReportProfilingDependencies = {
  claim(input: {
    organizationId: string;
    packageId: string;
    idempotencyKey: string;
    claimToken: string;
  }): Promise<
    | { outcome: "acquired"; reportPackage: ReportPackageRow }
    | { outcome: "completed" | "not_found" | "not_ready" | "in_progress" | "conflict" }
  >;
  objectStore: {
    stat(input: { path: string }): Promise<{ id: string; metadata: Record<string, unknown> }>;
    download(input: { path: string }): Promise<Buffer>;
  };
  complete(input: {
    organizationId: string;
    packageId: string;
    claimToken: string;
    contentSha256: string;
    schemaFingerprint: string;
    sheets: SheetManifestInput[];
  }): Promise<void>;
  fail(input: {
    organizationId: string;
    packageId: string;
    claimToken: string;
    code: ReportPackageFailureCode;
  }): Promise<void>;
};

function assertObjectIdentity(
  reportPackage: ReportPackageRow,
  object: { id: string; metadata: Record<string, unknown> },
) {
  if (object.id !== reportPackage.storage_object_id) {
    fail("OBJECT_IDENTITY_CHANGED");
  }
  const size = metadataSize(object.metadata);
  if (
    size !== reportPackage.declared_content_length ||
    size > REPORT_PACKAGE_LIMITS.maxCompressedBytes
  ) {
    fail("FILE_TOO_LARGE");
  }
  if (object.metadata.mimetype !== reportPackage.declared_content_type) fail("INVALID_FILE_TYPE");
}

export async function runReportPackageProfiling(
  input: unknown,
  dependencies: ReportProfilingDependencies,
): Promise<{ outcome: string }> {
  const payload = reportProfilingTaskSchema.parse(input);
  const claimToken = crypto.randomUUID();
  const claim = await dependencies.claim({ ...payload, claimToken });
  if (claim.outcome !== "acquired") return { outcome: claim.outcome };
  try {
    // The object is checked after the durable lease is acquired. Storage has no
    // authenticated UPDATE or DELETE policy, and this second metadata read
    // prevents a privileged or stale object from being profiled under an old id.
    const object = await dependencies.objectStore.stat({ path: claim.reportPackage.storage_path });
    assertObjectIdentity(claim.reportPackage, object);
    const buffer = await dependencies.objectStore.download({
      path: claim.reportPackage.storage_path,
    });
    if (buffer.byteLength !== claim.reportPackage.declared_content_length)
      fail("OBJECT_IDENTITY_CHANGED");
    const contentSha256 = createHash("sha256").update(buffer).digest("hex");
    // Checked by content rather than by the declared kind. A BIFF file renamed
    // to .xlsx would otherwise reach ExcelJS and fail as an unreadable archive,
    // which tells the operator nothing they can act on.
    if (isLegacyXlsBuffer(buffer)) fail("LEGACY_XLS_UNSUPPORTED");

    const sheets =
      claim.reportPackage.file_kind === "csv"
        ? await profileCsvBuffer(buffer)
        : claim.reportPackage.file_kind === "pdf"
          ? await profilePdfBuffer(buffer)
          : await profileXlsxBuffer(buffer);
    const schemaFingerprint = createReportSchemaFingerprint({
      reportType: claim.reportPackage.report_type,
      currency: claim.reportPackage.declared_currency,
      outletGrain: "branch",
      parserVersion: claim.reportPackage.parser_version,
      fingerprintVersion: claim.reportPackage.fingerprint_version,
      sheets: sheets.map((sheet) => ({
        position: sheet.sheetPosition,
        normalizedSheetName: sheet.normalizedSheetName,
        headerCandidateDigests: sheet.headerCandidateDigests,
        hasFormula: sheet.hasFormula,
        hasMergedCells: sheet.hasMergedCells,
        hasRepeatedHeader: sheet.hasRepeatedHeader,
      })),
    });
    await dependencies.complete({
      ...payload,
      claimToken,
      contentSha256,
      schemaFingerprint,
      sheets,
    });
    return { outcome: "profiled" };
  } catch (error) {
    const code = error instanceof ReportProfileFailure ? error.code : "PROFILE_FAILED";
    await dependencies.fail({ ...payload, claimToken, code });
    return { outcome: "failed" };
  }
}
