import { describe, expect, it } from "vitest";

import { scoreMergedItems } from "@/components/growth-intelligence/merged-opportunities";
import type { CampaignProposalCardView } from "@/modules/campaigns/application/proposal-read-model";
import type { RecommendationCard } from "@/modules/growth-intelligence/application/read-model";

function recommendation(
  overrides: Partial<RecommendationCard> = {},
): RecommendationCard {
  return {
    id: "rec-1",
    source: { kind: "channel_recommendation", id: "rec-1" },
    title: "Confirm stock before opening",
    detail: "Prevents auto-cancellations.",
    generatedAt: "2026-09-10T00:00:00.000Z",
    evidenceWindow: { start: "2026-01-01", end: "2026-01-15" },
    marketObservedAt: null,
    decision: null,
    decidedAt: null,
    snoozedUntil: null,
    pinned: false,
    carriedOver: false,
    ageLabel: null,
    itemFingerprint: null,
    channelId: "ch-1",
    branchId: null,
    myFeedback: null,
    supportedActions: [],
    limitations: [],
    citationFindingIds: [],
    ...overrides,
  };
}

function proposal(
  overrides: Partial<CampaignProposalCardView> = {},
): CampaignProposalCardView {
  return {
    proposalId: "prop-1",
    state: "ready_for_review",
    sourceKind: "manual_request",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-11T00:00:00.000Z",
    snoozedUntil: null,
    linkedCampaignId: null,
    content: { kind: "awaiting_research" },
    decidable: true,
    decisions: [],
    lastDecision: null,
    ...overrides,
  };
}

describe("scoreMergedItems", () => {
  it("ranks a decidable proposal above unseen advice and caps at six", () => {
    const recs = Array.from({ length: 7 }, (_, index) =>
      recommendation({ id: `rec-${index}`, generatedAt: "2026-09-01T00:00:00.000Z" }),
    );
    const props = [proposal({ proposalId: "prop-top" })];
    const items = scoreMergedItems(recs, props, new Date("2026-09-12T00:00:00.000Z"));
    expect(items).toHaveLength(6);
    expect(items[0]).toMatchObject({ kind: "proposal" });
  });

  it("hides dismissed, cancelled and superseded proposals", () => {
    const items = scoreMergedItems(
      [],
      [
        proposal({ proposalId: "dead-1", state: "dismissed" }),
        proposal({ proposalId: "dead-2", state: "cancelled" }),
        proposal({ proposalId: "dead-3", state: "superseded" }),
        proposal({ proposalId: "live", state: "needs_input" }),
      ],
      new Date("2026-09-12T00:00:00.000Z"),
    );
    expect(items.map((item) => (item.kind === "proposal" ? item.card.proposalId : "rec"))).toEqual([
      "live",
    ]);
  });

  it("prefers unseen and newer advice over decided older advice", () => {
    const items = scoreMergedItems(
      [
        recommendation({
          id: "old-seen",
          decision: "acknowledged",
          decidedAt: "2026-09-02T00:00:00.000Z",
          generatedAt: "2026-07-01T00:00:00.000Z",
        }),
        recommendation({ id: "new-unseen", generatedAt: "2026-09-11T00:00:00.000Z" }),
      ],
      [],
      new Date("2026-09-12T00:00:00.000Z"),
    );
    expect(items[0]).toMatchObject({ kind: "recommendation", card: { id: "new-unseen" } });
  });
});
