import { parse } from "csv-parse/sync";

import type { IntegrationRecordEnvelope } from "@/domain/integrations/schemas";
import {
  beginOrCancel,
  complete,
  loadValidatedDataSource,
  normalizedError,
  nowIso,
  parseDataSourceTaskPayload,
  type CsvObjectStore,
  type IntegrationWorkerDependencies,
} from "@/workflows/integrations/contracts";

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_SIZE = 500;

function assertCsvObject(metadata: {
  contentType: string | null;
  size: number;
  encoding: string | null;
}): void {
  if (
    metadata.contentType !== "text/csv" ||
    !Number.isInteger(metadata.size) ||
    metadata.size < 1 ||
    metadata.size > MAX_CSV_BYTES ||
    metadata.encoding?.toLowerCase() !== "utf-8"
  ) {
    throw new Error("CSV object metadata is invalid.");
  }
}

async function* parseCsvRows(
  stream: AsyncIterable<Uint8Array>,
): AsyncGenerator<Record<string, string>> {
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  for await (const chunk of stream) {
    totalBytes += chunk.byteLength;
    if (totalBytes > MAX_CSV_BYTES) throw new Error("CSV file exceeds the allowed size.");
    chunks.push(chunk);
  }
  const records = parse(Buffer.concat(chunks).toString("utf8"), {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    max_record_size: 64 * 1024,
  });
  for (const record of records) yield record as Record<string, string>;
}

function assertMapping(row: Record<string, string>, mapping: Record<string, unknown>): void {
  const headers = new Set(Object.keys(row));
  const fields = Object.values(mapping);
  if (
    !fields.length ||
    fields.some((column) => typeof column !== "string" || !headers.has(column))
  ) {
    throw new Error("CSV column mapping does not match the uploaded headers.");
  }
}

async function handoffBatch(input: {
  dependencies: IntegrationWorkerDependencies;
  organizationId: string;
  ingestionRunId: string;
  idempotencyKey: string;
  records: IntegrationRecordEnvelope[];
}) {
  return input.dependencies.sink.accept({
    organizationId: input.organizationId,
    ingestionRunId: input.ingestionRunId,
    idempotencyKey: input.idempotencyKey,
    records: input.records,
  });
}

/** Streams a validated CSV through bounded Data Ingestion batches. */
export async function runImportDataSource(
  input: unknown,
  dependencies: IntegrationWorkerDependencies,
) {
  const payload = parseDataSourceTaskPayload(input);
  const source = await loadValidatedDataSource(payload, dependencies);
  const cancelled = await beginOrCancel(payload, dependencies);
  if (cancelled) return;
  let recordsReceived = 0;
  let recordsAccepted = 0;
  let recordsRejected = 0;
  try {
    const objectStore: CsvObjectStore | undefined = dependencies.csvObjects;
    if (!objectStore || !source.storage_path) throw new Error("CSV import storage is unavailable.");
    assertCsvObject(await objectStore.stat({ path: source.storage_path }));
    const fetchedAt = nowIso(dependencies);
    let batch: IntegrationRecordEnvelope[] = [];
    let mappingValidated = false;
    for await (const row of parseCsvRows(await objectStore.open({ path: source.storage_path }))) {
      if (!mappingValidated) {
        assertMapping(row, source.column_mapping);
        mappingValidated = true;
      }
      recordsReceived += 1;
      batch.push({
        schemaVersion: source.schema_version,
        organizationId: payload.organizationId,
        source: { kind: "data_source", id: source.id },
        externalRecordId: `row-${recordsReceived}`,
        recordType: "csv_import.row",
        fetchedAt,
        payload: { values: row, columnMapping: source.column_mapping },
      });
      if (batch.length === MAX_BATCH_SIZE) {
        const result = await handoffBatch({
          dependencies,
          organizationId: payload.organizationId,
          ingestionRunId: payload.ingestionRunId,
          idempotencyKey: `${payload.idempotencyKey}:batch:${recordsReceived / MAX_BATCH_SIZE}`,
          records: batch,
        });
        recordsAccepted += result.accepted;
        recordsRejected += result.rejected;
        batch = [];
      }
    }
    if (!mappingValidated) throw new Error("CSV upload has no usable rows.");
    if (batch.length) {
      const result = await handoffBatch({
        dependencies,
        organizationId: payload.organizationId,
        ingestionRunId: payload.ingestionRunId,
        idempotencyKey: `${payload.idempotencyKey}:batch:${Math.ceil(recordsReceived / MAX_BATCH_SIZE)}`,
        records: batch,
      });
      recordsAccepted += result.accepted;
      recordsRejected += result.rejected;
    }
    await complete(payload, dependencies, {
      status: recordsRejected ? "partially_succeeded" : "succeeded",
      recordsReceived,
      recordsAccepted,
      recordsRejected,
    });
  } catch (error) {
    const normalized = normalizedError(error);
    await complete(payload, dependencies, {
      status: "failed",
      recordsReceived,
      recordsAccepted,
      recordsRejected,
      normalizedErrorCode: normalized.code,
      safeErrorSummary: normalized.message,
    });
    throw normalized;
  }
}
