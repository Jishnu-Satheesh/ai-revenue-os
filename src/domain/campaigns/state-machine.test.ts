import { describe, expect, it } from "vitest";

import { CampaignError } from "@/domain/campaigns/errors";
import { hasCampaignPermission, rolesWith } from "@/domain/campaigns/permissions";
import {
  CAMPAIGN_STATES,
  allowedTransitions,
  approvalStatus,
  assertTransition,
  canTransition,
  isTerminal,
  type ApprovalRow,
  type CampaignState,
} from "@/domain/campaigns/state-machine";

const NOW = new Date("2026-08-15T10:00:00.000Z");

function approval(overrides: Partial<ApprovalRow> = {}): ApprovalRow {
  return {
    bundleVersionId: "v-1",
    bundleDigest: "a".repeat(64),
    expiresAt: "2026-08-20T10:00:00.000Z",
    revokedAt: null,
    ...overrides,
  };
}

const SUBJECT = { bundleVersionId: "v-1", bundleDigest: "a".repeat(64) };

describe("campaign state machine", () => {
  it("walks the happy path from draft to completed", () => {
    const path: CampaignState[] = [
      "draft",
      "ready_for_review",
      "approved",
      "scheduled",
      "executing",
      "measuring",
      "completed",
    ];

    for (let index = 0; index < path.length - 1; index += 1) {
      expect(canTransition(path[index]!, path[index + 1]!)).toBe(true);
    }
  });

  it("never lets an approved campaign be edited back into a draft", () => {
    expect(canTransition("approved", "draft")).toBe(false);
    expect(canTransition("scheduled", "draft")).toBe(false);
    expect(canTransition("executing", "draft")).toBe(false);
  });

  it("does not treat approval as scheduling", () => {
    expect(canTransition("approved", "executing")).toBe(false);
  });

  it("sends an approved campaign back to review when its approval is superseded", () => {
    // A new bundle version revokes the approval on the old one, and the
    // database moves the campaign with it. Without this transition the two
    // layers disagree: staging held a campaign in `approved` whose only
    // approval had been revoked, and the portfolio badge said so out loud.
    expect(canTransition("approved", "ready_for_review")).toBe(true);
  });

  it("still refuses to reopen an approved campaign as a draft", () => {
    // Back to review is not the same as back to the drawing board: review is
    // where a version that already exists gets looked at again.
    expect(canTransition("approved", "draft")).toBe(false);
  });

  it("lets a readiness gap recover once the evidence arrives", () => {
    expect(canTransition("needs_data", "ready_for_review")).toBe(true);
  });

  it("lets a blocked campaign return to review when the blocker clears", () => {
    expect(canTransition("blocked", "ready_for_review")).toBe(true);
  });

  it("keeps measuring reachable after a partial run, because it still happened", () => {
    expect(canTransition("executing", "partially_completed")).toBe(true);
    expect(canTransition("partially_completed", "measuring")).toBe(true);
  });

  it("allows cancellation from every live state", () => {
    for (const state of CAMPAIGN_STATES) {
      if (isTerminal(state) || state === "cancelled") continue;
      expect(canTransition(state, "cancelled")).toBe(true);
    }
  });

  it("treats completed and cancelled as terminal", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("cancelled")).toBe(true);
  });

  it("does not let a completed campaign restart", () => {
    expect(allowedTransitions("completed")).toEqual([]);
  });

  it("throws a typed error on a forbidden transition", () => {
    expect(() => assertTransition("completed", "executing")).toThrow(CampaignError);
  });

  it("names every state it can reach, and nothing it cannot", () => {
    for (const state of CAMPAIGN_STATES) {
      for (const next of allowedTransitions(state)) {
        expect(CAMPAIGN_STATES).toContain(next);
      }
    }
  });

  it("never transitions to itself", () => {
    for (const state of CAMPAIGN_STATES) {
      expect(allowedTransitions(state)).not.toContain(state);
    }
  });
});

describe("approvalStatus", () => {
  it("approves the exact version and digest that was read", () => {
    expect(approvalStatus(approval(), SUBJECT, NOW)).toEqual({ isApproved: true });
  });

  it("refuses when no approval exists", () => {
    expect(approvalStatus(null, SUBJECT, NOW)).toEqual({
      isApproved: false,
      reason: "no_approval",
    });
  });

  it("refuses an approval that covers an earlier version", () => {
    expect(approvalStatus(approval({ bundleVersionId: "v-0" }), SUBJECT, NOW)).toEqual({
      isApproved: false,
      reason: "version_superseded",
    });
  });

  it("refuses when the content changed under a matching version id", () => {
    expect(approvalStatus(approval({ bundleDigest: "b".repeat(64) }), SUBJECT, NOW)).toEqual({
      isApproved: false,
      reason: "digest_mismatch",
    });
  });

  it("refuses an expired approval", () => {
    const expired = approval({ expiresAt: "2026-08-15T09:59:59.000Z" });

    expect(approvalStatus(expired, SUBJECT, NOW)).toEqual({
      isApproved: false,
      reason: "expired",
    });
  });

  it("treats the exact expiry instant as expired, matching the write path", () => {
    const boundary = approval({ expiresAt: NOW.toISOString() });

    expect(approvalStatus(boundary, SUBJECT, NOW)).toMatchObject({ isApproved: false });
  });

  it("refuses a revoked approval before anything else is considered", () => {
    const revoked = approval({ revokedAt: "2026-08-14T10:00:00.000Z", bundleVersionId: "v-0" });

    expect(approvalStatus(revoked, SUBJECT, NOW)).toEqual({
      isApproved: false,
      reason: "revoked",
    });
  });
});

describe("campaign permissions", () => {
  it("lets an operator approve a Tier 3 public and spending action", () => {
    expect(hasCampaignPermission("operator", "campaign.approve")).toBe(true);
    expect(hasCampaignPermission("operator", "campaign.attest")).toBe(true);
  });

  it("lets a viewer read and nothing else", () => {
    expect(hasCampaignPermission("viewer", "campaign.read")).toBe(true);
    expect(hasCampaignPermission("viewer", "campaign.approve")).toBe(false);
    expect(hasCampaignPermission("viewer", "campaign.edit")).toBe(false);
    expect(hasCampaignPermission("viewer", "campaign.cancel")).toBe(false);
  });

  it("names the roles a route should admit for approval", () => {
    expect([...rolesWith("campaign.approve")].sort()).toEqual(["admin", "operator", "owner"]);
  });

  it("admits every role for reading", () => {
    expect([...rolesWith("campaign.read")].sort()).toEqual([
      "admin",
      "operator",
      "owner",
      "viewer",
    ]);
  });
});
