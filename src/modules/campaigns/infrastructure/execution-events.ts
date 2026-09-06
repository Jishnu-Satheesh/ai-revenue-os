import { randomUUID } from "node:crypto";

import { createEventPublisher } from "@/domain/events/publisher";
import type { CampaignVerdict } from "@/domain/campaigns/measurement";

/**
 * The events the execution loop announces.
 *
 * Past tense and organization-scoped, per the repository's event conventions.
 * The actor is the worker, not a person: nobody clicked to settle an outcome,
 * a cadence did.
 *
 * The payloads carry identifiers and a verdict, and nothing else. A settled
 * outcome's numbers live in `campaign_outcomes`, where they are bound to a plan
 * digest; repeating them in an event would create a second, unversioned copy of
 * a measured result, which is exactly the kind of claim this codebase requires
 * to have a baseline and a method attached.
 */

function publish(eventName: string, organizationId: string, payload: Record<string, unknown>) {
  return createEventPublisher().publish({
    eventId: randomUUID(),
    eventName,
    occurredAt: new Date().toISOString(),
    organizationId,
    // No actorId: nobody clicked. Omitted rather than nulled, because the
    // event contract treats it as absent-or-a-person.
    actorType: "system",
    correlationId: randomUUID(),
    schemaVersion: 1,
    payload,
  });
}

export function createCampaignCycleEvents() {
  return {
    async emitCycleCompleted(input: {
      organizationId: string;
      cycleId: string;
      campaignCount: number;
      decisionCount: number;
      pauseCount: number;
    }) {
      await publish("campaign.allocation_cycle_completed", input.organizationId, {
        cycleId: input.cycleId,
        campaignCount: input.campaignCount,
        decisionCount: input.decisionCount,
        pauseCount: input.pauseCount,
      });
    },

    async emitOutcomeSettled(input: {
      organizationId: string;
      campaignId: string;
      verdict: CampaignVerdict;
    }) {
      await publish("campaign.outcome_settled", input.organizationId, {
        campaignId: input.campaignId,
        // The verdict is a bounded vocabulary, not a number. "inconclusive" is
        // as much a result as any other and is announced the same way.
        verdict: input.verdict,
      });
    },

    async emitLearningProposed(input: {
      organizationId: string;
      campaignId: string;
      proposalId: string;
    }) {
      await publish("campaign.learning_proposed", input.organizationId, {
        campaignId: input.campaignId,
        proposalId: input.proposalId,
      });
    },
  };
}
