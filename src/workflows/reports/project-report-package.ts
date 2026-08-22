import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import ExcelJS from "exceljs";
import { parse } from "csv-parse";
import { z } from "zod";

import { normalizeReportStructureIdentifier, reportContractDocumentSchema } from "@/domain/reports/contracts";
import {
  createReportProjectionResultDigest,
  projectExactRangeMetrics,
  reportProjectionDocumentSchema,
} from "@/domain/reports/projection";

const payloadSchema = z
  .object({
    organizationId: z.string().uuid(),
    packageId: z.string().uuid(),
    contractVersionId: z.string().uuid(),
    projectionVersionId: z.string().uuid(),
    projectionRunId: z.string().uuid(),
    correlationId: z.string().uuid(),
    idempotencyKey: z.string().trim().min(16).max(200),
  })
  .strict();

type ProjectionPackage = {
  id: string;
  organization_id: string;
  storage_path: string;
  storage_object_id: string | null;
  storage_object_version: string | null;
  declared_content_length: number;
  declared_content_type: string;
  content_sha256: string | null;
  declared_currency: string;
  file_kind: "csv" | "xlsx";
};

type ProjectionOutput = {
  key: string;
  metricKey: string;
  metricDefinitionId: string;
  valueKind: "money" | "count";
  valueNumerator: string;
  currency: string | null;
  normalizedSheetName: string;
  canonicalField: string;
  sourceColumnOrdinal: number;
  firstDataRow: number;
  lastDataRow: number;
  contributorCount: number;
  sourceDigest: string;
};

export type ReportProjectionDependencies = {
  claim(input: {
    organizationId: string;
    packageId: string;
    contractVersionId: string;
    projectionVersionId: string;
    projectionRunId: string;
    idempotencyKey: string;
    claimToken: string;
    correlationId: string;
  }): Promise<
    | {
        outcome: "acquired";
        reportPackage: ProjectionPackage;
        contractVersion: { mapping_document: unknown };
        projectionVersion: { projection_document: unknown };
        metricDefinitions: Array<{ id: string; key: string; value_kind: "money" | "count" }>;
        validationStatus?: "validated" | "partially_validated";
      }
    | { outcome: "completed" | "not_found" | "not_ready" | "in_progress" | "conflict" | "expired" | "object_mismatch" }
  >;
  objectStore: {
    stat(input: { path: string }): Promise<{ id: string; metadata: Record<string, unknown> }>;
    download(input: { path: string }): Promise<Buffer>;
  };
  complete(input: {
    organizationId: string;
    packageId: string;
    projectionRunId: string;
    claimToken: string;
    resultDigest: string;
    result: {
      status: "projected" | "partially_projected";
      qualityState: "complete" | "partial";
      completenessState: "complete" | "partial";
      errorCodes: string[];
      warningCodes: string[];
    };
    outputs: ProjectionOutput[];
  }): Promise<void>;
  fail(input: {
    organizationId: string;
    packageId: string;
    projectionRunId: string;
    claimToken: string;
    code: "OBJECT_IDENTITY_CHANGED" | "OBJECT_UNAVAILABLE" | "UNREADABLE_WORKBOOK" | "PROJECTION_PROCESSING_FAILED";
    resultDigest: string;
  }): Promise<void>;
};

export class ReportProjectionFailure extends Error {
  constructor(
    public readonly code:
      | "OBJECT_IDENTITY_CHANGED"
      | "OBJECT_UNAVAILABLE"
      | "UNREADABLE_WORKBOOK"
      | "PROJECTION_PROCESSING_FAILED",
  ) {
    super(code);
    this.name = "ReportProjectionFailure";
  }
}

function metadataSize(metadata: Record<string, unknown>): number {
  return typeof metadata.size === "number"
    ? metadata.size
    : typeof metadata.size === "string"
      ? Number(metadata.size)
      : 0;
}

function assertObjectIdentity(
  reportPackage: ProjectionPackage,
  object: { id: string; metadata: Record<string, unknown> },
): void {
  if (
    object.id !== reportPackage.storage_object_id ||
    metadataSize(object.metadata) !== reportPackage.declared_content_length ||
    object.metadata.mimetype !== reportPackage.declared_content_type
  ) {
    throw new ReportProjectionFailure("OBJECT_IDENTITY_CHANGED");
  }
}

async function readCsvRows(buffer: Buffer): Promise<unknown[][]> {
  const rows: unknown[][] = [];
  const parser = Readable.from([buffer]).pipe(
    parse({ bom: true, relax_column_count: false, skip_empty_lines: true, max_record_size: 1024 * 1024 }),
  );
  for await (const row of parser as AsyncIterable<unknown>) {
    if (!Array.isArray(row)) throw new ReportProjectionFailure("UNREADABLE_WORKBOOK");
    rows.push(row);
  }
  return rows;
}

async function readWorkbookRows(buffer: Buffer): Promise<Array<{ normalizedSheetName: string; rows: unknown[][] }>> {
  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookReader(Readable.from([buffer]), {
      entries: "ignore",
      hyperlinks: "ignore",
      sharedStrings: "cache",
      styles: "ignore",
      worksheets: "emit",
    });
    const sheets: Array<{ normalizedSheetName: string; rows: unknown[][] }> = [];
    for await (const worksheet of workbook) {
      const rows: unknown[][] = [];
      for await (const row of worksheet) {
        const values = Array.isArray(row.values) ? row.values.slice(1) : [];
        rows.push(values);
      }
      const reader = worksheet as unknown as { name?: string };
      sheets.push({
        normalizedSheetName: normalizeReportStructureIdentifier(reader.name ?? `sheet_${sheets.length + 1}`),
        rows,
      });
    }
    return sheets;
  } catch {
    throw new ReportProjectionFailure("UNREADABLE_WORKBOOK");
  }
}

