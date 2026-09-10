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
    listDraftRequestStates: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function service(deps: Partial<Parameters<typeof createGrowthIntelligenceReadService>[0]> = {}) {
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
      version: 1,
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
      preferenceSnoozedUntil: null,
    };
    const itemRow: SynthesizedItemRow = {
      id: "70000000-0000-4000-8000-000000000007",
      kind: "insight",
      narrative: "Delivery orders spike on rainy Thursdays.",
      fingerprint: "aa00000000000000000000000000000000000000000000000000000000000001",
      synthesisRunId: "71000000-0000-4000-8000-000000000071",
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
      myFeedback: null,
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
    expect(view.priorityActions.opportunities[0]!.actionKey).toBe("campaign.meta_bundle_v1");
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

  it("carries draft request states from the repository to the cards", async () => {
    const listDraftRequestStates = vi.fn().mockResolvedValue([
      {
        opportunityId: "50000000-0000-4000-8000-000000000005",
        status: "processing",
        campaignId: null,
        requestedAt: "2026-09-03T08:00:00.000Z",
        updatedAt: "2026-09-03T09:00:00.000Z",
      },
    ]);
    const read = service({
      workspace: workspace({ listDraftRequestStates }),
      opportunities: {
        listOpportunities: vi.fn().mockResolvedValue([
          {
            id: "50000000-0000-4000-8000-000000000005",
            organizationId,
            decisionRecordId: "51000000-0000-4000-8000-000000000051",
            playbookVersionId: "52000000-0000-4000-8000-000000000052",
            actionKey: "campaign.governed_draft_v1",
            createdAt: "2026-09-01T07:00:00.000Z",
            title: "Shift budget",
            summary: "Move spend.",
            evidenceTier: "computed",
            impactLowMinor: 100_00,
            impactHighMinor: 400_00,
            executionCostMinor: 50_00,
            expectedContributionMinor: 300_00,
            currency: "AED",
            timeToImpactDays: 14,
            status: "draft_requested",
            expiresAt: "2026-10-01T00:00:00.000Z",
            version: 1,
          },
        ]),
      },
    });

    const view = await read.getWorkspace({ organizationId, actorId });

    expect(listDraftRequestStates).toHaveBeenCalledWith({ organizationId });
    expect(view.priorityActions.opportunities).toHaveLength(1);
    expect(view.priorityActions.opportunities[0]!.draftRequest).toMatchObject({
      status: "processing",
    });
  });
});

describe("research composition", () => {
  const branchId = "30000000-0000-4000-8000-000000000003";
  const pipelineId = "31000000-0000-4000-8000-000000000031";
  const runId = "71000000-0000-4000-8000-000000000071";
  const itemId = "70000000-0000-4000-8000-000000000007";

  function researchReader() {
    return {
      listItemProvenance: vi.fn().mockResolvedValue({
        [runId]: {
          pipelineId,
          branchId,
          stage: "ready",
          statusPath: `/api/organizations/${organizationId}/market-profile/research/${pipelineId}`,
          supportingClaimIds: [],
        },
      }),
      listResearchActivity: vi.fn().mockResolvedValue([
        {
          kind: "started",
          pipelineId,
          branchId,
          scopeLabel: "Marina",
          title: "Market research started — Marina",
          occurredAt: "2026-09-01T08:00:00.000Z",
          stage: null,
        },
      ]),
    };
  }

  function recommendationItemRow() {
    return {
      id: itemId,
      kind: "recommendation" as const,
      narrative: "Research advice.",
      fingerprint: "aa00000000000000000000000000000000000000000000000000000000000001",
      synthesisRunId: runId,
      supportGrade: "corroborated",
      freshness: "current",
      urgency: "medium",
      goalAlignment: "direct",
      activityMonth: "2026-09",
      generatedAt: "2026-09-02T08:00:00.000Z",
      evidenceWindowStart: null,
      evidenceWindowEnd: null,
      marketObservedAt: null,
      missingInput: null,
      decision: null,
      decidedAt: null,
      snoozedUntil: null,
      pinned: false,
      myFeedback: null,
    };
  }

  it("attaches provenance and activity without changing lane order", async () => {
    const research = researchReader();
    const read = service({
      workspace: workspace({
        listWorkspaceItems: vi.fn().mockResolvedValue([recommendationItemRow()]),
      }),
      research,
    });

    const view = await read.getWorkspace({ organizationId, actorId, branchId });
    const plain = await service({
      workspace: workspace({
        listWorkspaceItems: vi.fn().mockResolvedValue([recommendationItemRow()]),
      }),
    }).getWorkspace({ organizationId, actorId });

    expect(research.listItemProvenance).toHaveBeenCalledWith({
      organizationId,
      items: [{ itemId, runId }],
    });
    expect(research.listResearchActivity).toHaveBeenCalledWith({
      organizationId,
      branchId,
      limit: undefined,
    });
    const attributed = view.priorityActions.recommendations.find((card) => card.id === itemId);
    expect(attributed?.researchProvenance?.pipelineId).toBe(pipelineId);
    // Ordering, filters and triage are untouched: the same cards in the same order.
    expect(view.priorityActions.recommendations.map((card) => card.id)).toEqual(
      plain.priorityActions.recommendations.map((card) => card.id),
    );
    expect(view.timeline.filter((event) => event.source.kind === "research_pipeline")).toHaveLength(
      1,
    );
  });

  it("reads organization-wide activity when no branch is selected", async () => {
    const research = researchReader();
    const read = service({ research });

    await read.getWorkspace({ organizationId, actorId });

    expect(research.listResearchActivity).toHaveBeenCalledWith({
      organizationId,
      branchId: null,
      limit: undefined,
    });
  });

  it("leaves cards without provenance when no research reader is wired", async () => {
    const read = service({
      workspace: workspace({
        listWorkspaceItems: vi.fn().mockResolvedValue([recommendationItemRow()]),
      }),
    });

    const view = await read.getWorkspace({ organizationId, actorId });

    expect(view.priorityActions.recommendations[0]!.researchProvenance).toBeNull();
    expect(view.timeline.filter((event) => event.source.kind === "research_pipeline")).toHaveLength(
      0,
    );
  });
});

describe("research degradation", () => {
  it("composes the workspace without provenance when the research read fails", async () => {
    const onResearchError = vi.fn();
    const research = {
      listItemProvenance: vi.fn().mockRejectedValue(new Error("denied")),
      listResearchActivity: vi.fn().mockResolvedValue([]),
    };
    const read = service({ research, onResearchError });

    const view = await read.getWorkspace({ organizationId, actorId });

    expect(view.activityMonth).toBe("2026-09");
    expect(onResearchError).toHaveBeenCalledTimes(1);
    expect(view.timeline.filter((event) => event.source.kind === "research_pipeline")).toHaveLength(
      0,
    );
  });
});
