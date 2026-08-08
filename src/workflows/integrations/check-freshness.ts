import {
  appendConnectionHealth,
  beginOrCancel,
  complete,
  loadValidatedConnection,
  normalizedError,
  nowIso,
  parseConnectionTaskPayload,
  type IntegrationWorkerDependencies,
} from "@/workflows/integrations/contracts";

/** Appends a freshness observation; previous health checks remain authoritative history. */
export async function runCheckFreshness(
  input: unknown,
  dependencies: IntegrationWorkerDependencies,
) {
  const payload = parseConnectionTaskPayload("integration.check-freshness", input);
  const connection = await loadValidatedConnection(payload, dependencies);
  const cancelled = await beginOrCancel(payload, dependencies);
  if (cancelled) return;
  try {
    const now = new Date(nowIso(dependencies));
    const threshold = 65 * 60 * 1_000;
    const lastSync = connection.last_successful_sync_at
      ? new Date(connection.last_successful_sync_at).getTime()
      : 0;
    const stale = !lastSync || now.getTime() - lastSync > threshold;
    await appendConnectionHealth(payload, dependencies, {
      checkType: "freshness",
      outcome: stale ? "warning" : "passed",
      safeDetail: stale
        ? "The connection has not synchronized within its freshness target."
        : "The connection is within its freshness target.",
    });
    await complete(payload, dependencies, { status: stale ? "partially_succeeded" : "succeeded" });
  } catch (error) {
    const normalized = normalizedError(error);
    await appendConnectionHealth(payload, dependencies, {
      checkType: "freshness",
      outcome: "failed",
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
