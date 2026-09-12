import { describe, expect, it } from "vitest";

import {
  assertLessonReviewable,
  assertRootsLive,
  assertSameTenant,
  isDuplicateLessonSubmit,
  isLessonInvalidatedByCorrection,
  isSharedRetrievableLesson,
  MEMORY_NEVER_OVERRIDES,
  projectCampaignLesson,
  projectCampaignOutcome,
  projectCampaignState,
  validateLessonReviewExtension,
} from "@/modules/campaigns/application/memory-source";

const ORGANIZATION_ID = "fb430000-0000-4000-8000-000000000201";
const CAMPAIGN_ID = "fb430000-0000-4000-8000-000000000301";
const VERSION_ID = "fb430000-0000-4000-8000-000000000302";
const OUTCOME_ID = "fb430000-0000-4000-8000-000000000303";
const PROPOSAL_ID = "fb430000-0000-4000-8000-000000000304";
const DIGEST = "a".repeat(64);

describe("campaign lifecycle projection", () => {
  it("carries version, branch, scope, schedule, and status", () => {
    const projected = projectCampaignState({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      bundleVersionId: VERSION_ID,
      version: 2,
      digest: DIGEST,
      branchId: null,
      scheduledFor: ["2026-09-01T10:00:00.000Z"],
      status: "scheduled",
    });

    expect(projected).toMatchObject({ version: 2, scope: "organization", status: "scheduled" });
    expect(Object.keys(projected).sort()).toEqual(
      expect.not.arrayContaining(["assertions", "spend", "assets"]),
    );
  });

  it("marks branch scope when a branch is present", () => {
    const branchId = "fb430000-0000-4000-8000-000000000305";
    const projected = projectCampaignState({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      bundleVersionId: VERSION_ID,
      version: 1,
      digest: DIGEST,
      branchId,
      scheduledFor: [],
      status: "draft",
    });

    expect(projected.scope).toBe("branch");
    expect(projected.branchId).toBe(branchId);
  });

  it("never overrides campaign truth", () => {
    expect(MEMORY_NEVER_OVERRIDES).toEqual(
      expect.arrayContaining(["assertions", "spend", "asset_truth", "policy"]),
    );
  });
});

describe("settled verdict projection", () => {
  function outcome(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      outcomeId: OUTCOME_ID,
      bundleVersionId: VERSION_ID,
      planDigest: DIGEST,
      verdict: "validated_outcome" as const,
      primaryMetricKey: "contribution.incremental_gross_profit",
      baselineSource: "channel_economics_entries weekday lunch",
      attributionMethod: "observational_prepost" as const,
      outcomeWindowDays: 14,
      settlementDelayDays: 3,
      limitations: ["Small sample."],
      evidenceTier: "observed" as const,
      ...overrides,
    };
  }

  it("projects a settled verdict with baseline, metric, method, window, and limits", () => {
    expect(projectCampaignOutcome(outcome()).verdict).toBe("validated_outcome");
  });

  it("rejects an inconclusive result dressed as a winning tactic", () => {
    expect(() =>
      projectCampaignLesson({
        organizationId: ORGANIZATION_ID,
        campaignId: CAMPAIGN_ID,
        proposalId: PROPOSAL_ID,
        outcomeId: OUTCOME_ID,
        status: "submitted_for_promotion",
        verdict: "inconclusive",
        proposedLesson: "This winning tactic won lunch and always works.",
        citedEvidenceIds: [OUTCOME_ID],
      }),
    ).toThrow(/winning tactic|overclaims/i);
  });

  it("rejects execution-only language that claims a win", () => {
    expect(() =>
      projectCampaignLesson({
        organizationId: ORGANIZATION_ID,
        campaignId: CAMPAIGN_ID,
        proposalId: PROPOSAL_ID,
        outcomeId: OUTCOME_ID,
        status: "submitted_for_promotion",
        verdict: "execution_only",
        proposedLesson: "We won the quarter with this approach.",
        citedEvidenceIds: [OUTCOME_ID],
      }),
    ).toThrow(/winning tactic|overclaims|won/i);
  });
});

describe("lesson promotion boundary", () => {
  function lesson(status: "proposed" | "dismissed" | "campaign_only" | "submitted_for_promotion") {
    return {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      proposalId: PROPOSAL_ID,
      outcomeId: OUTCOME_ID,
      status,
      proposedLesson: "Weekday lunch demand held after the menu change.",
      verdict: "validated_outcome" as const,
      citedEvidenceIds: [OUTCOME_ID],
    };
  }

  it("shares exactly one lesson on submitted_for_promotion", () => {
    expect(projectCampaignLesson(lesson("submitted_for_promotion"))?.proposalId).toBe(PROPOSAL_ID);
  });

  it("keeps local and dismissed lessons out of shared retrieval", () => {
    expect(projectCampaignLesson(lesson("proposed"))).toBeNull();
    expect(projectCampaignLesson(lesson("campaign_only"))).toBeNull();
    expect(projectCampaignLesson(lesson("dismissed"))).toBeNull();
    expect(isSharedRetrievableLesson("proposed")).toBe(false);
    expect(isSharedRetrievableLesson("submitted_for_promotion")).toBe(true);
  });

  it("treats a duplicate submit as a replay", () => {
    expect(isDuplicateLessonSubmit({ proposalId: PROPOSAL_ID }, { proposalId: PROPOSAL_ID })).toBe(
      true,
    );
    expect(
      isDuplicateLessonSubmit({ proposalId: PROPOSAL_ID }, { proposalId: OUTCOME_ID }),
    ).toBe(false);
  });

  it("refuses cross-tenant evidence", () => {
    expect(() =>
      assertSameTenant(ORGANIZATION_ID, "fb430000-0000-4000-8000-000000000999"),
    ).toThrow(/another organization/i);
  });

  it("invalidates a lesson whose root was withdrawn", () => {
    expect(() =>
      assertRootsLive({ citedEvidenceIds: [OUTCOME_ID], withdrawnIds: [OUTCOME_ID] }),
    ).toThrow(/no longer stands/i);
  });

  it("marks reviewed lessons invalid when the source is corrected", () => {
    expect(
      isLessonInvalidatedByCorrection({ citedEvidenceIds: [OUTCOME_ID], correctedIds: [OUTCOME_ID] }),
    ).toBe(true);
    expect(
      isLessonInvalidatedByCorrection({
        citedEvidenceIds: [OUTCOME_ID],
        correctedIds: [PROPOSAL_ID],
      }),
    ).toBe(false);
  });

  it("forbids direct verification of captured decisions and recommendations", () => {
    expect(() =>
      assertLessonReviewable({ memoryType: "decision", origin: "system_generated" }),
    ).toThrow(/never verified/i);
    expect(() =>
      assertLessonReviewable({
        memoryType: "episode",
        origin: "system_generated",
        knowledgeKind: "recommendation",
      }),
    ).toThrow(/never verified/i);
  });

  it("records the review extension with revision, roots, applicability, and date", () => {
    const extension = validateLessonReviewExtension({
      proposalId: PROPOSAL_ID,
      expectedRevision: 2,
      validRoots: [OUTCOME_ID],
      applicability: "Applies to weekday lunch service only.",
      reviewDate: "2026-09-12T00:00:00.000Z",
    });

    expect(extension.expectedRevision).toBe(2);
  });
});
