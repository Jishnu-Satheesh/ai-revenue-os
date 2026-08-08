import { task, tasks } from "@trigger.dev/sdk";

import { createProviderRegistry } from "@/domain/integrations/provider-registry";
import { createIntegrationWorkerServiceClient } from "@/lib/supabase/service";
import {
  createAuthenticatedIntegrationRepository,
  createSupabaseIntegrationRunTransitionPort,
} from "@/modules/integrations/infrastructure/repository";
import {
  createAcknowledgingDataIngestionPort,
  createDurableIngestionSink,
  createValidatedIngestionSink,
} from "@/modules/integrations/infrastructure/ingestion-sink";
import type { DurableIngestionHandoffLedger } from "@/modules/integrations/infrastructure/ingestion-sink";
import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";
import { createGoogleBusinessProfileFixtureAdapter } from "@/modules/integrations/providers/google-business-profile/fixture-adapter";
import { assertIntegrationHubEnabled } from "@/modules/integrations/application/feature-access";
import { runCheckFreshness } from "@/workflows/integrations/check-freshness";
import { runDisconnectConnection } from "@/workflows/integrations/disconnect-connection";
import { runImportDataSource } from "@/workflows/integrations/import-data-source";
import { runSyncConnection } from "@/workflows/integrations/sync-connection";
import { runTestConnection } from "@/workflows/integrations/test-connection";
import {
  parseConnectionTaskPayload,
  parseDataSourceTaskPayload,
  type CsvObjectStore,
  type IntegrationWorkerDependencies,
} from "@/workflows/integrations/contracts";
import { IntegrationError } from "@/domain/integrations/errors";

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

/**
 * Constructs dependencies only inside Trigger's node runtime. The repository
 * fails closed until the atomic worker transition RPC is deployed.
 */
function assertStoragePath(path: string): void {
  const segments = path.split("/");
  if (segments.length !== 4 || segments.some((segment) => !segment)) {
    throw new IntegrationError("VALIDATION_ERROR", "The import storage path is invalid.", false);
  }
}

function asAsyncIterable(stream: ReadableStream<Uint8Array>): AsyncIterable<Uint8Array> {
  return {
    async *[Symbol.asyncIterator]() {
      const reader = stream.getReader();
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) return;
          yield next.value;
        }
      } finally {
        reader.releaseLock();
      }
    },
  };
}

function createCsvObjectStore(
  supabase: ReturnType<typeof createIntegrationWorkerServiceClient>,
): CsvObjectStore {
  return {
    async stat({ path }) {
      assertStoragePath(path);
      const segments = path.split("/");
      const folder = segments.slice(0, 3).join("/");
      const filename = segments[3];
      const listed = await supabase.storage.from("integration-imports").list(folder, {
        limit: 2,
        search: filename,
      });
      if (listed.error)
        throw new IntegrationError("NOT_FOUND", "The import file is unavailable.", false);
      const file = listed.data.find((candidate) => candidate.name === filename);
      const metadata = file?.metadata as { size?: number; mimetype?: string } | undefined;
      return {
        contentType: metadata?.mimetype ?? null,
        size: metadata?.size ?? 0,
        encoding: null,
      };
    },
    async open({ path }) {
      assertStoragePath(path);
      const result = await supabase.storage.from("integration-imports").download(path);
      if (result.error)
        throw new IntegrationError("NOT_FOUND", "The import file is unavailable.", false);
      return asAsyncIterable(result.data.stream());
    },
  };
}

