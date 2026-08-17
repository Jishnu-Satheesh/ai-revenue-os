import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import type { GenerationDispatcher } from "@/modules/campaigns/application/service";
import type {
  CampaignRunDispatcher,
  EnqueueRunInput,
} from "@/modules/campaigns/infrastructure/run-repository";
import type { generateCampaignBundleTask, reviseCampaignBundleTask } from "@/trigger/campaigns";

/**
 * Handing an enqueued run to the worker that performs it.
 *
 * The run row and the Trigger task are two halves of one thing: Postgres
 * records that generation is owed, and Trigger actually does it. Writing the
 * row without dispatching leaves a campaign that says "generating" forever
 * while nothing is running, which looks identical to slow work and is the
 * worst possible failure for a screen an operator is waiting on.
 *
 * Dispatch failure is therefore not swallowed. The rates-recompute path can
 * afford to warn and carry on because the saved data still stands on its own;
 * here there is nothing to stand on — an undispatched campaign has no proposal
 * and never will.
 */

/**
 * What one attempt may spend on models before the run stops.
 *
 * A ceiling has to exist because generation calls a paid image model in a loop.
 * The default is deliberately low: the safe direction for a misconfigured
 * ceiling is a run that stops early and says so, not one that keeps spending.
 */
const DEFAULT_COST_CEILING_MINOR = 500;

export function generationCostCeilingMinor(
  raw: string | undefined = env.CAMPAIGN_GENERATION_COST_CEILING_MINOR,
): number {
  if (!raw) return DEFAULT_COST_CEILING_MINOR;
  // Digits only, checked before parsing. `parseInt` reads "1e9" as 1 and
  // "500abc" as 500, so a mistyped ceiling would silently become a much
  // smaller one — and a spend limit that quietly shrinks is still a spend
  // limit nobody chose.
  const parsed = /^\d+$/.test(raw.trim()) ? Number.parseInt(raw.trim(), 10) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 10_000_000) {
    throw new Error(
      "CAMPAIGN_GENERATION_COST_CEILING_MINOR must be a positive integer of minor units.",
    );
  }
  return parsed;
}

type DispatchInput = {
  organizationId: string;
  campaignId: string;
  runId: string;
  correlationId: string;
};

async function dispatch(
  taskId: "campaign.generate-bundle" | "campaign.revise-bundle",
  payload: DispatchInput & { baseVersionId?: string; baseDigest?: string },
  idempotencyKey: string,
): Promise<void> {
  try {
    const { tasks } = await import("@trigger.dev/sdk");
    const handle = await tasks.trigger<
      typeof generateCampaignBundleTask | typeof reviseCampaignBundleTask
    >(
      taskId,
      { ...payload, costCeilingMinor: generationCostCeilingMinor() },
      // Trigger's own key as well as the database's. A retried request must not
      // become two runs at either layer.
      { idempotencyKey, concurrencyKey: payload.organizationId },
    );
    logger.info("campaign.generation_dispatched", {
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
      runId: payload.runId,
      correlationId: payload.correlationId,
      workerId: handle.id,
    });
  } catch (error) {
    logger.error("campaign.generation_not_dispatched", {
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
      runId: payload.runId,
      correlationId: payload.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    throw new DomainError(
      "WORKFLOW_ERROR",
      "Generation could not be started. The campaign was saved; try generating again.",
    );
  }
}

/** Enqueues the run, then hands it to the worker. */
export function createTriggerGenerationDispatcher(
  runs: CampaignRunDispatcher,
): GenerationDispatcher {
  return {
    async enqueueGeneration(input) {
      const { runId, replayed } = await runs.enqueue({
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        sourceSnapshotId: input.sourceSnapshotId,
        kind: "generate",
        idempotencyKey: input.idempotencyKey,
        correlationId: input.correlationId,
      });

      // A replay is dispatched too. The run row is claimed with a lease and a
      // token, so a second delivery finds the run already claimed or finished
      // and stands down before any model is called — which is cheaper than
      // leaving a run stranded because its first dispatch was lost.
      await dispatch(
        "campaign.generate-bundle",
        {
          organizationId: input.organizationId,
          campaignId: input.campaignId,
          runId,
          correlationId: input.correlationId,
        },
        input.idempotencyKey,
      );

      return { runId, replayed };
    },
  };
}

/** The revision equivalent, which additionally pins the version it was written against. */
export async function enqueueAndDispatchRevision(
  runs: CampaignRunDispatcher,
  input: EnqueueRunInput & { baseVersionId: string; baseDigest: string },
): Promise<{ runId: string; replayed: boolean }> {
  const { runId, replayed } = await runs.enqueue(input);

  await dispatch(
    "campaign.revise-bundle",
    {
      organizationId: input.organizationId,
      campaignId: input.campaignId,
      runId,
      correlationId: input.correlationId,
      baseVersionId: input.baseVersionId,
      baseDigest: input.baseDigest,
    },
    input.idempotencyKey,
  );

  return { runId, replayed };
}
