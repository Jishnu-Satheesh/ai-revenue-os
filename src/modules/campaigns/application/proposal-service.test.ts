import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CampaignProposalDocument } from "@/domain/campaigns/proposal";
import { proposalDigest } from "@/domain/campaigns/proposal-digest";
import {
  createCampaignProposalService,
  proposalOutcomeStatus,
  type ProposalStore,
} from "@/modules/campaigns/application/proposal-service";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION = "22222222-2222-4222-8222-222222222222";
const PROPOSAL = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const MANIFEST = "55555555-5555-4555-8555-555555555555";
const LINKED_CAMPAIGN = "77777777-7777-4777-8777-777777777777";
const SNAPSHOT = "88888888-8888-4888-8888-888888888888";

function document(overrides: Partial<CampaignProposalDocument> = {}): CampaignProposalDocument {
  return {
    schemaVersion: 1,
    title: "Weekday lunch footfall",
    businessProblem: "Weekday lunch covers are down against the same weeks last quarter.",
    objective: "acquisition",
    audience: "People working within a short walk who do not order lunch here.",
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
    assumptions: ["Lunch capacity is not the binding constraint."],
    limitations: [],
    readiness: { canPrepare: true, canLaunch: false, blockers: ["No connected channel"] },
    ...overrides,
  };
}

const store = {
  requestProposal: vi.fn(),
  completeVersion: vi.fn(),
  decide: vi.fn(),
  readVersionDocument: vi.fn(),
  readContextManifest: vi.fn(),
  pinApprovalSnapshot: vi.fn(),
} satisfies Record<keyof ProposalStore, ReturnType<typeof vi.fn>>;

function service() {
  return createCampaignProposalService({ store: store as unknown as ProposalStore });
}

beforeEach(() => {
  Object.values(store).forEach((fn) => fn.mockReset());
  store.requestProposal.mockResolvedValue({ proposalId: PROPOSAL, outcome: "saved" });
  store.completeVersion.mockResolvedValue({
    proposalVersionId: VERSION,
    version: 1,
    digest: proposalDigest(document()),
  });
  store.decide.mockResolvedValue({
    decisionId: "66666666-6666-4666-8666-666666666666",
    outcome: "saved",
    linkedCampaignId: LINKED_CAMPAIGN,
  });
  store.readVersionDocument.mockResolvedValue(document());
  store.readContextManifest.mockResolvedValue({ id: MANIFEST });
  store.pinApprovalSnapshot.mockResolvedValue({ sourceSnapshotId: SNAPSHOT, refreshed: true });
});

describe("opening a proposal", () => {
  it("reports a replay as a replay rather than a second proposal", async () => {
    store.requestProposal.mockResolvedValue({ proposalId: PROPOSAL, outcome: "replayed" });

    const outcome = await service().request({
      organizationId: ORGANIZATION,
      request: { sourceKind: "business_signal", dedupeFingerprint: "weekday-lunch" },
    });

    expect(outcome).toEqual({ status: "replayed", value: { proposalId: PROPOSAL } });
    expect(proposalOutcomeStatus(outcome)).toBe(200);
  });

  it("never lets the caller name its own tenant", async () => {
    await service().request({
      organizationId: ORGANIZATION,
      request: { sourceKind: "manual_request" },
    });

    expect(store.requestProposal).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION }),
    );
  });
});

describe("writing a revision", () => {
  it("digests the document itself rather than trusting a supplied digest", async () => {
    await service().requestRevision({
      organizationId: ORGANIZATION,
      request: { proposalId: PROPOSAL, document: document() },
    });

    expect(store.completeVersion).toHaveBeenCalledWith(
      expect.objectContaining({ digest: proposalDigest(document()) }),
    );
  });

  it("admits a proposal with no estimate and no external research (D07)", async () => {
    const outcome = await service().requestRevision({
      organizationId: ORGANIZATION,
      request: { proposalId: PROPOSAL, document: document() },
    });

    expect(outcome.status).toBe("saved");
  });

  it("refuses a market claim with no citation, and says which gap it is", async () => {
    const outcome = await service().requestRevision({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        document: document(),
        marketClaimKeys: ["delivery_demand_is_growing"],
      },
    });

    expect(outcome).toMatchObject({
      status: "needs_input",
      reasonCode: "market_claim_without_citation",
    });
    expect(proposalOutcomeStatus(outcome)).toBe(422);
    expect(store.completeVersion).not.toHaveBeenCalled();
  });

  it("treats another tenant's evidence as a tenancy refusal, not a drafting note", async () => {
    const outcome = await service().requestRevision({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        document: document({
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
        }),
      },
    });

    expect(outcome).toEqual({ status: "forbidden" });
    expect(proposalOutcomeStatus(outcome)).toBe(403);
    expect(store.completeVersion).not.toHaveBeenCalled();
  });
});

