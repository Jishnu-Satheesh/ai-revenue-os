import {
  appendConnectionHealth,
  assertActiveExecutionLease,
  beginOrCancel,
  complete,
  loadValidatedConnection,
  normalizedError,
  nowIso,
  parseConnectionTaskPayload,
  persistPreflightFailure,
  requeueOrFail,
  type IntegrationWorkerDependencies,
} from "@/workflows/integrations/contracts";
import type { ProviderAdapter } from "@/domain/integrations/types";

/** Executes a connection check after the task payload and tenant source are revalidated. */
export async function runTestConnection(
  input: unknown,
  dependencies: IntegrationWorkerDependencies,
) {
  const payload = parseConnectionTaskPayload("integration.test-connection", input);
  const startedAt = Date.now();
  let adapter: ProviderAdapter;
  try {
    ({ adapter } = await loadValidatedConnection(payload, dependencies));
  } catch (error) {
    const normalized = normalizedError(error);
    await persistPreflightFailure(payload, dependencies, normalized);
    throw normalized;
  }
  const begin = await beginOrCancel(payload, dependencies);
  if (begin.outcome !== "acquired") return;
  try {
    await assertActiveExecutionLease(payload, dependencies, begin.claimToken);
    const result = await adapter.testConnection({
      organizationId: payload.organizationId,
      connectionId: payload.connectionId,
      adapterVersion: payload.adapterVersion,
      correlationId: payload.correlationId,
    });
    await assertActiveExecutionLease(payload, dependencies, begin.claimToken);
    await appendConnectionHealth(payload, dependencies, begin.claimToken, {
      checkType: "connectivity",
      outcome: result.outcome,
      latencyMs: Date.now() - startedAt,
      safeDetail: result.safeDetail,
    });
    const status =
      result.outcome === "passed"
        ? "succeeded"
        : result.outcome === "warning"
          ? "partially_succeeded"
          : "failed";
    await complete(payload, dependencies, begin.claimToken, {
      status,
      normalizedErrorCode: result.outcome === "failed" ? "UNKNOWN_PROVIDER_ERROR" : null,
      safeErrorSummary:
        result.outcome === "failed" ? (result.safeDetail ?? "The connection test failed.") : null,
    });
  } catch (error) {
    const normalized = normalizedError(error);
    if (normalized.metadata.staleLease) return;
    await appendConnectionHealth(payload, dependencies, begin.claimToken, {
      checkType: normalized.code === "AUTHENTICATION_FAILED" ? "authentication" : "connectivity",
      outcome: "failed",
      latencyMs: Date.now() - startedAt,
      normalizedErrorCode: normalized.code,
      safeDetail: normalized.message,
    });
    await requeueOrFail(payload, dependencies, normalized, begin.claimToken);
    throw normalized;
  }
}

export { nowIso };
