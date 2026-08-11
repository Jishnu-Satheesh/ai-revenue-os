import { z } from "zod";

import { nextPeriodStart } from "@/domain/metrics/periods";
import {
  recomputeChannelEconomics,
  type RecomputeChannelEconomicsResult,
} from "@/modules/economics/application/ledger";
import type {
  EconomicsCatalogPort,
  EconomicsLedgerStore,
} from "@/modules/economics/application/ports";
import type {
  MetricIngestionWindowPort,
  MetricSeriesPort,
} from "@/modules/metrics/application/ports";

/**
 * Reprices the periods one ingestion run touched.
 *
 * Separate from the import rather than inline in it, for two reasons. An
 * import that succeeded has succeeded: a margin that failed to recompute is a
 * retryable problem of its own and must not turn a good import into a failed
 * one. And the other trigger for repricing — an operator correcting a
 * commission rate — has nothing to do with imports at all, so the work belongs
 * somewhere both can reach.
 *
 * See `specs/012-channel-economics-ledger.md` section 3.1.
 */

const payloadSchema = z.object({
  organizationId: z.string().uuid(),
  ingestionRunId: z.string().uuid(),
  /** Absolute minor units; a small gap on a tiny period is not a disagreement. */
  reconciliationToleranceMinor: z.number().int().nonnegative().optional(),
});

export type RecomputeLedgerPayload = z.infer<typeof payloadSchema>;

export type RecomputeLedgerDependencies = {
  metrics: MetricSeriesPort;
  windows: MetricIngestionWindowPort;
  catalog: EconomicsCatalogPort;
  ledger: EconomicsLedgerStore;
  logger?: {
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
  };
};

export type RecomputeLedgerOutcome =
  | { status: "skipped"; reason: "no_observations" }
  | ({ status: "recomputed" } & RecomputeChannelEconomicsResult);

export async function runRecomputeLedger(
  input: unknown,
  dependencies: RecomputeLedgerDependencies,
): Promise<RecomputeLedgerOutcome> {
  const payload = payloadSchema.parse(input);

  const window = await dependencies.windows.loadIngestionRunWindow({
    organizationId: payload.organizationId,
    ingestionRunId: payload.ingestionRunId,
  });

  // An import whose rows all rejected wrote no observations, so there is
  // nothing to reprice. That is an ordinary outcome, not a failure.
  if (!window) return { status: "skipped", reason: "no_observations" };

  const metricKeys = await dependencies.catalog.loadMetricBinding(payload.organizationId);

  const result = await recomputeChannelEconomics(
    {
      metrics: dependencies.metrics,
      catalog: dependencies.catalog,
      ledger: dependencies.ledger,
    },
    {
      organizationId: payload.organizationId,
      branchId: window.branchId,
      timeZone: window.timeZone,
      grain: window.grain,
      rangeStart: window.rangeStart,
      // The end of the last period the run wrote, not its start, or the final
      // day of every import would fall outside its own recompute.
      rangeEndExclusive: nextPeriodStart(window.lastPeriodStart, window.grain, window.timeZone),
      metricKeys,
      ...(payload.reconciliationToleranceMinor === undefined
        ? {}
        : { reconciliationToleranceMinor: payload.reconciliationToleranceMinor }),
    },
  );

  dependencies.logger?.info("economics.ledger.recomputed", {
    organizationId: payload.organizationId,
    ingestionRunId: payload.ingestionRunId,
    entriesWritten: result.entriesWritten,
    ...result.gradeCounts,
    reportedEntryCount: result.reportedEntryCount,
    periodStartsWithoutRevenue: result.periodStartsWithoutRevenue,
    disagreementCount: result.disagreements.length,
  });

  // Surfaced rather than reconciled, per specs/012 section 4.4.1. Either a rate
  // is wrong or the export is, and only the operator can say which; turning
  // these into fact proposals is a later slice.
  if (result.disagreements.length > 0)
    dependencies.logger?.warn("economics.ledger.reported_margin_disagreement", {
      organizationId: payload.organizationId,
      ingestionRunId: payload.ingestionRunId,
      periods: result.disagreements.length,
      largestDifferenceMinor: Math.max(
        ...result.disagreements.map((disagreement) => Math.abs(disagreement.differenceMinor)),
      ),
    });

  return { status: "recomputed", ...result };
}
