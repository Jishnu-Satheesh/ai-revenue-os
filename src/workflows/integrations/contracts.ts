import { z } from "zod";

import { IntegrationError, normalizeProviderError } from "@/domain/integrations/errors";
import {
  integrationRecordEnvelopeSchema,
  type IntegrationRecordEnvelope,
} from "@/domain/integrations/schemas";
import type { IngestionSink, ProviderAdapter } from "@/domain/integrations/types";
import type { ProviderRegistry } from "@/domain/integrations/provider-registry";
import type { IntegrationTaskName } from "@/modules/integrations/application/service";
import type {
  IntegrationConnectionRow,
  IntegrationDataSourceRow,
  IntegrationWorkerRepository,
} from "@/modules/integrations/application/ports";

const idSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(16).max(200);
const baseTaskPayloadSchema = z.object({
  taskName: z.enum([
    "integration.test-connection",
    "integration.sync-connection",
    "integration.import-data-source",
    "integration.disconnect-connection",
    "integration.check-freshness",
  ]),
  organizationId: idSchema,
  connectionId: idSchema.optional(),
  dataSourceId: idSchema.optional(),
  ingestionRunId: idSchema,
  correlationId: idSchema,
  idempotencyKey: idempotencyKeySchema,
  adapterVersion: z.string().trim().min(1).max(80).optional(),
});

const connectionTaskPayloadSchema = baseTaskPayloadSchema
  .extend({
    connectionId: idSchema,
    dataSourceId: z.undefined().optional(),
    adapterVersion: z.string().trim().min(1).max(80),
  })
  .strict();

const dataSourceTaskPayloadSchema = baseTaskPayloadSchema
  .extend({
    dataSourceId: idSchema,
    connectionId: z.undefined().optional(),
    adapterVersion: z.undefined().optional(),
  })
  .strict();

export type ConnectionTaskPayload = z.infer<typeof connectionTaskPayloadSchema>;
export type DataSourceTaskPayload = z.infer<typeof dataSourceTaskPayloadSchema>;

export type CsvObjectStore = {
  stat(input: { path: string }): Promise<{
    contentType: string | null;
    size: number;
    encoding: string | null;
  }>;
  open(input: { path: string }): Promise<AsyncIterable<Uint8Array>>;
};

export type IntegrationWorkerDependencies = {
  worker: IntegrationWorkerRepository;
  providers: Pick<ProviderRegistry, "getAdapter" | "getDefinition">;
  sink: IngestionSink;
  findDataSource(input: {
    organizationId: string;
    dataSourceId: string;
  }): Promise<IntegrationDataSourceRow | null>;
  assertFeatureEnabled?: (organizationId: string) => void;
  isCancelled?: (input: { organizationId: string; ingestionRunId: string }) => Promise<boolean>;
  now?: () => Date;
  csvObjects?: CsvObjectStore;
  credentialCleanup?: {
    revoke(input: { organizationId: string; connectionId: string }): Promise<void>;
  };
};

export type WorkerBeginResult =
  | { outcome: "acquired"; claimToken: string }
  | { outcome: "in_progress" }
  | { outcome: "cancelled" };

function taskValidationError(): never {
  throw new IntegrationError("VALIDATION_ERROR", "The integration task payload is invalid.", false);
}

export function parseConnectionTaskPayload(
  taskName: Extract<IntegrationTaskName, `integration.${string}`>,
  input: unknown,
): ConnectionTaskPayload {
  const result = connectionTaskPayloadSchema.safeParse(input);
  if (!result.success || result.data.taskName !== taskName) return taskValidationError();
  return result.data;
}

export function parseDataSourceTaskPayload(input: unknown): DataSourceTaskPayload {
  const result = dataSourceTaskPayloadSchema.safeParse(input);
  if (!result.success || result.data.taskName !== "integration.import-data-source") {
    return taskValidationError();
  }
  return result.data;
}

export function nowIso(dependencies: IntegrationWorkerDependencies): string {
  return (dependencies.now ?? (() => new Date()))().toISOString();
}

