import { describe, expect, it } from "vitest";

import {
  campaignPhase,
  phasePosition,
  type CampaignPhaseInput,
  type DeliverableTally,
} from "@/domain/campaigns/phase";

function tally(overrides: Partial<DeliverableTally> = {}): DeliverableTally {
  return { planned: 3, produced: 3, approved: 3, rejected: 0, ...overrides };
}

function input(overrides: Partial<CampaignPhaseInput> = {}): CampaignPhaseInput {
  return {
    state: "approved",
    hasVersion: true,
    approvalStatus: "live",
    deliverables: tally(),
    launchAuthorized: false,
    settledAt: null,
    ...overrides,
  };
}

describe("what the word 'approved' is hiding", () => {
  it("separates creative not yet made from creative not yet reviewed", () => {
    // The same database state, two situations an operator must act on
    // differently.
    const producing = campaignPhase(input({ deliverables: tally({ produced: 1, approved: 1 }) }));
    const reviewing = campaignPhase(input({ deliverables: tally({ approved: 1 }) }));

    expect(producing.nextAction).toBeNull();
    expect(reviewing.nextAction).toMatchObject({ key: "review_outputs" });
  });

  it("separates reviewed-but-not-authorized from authorized to publish", () => {
    expect(campaignPhase(input({ launchAuthorized: false })).phase).toBe("awaiting_publication");
    expect(campaignPhase(input({ launchAuthorized: true })).phase).toBe("publishing");
  });

  it("asks for the publication approval only once every output is reviewed", () => {
    const outcome = campaignPhase(input({ deliverables: tally({ approved: 2 }) }));

    expect(outcome.nextAction).toMatchObject({ key: "review_outputs" });
  });
});

describe("an approval that authorizes nothing", () => {
  it.each(["none", "expired", "superseded", "digest_mismatch", "revoked"] as const)(
    "treats %s as awaiting review, because none of them authorize preparation",
    (approvalStatus) => {
      expect(campaignPhase(input({ approvalStatus })).phase).toBe("awaiting_review");
    },
  );

  it("says why the approval is gone rather than only that it is", () => {
    const outcome = campaignPhase(input({ approvalStatus: "revoked" }));

    expect(outcome.facts).toContainEqual({ label: "Approval", value: "Revoked" });
  });

  it("does not confuse never-approved with no-longer-approved", () => {
    expect(campaignPhase(input({ approvalStatus: "none" })).summary).not.toEqual(
      campaignPhase(input({ approvalStatus: "expired" })).summary,
    );
  });
});

describe("a signal that could not be read", () => {
  it("reports unreadable deliverables as undetermined, never as zero", () => {
    const outcome = campaignPhase(input({ deliverables: null }));

    expect(outcome.undetermined).toContain("deliverables");
    expect(outcome.facts).toContainEqual({
      label: "Finished outputs",
      value: null,
      undetermined: true,
    });
  });

  it("never offers a next action built on a count nobody could read", () => {
    // Offering "review the outputs" when the outputs could not be counted would
    // send somebody to a screen that may be empty for a different reason.
    expect(campaignPhase(input({ deliverables: null })).nextAction).toBeNull();
  });

  it("withholds the publication action when launch authority is unknown", () => {
    const outcome = campaignPhase(input({ launchAuthorized: null }));

    expect(outcome.undetermined).toContain("launch");
    expect(outcome.nextAction).toBeNull();
  });

  it("distinguishes 'not authorized' from 'could not tell'", () => {
    const unknown = campaignPhase(input({ launchAuthorized: null }));
    const refused = campaignPhase(input({ launchAuthorized: false }));

    expect(unknown.facts).toContainEqual({
      label: "Publication",
      value: null,
      undetermined: true,
    });
    expect(refused.facts).toContainEqual({ label: "Publication", value: "Not authorized" });
  });
});

describe("history outliving authority", () => {
  it("keeps a settled campaign settled after its approval lapses", () => {
    // C09: rollback stops new admissions while leaving history readable. A
    // campaign that ran and settled does not become un-run when its approval
    // expires.
    const outcome = campaignPhase(
      input({ settledAt: "2026-09-01T00:00:00.000Z", approvalStatus: "expired" }),
    );

    expect(outcome.phase).toBe("settled");
  });

  it("reports a settled campaign as having nothing left to do", () => {
    expect(
      campaignPhase(input({ settledAt: "2026-09-01T00:00:00.000Z" })).nextAction,
    ).toBeNull();
  });
});

describe("a campaign that is not going anywhere", () => {
  it.each(["cancelled", "failed", "blocked"] as const)("reports %s as stopped", (state) => {
    expect(campaignPhase(input({ state })).phase).toBe("stopped");
  });

  it("invents no recovery step, because the right one depends on why it stopped", () => {
    expect(campaignPhase(input({ state: "failed" })).nextAction).toBeNull();
  });

  it("still reports a stopped campaign's settled result", () => {
    const outcome = campaignPhase(
      input({ state: "cancelled", settledAt: "2026-09-01T00:00:00.000Z" }),
    );

    expect(outcome.phase).toBe("settled");
  });
});

describe("a campaign with no proposal", () => {
  it("asks for generation rather than for a review of nothing", () => {
    const outcome = campaignPhase(input({ hasVersion: false, approvalStatus: "none" }));

    expect(outcome.phase).toBe("drafting");
    expect(outcome.nextAction).toMatchObject({ key: "generate" });
  });
});

describe("who the next action belongs to", () => {
  it("asks for publish rights to authorize publication, not merely approve rights", () => {
    expect(campaignPhase(input({ launchAuthorized: false })).nextAction).toMatchObject({
      permission: "campaign.publish",
    });
  });

  it("asks only for approve rights to review an output", () => {
    expect(campaignPhase(input({ deliverables: tally({ approved: 1 }) })).nextAction).toMatchObject(
      { permission: "campaign.approve" },
    );
  });
});

describe("placing a phase on the strip", () => {
  it("orders the working phases", () => {
    expect(phasePosition("drafting")).toBe(0);
    expect(phasePosition("publishing")).toBe(4);
  });

  it("gives an ending no position, rather than putting it back at the start", () => {
    expect(phasePosition("settled")).toBeNull();
    expect(phasePosition("stopped")).toBeNull();
  });
});
