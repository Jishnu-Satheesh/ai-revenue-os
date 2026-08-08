import { task } from "@trigger.dev/sdk";

import { createProviderRegistry } from "@/domain/integrations/provider-registry";
import { createIntegrationWorkerServiceClient } from "@/lib/supabase/service";
import { createAuthenticatedIntegrationRepository } from "@/modules/integrations/infrastructure/repository";
import {
  createAcknowledgingDataIngestionPort,
  createValidatedIngestionSink,
} from "@/modules/integrations/infrastructure/ingestion-sink";
import { googleBusinessProfileDefinition } from "@/modules/integrations/providers/google-business-profile/definition";
import { createGoogleBusinessProfileFixtureAdapter } from "@/modules/integrations/providers/google-business-profile/fixture-adapter";
import { assertIntegrationHubEnabled } from "@/modules/integrations/application/feature-access";
import { runCheckFreshness } from "@/workflows/integrations/check-freshness";
import { runDisconnectConnection } from "@/workflows/integrations/disconnect-connection";
import { runImportDataSource } from "@/workflows/integrations/import-data-source";
import { runSyncConnection } from "@/workflows/integrations/sync-connection";
import { runTestConnection } from "@/workflows/integrations/test-connection";
import type { IntegrationWorkerDependencies } from "@/workflows/integrations/contracts";

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
function createWorkerDependencies(): IntegrationWorkerDependencies {
  const supabase = createIntegrationWorkerServiceClient();
  const { repository, workerRepository } = createAuthenticatedIntegrationRepository({ supabase });
  const providers = createProviderRegistry(
    [googleBusinessProfileDefinition],
    [createGoogleBusinessProfileFixtureAdapter()],
  );
  const sink = createValidatedIngestionSink({
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
  return {
    worker: workerRepository,
    providers,
    sink,
    findDataSource: (input) => repository.findDataSource(input),
    assertFeatureEnabled: assertIntegrationHubEnabled,
  };
}

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
