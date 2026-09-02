import { randomUUID } from "node:crypto";

import type { AllocationDecision } from "@/domain/campaigns/allocation";
import type { AllocationCampaignResult } from "@/modules/campaigns/application/allocation-service";

/**
 * `campaign.allocation-cycle` — the fast loop's cadence.
 *
 * This runs once per organization and decides each campaign on its own. It
 * carries no state from one campaign into the next: the evaluation service is
 * single-campaign, the pause port is handed exactly one variant's decision, and
 * nothing here ranks, compares, or even sees two campaigns side by side.
 * Comparing campaigns is learning, and learning stays out of this loop.
 *
 * The loop's only outward action is the pause port. It never raises a budget,
 * widens an audience, creates creative, or changes campaign state — a pause is
 * containment inside the approval envelope, and resume is a separate human act.
 *
 * Built but not registered as a Trigger task yet, matching the dispatch and
 * collection workflows: the cadence schedule is activated when the platform is
 * ready to run it, not before.
 */

export type AllocationCyclePayload = {
  organizationId: string;
  /** Present only to make a cycle reproducible in tests; generated otherwise. */
  cycleId?: string;
};

export type AllocationCycleDependencies = {
  listActiveCampaigns(input: { organizationId: string }): Promise<readonly string[]>;
  evaluateCampaign(input: {
    organizationId: string;
    campaignId: string;
    cycleId: string;
  }): Promise<AllocationCampaignResult>;
  pause(input: {
    organizationId: string;
    campaignId: string;
    variantId: string;
    decision: AllocationDecision;
  }): Promise<void>;
  emitCycleCompleted(input: {
    organizationId: string;
    cycleId: string;
    campaignCount: number;
    decisionCount: number;
    pauseCount: number;
  }): Promise<void>;
  isCancelled(): boolean;
};

export type AllocationCycleResult = {
  cycleId: string;
  campaignCount: number;
  decisionCount: number;
  pauseCount: number;
  campaigns: readonly {
    campaignId: string;
    decisions: number;
    pauses: number;
  }[];
};

export async function runAllocationCycle(
  payload: AllocationCyclePayload,
  deps: AllocationCycleDependencies,
  signal: AbortSignal,
): Promise<AllocationCycleResult> {
  const cycleId = payload.cycleId ?? randomUUID();
  const campaigns = await deps.listActiveCampaigns({ organizationId: payload.organizationId });

  let decisionCount = 0;
  let pauseCount = 0;
  const summaries: AllocationCycleResult["campaigns"][number][] = [];

  for (const campaignId of campaigns) {
    if (deps.isCancelled() || signal.aborted) break;

    const result = await deps.evaluateCampaign({
      organizationId: payload.organizationId,
      campaignId,
      cycleId,
    });

    decisionCount += result.decisions.length;
    pauseCount += result.pauses.length;

    for (const decision of result.pauses) {
      if (deps.isCancelled() || signal.aborted) break;
      await deps.pause({
        organizationId: payload.organizationId,
        campaignId,
        variantId: decision.variantId,
        decision,
      });
    }

    summaries.push({
      campaignId,
      decisions: result.decisions.length,
      pauses: result.pauses.length,
    });
  }

  await deps.emitCycleCompleted({
    organizationId: payload.organizationId,
    cycleId,
    campaignCount: summaries.length,
    decisionCount,
    pauseCount,
  });

  return {
    cycleId,
    campaignCount: summaries.length,
    decisionCount,
    pauseCount,
    campaigns: summaries,
  };
}
