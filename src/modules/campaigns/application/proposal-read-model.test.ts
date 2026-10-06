import { describe, expect, it } from "vitest";

import { type CampaignProposalDocument } from "@/domain/campaigns/proposal";
import { proposalDigest } from "@/domain/campaigns/proposal-digest";
import {
  laneProposals,
  toProposalCard,
  toProposalCards,
  toProposalLane,
  toProposalReview,
  type ProposalDecisionRow,
  type ProposalRow,
  type ProposalVersionRow,
} from "@/modules/campaigns/application/proposal-read-model";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION = "22222222-2222-4222-8222-222222222222";
const MANIFEST = "33333333-3333-4333-8333-333333333333";
const PROPOSAL = "44444444-4444-4444-8444-444444444444";
const VERSION = "55555555-5555-4555-8555-555555555555";
const CAMPAIGN = "66666666-6666-4666-8666-666666666666";
const DECISION = "77777777-7777-4777-8777-777777777777";

function document(overrides: Partial<CampaignProposalDocument> = {}): CampaignProposalDocument {
  return {
    schemaVersion: 1,
    title: "Weekday lunch footfall",
    businessProblem: "Weekday lunch covers are down against the same weeks last quarter.",
    objective: "acquisition",
    audience: "People working within a short walk who do not currently order lunch here.",
    offer: { kind: "no_offer" },
    channels: [{ channelKey: "instagram", delivery: "organic" }],
    deliverables: [{ format: "feed", language: "en", count: 3 }],
    timing: { startAt: "2026-09-20T00:00:00.000Z", endAt: null, timezone: "Asia/Dubai" },
    proposedMediaBudget: null,
    generationCostCeiling: { amountMinor: 8000, currency: "AED" },
    successPlan: {
      primaryMetricKey: "weekday_lunch_covers",
      baselineSource: "point_of_sale",
      baselineRevision: 4,
      baselineFrom: "2026-06-01T00:00:00.000Z",
      baselineTo: "2026-08-31T00:00:00.000Z",
      observationWindowDays: 28,
      reportingDelayDays: 2,
      settlementDelayDays: 7,
      measurementMethod: "pre_post_with_baseline",
      target: null,
      missingData: [],
    },
    pausePolicyRef: "default_pause_policy",
    evidence: [
      {
        kind: "business_memory_context",
        organizationId: ORGANIZATION,
        contextManifestId: MANIFEST,
        sourceRevision: 4,
        observedFrom: "2026-06-01T00:00:00.000Z",
        observedTo: "2026-08-31T00:00:00.000Z",
        supports: "internal_fact",
      },
    ],
    memoryContextManifestId: MANIFEST,
    assumptions: ["Lunch service capacity is not the binding constraint."],
    limitations: [],
    readiness: { canPrepare: true, canLaunch: false, blockers: [] },
    ...overrides,
  };
}

function proposal(overrides: Partial<ProposalRow> = {}): ProposalRow {
  return {
    id: PROPOSAL,
    sourceKind: "business_signal",
    sourceId: null,
    state: "ready_for_review",
    currentVersionId: VERSION,
    linkedCampaignId: null,
    snoozedUntil: null,
    createdAt: "2026-09-14T08:00:00.000Z",
    updatedAt: "2026-09-15T08:00:00.000Z",
    ...overrides,
  };
}

function version(overrides: Partial<ProposalVersionRow> = {}): ProposalVersionRow {
  const stored = document();
  return {
    id: VERSION,
    proposalId: PROPOSAL,
    version: 1,
    document: stored,
    digest: proposalDigest(stored),
    createdAt: "2026-09-15T07:00:00.000Z",
    ...overrides,
  };
}

function decision(overrides: Partial<ProposalDecisionRow> = {}): ProposalDecisionRow {
  return {
    id: DECISION,
    proposalId: PROPOSAL,
    proposalVersionId: VERSION,
    proposalDigest: proposalDigest(document()),
    decision: "changes_requested",
    reason: null,
    instructions: "Say what the offer is.",
    snoozedUntil: null,
    decidedAt: "2026-09-15T09:00:00.000Z",
    ...overrides,
  };
}

