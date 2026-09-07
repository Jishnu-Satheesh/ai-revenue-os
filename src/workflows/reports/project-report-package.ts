import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import ExcelJS from "exceljs";
import { parse } from "csv-parse";
import { z } from "zod";

import {
  normalizeReportStructureIdentifier,
  reportContractDocumentSchema,
} from "@/domain/reports/contracts";
import {
  createReportPeriodGrainResultDigest,
  createReportProjectionResultDigest,
} from "@/domain/reports/document-digest";
import {
  projectExactRangeMetrics,
  projectPeriodGrainMetrics,
  ReportControlTotalMismatch,
  ReportProjectionError,
  reportProjectionDocumentSchema,
} from "@/domain/reports/projection";
import { reconstructPdfGrid } from "@/domain/reports/pdf-grid";
import { selectContractSheet } from "@/domain/reports/sheet-locator";
import { extractPdfTextLayer } from "@/workflows/reports/pdf-text-layer";

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
  /** Inclusive local dates, as the operator declared the package covers. */
  declared_period_start: string;
  declared_period_end: string;
  file_kind: "csv" | "xlsx" | "pdf";
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

/**
 * One period of a series, in the exact shape
 * `complete_governed_report_package_period_grain_projection` accepts. The
 * database checks every one of these fields again; this type only keeps the two
 * copies of the rule from drifting silently.
 */
type PeriodGrainObservationPayload = {
  key: string;
  metricKey: string;
  metricDefinitionId: string;
  valueKind: "money" | "count";
  valueNumerator: string;
  currency: string | null;
  /** Inclusive local dates. No timezone arithmetic happens in the worker. */
  periodStart: string;
  periodEnd: string;
  normalizedSheetName: string;
  canonicalField: string;
  sourceColumnOrdinal: number;
  contributorCount: number;
  /** Present exactly when the output is categorical. See the projection schema. */
  dimensions?: { readonly [dimensionKey: string]: string };
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
  completePeriodGrain(input: {
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
    observations: PeriodGrainObservationPayload[];
    /**
     * Periods the provider left blank. Carried through so Postgres can record
     * it: a gap is a fact about the evidence, and `specs/018` section 10.1 says
     * gaps stay absent rather than becoming zeros nobody can tell apart.
     */
    absentRowCount: number;
  }): Promise<void>;
  fail(input: {
    organizationId: string;
    packageId: string;
    projectionRunId: string;
    claimToken: string;
    code: ReportProjectionFailureCode;
    resultDigest: string;
    /**
     * What the failure knew about itself, for the codes that name a category
     * rather than a cause. Identifiers and the error's own name and message
     * only; never workbook content.
     */
    detail?: string;
  }): Promise<void>;
};

/** Every code `fail_governed_report_package_projection` will accept. */
export type ReportProjectionFailureCode =
  | "OBJECT_IDENTITY_CHANGED"
  | "OBJECT_UNAVAILABLE"
  | "UNREADABLE_WORKBOOK"
  | "CONTROL_TOTAL_MISMATCH"
  | "PROJECTION_OUTPUT_KIND_UNSUPPORTED"
  | "TOTALS_ROW_NOT_RESOLVED"
  | "INVALID_LOCAL_DATE"
  | "PERIOD_OUT_OF_DECLARED_RANGE"
  | "PROJECTION_PROCESSING_FAILED";

