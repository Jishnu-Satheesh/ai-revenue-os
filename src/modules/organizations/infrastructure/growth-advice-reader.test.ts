import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createGrowthAdviceReader } from "@/modules/organizations/infrastructure/growth-advice-reader";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "99999999-9999-4999-8999-999999999999";
const NOW_ISO = "2026-09-16T12:00:00.000Z";
const PROPOSAL_ID = "66666666-6666-4666-8666-666666666666";

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    channelId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    branchId: null,
    label: "recommendation",
    headline: "Recover avoidable cancellations",
    detail: "Cancellation findings name a recoverable share of lost orders.",
    windowStart: "2026-08-01",
    windowEnd: "2026-08-31",
    generatedAt: "2026-09-01T00:00:00.000Z",
    decision: null,
    pinned: false,
    preferenceSnoozedUntil: null,
    citationFindingIds: ["33333333-3333-4333-8333-333333333331"],
    ...overrides,
  };
}

function workspaceItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "item-1",
    kind: "recommendation",
    narrative: "Weekend demand is climbing across the observed window.",
    fingerprint: "fp-1",
    synthesisRunId: "77777777-7777-4777-8777-777777777777",
    supportGrade: "observed",
    freshness: "fresh",
    urgency: "medium",
    goalAlignment: "aligned",
    activityMonth: "2026-09",
    generatedAt: "2026-09-10T00:00:00.000Z",
    evidenceWindowStart: "2026-08-01",
    evidenceWindowEnd: "2026-08-31",
    marketObservedAt: null,
    missingInput: null,
    decision: "acknowledged",
    decidedAt: null,
    snoozedUntil: null,
    pinned: false,
    myFeedback: null,
    ...overrides,
  };
}

function proposalBundle(overrides: Record<string, unknown> = {}) {
  const versionOverride = "version" in overrides ? overrides.version : undefined;
  return {
    proposal: {
      id: PROPOSAL_ID,
      sourceKind: "business_signal",
      sourceId: null,
      state: "ready_for_review",
      currentVersionId: "88888888-8888-4888-8888-888888888888",
      linkedCampaignId: null,
      snoozedUntil: null,
      createdAt: "2026-08-12T00:00:00.000Z",
      updatedAt: "2026-08-13T00:00:00.000Z",
      ...((overrides.proposal ?? {}) as Record<string, unknown>),
    },
    version:
      versionOverride === null
        ? null
        : {
            id: "88888888-8888-4888-8888-888888888888",
            proposalId: PROPOSAL_ID,
            version: 1,
            document: {
              schemaVersion: 1,
              title: "Iftar week push",
              businessProblem: "Orders dip on weekdays.",
              objective: "Lift weekday orders",
              audience: "Nearby families who order dinner.",
              offer: { kind: "no_offer" },
              channels: [{ channelKey: "instagram", delivery: "organic" }],
              deliverables: [{ format: "post", language: "en", count: 3 }],
              timing: { startAt: "2026-09-20T00:00:00Z", endAt: null, timezone: "Asia/Dubai" },
              proposedMediaBudget: null,
              generationCostCeiling: { amountMinor: 1000, currency: "AED" },
              successPlan: {
                primaryMetricKey: "orders",
                baselineSource: "channel reports",
                baselineRevision: null,
                baselineFrom: null,
                baselineTo: null,
                observationWindowDays: 14,
                reportingDelayDays: 2,
                settlementDelayDays: 7,
                measurementMethod: null,
                target: null,
                missingData: [],
              },
              pausePolicyRef: "standard",
              evidence: [],
              memoryContextManifestId: null,
              assumptions: [],
              limitations: [],
              readiness: { canPrepare: true, canLaunch: false, blockers: [] },
            },
            digest: "a".repeat(64),
            createdAt: "2026-08-12T00:00:00.000Z",
            ...((versionOverride ?? {}) as Record<string, unknown>),
          },
    decisions: (overrides.decisions ?? []) as readonly unknown[],
  };
}

