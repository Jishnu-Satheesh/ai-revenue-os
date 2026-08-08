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

/** Appends a freshness observation; previous health checks remain authoritative history. */
export async function runCheckFreshness(
  input: unknown,
  dependencies: IntegrationWorkerDependencies,
) {
  const payload = parseConnectionTaskPayload("integration.check-freshness", input);
  let connection;
  let staleAfterMinutes;
  try {
    ({ connection, staleAfterMinutes } = await loadValidatedConnection(payload, dependencies));
  } catch (error) {
    const normalized = normalizedError(error);
    await persistPreflightFailure(payload, dependencies, normalized);
    throw normalized;
  }
  const begin = await beginOrCancel(payload, dependencies);
  if (begin.outcome !== "acquired") return;
  try {
    await assertActiveExecutionLease(payload, dependencies, begin.claimToken);
    const now = new Date(nowIso(dependencies));
    const threshold = staleAfterMinutes * 60 * 1_000;
    const lastSync = connection.last_successful_sync_at
      ? new Date(connection.last_successful_sync_at).getTime()
      : 0;
    const stale = !lastSync || now.getTime() - lastSync > threshold;
    await appendConnectionHealth(payload, dependencies, begin.claimToken, {
      checkType: "freshness",
      outcome: stale ? "warning" : "passed",
      safeDetail: stale
        ? "The connection has not synchronized within its freshness target."
        : "The connection is within its freshness target.",
    });
    await complete(payload, dependencies, begin.claimToken, {
      status: stale ? "partially_succeeded" : "succeeded",
    });
  } catch (error) {
    const normalized = normalizedError(error);
    if (normalized.metadata.staleLease) return;
    await appendConnectionHealth(payload, dependencies, begin.claimToken, {
      checkType: "freshness",
      outcome: "failed",
      normalizedErrorCode: normalized.code,
      safeDetail: normalized.message,
    });
    await requeueOrFail(payload, dependencies, normalized, begin.claimToken);
    throw normalized;
  }
}