describe("what a person may be shown about a proposal", () => {
  it("reads a complete proposal as decidable", () => {
    const card = toProposalCard({
      proposal: proposal(),
      version: version(),
      decisions: [],
    });

    expect(card?.decidable).toBe(true);
    expect(card?.content.kind).toBe("document");
  });

  it("treats a proposal with no version yet as awaiting research, not as broken", () => {
    // A proposal row is created before its document exists. This is the normal
    // first minute of its life, and it must not read as an error.
    const card = toProposalCard({
      proposal: proposal({ state: "researching", currentVersionId: null }),
      version: null,
      decisions: [],
    });

    expect(card?.content).toEqual({ kind: "awaiting_research" });
    expect(card?.decidable).toBe(false);
  });

  it("reports a stored document that no longer validates as unreadable", () => {
    const card = toProposalCard({
      proposal: proposal(),
      version: version({ document: { schemaVersion: 1, title: "Half a proposal" } }),
      decisions: [],
    });

    // Half a proposal is not a smaller argument for spending money, it is an
    // unreliable one, so no part of it is rendered and nothing is decidable.
    expect(card?.content).toEqual({ kind: "unreadable" });
    expect(card?.decidable).toBe(false);
  });

  it("refuses to call a decidable state decidable when there is nothing to decide on", () => {
    // The database binds a decision to the current version's digest. With no
    // readable document there is no digest, so the decision could only fail.
    const card = toProposalCard({
      proposal: proposal({ state: "ready_for_review" }),
      version: version({ document: { nonsense: true } }),
      decisions: [],
    });

    expect(card?.decidable).toBe(false);
  });

  it.each([
    ["ready_for_review", true],
    ["changes_requested", true],
    ["snoozed", true],
    ["researching", false],
    ["needs_input", false],
    ["approved_for_preparation", false],
    ["dismissed", false],
  ] as const)("admits a decision from %s: %s", (state, expected) => {
    const card = toProposalCard({
      proposal: proposal({ state, snoozedUntil: state === "snoozed" ? "2026-10-01T00:00:00.000Z" : null }),
      version: version(),
      decisions: [],
    });

    // Mirrors the `campaign_proposal_not_decidable` guard exactly. Offering a
    // control the database will refuse teaches people to distrust the screen.
    expect(card?.decidable).toBe(expected);
  });

  it("drops a row whose state this build does not know", () => {
    // Every sentence and every control is chosen by the state. Guessing at one
    // would put words on screen nothing behind them supports.
    expect(
      toProposalCard({ proposal: proposal({ state: "half_baked" }), version: version(), decisions: [] }),
    ).toBeNull();
  });

  it("says whether an earlier decision still describes what is on screen", () => {
    const superseded = decision({ proposalDigest: "0".repeat(64) });
    const card = toProposalCard({
      proposal: proposal(),
      version: version(),
      decisions: [superseded],
    });

    // An approval recorded against text that has since changed is history, not
    // standing authority, and the surface has to be able to say so.
    expect(card?.lastDecision?.appliesToCurrentContent).toBe(false);
  });

  it("puts the newest decision first", () => {
    const card = toProposalCard({
      proposal: proposal(),
      version: version(),
      decisions: [
        decision({ id: "88888888-8888-4888-8888-888888888888", decidedAt: "2026-09-13T09:00:00.000Z" }),
        decision({ decidedAt: "2026-09-15T09:00:00.000Z" }),
      ],
    });

    expect(card?.lastDecision?.decidedAt).toBe("2026-09-15T09:00:00.000Z");
  });
});

