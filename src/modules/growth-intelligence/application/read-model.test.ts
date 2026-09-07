import { describe, expect, it } from "vitest";

import type { OpportunityFeedItem } from "@/modules/decisions/application/ports";
import {
  buildGrowthIntelligenceView,
  type ChannelRecommendationRow,
  type GrowthIntelligenceViewInput,
  type SynthesizedItemRow,
} from "@/modules/growth-intelligence/application/read-model";

const organizationId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";

function opportunity(overrides: Partial<OpportunityFeedItem> = {}): OpportunityFeedItem {
  return {
    id: "50000000-0000-4000-8000-000000000005",
    organizationId,
    decisionRecordId: "51000000-0000-4000-8000-000000000051",
    playbookVersionId: "52000000-0000-4000-8000-000000000052",
    actionKey: "campaign.meta_bundle_v1",
    createdAt: "2026-09-01T07:00:00.000Z",
    title: "Shift budget to the winning channel",
    summary: "Move spend where the evidence already points.",
    evidenceTier: "computed",
    impactLowMinor: 100_00,
    impactHighMinor: 400_00,
    executionCostMinor: 50_00,
    expectedContributionMinor: 300_00,
    currency: "AED",
    timeToImpactDays: 14,
    status: "proposed",
    expiresAt: "2026-10-01T00:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function recommendation(
  overrides: Partial<ChannelRecommendationRow> = {},
): ChannelRecommendationRow {
  return {
    id: "60000000-0000-4000-8000-000000000006",
    channelId: "61000000-0000-4000-8000-000000000061",
    branchId: null,
    label: "recommendation",
    headline: "Extend Friday hours",
    detail: "Friday evenings carry the week's strongest observed demand.",
    windowStart: "2026-08-01",
    windowEnd: "2026-08-31",
    generatedAt: "2026-09-01T08:00:00.000Z",
    decision: null,
    pinned: false,
    preferenceSnoozedUntil: null,
    ...overrides,
  };
}

function item(overrides: Partial<SynthesizedItemRow> = {}): SynthesizedItemRow {
  return {
    id: "70000000-0000-4000-8000-000000000007",
    kind: "insight",
    narrative: "Delivery orders spike on rainy Thursdays.",
    fingerprint:
      "aa00000000000000000000000000000000000000000000000000000000000001",
    supportGrade: "corroborated",
    freshness: "current",
    urgency: "medium",
    goalAlignment: "direct",
    activityMonth: "2026-09",
    generatedAt: "2026-09-02T08:00:00.000Z",
    evidenceWindowStart: "2026-08-01",
    evidenceWindowEnd: "2026-08-31",
    marketObservedAt: null,
    missingInput: null,
    decision: null,
    decidedAt: null,
    snoozedUntil: null,
    pinned: false,
    ...overrides,
  };
}

function input(overrides: Partial<GrowthIntelligenceViewInput> = {}): GrowthIntelligenceViewInput {
  return {
    organizationId,
    actorId,
    activityMonth: "2026-09",
    timeZone: "Asia/Dubai",
    now: new Date("2026-09-04T10:00:00.000Z"),
    opportunities: [opportunity()],
    recommendations: [recommendation()],
    items: [item()],
    ...overrides,
  };
}

describe("buildGrowthIntelligenceView", () => {
  it("separates platform-ready opportunities from operator-performed recommendations", () => {
    const view = buildGrowthIntelligenceView(input());
    expect(view.priorityActions.opportunities).toHaveLength(1);
    expect(view.priorityActions.recommendations).toHaveLength(1);
    expect(view.priorityActions.opportunities[0]!.source).toEqual({
      kind: "opportunity",
      id: "50000000-0000-4000-8000-000000000005",
    });
    expect(view.priorityActions.recommendations[0]!.source).toEqual({
      kind: "channel_recommendation",
      id: "60000000-0000-4000-8000-000000000006",
    });
  });

  it("returns the stored opportunity action key rather than a default", () => {
    const view = buildGrowthIntelligenceView(
      input({ opportunities: [opportunity({ actionKey: "campaign.meta_bundle_v1" })] }),
    );
    expect(view.priorityActions.opportunities[0]!.actionKey).toBe("campaign.meta_bundle_v1");
  });

  it("carries the draft request state and links the created draft", () => {
    const view = buildGrowthIntelligenceView(
      input({
        draftRequests: [
          {
            opportunityId: "50000000-0000-4000-8000-000000000005",
            status: "processing",
            campaignId: null,
            requestedAt: "2026-09-03T08:00:00.000Z",
            updatedAt: "2026-09-03T09:00:00.000Z",
          },
        ],
      }),
    );
    const card = view.priorityActions.opportunities[0]!;
    expect(card.draftRequest).toMatchObject({ status: "processing", campaignId: null });
    expect(view.timeline.map((event) => event.type)).toContain("draft-requested");
  });

  it("announces draft creation, retryable failure, and permanent failure distinctly", () => {
    const view = buildGrowthIntelligenceView(
      input({
        opportunities: [
          opportunity({
            id: "50000000-0000-4000-8000-000000000005",
            status: "draft_created",
          }),
        ],
        draftRequests: [
          {
            opportunityId: "50000000-0000-4000-8000-000000000005",
            status: "completed",
            campaignId: "40000000-0000-4000-8000-000000000004",
            requestedAt: "2026-09-03T08:00:00.000Z",
            updatedAt: "2026-09-03T10:00:00.000Z",
          },
        ],
      }),
    );
    const types = view.timeline.map((event) => event.type);
    expect(types).toContain("draft-requested");
    expect(types).toContain("draft-created");
    const failed = buildGrowthIntelligenceView(
      input({
        draftRequests: [
          {
            opportunityId: "50000000-0000-4000-8000-000000000005",
            status: "retryable_failed",
            campaignId: null,
            requestedAt: "2026-09-03T08:00:00.000Z",
            updatedAt: "2026-09-03T10:00:00.000Z",
          },
        ],
      }),
    );
    expect(failed.timeline.map((event) => event.type)).toContain("retry");
    const dead = buildGrowthIntelligenceView(
      input({
        draftRequests: [
          {
            opportunityId: "50000000-0000-4000-8000-000000000005",
            status: "permanent_failed",
            campaignId: null,
            requestedAt: "2026-09-03T08:00:00.000Z",
            updatedAt: "2026-09-03T10:00:00.000Z",
          },
        ],
      }),
    );
    expect(dead.timeline.map((event) => event.type)).toContain("draft-failed");
  });

  it("hides the actor's preference-snoozed channel row until its horizon passes", () => {
    const snoozed = recommendation({ preferenceSnoozedUntil: "2026-09-20T00:00:00.000Z" });
    const hidden = buildGrowthIntelligenceView(input({ recommendations: [snoozed] }));
    expect(hidden.priorityActions.recommendations).toHaveLength(0);
    expect(hidden.counts.recommendations).toBe(0);

    const expired = buildGrowthIntelligenceView(
      input({
        recommendations: [recommendation({ preferenceSnoozedUntil: "2026-09-01T00:00:00.000Z" })],
      }),
    );
    expect(expired.priorityActions.recommendations).toHaveLength(1);
  });

  it("carries an unresolved earlier-month item forward with an explicit age label", () => {
    const view = buildGrowthIntelligenceView(
      input({
        items: [item({ activityMonth: "2026-07", generatedAt: "2026-07-15T08:00:00.000Z" })],
      }),
    );
    expect(view.insights).toHaveLength(1);
    expect(view.insights[0]!.carriedOver).toBe(true);
    expect(view.insights[0]!.ageLabel).toContain("2 months");
  });

  it("does not carry a dismissed earlier-month item forward", () => {
    const view = buildGrowthIntelligenceView(
      input({
        items: [
          item({
            activityMonth: "2026-07",
            decision: "dismissed",
            decidedAt: "2026-08-01T08:00:00.000Z",
          }),
        ],
      }),
    );
    expect(view.insights).toHaveLength(0);
  });

  it("hides a snoozed item until its required future time", () => {
    const view = buildGrowthIntelligenceView(
      input({
        items: [
          item({
            decision: "snoozed",
            decidedAt: "2026-09-01T08:00:00.000Z",
            snoozedUntil: "2026-09-10T08:00:00.000Z",
          }),
        ],
      }),
    );
    expect(view.insights).toHaveLength(0);
    expect(view.timeline.map((event) => event.type)).toContain("snoozed");
  });

  it("keeps data gaps out of the opportunity and recommendation counts", () => {
    const view = buildGrowthIntelligenceView(
      input({
        items: [
          item(),
          item({
            id: "70000000-0000-4000-8000-000000000008",
            kind: "data_gap",
            narrative: "No delivery data for August.",
            fingerprint:
              "bb00000000000000000000000000000000000000000000000000000000000002",
            missingInput: "delivery_orders",
          }),
        ],
      }),
    );
    expect(view.dataGaps).toHaveLength(1);
    expect(view.counts).toEqual({
      opportunities: 1,
      recommendations: 1,
      insights: 1,
      dataGaps: 1,
    });
  });

  it("shows a channel recommendation decision state without copying it into items", () => {
    const view = buildGrowthIntelligenceView(
      input({
        recommendations: [
          recommendation({
            decision: {
              decision: "planned",
              snoozedUntil: null,
              createdAt: "2026-09-03T08:00:00.000Z",
            },
          }),
        ],
      }),
    );
    expect(view.priorityActions.recommendations).toHaveLength(0);
    expect(view.timeline.map((event) => event.type)).toContain("planned");
    expect(
      view.insights.some(
        (card) => card.source.id === "60000000-0000-4000-8000-000000000006",
      ),
    ).toBe(false);
  });

  it("keeps the generated date separate from the business evidence window", () => {
    const view = buildGrowthIntelligenceView(input());
    const card = view.priorityActions.recommendations[0]!;
    expect(card.generatedAt).toBe("2026-09-01T08:00:00.000Z");
    expect(card.evidenceWindow).toEqual({ start: "2026-08-01", end: "2026-08-31" });
    expect(card.generatedAt).not.toContain("2026-08-01");
  });

  it("suppresses an evidence-identical duplicate card", () => {
    const duplicate = item({
      id: "70000000-0000-4000-8000-000000000009",
      generatedAt: "2026-09-03T08:00:00.000Z",
    });
    const view = buildGrowthIntelligenceView(input({ items: [item(), duplicate] }));
    expect(view.insights).toHaveLength(1);
    expect(view.insights[0]!.id).toBe("70000000-0000-4000-8000-000000000007");
  });

  it("returns empty lanes and zero counts when every section is empty", () => {
    const view = buildGrowthIntelligenceView(
      input({ opportunities: [], recommendations: [], items: [] }),
    );
    expect(view.priorityActions.opportunities).toHaveLength(0);
    expect(view.insights).toHaveLength(0);
    expect(view.dataGaps).toHaveLength(0);
    expect(view.counts).toEqual({
      opportunities: 0,
      recommendations: 0,
      insights: 0,
      dataGaps: 0,
    });
  });

  it("honours a section filter by leaving the other lanes empty", () => {
    const view = buildGrowthIntelligenceView(input({ sections: ["insights"] }));
    expect(view.insights).toHaveLength(1);
    expect(view.priorityActions.opportunities).toHaveLength(0);
    expect(view.priorityActions.recommendations).toHaveLength(0);
    expect(view.dataGaps).toHaveLength(0);
  });
});