function findColumn(rows: readonly (readonly unknown[])[], headerRow: number, sourceHeader: string): number {
  const header = rows[headerRow - 1] ?? [];
  const index = header.findIndex(
    (value) => typeof value === "string" && normalizeReportStructureIdentifier(value) === sourceHeader,
  );
  if (index < 0) throw new ReportProjectionFailure("PROJECTION_PROCESSING_FAILED");
  return index + 1;
}

function safeSourceDigest(output: ProjectionOutput): string {
  return createHash("sha256")
    .update(
      [
        output.key,
        output.metricKey,
        output.valueKind,
        output.valueNumerator,
        output.normalizedSheetName,
        output.canonicalField,
        output.sourceColumnOrdinal,
        output.firstDataRow,
        output.lastDataRow,
        output.contributorCount,
      ].join("|"),
    )
    .digest("hex");
}

function failureDigest(code: string): string {
  return createHash("sha256").update(`report-projection-failure:${code}`).digest("hex");
}

export async function runReportPackageProjection(
  input: unknown,
  dependencies: ReportProjectionDependencies,
): Promise<{ outcome: string }> {
  const payload = payloadSchema.parse(input);
  const claimToken = crypto.randomUUID();
  const claim = await dependencies.claim({ ...payload, claimToken });
  if (claim.outcome !== "acquired") return { outcome: claim.outcome };

  try {
    const object = await dependencies.objectStore.stat({ path: claim.reportPackage.storage_path });
    assertObjectIdentity(claim.reportPackage, object);
    const buffer = await dependencies.objectStore.download({ path: claim.reportPackage.storage_path });
    if (
      buffer.byteLength !== claim.reportPackage.declared_content_length ||
      createHash("sha256").update(buffer).digest("hex") !== claim.reportPackage.content_sha256
    ) {
      throw new ReportProjectionFailure("OBJECT_IDENTITY_CHANGED");
    }
    const contract = reportContractDocumentSchema.parse(claim.contractVersion.mapping_document);
    const document = reportProjectionDocumentSchema.parse(claim.projectionVersion.projection_document);
    if (contract.currency !== claim.reportPackage.declared_currency || contract.outletGrain !== "branch") {
      throw new ReportProjectionFailure("PROJECTION_PROCESSING_FAILED");
    }
    const sheets =
      claim.reportPackage.file_kind === "csv"
        ? [{ normalizedSheetName: "csv", rows: await readCsvRows(buffer) }]
        : await readWorkbookRows(buffer);
    const projected = projectExactRangeMetrics({
      contract,
      document,
      declaredCurrency: claim.reportPackage.declared_currency,
      sheets,
    });
    const definitions = new Map(claim.metricDefinitions.map((definition) => [definition.key, definition]));
    const outputs: ProjectionOutput[] = projected.outputs.map((output) => {
      const definition = definitions.get(output.metricKey);
      if (!definition || definition.value_kind !== output.valueKind) {
        throw new ReportProjectionFailure("PROJECTION_PROCESSING_FAILED");
      }
      const rule = contract.sheets.find((sheet) => sheet.normalizedSheetName === output.normalizedSheetName);
      const field = rule?.fields.find((candidate) => candidate.canonicalField === output.canonicalField);
      const source = sheets.find((sheet) => sheet.normalizedSheetName === output.normalizedSheetName);
      if (!rule || !field || !source) throw new ReportProjectionFailure("PROJECTION_PROCESSING_FAILED");
      const prepared: ProjectionOutput = {
        ...output,
        metricDefinitionId: definition.id,
        sourceColumnOrdinal: findColumn(source.rows, rule.headerRow, field.sourceHeader),
        sourceDigest: "",
      };
      return { ...prepared, sourceDigest: safeSourceDigest(prepared) };
    });
    const partial = claim.validationStatus === "partially_validated";
    const result = {
      status: partial ? ("partially_projected" as const) : ("projected" as const),
      qualityState: partial ? ("partial" as const) : ("complete" as const),
      completenessState: partial ? ("partial" as const) : ("complete" as const),
      errorCodes: [],
      warningCodes: partial ? ["OPTIONAL_VALIDATION_DEPENDENCY_UNAVAILABLE"] : [],
    };
    await dependencies.complete({
      organizationId: payload.organizationId,
      packageId: payload.packageId,
      projectionRunId: payload.projectionRunId,
      claimToken,
      resultDigest: createReportProjectionResultDigest({ outputs: projected.outputs }),
      result,
      outputs,
    });
    return { outcome: result.status };
  } catch (error) {
    const code = error instanceof ReportProjectionFailure ? error.code : "PROJECTION_PROCESSING_FAILED";
    await dependencies.fail({
      organizationId: payload.organizationId,
      packageId: payload.packageId,
      projectionRunId: payload.projectionRunId,
      claimToken,
      code,
      resultDigest: failureDigest(code),
    });
    return { outcome: "failed" };
  }
}
