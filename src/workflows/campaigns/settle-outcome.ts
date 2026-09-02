import type { CampaignVerdict } from "@/domain/campaigns/measurement";
import type { SettleCampaignResult } from "@/modules/campaigns/application/measurement-service";

/**
 * `campaign.settle-outcome` — the slow evidence loop's cadence.
 *
 * This runs once per organization and settles each due campaign on its own. It
 * carries no state from one campaign into the next: the settlement service is
 * single-campaign, the verdict is computed from that campaign's own plan and
 * exposures, and nothing here ranks, compares, or even sees two campaigns side
 * by side. Comparing campaigns is learning, and learning stays out of this
 * loop too.
 *
 * The loop refuses to shorten the evidence window: eligibility is checked in
 * the service and re-checked in the write RPC, so nothing here can settle a
 * campaign before its registered outcome window and settlement delay have
 * passed.
 *
 * Built but not registered as a Trigger task yet, matching the dispatch,
 * collection, and allocation workflows: the cadence schedule is activated when
 * the platform is ready to run it, not before.
 */

export type SettleOutcomePayload = {
  organizationId: string;
};

export type SettleOutcomeDependencies = {
  listDueCampaigns(input: { organizationId: string }): Promise<readonly string[]>;
  settle(input: { organizationId: string; campaignId: string }): Promise<SettleCampaignResult>;
  emitOutcomeSettled(input: {
    organizationId: string;
    campaignId: string;
    verdict: CampaignVerdict;
  }): Promise<void>;
  isCancelled(): boolean;
};

export type SettleOutcomeResult = {
  considered: number;
  settled: number;
  outcomes: readonly { campaignId: string; result: SettleCampaignResult }[];
};

export async function runSettleOutcome(
  payload: SettleOutcomePayload,
  deps: SettleOutcomeDependencies,
  signal: AbortSignal,
): Promise<SettleOutcomeResult> {
  const campaigns = await deps.listDueCampaigns({ organizationId: payload.organizationId });

  let settled = 0;
  const outcomes: SettleOutcomeResult["outcomes"][number][] = [];

  for (const campaignId of campaigns) {
    if (deps.isCancelled() || signal.aborted) break;

    const result = await deps.settle({
      organizationId: payload.organizationId,
      campaignId,
    });

    // A restatement is a settlement too: the verdict changed, so the event
    // fires so downstream readers know to look again. An `unchanged` replay
    // emits nothing, because nothing changed to announce.
    if (result.result === "settled" && result.write.result !== "unchanged") {
      settled += 1;
      await deps.emitOutcomeSettled({
        organizationId: payload.organizationId,
        campaignId,
        verdict: result.outcome.verdict,
      });
    }

    outcomes.push({ campaignId, result });
  }

  return { considered: campaigns.length, settled, outcomes };
}