function reads(
  overrides: {
    recommendations?: unknown;
    items?: unknown;
    proposals?: unknown;
  } = {},
) {
  return {
    growthReads: {
      listChannelRecommendationRecords: vi.fn(
        async () => (overrides.recommendations ?? []) as never,
      ),
      listWorkspaceItems: vi.fn(async () => (overrides.items ?? []) as never),
    },
    proposalReader: {
      listProposals: vi.fn(async () => (overrides.proposals ?? []) as never),
    },
  };
}

function allowAll() {
  return { recommendations: true, items: true, proposals: true };
}

describe("denied lanes are never fetched", () => {
  it("calls no reader when every lane is disallowed", async () => {
    const deps = reads({
      recommendations: [recommendation()],
      items: [workspaceItem()],
      proposals: [proposalBundle()],
    });
    const reader = createGrowthAdviceReader(deps);

    const result = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: { recommendations: false, items: false, proposals: false },
    });

    expect(result.candidates).toEqual([]);
    expect(result.laneErrors).toEqual({});
    expect(deps.growthReads.listChannelRecommendationRecords).not.toHaveBeenCalled();
    expect(deps.growthReads.listWorkspaceItems).not.toHaveBeenCalled();
    expect(deps.proposalReader.listProposals).not.toHaveBeenCalled();
  });

  it("fetches only the allowed lane", async () => {
    const deps = reads({ recommendations: [recommendation()], items: [workspaceItem()] });
    const reader = createGrowthAdviceReader(deps);

    const result = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: { recommendations: true, items: false, proposals: false },
    });

    expect(deps.growthReads.listChannelRecommendationRecords).toHaveBeenCalledTimes(1);
    expect(deps.growthReads.listWorkspaceItems).not.toHaveBeenCalled();
    expect(deps.proposalReader.listProposals).not.toHaveBeenCalled();
    expect(result.candidates.map((row) => row.id)).toEqual(["rec:rec-1"]);
  });
});