describe("the campaign lane in Growth Intelligence", () => {
  it("keeps what is still in the conversation, newest movement first", () => {
    const lane = toProposalLane([
      {
        proposal: proposal({ id: PROPOSAL, updatedAt: "2026-09-10T08:00:00.000Z" }),
        version: version(),
        decisions: [],
      },
      {
        proposal: proposal({
          id: "99999999-9999-4999-8999-999999999999",
          updatedAt: "2026-09-15T08:00:00.000Z",
        }),
        version: version({ id: VERSION, proposalId: "99999999-9999-4999-8999-999999999999" }),
        decisions: [],
      },
    ]);

    expect(lane.map((card) => card.updatedAt)).toEqual([
      "2026-09-15T08:00:00.000Z",
      "2026-09-10T08:00:00.000Z",
    ]);
  });

  it.each(["dismissed", "superseded", "cancelled"] as const)(
    "leaves a %s proposal out of the lane",
    (state) => {
      // Still readable at its own address. It just does not sit in a lane
      // asking to be acted on.
      expect(
        toProposalLane([{ proposal: proposal({ state }), version: version(), decisions: [] }]),
      ).toEqual([]);
    },
  );

  it("keeps an approved proposal, because its card is the way to the campaign", () => {
    const lane = toProposalLane([
      {
        proposal: proposal({ state: "approved_for_preparation", linkedCampaignId: CAMPAIGN }),
        version: version(),
        decisions: [],
      },
    ]);

    expect(lane).toHaveLength(1);
    expect(lane[0]?.linkedCampaignId).toBe(CAMPAIGN);
    expect(lane[0]?.decidable).toBe(false);
  });
});

describe("the review of one proposal", () => {
  it("states what approving it would authorize, and what it would not", () => {
    const review = toProposalReview({
      organizationId: ORGANIZATION,
      proposal: proposal(),
      version: version(),
      decisions: [],
    });

    // Every one of these is false and always will be. Approval is gate one.
    expect(review?.authority).toEqual({
      mayPrepareCreative: true,
      mayReserveMediaSpend: false,
      mayPublish: false,
      mayConfirmCreative: false,
      mayAuthorizeLaterVariation: false,
      generationCostCeiling: { amountMinor: 8000, currency: "AED" },
    });
  });

  it("will not say preparation is permitted while the proposal says it is blocked", () => {
    const blocked = document({
      readiness: { canPrepare: false, canLaunch: false, blockers: ["No connected channel"] },
    });
    const review = toProposalReview({
      organizationId: ORGANIZATION,
      proposal: proposal(),
      version: version({ document: blocked, digest: proposalDigest(blocked) }),
      decisions: [],
    });

    expect(review?.authority?.mayPrepareCreative).toBe(false);
  });

  it("names the gaps without refusing the proposal over them", () => {
    const modest = document({
      evidence: [],
      assumptions: ["Footfall has not changed."],
      limitations: ["No competitor pricing was available."],
      successPlan: { ...document().successPlan, missingData: ["No point-of-sale baseline yet."] },
    });
    const review = toProposalReview({
      organizationId: ORGANIZATION,
      proposal: proposal(),
      version: version({ document: modest, digest: proposalDigest(modest) }),
      decisions: [],
    });

    // D07: a proposal built on the client's own evidence, with no estimate and
    // no external research, is still worth reading — provided it says so.
    expect(review?.refusal).toBeNull();
    expect(review?.decidable).toBe(true);
    expect(review?.declaredGaps).toEqual(
      expect.arrayContaining([
        "No point-of-sale baseline yet.",
        "No competitor pricing was available.",
        "No external market research supports this.",
        "No profit or outcome estimate is attached.",
      ]),
    );
  });

  it("withholds a proposal citing another organization's records, and says so", () => {
    const leaked = document({
      evidence: [
        {
          kind: "business_memory_context",
          organizationId: OTHER_ORGANIZATION,
          contextManifestId: MANIFEST,
          sourceRevision: 4,
          observedFrom: "2026-06-01T00:00:00.000Z",
          observedTo: "2026-08-31T00:00:00.000Z",
          supports: "internal_fact",
        },
      ],
    });
    const review = toProposalReview({
      organizationId: ORGANIZATION,
      proposal: proposal(),
      version: version({ document: leaked, digest: proposalDigest(leaked) }),
      decisions: [],
    });

    // Not decidable whatever its state says: this is about evidence that must
    // not be shown to anyone here.
    expect(review?.decidable).toBe(false);
    expect(review?.refusal).toMatch(/do not belong to this organization/i);
    expect(review?.declaredGaps).toEqual([]);
  });

  it("refuses a proposal with no evidence and no stated assumption", () => {
    const empty = document({ evidence: [], assumptions: [] });
    const review = toProposalReview({
      organizationId: ORGANIZATION,
      proposal: proposal(),
      version: version({ document: empty, digest: proposalDigest(empty) }),
      decisions: [],
    });

    expect(review?.decidable).toBe(false);
    expect(review?.refusal).toMatch(/nothing to review/i);
  });

  it("carries no authority and no gaps for a proposal still being researched", () => {
    const review = toProposalReview({
      organizationId: ORGANIZATION,
      proposal: proposal({ state: "researching", currentVersionId: null }),
      version: null,
      decisions: [],
    });

    expect(review?.authority).toBeNull();
    expect(review?.declaredGaps).toEqual([]);
    expect(review?.refusal).toBeNull();
  });

  it("returns every decision, not just the last one", () => {
    const review = toProposalReview({
      organizationId: ORGANIZATION,
      proposal: proposal(),
      version: version(),
      decisions: [
        decision({ decidedAt: "2026-09-15T09:00:00.000Z" }),
        decision({
          id: "88888888-8888-4888-8888-888888888888",
          decision: "snoozed",
          snoozedUntil: "2026-09-20T00:00:00.000Z",
          decidedAt: "2026-09-14T09:00:00.000Z",
        }),
      ],
    });

    expect(review?.decisions).toHaveLength(2);
    expect(review?.decisions[0]?.decision).toBe("changes_requested");
  });

  it("drops a decision kind it cannot name rather than showing it as something else", () => {
    const review = toProposalReview({
      organizationId: ORGANIZATION,
      proposal: proposal(),
      version: version(),
      decisions: [decision({ decision: "vetoed" })],
    });

    // Mislabelling what a person decided is the one thing this record exists
    // to prevent.
    expect(review?.decisions).toEqual([]);
  });
});