export class ReportProjectionFailure extends Error {
  constructor(public readonly code: ReportProjectionFailureCode) {
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

export async function readCsvRows(buffer: Buffer): Promise<unknown[][]> {
  const rows: unknown[][] = [];
  const parser = Readable.from([buffer]).pipe(
    parse({
      bom: true,
      relax_column_count: false,
      skip_empty_lines: true,
      max_record_size: 1024 * 1024,
    }),
  );
  for await (const row of parser as AsyncIterable<unknown>) {
    if (!Array.isArray(row)) throw new ReportProjectionFailure("UNREADABLE_WORKBOOK");
    rows.push(row);
  }
  return rows;
}

/**
 * A PDF read as one sheet per page, exactly as it was profiled and validated.
 *
 * The grid comes back from the text layer's coordinates. A page with no table
 * is an empty sheet rather than a failure -- a statement's cover page is not a
 * reason to refuse the statement -- and the contract says which pages it needs
 * through the fields it cannot otherwise find.
 */
export async function readPdfRows(
  buffer: Buffer,
): Promise<Array<{ normalizedSheetName: string; rows: unknown[][] }>> {
  const extracted = await extractPdfTextLayer(buffer);
  if (extracted.outcome === "failed") throw new ReportProjectionFailure("UNREADABLE_WORKBOOK");
  return extracted.pages.map((page) => {
    const grid = reconstructPdfGrid(page.items);
    return {
      normalizedSheetName: `page_${page.pageNumber}`,
      rows: grid.outcome === "reconstructed" ? grid.grid.rows.map((row) => [...row.cells]) : [],
    };
  });
}

export async function readWorkbookRows(
  buffer: Buffer,
): Promise<Array<{ normalizedSheetName: string; rows: unknown[][] }>> {
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
        normalizedSheetName: normalizeReportStructureIdentifier(
          reader.name ?? `sheet_${sheets.length + 1}`,
        ),
        rows,
      });
    }
    return sheets;
  } catch {
    throw new ReportProjectionFailure("UNREADABLE_WORKBOOK");
  }
}

