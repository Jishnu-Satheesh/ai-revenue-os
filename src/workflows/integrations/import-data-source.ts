import { once } from "node:events";
import { createHash } from "node:crypto";

import { parse } from "csv-parse";

import type { IntegrationRecordEnvelope } from "@/domain/integrations/schemas";
import {
  beginOrCancel,
  complete,
  loadValidatedDataSource,
  normalizedError,
  nowIso,
  parseDataSourceTaskPayload,
  persistPreflightFailure,
  requeueOrFail,
  type CsvObjectStore,
  type IntegrationWorkerDependencies,
} from "@/workflows/integrations/contracts";

const MAX_CSV_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_SIZE = 500;

export function batchIdempotencyKey(key: string, batchNumber: number): string {
  const suffix = `:csv:${batchNumber}`;
  const digest = createHash("sha256").update(key, "utf8").digest("base64url").slice(0, 16);
  return `${key.slice(0, 200 - suffix.length - digest.length - 1)}:${digest}${suffix}`;
}

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
    (metadata.encoding !== null && metadata.encoding.toLowerCase() !== "utf-8")
  ) {
    throw new Error("CSV object metadata is invalid.");
  }
}

async function* parseCsvRows(
  stream: AsyncIterable<Uint8Array>,
): AsyncGenerator<Record<string, string>> {
  const parser = parse({
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: true,
    max_record_size: 64 * 1024,
  });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  const write = (async () => {
    try {
      for await (const chunk of stream) {
        totalBytes += chunk.byteLength;
        if (totalBytes > MAX_CSV_BYTES) throw new Error("CSV file exceeds the allowed size.");
        const decoded = decoder.decode(chunk, { stream: true });
        if (decoded && !parser.write(decoded)) await once(parser, "drain");
      }
      const tail = decoder.decode();
      if (tail && !parser.write(tail)) await once(parser, "drain");
      parser.end();
    } catch (error) {
      parser.destroy(error as Error);
      throw error;
    }
  })();
  try {
    for await (const record of parser) yield record as Record<string, string>;
    await write;
  } catch (error) {
    await write.catch(() => undefined);
    throw error;
  }
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

function assertTenantStoragePath(path: string, organizationId: string, dataSourceId: string): void {
  const segments = path.split("/");
  if (
    segments.length !== 4 ||
    segments[0] !== organizationId ||
    segments[1] !== dataSourceId ||
    segments.some((segment) => !segment)
  ) {
    throw new Error("CSV storage path is outside the validated tenant source.");
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
  let source;
  try {
    source = await loadValidatedDataSource(payload, dependencies);
  } catch (error) {
    const normalized = normalizedError(error);
    await persistPreflightFailure(payload, dependencies, normalized);
    throw normalized;
  }
  const cancelled = await beginOrCancel(payload, dependencies);
  if (cancelled) return;
  let recordsReceived = 0;
  let recordsAccepted = 0;
  let recordsRejected = 0;
  try {
    const objectStore: CsvObjectStore | undefined = dependencies.csvObjects;
    if (!objectStore || !source.storage_path) throw new Error("CSV import storage is unavailable.");
    assertTenantStoragePath(source.storage_path, payload.organizationId, source.id);
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
          idempotencyKey: batchIdempotencyKey(
            payload.idempotencyKey,
            recordsReceived / MAX_BATCH_SIZE,
          ),
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
        idempotencyKey: batchIdempotencyKey(
          payload.idempotencyKey,
          Math.ceil(recordsReceived / MAX_BATCH_SIZE),
        ),
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
    if (normalized.metadata.staleLease || normalized.metadata.handoffInProgress) return;
    await requeueOrFail(payload, dependencies, normalized, {
      recordsReceived,
      recordsAccepted,
      recordsRejected,
    });
    throw normalized;
  }
}
