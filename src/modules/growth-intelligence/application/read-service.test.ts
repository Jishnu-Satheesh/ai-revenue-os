import { describe, expect, it, vi } from "vitest";

import type { OpportunityFeedItem } from "@/modules/decisions/application/ports";
import type {
  ChannelRecommendationRow,
  SynthesizedItemRow,
} from "@/modules/growth-intelligence/application/read-model";
import {
  createGrowthIntelligenceReadService,
  currentLocalMonth,
  type GrowthIntelligenceWorkspaceRepository,
} from "@/modules/growth-intelligence/application/read-service";

const organizationId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";
const NOW = new Date("2026-09-04T10:00:00.000Z");

function workspace(
  overrides: Partial<GrowthIntelligenceWorkspaceRepository> = {},
): GrowthIntelligenceWorkspaceRepository {
  return {
    readOrganizationTimeZone: vi.fn().mockResolvedValue("Asia/Dubai"),
    listWorkspaceItems: vi.fn().mockResolvedValue([]),
    listChannelRecommendationRecords: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function service(
  deps: Partial<Parameters<typeof createGrowthIntelligenceReadService>[0]> = {},
) {
  return createGrowthIntelligenceReadService({
    workspace: workspace(),
    opportunities: { listOpportunities: vi.fn().mockResolvedValue([]) },
    now: () => NOW,
    ...deps,
  });
}

describe("currentLocalMonth", () => {
  it("resolves the organization's current local month from its timezone", () => {
    // 10:00 UTC is 14:00 in Dubai on 4 September.
    expect(currentLocalMonth("Asia/Dubai", NOW)).toBe("2026-09");
  });

  it("refuses an unknown timezone instead of guessing UTC", () => {
    expect(() => currentLocalMonth("Not/AZone", NOW)).toThrow(/timezone/i);
  });
});

describe("getGrowthIntelligence workspace", () => {
  it("defaults to the organization's current local month", async () => {
    const read = service();

    const view = await read.getWorkspace({ organizationId, actorId });

    expect(view.activityMonth).toBe("2026-09");
    expect(view.timeZone).toBe("Asia/Dubai");
  });

  it("honours an explicit canonical month", async () => {
    const listWorkspaceItems = vi.fn().mockResolvedValue([]);
    const read = service({ workspace: workspace({ listWorkspaceItems }) });

    const view = await read.getWorkspace({
      organizationId,
      actorId,
      activityMonth: "2026-07",
    });

    expect(view.activityMonth).toBe("2026-07");
    expect(listWorkspaceItems).toHaveBeenCalledWith(
      expect.objectContaining({ throughMonth: "2026-07" }),
    );
  });

  it("rejects a non-canonical month without touching the repositories", async () => {
    const listWorkspaceItems = vi.fn().mockResolvedValue([]);
    const listOpportunities = vi.fn().mockResolvedValue([]);
    const read = service({
      workspace: workspace({ listWorkspaceItems }),
      opportunities: { listOpportunities },
    });

    await expect(
      read.getWorkspace({ organizationId, actorId, activityMonth: "September" }),
    ).rejects.toThrow(/month/i);
    expect(listWorkspaceItems).not.toHaveBeenCalled();
    expect(listOpportunities).not.toHaveBeenCalled();
  });

  it("composes opportunities, channel rows, and items through one view", async () => {
    const opportunity: OpportunityFeedItem = {
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
    };
    const channelRow: ChannelRecommendationRow = {
      id: "60000000-0000-4000-8000-000000000006",
      channelId: "61000000-0000-4000-8000-000000000061",
      branchId: null,
      label: "recommendation",
      headline: "Extend Friday hours",
      detail: "Friday evenings carry the strongest observed demand.",
      windowStart: "2026-08-01",
      windowEnd: "2026-08-31",
      generatedAt: "2026-09-01T08:00:00.000Z",
      decision: null,
      pinned: false,
    };
    const itemRow: SynthesizedItemRow = {
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
    };
    const read = service({
      workspace: workspace({
        listWorkspaceItems: vi.fn().mockResolvedValue([itemRow]),
        listChannelRecommendationRecords: vi.fn().mockResolvedValue([channelRow]),
      }),
      opportunities: { listOpportunities: vi.fn().mockResolvedValue([opportunity]) },
    });

    const view = await read.getWorkspace({ organizationId, actorId });

    expect(view.counts).toEqual({
      opportunities: 1,
      recommendations: 1,
      insights: 1,
      dataGaps: 0,
    });
    expect(view.priorityActions.opportunities[0]!.actionKey).toBe(
      "campaign.meta_bundle_v1",
    );
  });

  it("passes the actor and section filter to the repositories", async () => {
    const listChannelRecommendationRecords = vi.fn().mockResolvedValue([]);
    const read = service({
      workspace: workspace({ listChannelRecommendationRecords }),
    });

    await read.getWorkspace({
      organizationId,
      actorId,
      sections: ["recommendations"],
    });

    expect(listChannelRecommendationRecords).toHaveBeenCalledWith(
      expect.objectContaining({ actorId }),
    );
  });
});