function findColumn(
  rows: readonly (readonly unknown[])[],
  headerRow: number,
  sourceHeader: string,
): number {
  const header = rows[headerRow - 1] ?? [];
  const index = header.findIndex(
    (value) =>
      typeof value === "string" && normalizeReportStructureIdentifier(value) === sourceHeader,
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

/**
 * What a failure knew about itself, in one bounded line.
 *
 * The error's own name and message, and for our own typed failures the code
 * they carry, because a code alone says which category the failure belongs to
 * and not which thing went wrong. Bounded to the column's 300 characters.
 *
 * Every error on this path carries identifiers only, with one deliberate
 * exception: `ReportCategoricalValueNotDeclared` also carries the offending
 * value, because a category label is a provider's own declared vocabulary
 * (`CLOSED`, `ITEM_UNAVAILABLE`) rather than a customer value, and it is
 * itself bounded to 64 characters before it ever reaches here. No other
 * error's message carries workbook content.
 */
function failureDetail(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const code =
    error instanceof ReportProjectionFailure || error instanceof ReportProjectionError
      ? (error as { code?: string }).code
      : undefined;
  const parts = [error.name, code, error.message].filter(
    (part): part is string => typeof part === "string" && part.length > 0,
  );
  const line = [...new Set(parts)].join(": ").replace(/\s+/g, " ").trim();
  return line.length === 0 ? undefined : line.slice(0, 300);
}

function safePeriodSourceDigest(observation: PeriodGrainObservationPayload): string {
  return createHash("sha256")
    .update(
      [
        observation.key,
        observation.metricKey,
        observation.valueKind,
        observation.valueNumerator,
        // Two categories of one output are different facts about the same
        // period, and a digest that could not tell them apart would make one
        // look like an idempotent replay of the other.
        observation.dimensions ? JSON.stringify(observation.dimensions) : "",
        observation.periodStart,
        observation.periodEnd,
        observation.normalizedSheetName,
        observation.canonicalField,
        observation.sourceColumnOrdinal,
        observation.contributorCount,
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
): Promise<{ outcome: string; absentRowCount?: number }> {
  const payload = payloadSchema.parse(input);
  const claimToken = crypto.randomUUID();
  const claim = await dependencies.claim({ ...payload, claimToken });
  if (claim.outcome !== "acquired") return { outcome: claim.outcome };

  try {
    const object = await dependencies.objectStore.stat({ path: claim.reportPackage.storage_path });
    assertObjectIdentity(claim.reportPackage, object);
    const buffer = await dependencies.objectStore.download({
      path: claim.reportPackage.storage_path,
    });
    if (
      buffer.byteLength !== claim.reportPackage.declared_content_length ||
      createHash("sha256").update(buffer).digest("hex") !== claim.reportPackage.content_sha256
    ) {
      throw new ReportProjectionFailure("OBJECT_IDENTITY_CHANGED");
    }
    const contract = reportContractDocumentSchema.parse(claim.contractVersion.mapping_document);
    const document = reportProjectionDocumentSchema.parse(
      claim.projectionVersion.projection_document,
    );
    if (
      contract.currency !== claim.reportPackage.declared_currency ||
      contract.outletGrain !== "branch"
    ) {
      throw new ReportProjectionFailure("PROJECTION_PROCESSING_FAILED");
    }
    const sheets =
      claim.reportPackage.file_kind === "csv"
        ? [{ normalizedSheetName: "csv", rows: await readCsvRows(buffer) }]
        : claim.reportPackage.file_kind === "pdf"
          ? await readPdfRows(buffer)
          : await readWorkbookRows(buffer);
    const definitions = new Map(
      claim.metricDefinitions.map((definition) => [definition.key, definition]),
    );
    const partial = claim.validationStatus === "partially_validated";
    const result = {
      status: partial ? ("partially_projected" as const) : ("projected" as const),
      qualityState: partial ? ("partial" as const) : ("complete" as const),
      completenessState: partial ? ("partial" as const) : ("complete" as const),
      errorCodes: [],
      warningCodes: partial ? ["OPTIONAL_VALIDATION_DEPENDENCY_UNAVAILABLE"] : [],
    };

    // A series projects into `normalized_metrics` per `specs/018` section 10.1,
    // one observation per period, rather than into the exact-range ledger.
    // Summing its days into a single total would be the silent reinterpretation
    // ADR 0029 exists to prevent. See ADR 0030.
    if (document.outputKind === "period_grain") {
      const series = projectPeriodGrainMetrics({
        contract,
        document,
        declaredCurrency: claim.reportPackage.declared_currency,
        declaredPeriod: {
          periodStart: claim.reportPackage.declared_period_start,
          periodEnd: claim.reportPackage.declared_period_end,
        },
        sheets,
      });
      const observations: PeriodGrainObservationPayload[] = series.observations.map(
        (observation) => {
          // A figure dated outside the window the operator declared this package
          // covers would be filed under someone else's month.
          if (
            observation.periodStart < claim.reportPackage.declared_period_start ||
            observation.periodEnd > claim.reportPackage.declared_period_end
          ) {
            throw new ReportProjectionFailure("PERIOD_OUT_OF_DECLARED_RANGE");
          }
          const definition = definitions.get(observation.metricKey);
          if (!definition || definition.value_kind !== observation.valueKind) {
            throw new ReportProjectionFailure("PROJECTION_PROCESSING_FAILED");
          }
          const rule = contract.sheets.find(
            (sheet) => sheet.normalizedSheetName === observation.normalizedSheetName,
          );
          const field = rule?.fields.find(
            (candidate) => candidate.canonicalField === observation.canonicalField,
          );
          // Selected the way the projector selected it, so the column ordinal
          // recorded in lineage names the sheet the figures actually came from.
          const source = rule ? selectContractSheet(rule, sheets) : undefined;
          if (!rule || !field || !source)
            throw new ReportProjectionFailure("PROJECTION_PROCESSING_FAILED");
          const prepared: PeriodGrainObservationPayload = {
            ...observation,
            metricDefinitionId: definition.id,
            sourceColumnOrdinal: findColumn(source.rows, rule.headerRow, field.sourceHeader),
            sourceDigest: "",
          };
          return { ...prepared, sourceDigest: safePeriodSourceDigest(prepared) };
        },
      );
      await dependencies.completePeriodGrain({
        organizationId: payload.organizationId,
        packageId: payload.packageId,
        projectionRunId: payload.projectionRunId,
        claimToken,
        resultDigest: createReportPeriodGrainResultDigest({
          observations: series.observations,
          absentRowCount: series.absentRowCount,
        }),
        result,
        observations,
        absentRowCount: series.absentRowCount,
      });
      return { outcome: result.status, absentRowCount: series.absentRowCount };
    }

    const projected = projectExactRangeMetrics({
      contract,
      document,
      declaredCurrency: claim.reportPackage.declared_currency,
      sheets,
    });
    const outputs: ProjectionOutput[] = projected.outputs.map((output) => {
      const definition = definitions.get(output.metricKey);
      if (!definition || definition.value_kind !== output.valueKind) {
        throw new ReportProjectionFailure("PROJECTION_PROCESSING_FAILED");
      }
      const rule = contract.sheets.find(
        (sheet) => sheet.normalizedSheetName === output.normalizedSheetName,
      );
      const field = rule?.fields.find(
        (candidate) => candidate.canonicalField === output.canonicalField,
      );
      const source = sheets.find(
        (sheet) => sheet.normalizedSheetName === output.normalizedSheetName,
      );
      if (!rule || !field || !source)
        throw new ReportProjectionFailure("PROJECTION_PROCESSING_FAILED");
      const prepared: ProjectionOutput = {
        ...output,
        metricDefinitionId: definition.id,
        sourceColumnOrdinal: findColumn(source.rows, rule.headerRow, field.sourceHeader),
        sourceDigest: "",
      };
      return { ...prepared, sourceDigest: safeSourceDigest(prepared) };
    });
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
    const code: ReportProjectionFailureCode =
      error instanceof ReportProjectionFailure
        ? error.code
        : error instanceof ReportControlTotalMismatch
          ? "CONTROL_TOTAL_MISMATCH"
          : error instanceof ReportProjectionError && error.code === "TOTALS_ROW_NOT_RESOLVED"
            ? "TOTALS_ROW_NOT_RESOLVED"
            : // A row whose date cannot be read is the likeliest way a series
              // fails, across three date encodings. Flattening it into the
              // generic code leaves an operator with nothing to act on.
              error instanceof ReportProjectionError && error.code === "INVALID_LOCAL_DATE"
              ? "INVALID_LOCAL_DATE"
              : "PROJECTION_PROCESSING_FAILED";
    if (error instanceof ReportControlTotalMismatch) {
      // The difference is the only part an operator can act on, and there is no
      // column for it, so it goes to the log with the identifiers that make it
      // findable. No figure from the workbook itself is logged.
      console.error("report projection control total mismatch", {
        organizationId: payload.organizationId,
        packageId: payload.packageId,
        projectionRunId: payload.projectionRunId,
        correlationId: payload.correlationId,
        outputKey: error.outputKey,
        differenceMinorUnits: error.differenceMinorUnits,
        toleranceMinorUnits: error.toleranceMinorUnits,
      });
    } else if (!(error instanceof ReportProjectionFailure)) {
      // An unexpected exception reached the boundary. Flattening it into the
      // generic code without recording what it was would make every such run
      // unexplainable after the fact — identifiers and the error's own name
      // and message only; never workbook content.
      //
      // The same detail is written to the run below. A log line the operator
      // cannot read, and which a production run does not surface to anyone
      // afterwards, is not a record: it cost a full session on 2026-09-01 to
      // rebuild a cause the worker had already held and discarded.
      console.error("report projection failed unexpectedly", {
        organizationId: payload.organizationId,
        packageId: payload.packageId,
        projectionRunId: payload.projectionRunId,
        correlationId: payload.correlationId,
        errorName: error instanceof Error ? error.name : "unknown",
        errorMessage: error instanceof Error ? error.message.slice(0, 300) : String(error),
        stackTop: error instanceof Error ? error.stack?.split("\n").slice(1, 4).join(" | ").slice(0, 400) : undefined,
      });
    }
    await dependencies.fail({
      organizationId: payload.organizationId,
      packageId: payload.packageId,
      projectionRunId: payload.projectionRunId,
      claimToken,
      code,
      resultDigest: failureDigest(code),
      detail: failureDetail(error),
    });
    return { outcome: "failed" };
  }
}