function createWorkerDependencies(): IntegrationWorkerDependencies {
  const supabase = createIntegrationWorkerServiceClient();
  const { repository, workerRepository } = createAuthenticatedIntegrationRepository({
    supabase,
    runTransitions: createSupabaseIntegrationRunTransitionPort(supabase),
  });
  const providers = createProviderRegistry(
    [googleBusinessProfileDefinition],
    [createGoogleBusinessProfileFixtureAdapter()],
  );
  const validatedSink = createValidatedIngestionSink({
    handoff: createAcknowledgingDataIngestionPort(),
    sourceResolver: {
      async resolve({ organizationId, ingestionRunId }) {
        const run = await repository.findRun({ organizationId, ingestionRunId });
        if (!run) return null;
        if (run.connection_id) return { kind: "connection" as const, id: run.connection_id };
        if (run.data_source_id) return { kind: "data_source" as const, id: run.data_source_id };
        return null;
      },
    },
  });
  const rpc = supabase as unknown as {
    rpc(name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: unknown }>;
  };
  const sink = createDurableIngestionSink({
    sink: validatedSink,
    ledger: {
      async claim(input) {
        const result = await rpc.rpc("claim_integration_ingestion_handoff", {
          p_organization_id: input.organizationId,
          p_ingestion_run_id: input.ingestionRunId,
          p_idempotency_key: input.idempotencyKey,
          p_fingerprint: input.fingerprint,
          p_claim_token: input.claimToken,
        });
        if (result.error)
          throw new IntegrationError(
            "CONFLICT",
            "The ingestion handoff claim is unavailable.",
            false,
          );
        if (!result.data)
          throw new IntegrationError(
            "CONFLICT",
            "The ingestion handoff claim is unavailable.",
            false,
          );
        return result.data as Awaited<ReturnType<DurableIngestionHandoffLedger["claim"]>>;
      },
      async complete(input) {
        const result = await rpc.rpc("complete_integration_ingestion_handoff", {
          p_organization_id: input.organizationId,
          p_ingestion_run_id: input.ingestionRunId,
          p_idempotency_key: input.idempotencyKey,
          p_fingerprint: input.fingerprint,
          p_claim_token: input.claimToken,
          p_accepted: input.accepted,
          p_rejected: input.rejected,
          p_rejection_reasons: [...input.rejectionReasons],
        });
        if (result.error)
          throw new IntegrationError(
            "CONFLICT",
            "The ingestion handoff completion is unavailable.",
            false,
          );
        if (!result.data) return { outcome: "stale_lease" as const };
        return result.data as {
          accepted: number;
          rejected: number;
          rejectionReasons: readonly string[];
        };
      },
    },
  });
  return {
    worker: workerRepository,
    providers,
    sink,
    findDataSource: (input) => repository.findDataSource(input),
    assertFeatureEnabled: assertIntegrationHubEnabled,
    isCancelled: async ({ organizationId, ingestionRunId }) => {
      const run = await repository.findRun({ organizationId, ingestionRunId });
      return run?.status === "cancelled";
    },
    csvObjects: createCsvObjectStore(supabase),
    credentialCleanup: {
      async revoke() {
        throw new IntegrationError(
          "FEATURE_NOT_AVAILABLE",
          "OAuth credential cleanup is not configured.",
          false,
        );
      },
    },
  };
}

const cancellationParsers = {
  "integration.test-connection": (payload: unknown) =>
    parseConnectionTaskPayload("integration.test-connection", payload),
  "integration.sync-connection": (payload: unknown) =>
    parseConnectionTaskPayload("integration.sync-connection", payload),
  "integration.import-data-source": parseDataSourceTaskPayload,
  "integration.disconnect-connection": (payload: unknown) =>
    parseConnectionTaskPayload("integration.disconnect-connection", payload),
  "integration.check-freshness": (payload: unknown) =>
    parseConnectionTaskPayload("integration.check-freshness", payload),
} as const;

tasks.onCancel(async ({ task: taskId, payload }) => {
  const parsePayload = cancellationParsers[taskId as keyof typeof cancellationParsers];
  if (!parsePayload) return;
  const parsed = parsePayload(payload);
  const worker = createWorkerDependencies().worker;
  const lease = await worker.acquireExecutionLease({
    organizationId: parsed.organizationId,
    ingestionRunId: parsed.ingestionRunId,
    idempotencyKey: parsed.idempotencyKey,
  });
  if (lease.outcome !== "acquired") return;
  await worker.cancelRun({
    organizationId: parsed.organizationId,
    ingestionRunId: parsed.ingestionRunId,
    claimToken: lease.claimToken,
  });
});

export const integrationTestConnectionTask = task({
  id: "integration.test-connection",
  retry,
  maxDuration: 300,
  run: async (payload: unknown) => runTestConnection(payload, createWorkerDependencies()),
});

export const integrationSyncConnectionTask = task({
  id: "integration.sync-connection",
  retry,
  maxDuration: 300,
  run: async (payload: unknown) => runSyncConnection(payload, createWorkerDependencies()),
});

export const integrationImportDataSourceTask = task({
  id: "integration.import-data-source",
  retry,
  maxDuration: 900,
  run: async (payload: unknown) => runImportDataSource(payload, createWorkerDependencies()),
});

export const integrationDisconnectConnectionTask = task({
  id: "integration.disconnect-connection",
  retry,
  maxDuration: 300,
  run: async (payload: unknown) => runDisconnectConnection(payload, createWorkerDependencies()),
});

export const integrationCheckFreshnessTask = task({
  id: "integration.check-freshness",
  retry,
  maxDuration: 180,
  run: async (payload: unknown) => runCheckFreshness(payload, createWorkerDependencies()),
});