describe("candidate qualification through source-owned rows", () => {
  it("maps a channel recommendation with its window, channels and evidence refs", async () => {
    const deps = reads({ recommendations: [recommendation()] });
    const reader = createGrowthAdviceReader(deps);

    const { candidates, laneErrors } = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: allowAll(),
    });

    expect(laneErrors).toEqual({});
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: "rec:rec-1",
      kind: "recommendation",
      title: "Recover avoidable cancellations",
      href: `/organizations/${ORG_ID}/growth-intelligence`,
      key: null,
      relation: "general",
      sourceWindowStart: "2026-08-01",
      sourceWindowEnd: "2026-08-31",
      channelIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1"],
      permission: "growth_intelligence.read",
    });
    expect(candidates[0]!.evidenceRefs).toEqual(["33333333-3333-4333-8333-333333333331"]);
  });

  it("labels planned status as intent and never as completed", async () => {
    const deps = reads({
      recommendations: [recommendation({ decision: { decision: "planned" } })],
    });
    const reader = createGrowthAdviceReader(deps);

    const { candidates } = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: allowAll(),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.supportingText).toContain("planned");
    expect(candidates[0]!.supportingText).toContain("intent, not completed execution");
    expect(candidates[0]!.supportingText).not.toMatch(
      /completed execution of|has completed|was completed/,
    );
  });

  it("drops dismissed, snoozed and resolved rows without reading further", async () => {
    const deps = reads({
      recommendations: [
        recommendation({ id: "d1", decision: { decision: "dismissed" } }),
        recommendation({ id: "s1", decision: { decision: "snoozed" } }),
        recommendation({ id: "o1", label: "observation", decision: null }),
        recommendation({ id: "n1", label: "needs_data", decision: null }),
      ],
      items: [
        workspaceItem({ id: "r1", decision: "resolved" }),
        workspaceItem({ id: "g1", kind: "data_gap" }),
      ],
    });
    const reader = createGrowthAdviceReader(deps);

    const { candidates } = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: allowAll(),
    });

    // Only the observation survives, as insight context — never as an action.
    expect(candidates.map((row) => row.id)).toEqual(["rec:o1"]);
    expect(candidates[0]!.kind).toBe("insight");
  });

  it("hides a personally snoozed row for this viewer only", async () => {
    const deps = reads({
      recommendations: [recommendation({ preferenceSnoozedUntil: "2026-10-01" })],
    });
    const reader = createGrowthAdviceReader(deps);

    const { candidates } = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: allowAll(),
    });

    expect(candidates).toEqual([]);
  });

  it("links proposals to their real review address with the registered source kind", async () => {
    const deps = reads({ proposals: [proposalBundle()] });
    const reader = createGrowthAdviceReader(deps);

    const { candidates } = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: allowAll(),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: `proposal:${PROPOSAL_ID}`,
      kind: "proposal",
      title: "Iftar week push",
      href: `/organizations/${ORG_ID}/campaign-proposals/${PROPOSAL_ID}`,
      key: "business_signal",
      relation: "general",
      permission: "campaign.read",
    });
  });

  it("keeps only reviewable proposals and drops decided ones", async () => {
    const deps = reads({
      proposals: [
        proposalBundle(),
        proposalBundle({
          proposal: { id: "22222222-2222-4222-8222-222222222222", state: "researching" },
        }),
        proposalBundle({
          proposal: {
            id: "33333333-3333-4333-8333-333333333333",
            state: "approved_for_preparation",
          },
        }),
        proposalBundle({
          proposal: { id: "44444444-4444-4444-8444-444444444444", state: "dismissed" },
        }),
      ],
    });
    const reader = createGrowthAdviceReader(deps);

    const { candidates } = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: allowAll(),
    });

    expect(candidates.map((row) => row.id)).toEqual([`proposal:${PROPOSAL_ID}`]);
  });

  it("falls back to the known workspace when a proposal has no readable document", async () => {
    const deps = reads({ proposals: [proposalBundle({ version: null })] });
    const reader = createGrowthAdviceReader(deps);

    const { candidates } = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: allowAll(),
    });

    // No readable document means no reviewable content: the row stays out
    // rather than linking a guessing title at a real address.
    expect(candidates).toEqual([]);
  });
});

describe("failure isolation and forbidden content", () => {
  it("preserves independent errors without losing the healthy lane", async () => {
    const deps = reads({ recommendations: [recommendation()] });
    deps.growthReads.listWorkspaceItems = vi.fn(async () => {
      throw new Error("db down");
    });
    const reader = createGrowthAdviceReader(deps);

    const { candidates, laneErrors } = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: allowAll(),
    });

    expect(candidates.map((row) => row.id)).toEqual(["rec:rec-1"]);
    expect(laneErrors).toEqual({ items: "SOURCE_READ_FAILED" });
  });

  it("carries no amounts, titles beyond bounds, or guessed routes", async () => {
    const deps = reads({
      recommendations: [recommendation()],
      items: [workspaceItem()],
      proposals: [proposalBundle()],
    });
    const reader = createGrowthAdviceReader(deps);

    const { candidates } = await reader.readCandidates({
      organizationId: ORG_ID,
      actorId: ACTOR_ID,
      nowIso: NOW_ISO,
      allow: allowAll(),
    });

    const serialized = JSON.stringify(candidates);
    expect(serialized).not.toContain("AED");
    expect(serialized).not.toContain("minorUnits");
    for (const row of candidates) {
      expect(row.title.length).toBeLessThanOrEqual(200);
      expect(row.supportingText.length).toBeLessThanOrEqual(1000);
      if (row.href !== null) {
        expect(
          row.href === `/organizations/${ORG_ID}/growth-intelligence` ||
            row.href === `/organizations/${ORG_ID}/campaign-proposals/${PROPOSAL_ID}`,
        ).toBe(true);
      }
    }
  });
});
