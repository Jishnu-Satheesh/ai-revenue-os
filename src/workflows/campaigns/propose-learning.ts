import type { ProposeLearningResult } from "@/modules/campaigns/application/learning-service";

/**
 * `campaign.propose-learning` — the evidence loop's last arrow.
 *
 * This runs once per organization and proposes one learning proposal per
 * settled campaign, each from that campaign's own outcome. It carries no state
 * from one campaign into the next: the learning service is single-campaign, the
 * lesson is drafted from that campaign's own plan, variants, exposures, and
 * outcome, and nothing here ranks, compares, or even sees two campaigns side by
 * side. Comparing campaigns is learning, and learning stays out of this loop
 * too.
 *
 * The loop refuses to invent a result: it only lists campaigns that already
 * have a settled outcome, the service refuses a campaign with none, and the
 * write RPC refuses it again. A proposal is drafted exactly once and then the
 * operator decides it — nothing here promotes, dismisses, or generalizes.
 *
 * Built but not registered as a Trigger task yet, matching the settlement,
 * dispatch, collection, and allocation workflows: the cadence schedule is
 * activated when the platform is ready to run it, not before.
 */

export type ProposeLearningPayload = {
  organizationId: string;
};

export type ProposeLearningDependencies = {
  /** Campaigns that already have a settled outcome — the only campaigns a lesson may be drafted from. */
  listSettledCampaigns(input: { organizationId: string }): Promise<readonly string[]>;
  propose(input: { organizationId: string; campaignId: string }): Promise<ProposeLearningResult>;
  emitLearningProposed(input: {
    organizationId: string;
    campaignId: string;
    proposalId: string;
  }): Promise<void>;
  isCancelled(): boolean;
};

export type ProposeLearningOutcome = {
  campaignId: string;
  result: ProposeLearningResult;
};

export type RunProposeLearningResult = {
  considered: number;
  proposed: number;
  outcomes: readonly ProposeLearningOutcome[];
};

export async function runProposeLearning(
  payload: ProposeLearningPayload,
  deps: ProposeLearningDependencies,
  signal: AbortSignal,
): Promise<RunProposeLearningResult> {
  const campaigns = await deps.listSettledCampaigns({ organizationId: payload.organizationId });

  let proposed = 0;
  const outcomes: ProposeLearningOutcome[] = [];

  for (const campaignId of campaigns) {
    if (deps.isCancelled() || signal.aborted) break;

    const result = await deps.propose({
      organizationId: payload.organizationId,
      campaignId,
    });

    // Only a newly-written proposal is announced. An idempotent replay writes
    // nothing new, and a refusal (no settled outcome, or a validation failure)
    // is recorded in the result, never dressed up as a proposal.
    if (result.result === "proposed") {
      proposed += 1;
      await deps.emitLearningProposed({
        organizationId: payload.organizationId,
        campaignId,
        proposalId: result.proposalId,
      });
    }

    outcomes.push({ campaignId, result });
  }

  return { considered: campaigns.length, proposed, outcomes };
}
