import {
  appendConnectionHealth,
  beginOrCancel,
  complete,
  loadValidatedConnection,
  normalizedError,
  parseConnectionTaskPayload,
  resolveValidatedAdapter,
  validateEnvelopes,
  type IntegrationWorkerDependencies,
} from "@/workflows/integrations/contracts";

/** Runs one bounded provider sync and hands validated envelopes to Data Ingestion exactly once. */
export async function runSyncConnection(
  input: unknown,
  dependencies: IntegrationWorkerDependencies,
) {
  const payload = parseConnectionTaskPayload("integration.sync-connection", input);
  const startedAt = Date.now();
  const connection = await loadValidatedConnection(payload, dependencies);
  const cancelled = await beginOrCancel(payload, dependencies);
  if (cancelled) return;
  const adapter = resolveValidatedAdapter(connection, payload, dependencies);
  try {
    const records = validateEnvelopes(
      await adapter.sync({
        organizationId: payload.organizationId,
        connectionId: payload.connectionId,
        ingestionRunId: payload.ingestionRunId,
        idempotencyKey: payload.idempotencyKey,
        adapterVersion: payload.adapterVersion,
        correlationId: payload.correlationId,
      }),
    );
    const handoff = await dependencies.sink.accept({
      organizationId: payload.organizationId,
      ingestionRunId: payload.ingestionRunId,
      idempotencyKey: payload.idempotencyKey,
      records,
    });
    const status = handoff.rejected > 0 ? "partially_succeeded" : "succeeded";
    await appendConnectionHealth(payload, dependencies, {
      checkType: "sync",
      outcome: handoff.rejected > 0 ? "warning" : "passed",
      latencyMs: Date.now() - startedAt,
      safeDetail:
        handoff.rejected > 0
          ? "Some provider records were rejected during validation."
          : "Synchronization completed.",
    });
    await complete(payload, dependencies, {
      status,
      recordsReceived: records.length,
      recordsAccepted: handoff.accepted,
      recordsRejected: handoff.rejected,
    });
  } catch (error) {
    const normalized = normalizedError(error);
    await appendConnectionHealth(payload, dependencies, {
      checkType: "sync",
      outcome: "failed",
      latencyMs: Date.now() - startedAt,
      normalizedErrorCode: normalized.code,
      safeDetail: normalized.message,
    });
    await complete(payload, dependencies, {
      status: "failed",
      normalizedErrorCode: normalized.code,
      safeErrorSummary: normalized.message,
    });
    throw normalized;
  }
}
