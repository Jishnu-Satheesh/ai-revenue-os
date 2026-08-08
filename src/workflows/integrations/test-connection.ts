import {
  appendConnectionHealth,
  beginOrCancel,
  complete,
  loadValidatedConnection,
  normalizedError,
  nowIso,
  parseConnectionTaskPayload,
  resolveValidatedAdapter,
  type IntegrationWorkerDependencies,
} from "@/workflows/integrations/contracts";

/** Executes a connection check after the task payload and tenant source are revalidated. */
export async function runTestConnection(
  input: unknown,
  dependencies: IntegrationWorkerDependencies,
) {
  const payload = parseConnectionTaskPayload("integration.test-connection", input);
  const startedAt = Date.now();
  const connection = await loadValidatedConnection(payload, dependencies);
  const cancelled = await beginOrCancel(payload, dependencies);
  if (cancelled) return;
  const adapter = resolveValidatedAdapter(connection, payload, dependencies);
  try {
    const result = await adapter.testConnection({
      organizationId: payload.organizationId,
      connectionId: payload.connectionId,
      adapterVersion: payload.adapterVersion,
      correlationId: payload.correlationId,
    });
    await appendConnectionHealth(payload, dependencies, {
      checkType: "connectivity",
      outcome: result.outcome,
      latencyMs: Date.now() - startedAt,
      safeDetail: result.safeDetail,
    });
    await complete(payload, dependencies, {
      status: result.outcome === "passed" ? "succeeded" : "partially_succeeded",
    });
  } catch (error) {
    const normalized = normalizedError(error);
    await appendConnectionHealth(payload, dependencies, {
      checkType: normalized.code === "AUTHENTICATION_FAILED" ? "authentication" : "connectivity",
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

export { nowIso };
