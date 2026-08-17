import { logger, queue, schemaTask, tasks } from "@trigger.dev/sdk";

import { createEventPublisher } from "@/domain/events/publisher";
import { createDecisionWorkerServiceClient } from "@/lib/supabase/service";
import type { CampaignDecisionCycleDependencies } from "@/workflows/decisions/run-cycle";
import {
  campaignDecisionCyclePayloadSchema,
  decisionCycleRequestDigest,
  parseCampaignDecisionCyclePayload,
} from "@/workflows/decisions/contracts";
import { runCampaignDecisionCycle } from "@/workflows/decisions/run-cycle";
import { createDecisionCycleRepository } from "@/modules/decisions/infrastructure/cycle-repository";
import type { DecisionCyclePersistence } from "@/modules/decisions/infrastructure/cycle-repository";
import { mapCampaignEvidence } from "@/modules/decisions/infrastructure/campaign-evidence-repository";
import { createCampaignOpportunitySource } from "@/modules/decisions/sources/campaign-opportunity-source";

const retry = {
  maxAttempts: 3,
  minTimeoutInMs: 1_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

/**
 * Dispatch remains intentionally disconnected in Task 5. This bounded queue
 * limits Trigger concurrency, while the database operation key and lease stay
 * authoritative for replay, cancellation, and stale-worker fencing.
 */
export const campaignDecisionQueue = queue({
  name: "decision-campaign-cycle",
  concurrencyLimit: 1,
});

tasks.onCancel(async ({ task: taskId, payload }) => {
  if (taskId !== "decision.run-campaign-cycle") return;
  const parsed = parseCampaignDecisionCyclePayload(payload);
  const cycles = createCycleRepository();
  await cycles.cancel({
    ...parsed,
    requestDigest: decisionCycleRequestDigest(parsed),
  });
});

export const runCampaignDecisionCycleTask = schemaTask({
  id: "decision.run-campaign-cycle",
  schema: campaignDecisionCyclePayloadSchema,
  queue: campaignDecisionQueue,
  retry,
  maxDuration: 300,
  run: async (payload, { signal }) => {
    const parsed = parseCampaignDecisionCyclePayload(payload);
    const dependencies = createDependencies(signal);
    const result = await runCampaignDecisionCycle(parsed, dependencies);

    logger.info("decision.campaign_cycle_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      decisionCycleId: result.decisionCycleId,
      status: result.status,
      ...(result.status === "completed"
        ? {
            decisionRecordId: result.decisionRecordId,
            opportunityId: result.opportunityId,
          }
        : {}),
    });

    return result;
  },
});

function createCycleRepository() {
  const supabase = createDecisionWorkerServiceClient();
  return createDecisionCycleRepository(supabase as unknown as DecisionCyclePersistence);
}

function createDependencies(signal: AbortSignal): CampaignDecisionCycleDependencies {
  return {
    cycles: createCycleRepository(),
    source: createCampaignOpportunitySource(),
    loadEvidence: (context) => mapCampaignEvidence(context.evidence, context.spendPolicy),
    events: createEventPublisher(),
    signal,
  };
}
