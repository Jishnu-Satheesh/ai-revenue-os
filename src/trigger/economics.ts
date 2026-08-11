import { logger, queue, schemaTask } from "@trigger.dev/sdk";
import { z } from "zod";

import { createIntegrationWorkerServiceClient } from "@/lib/supabase/service";
import {
  createEconomicsCatalogRepository,
  createEconomicsLedgerStore,
} from "@/modules/economics/infrastructure/repository";
import {
  createMetricIngestionWindowRepository,
  createMetricSeriesRepository,
} from "@/modules/metrics/infrastructure/repository";
import {
  runRecomputeLedger,
  type RecomputeLedgerDependencies,
} from "@/workflows/economics/recompute-ledger";

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

/**
 * One recompute per organization at a time, any number of organizations at
 * once. Triggered with the organization as the concurrency key, so two imports
 * finishing together queue behind each other instead of interleaving upserts
 * over the same periods.
 */
export const economicsLedgerQueue = queue({
  name: "economics-ledger",
  concurrencyLimit: 1,
});

const payloadSchema = z.object({
  organizationId: z.string().uuid(),
  ingestionRunId: z.string().uuid(),
  reconciliationToleranceMinor: z.number().int().nonnegative().optional(),
});

function createDependencies(): RecomputeLedgerDependencies {
  const supabase = createIntegrationWorkerServiceClient();

  return {
    metrics: createMetricSeriesRepository(supabase),
    windows: createMetricIngestionWindowRepository(supabase),
    catalog: createEconomicsCatalogRepository(supabase),
    ledger: createEconomicsLedgerStore(supabase),
    logger: {
      info: (message, context) => logger.info(message, context),
      warn: (message, context) => logger.warn(message, context),
    },
  };
}

export const economicsRecomputeLedgerTask = schemaTask({
  id: "economics.recompute-ledger",
  schema: payloadSchema,
  queue: economicsLedgerQueue,
  retry,
  maxDuration: 600,
  run: async (payload) => runRecomputeLedger(payload, createDependencies()),
});
