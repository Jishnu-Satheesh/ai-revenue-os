import "server-only";

import { tasks } from "@trigger.dev/sdk";

import { logger } from "@/lib/logger";
import type { ResearchWorkerDispatch } from "@/modules/campaigns/application/research-dispatch";
import type { researchCampaignProposalTask } from "@/trigger/campaigns";

/**
 * Handing an admitted research run to a worker.
 *
 * Trigger is transport and nothing else. The payload carries identifiers and
 * one operating limit, and everything that matters — the staged question, the
 * trigger kind, the pinned manifest, the budget — is re-read by the worker from
 * the admitted run row through its claim. A payload cannot widen what a run was
 * admitted to do.
 *
 * `evidenceMaxAgeDays` travels because the worker refuses to default it: what
 * counts as evidence too old to use is a numeric operating limit the
 * organization set, not one the platform picks (D06).
 */
export const dispatchResearchWorker: ResearchWorkerDispatch = async (input) => {
  // Keyed by the run, so a retried dispatch of the same admitted run does not
  // queue a second delivery. Two deliveries would not double-spend — the claim
  // takes only queued rows — but one is what we mean.
  const idempotencyKey = `campaign-research:${input.runId}`;

  try {
    await tasks.trigger<typeof researchCampaignProposalTask>(
      "campaign.research-proposal",
      {
        organizationId: input.organizationId,
        runId: input.runId,
        correlationId: input.correlationId,
        evidenceMaxAgeDays: input.evidenceMaxAgeDays,
      },
      { idempotencyKey },
    );
    return true;
  } catch (error) {
    // The run stays queued and the lease sweep will offer it again, so this is
    // "not started yet", not "nothing happened". Reported either way: a button
    // that silently does nothing is worse than one that says it could not.
    logger.warn("campaign.research_dispatch_failed", {
      organizationId: input.organizationId,
      runId: input.runId,
      correlationId: input.correlationId,
      errorCode: error instanceof Error ? error.name : "unknown",
    });
    return false;
  }
};
