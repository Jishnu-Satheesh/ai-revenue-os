import type { EventPublisher } from "@/domain/events/types";
import type { SynthesisRepository } from "@/modules/growth-intelligence/infrastructure/synthesis-repository";

/**
 * Member triage over synthesized intelligence (spec 022 section 9.6).
 *
 * Decisions append through the fenced member RPCs on the caller's own
 * session; pins stay actor-scoped presentation preferences. The only event
 * here is the identifier-only `growth_intelligence.item_triaged`, published
 * after the committed outcome and never on failure.
 */

export type GrowthIntelligenceTriageStore = Pick<
  SynthesisRepository,
  "decide" | "setPreference" | "recordFeedback"
>;

export type TriageDecision =
  | "acknowledged"
  | "pinned"
  | "unpinned"
  | "planned"
  | "snoozed"
  | "dismissed"
  | "resolved";

export type DecideItemInput = {
  organizationId: string;
  actorId: string;
  itemId: string;
  decision: TriageDecision;
  reason: string | null;
  snoozedUntil: string | null;
  itemFingerprint: string;
  correlationId: string;
};

export type SetPreferenceInput = {
  organizationId: string;
  actorId: string;
  sourceKind: "synthesis_item" | "channel_recommendation" | "opportunity";
  sourceId: string;
  pinned: boolean;
  snoozedUntil: string | null;
};

export type RecordFeedbackInput = {
  organizationId: string;
  actorId: string;
  itemId: string;
  helpful: boolean;
};

export type GrowthIntelligenceTriageDependencies = {
  triage: GrowthIntelligenceTriageStore;
  events: EventPublisher;
};

export function createGrowthIntelligenceTriageService(
  dependencies: GrowthIntelligenceTriageDependencies,
) {
  const { triage, events } = dependencies;

  return {
    async decideItem(input: DecideItemInput): Promise<{ decisionId: string; decision: string }> {
      const outcome = await triage.decide({
        organizationId: input.organizationId,
        actorId: input.actorId,
        itemId: input.itemId,
        decision: input.decision,
        reason: input.reason,
        snoozedUntil: input.snoozedUntil,
        itemFingerprint: input.itemFingerprint,
      });
      await events.publish({
        eventId: crypto.randomUUID(),
        eventName: "growth_intelligence.item_triaged",
        occurredAt: new Date().toISOString(),
        organizationId: input.organizationId,
        actorType: "user",
        actorId: input.actorId,
        correlationId: input.correlationId,
        schemaVersion: 1,
        payload: { itemId: input.itemId, decisionId: outcome.decisionId },
      });
      return outcome;
    },

    async setPreference(
      input: SetPreferenceInput,
    ): Promise<{ sourceKind: string; pinned: boolean }> {
      // Presentation-only: no organization policy changes, so no event.
      return triage.setPreference({
        organizationId: input.organizationId,
        actorId: input.actorId,
        sourceKind: input.sourceKind,
        sourceId: input.sourceId,
        pinned: input.pinned,
        snoozedUntil: input.snoozedUntil,
      });
    },

    async recordFeedback(
      input: RecordFeedbackInput,
    ): Promise<{ itemId: string; helpful: boolean }> {
      // A member-scoped quality signal, not an organization policy change.
      return triage.recordFeedback(input);
    },
  };
}