describe("what the lane keeps and what the history keeps", () => {
  function bundle(state: string, id = PROPOSAL) {
    return {
      proposal: proposal({ id, state }),
      version: version({ proposalId: id }),
      decisions: [decision({ proposalId: id, decision: "dismissed", reason: "Not this quarter." })],
    };
  }

  it("keeps a dismissed proposal in the full projection", () => {
    // The lane drops it, but what a person turned down is one of the most
    // useful things in a record of what they decided.
    const cards = toProposalCards([bundle("dismissed")]);

    expect(cards).toHaveLength(1);
    expect(cards[0]?.decisions[0]?.decision).toBe("dismissed");
  });

  it.each(["dismissed", "superseded", "cancelled"] as const)(
    "drops a %s proposal from the lane only",
    (state) => {
      const cards = toProposalCards([bundle(state)]);

      expect(cards).toHaveLength(1);
      expect(laneProposals(cards)).toEqual([]);
    },
  );

  it("carries every decision, not only the newest", () => {
    const cards = toProposalCards([
      {
        proposal: proposal({ state: "changes_requested" }),
        version: version(),
        decisions: [
          decision({ decidedAt: "2026-09-15T09:00:00.000Z" }),
          decision({
            id: "88888888-8888-4888-8888-888888888888",
            decision: "snoozed",
            snoozedUntil: "2026-09-20T00:00:00.000Z",
            decidedAt: "2026-09-13T09:00:00.000Z",
          }),
        ],
      },
    ]);

    expect(cards[0]?.decisions.map((entry) => entry.decision)).toEqual([
      "changes_requested",
      "snoozed",
    ]);
    expect(cards[0]?.lastDecision?.decidedAt).toBe("2026-09-15T09:00:00.000Z");
  });
});