describe("deciding a proposal", () => {
  it("reports exactly what an approval authorized", async () => {
    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-11",
      },
    });

    expect(outcome.status).toBe("saved");
    const value = outcome.status === "saved" ? outcome.value : null;
    expect(value?.authority).toMatchObject({
      mayPrepareCreative: true,
      mayReserveMediaSpend: false,
      mayPublish: false,
      mayConfirmCreative: false,
      mayAuthorizeLaterVariation: false,
    });
  });

  it("attaches no authority at all to a rejection", async () => {
    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "dismissed",
        reason: "Not this quarter.",
        idempotencyKey: "owner-dismisses-11",
      },
    });

    const value = outcome.status === "saved" ? outcome.value : null;
    expect(value?.authority).toBeNull();
    expect(store.readVersionDocument).not.toHaveBeenCalled();
  });

  it("maps a stale revision to a conflict the caller can act on", async () => {
    store.decide.mockRejectedValue({ kind: "stale_version" });

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "stale-approval-11",
      },
    });

    expect(outcome).toEqual({ status: "stale_version" });
    expect(proposalOutcomeStatus(outcome)).toBe(409);
  });

  it("answers 'not visible' the same way as 'not permitted', so neither confirms the other tenant", async () => {
    store.decide.mockRejectedValue({ kind: "not_found" });

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "dismissed",
        idempotencyKey: "foreign-proposal-11",
      },
    });

    expect(outcome).toEqual({ status: "forbidden" });
  });

  it("refuses a snooze with no date rather than snoozing forever", async () => {
    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "snoozed",
        idempotencyKey: "snooze-forever-11",
      },
    });

    expect(outcome).toMatchObject({ status: "needs_input", reasonCode: "snooze_requires_until" });
    expect(store.decide).not.toHaveBeenCalled();
  });

  it("passes the idempotency key through so a double click cannot approve twice", async () => {
    await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-11",
      },
    });

    expect(store.decide).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: "owner-approves-11" }),
    );
  });

  it("refuses an actor supplied in the request body", async () => {
    await expect(
      service().decide({
        organizationId: ORGANIZATION,
        request: {
          proposalId: PROPOSAL,
          proposalVersionId: VERSION,
          proposalDigest: proposalDigest(document()),
          decision: "approved_for_preparation",
          idempotencyKey: "forged-actor-11",
          actorId: "88888888-8888-4888-8888-888888888888",
        } as never,
      }),
    ).rejects.toThrow();
  });

  it("will not accept an approval whose readiness blocks preparation", async () => {
    store.readVersionDocument.mockResolvedValue(
      document({ readiness: { canPrepare: false, canLaunch: false, blockers: ["No subject"] } }),
    );

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "not-ready-11",
      },
    });

    const value = outcome.status === "saved" ? outcome.value : null;
    expect(value?.authority?.mayPrepareCreative).toBe(false);
  });

  it("pins an approval-time snapshot from the evidence the approved version cited", async () => {
    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-12",
      },
    });

    expect(outcome.status).toBe("saved");
    expect(store.pinApprovalSnapshot).toHaveBeenCalledTimes(1);
    expect(store.pinApprovalSnapshot).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      campaignId: LINKED_CAMPAIGN,
    });
  });

  it("pins nothing when the approved version cites no evidence, leaving the honest refusal in place", async () => {
    store.readVersionDocument.mockResolvedValue(
      document({ evidence: [], memoryContextManifestId: null }),
    );

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-13",
      },
    });

    expect(outcome.status).toBe("saved");
    expect(store.pinApprovalSnapshot).not.toHaveBeenCalled();
  });

  it("pins nothing for a rejection, which mints no campaign to pin for", async () => {
    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "dismissed",
        reason: "Not this quarter.",
        idempotencyKey: "owner-dismisses-12",
      },
    });

    expect(outcome.status).toBe("saved");
    expect(store.pinApprovalSnapshot).not.toHaveBeenCalled();
  });

  it("pins on a replayed approval too, healing campaigns approved before the link existed", async () => {
    store.decide.mockResolvedValue({
      decisionId: "66666666-6666-4666-8666-666666666666",
      outcome: "replayed",
      linkedCampaignId: LINKED_CAMPAIGN,
    });

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-12",
      },
    });

    expect(outcome).toMatchObject({ status: "replayed" });
    expect(store.pinApprovalSnapshot).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      campaignId: LINKED_CAMPAIGN,
    });
  });

  it("leaves a recorded approval standing when the pin cannot be written", async () => {
    store.pinApprovalSnapshot.mockResolvedValue({ sourceSnapshotId: null, refreshed: false });

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-14",
      },
    });

    expect(outcome.status).toBe("saved");
    const value = outcome.status === "saved" ? outcome.value : null;
    expect(value?.linkedCampaignId).toBe(LINKED_CAMPAIGN);
  });

  it("leaves a recorded approval standing when the pin transport itself throws", async () => {
    store.pinApprovalSnapshot.mockRejectedValue(new Error("boom"));

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-15",
      },
    });

    expect(outcome.status).toBe("saved");
    const value = outcome.status === "saved" ? outcome.value : null;
    expect(value?.linkedCampaignId).toBe(LINKED_CAMPAIGN);
  });

  it("pins on a manifest standing alone once this tenant owns it", async () => {
    store.readVersionDocument.mockResolvedValue(document({ evidence: [] }));

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-16",
      },
    });

    expect(outcome.status).toBe("saved");
    expect(store.readContextManifest).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      manifestId: MANIFEST,
    });
    expect(store.pinApprovalSnapshot).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      campaignId: LINKED_CAMPAIGN,
    });
  });

  it("authorizes no pin from a manifest this tenant does not own", async () => {
    store.readVersionDocument.mockResolvedValue(
      document({
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
        memoryContextManifestId: MANIFEST,
      }),
    );
    store.readContextManifest.mockResolvedValue(null);

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-17",
      },
    });

    expect(outcome.status).toBe("saved");
    expect(store.pinApprovalSnapshot).not.toHaveBeenCalled();
  });

  it("refuses a cross-tenant decide and writes no snapshot for it", async () => {
    store.decide.mockRejectedValue({ kind: "not_found" });

    const outcome = await service().decide({
      organizationId: ORGANIZATION,
      request: {
        proposalId: PROPOSAL,
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "foreign-approval-11",
      },
    });

    expect(outcome).toEqual({ status: "forbidden" });
    expect(store.readVersionDocument).not.toHaveBeenCalled();
    expect(store.readContextManifest).not.toHaveBeenCalled();
    expect(store.pinApprovalSnapshot).not.toHaveBeenCalled();
  });
});
