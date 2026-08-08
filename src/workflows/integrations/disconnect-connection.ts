import {
  appendConnectionHealth,
  beginOrCancel,
  complete,
  loadValidatedConnection,
  normalizedError,
  parseConnectionTaskPayload,
  requeueOrFail,
  type IntegrationWorkerDependencies,
} from "@/workflows/integrations/contracts";

/** Revokes a credential after the synchronous disconnect transaction has disabled capabilities. */
export async function runDisconnectConnection(
  input: unknown,
  dependencies: IntegrationWorkerDependencies,
) {
  const payload = parseConnectionTaskPayload("integration.disconnect-connection", input);
  const { connection } = await loadValidatedConnection(payload, dependencies, {
    allowInactive: true,
  });
  const cancelled = await beginOrCancel(payload, dependencies);
  if (cancelled) return;
  try {
    await dependencies.worker.scheduleConnection({
      organizationId: payload.organizationId,
      connectionId: payload.connectionId,
      nextScheduledSyncAt: null,
    });
    if (connection.connection_mode !== "fixture") {
      if (!dependencies.credentialCleanup) throw new Error("Credential cleanup is unavailable.");
      await dependencies.credentialCleanup.revoke({
        organizationId: payload.organizationId,
        connectionId: payload.connectionId,
      });
    }
    await dependencies.worker.setConnectionStatus({
      organizationId: payload.organizationId,
      connectionId: payload.connectionId,
      status: "revoked",
    });
    await appendConnectionHealth(payload, dependencies, {
      checkType: "authentication",
      outcome: "passed",
      safeDetail: "Credential cleanup completed.",
    });
    await complete(payload, dependencies, { status: "succeeded" });
  } catch (error) {
    const normalized = normalizedError(error);
    // The synchronous disconnect already disabled grants. This appends a recovery warning only.
    await appendConnectionHealth(payload, dependencies, {
      checkType: "authentication",
      outcome: "warning",
      normalizedErrorCode: normalized.code,
      safeDetail: "Credential cleanup requires a retry; capabilities remain disabled.",
    });
    await requeueOrFail(payload, dependencies, normalized);
    throw normalized;
  }
}