export async function loadValidatedConnection(
  payload: ConnectionTaskPayload,
  dependencies: IntegrationWorkerDependencies,
  options: { allowInactive?: boolean } = {},
): Promise<{
  connection: IntegrationConnectionRow;
  adapter: ProviderAdapter;
  staleAfterMinutes: number;
}> {
  dependencies.assertFeatureEnabled?.(payload.organizationId);
  const connection = await dependencies.worker.loadGrantRecomputationInput({
    organizationId: payload.organizationId,
    connectionId: payload.connectionId,
  });
  if (
    connection.organization_id !== payload.organizationId ||
    connection.id !== payload.connectionId ||
    connection.adapter_version !== payload.adapterVersion
  ) {
    throw new IntegrationError(
      "TENANT_SCOPE_ERROR",
      "The integration connection is not available for this task.",
      false,
    );
  }
  if (
    !options.allowInactive &&
    (connection.status === "disconnected" || connection.status === "revoked")
  ) {
    throw new IntegrationError("CONFLICT", "The integration connection is inactive.", false);
  }
  const definition = dependencies.providers.getDefinition(connection.provider_key);
  if (definition.adapterVersion !== payload.adapterVersion) {
    throw new IntegrationError("VALIDATION_ERROR", "The provider definition is invalid.", false);
  }
  const adapter = dependencies.providers.getAdapter(
    connection.provider_key,
    payload.adapterVersion,
  );
  if (
    adapter.providerKey !== connection.provider_key ||
    adapter.adapterVersion !== payload.adapterVersion
  ) {
    throw new IntegrationError("VALIDATION_ERROR", "The provider adapter is invalid.", false);
  }
  return { connection, adapter, staleAfterMinutes: definition.staleAfterMinutes };
}

export async function loadValidatedDataSource(
  payload: DataSourceTaskPayload,
  dependencies: IntegrationWorkerDependencies,
): Promise<IntegrationDataSourceRow> {
  dependencies.assertFeatureEnabled?.(payload.organizationId);
  const source = await dependencies.findDataSource({
    organizationId: payload.organizationId,
    dataSourceId: payload.dataSourceId,
  });
  if (
    !source ||
    source.organization_id !== payload.organizationId ||
    source.id !== payload.dataSourceId
  ) {
    throw new IntegrationError(
      "TENANT_SCOPE_ERROR",
      "The integration data source is not available for this task.",
      false,
    );
  }
  if (source.status === "archived" || source.source_type !== "csv_import") {
    throw new IntegrationError("CONFLICT", "The data source cannot be imported.", false);
  }
  return source;
}

export async function beginOrCancel(
  payload: ConnectionTaskPayload | DataSourceTaskPayload,
  dependencies: IntegrationWorkerDependencies,
): Promise<WorkerBeginResult> {
  const lease = await dependencies.worker.acquireExecutionLease({
    organizationId: payload.organizationId,
    ingestionRunId: payload.ingestionRunId,
    idempotencyKey: payload.idempotencyKey,
  });
  if (lease.outcome === "in_progress") return lease;
  try {
    try {
      await dependencies.worker.markRunRunning({
        organizationId: payload.organizationId,
        ingestionRunId: payload.ingestionRunId,
        claimToken: lease.claimToken,
        startedAt: nowIso(dependencies),
      });
    } catch (error) {
      const normalized = normalizedError(error);
      if (normalized.code !== "CONFLICT") throw normalized;
      await dependencies.worker.resumeLeasedRun({
        organizationId: payload.organizationId,
        ingestionRunId: payload.ingestionRunId,
        claimToken: lease.claimToken,
      });
    }
    const cancelled = await dependencies.isCancelled?.({
      organizationId: payload.organizationId,
      ingestionRunId: payload.ingestionRunId,
    });
    if (!cancelled) return lease;
    await dependencies.worker.completeRun({
      organizationId: payload.organizationId,
      ingestionRunId: payload.ingestionRunId,
      claimToken: lease.claimToken,
      status: "cancelled",
      recordsReceived: 0,
      recordsAccepted: 0,
      recordsRejected: 0,
      completedAt: nowIso(dependencies),
      normalizedErrorCode: "CANCELLED",
      safeErrorSummary: "The integration task was cancelled.",
    });
    return { outcome: "cancelled" };
  } catch (error) {
    const normalized = normalizedError(error);
    try {
      await requeueOrFail(payload, dependencies, normalized, lease.claimToken);
    } catch {
      // A missing CAS boundary remains a hard failure; never emulate the transition.
    }
    throw normalized;
  }
}

/** Persists a validated preflight error only after all source checks have completed. */
export async function persistPreflightFailure(
  payload: ConnectionTaskPayload | DataSourceTaskPayload,
  dependencies: IntegrationWorkerDependencies,
  error: IntegrationError,
): Promise<void> {
  const lease = await dependencies.worker.acquireExecutionLease({
    organizationId: payload.organizationId,
    ingestionRunId: payload.ingestionRunId,
    idempotencyKey: payload.idempotencyKey,
  });
  if (lease.outcome === "in_progress") return;
  try {
    try {
      await dependencies.worker.markRunRunning({
        organizationId: payload.organizationId,
        ingestionRunId: payload.ingestionRunId,
        claimToken: lease.claimToken,
        startedAt: nowIso(dependencies),
      });
    } catch (transitionError) {
      const normalized = normalizedError(transitionError);
      if (normalized.code !== "CONFLICT") throw normalized;
      await dependencies.worker.resumeLeasedRun({
        organizationId: payload.organizationId,
        ingestionRunId: payload.ingestionRunId,
        claimToken: lease.claimToken,
      });
    }
    await requeueOrFail(payload, dependencies, error, lease.claimToken);
  } catch {
    // Preserve the original validated error; an unavailable CAS boundary must not be bypassed.
  }
}

export async function complete(
  payload: ConnectionTaskPayload | DataSourceTaskPayload,
  dependencies: IntegrationWorkerDependencies,
  claimToken: string,
  input: {
    status: "succeeded" | "partially_succeeded" | "failed" | "cancelled";
    recordsReceived?: number;
    recordsAccepted?: number;
    recordsRejected?: number;
    normalizedErrorCode?: string | null;
    safeErrorSummary?: string | null;
  },
): Promise<void> {
  await dependencies.worker.completeRun({
    organizationId: payload.organizationId,
    ingestionRunId: payload.ingestionRunId,
    claimToken,
    status: input.status,
    recordsReceived: input.recordsReceived ?? 0,
    recordsAccepted: input.recordsAccepted ?? 0,
    recordsRejected: input.recordsRejected ?? 0,
    completedAt: nowIso(dependencies),
    normalizedErrorCode: input.normalizedErrorCode,
    safeErrorSummary: input.safeErrorSummary,
  });
}

export async function requeueOrFail(
  payload: ConnectionTaskPayload | DataSourceTaskPayload,
  dependencies: IntegrationWorkerDependencies,
  error: IntegrationError,
  claimToken: string,
  counts: { recordsReceived?: number; recordsAccepted?: number; recordsRejected?: number } = {},
): Promise<void> {
  if (error.retryable) {
    await dependencies.worker.requeueRun({
      organizationId: payload.organizationId,
      ingestionRunId: payload.ingestionRunId,
      claimToken,
      recordsReceived: counts.recordsReceived ?? 0,
      recordsAccepted: counts.recordsAccepted ?? 0,
      recordsRejected: counts.recordsRejected ?? 0,
      normalizedErrorCode: error.code,
      safeErrorSummary: error.message,
    });
    return;
  }
  await complete(payload, dependencies, claimToken, {
    status: "failed",
    recordsReceived: counts.recordsReceived,
    recordsAccepted: counts.recordsAccepted,
    recordsRejected: counts.recordsRejected,
    normalizedErrorCode: error.code,
    safeErrorSummary: error.message,
  });
}

export function normalizedError(error: unknown): IntegrationError {
  if (error instanceof IntegrationError) return error;
  return normalizeProviderError({ cause: error });
}

export async function appendConnectionHealth(
  payload: ConnectionTaskPayload,
  dependencies: IntegrationWorkerDependencies,
  input: {
    checkType: "connectivity" | "authentication" | "freshness" | "sync";
    outcome: "passed" | "warning" | "failed";
    latencyMs?: number | null;
    normalizedErrorCode?: string | null;
    safeDetail?: string | null;
  },
): Promise<void> {
  await dependencies.worker.appendHealthCheck({
    organization_id: payload.organizationId,
    connection_id: payload.connectionId,
    ingestion_run_id: payload.ingestionRunId,
    check_type: input.checkType,
    outcome: input.outcome,
    latency_ms: input.latencyMs ?? null,
    normalized_error_code: input.normalizedErrorCode ?? null,
    safe_detail: input.safeDetail ?? null,
    checked_at: nowIso(dependencies),
    correlation_id: payload.correlationId,
  });
}

export function validateEnvelopes(input: unknown): IntegrationRecordEnvelope[] {
  const result = z.array(integrationRecordEnvelopeSchema).max(1_000).safeParse(input);
  if (!result.success) {
    throw new IntegrationError("VALIDATION_ERROR", "The provider returned invalid records.", false);
  }
  return result.data;
}
