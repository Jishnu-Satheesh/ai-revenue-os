import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import type { CampaignProposalDocument } from "@/domain/campaigns/proposal";
import { proposalDigest } from "@/domain/campaigns/proposal-digest";
import { createProposalRouteHandlers } from "@/modules/campaigns/application/proposal-route-handlers";
import type { ProposalRouteContext } from "@/modules/campaigns/application/proposal-route-handlers";
import type { CampaignProposalService } from "@/modules/campaigns/application/proposal-service";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const PROPOSAL = "33333333-3333-4333-8333-333333333333";
const VERSION = "44444444-4444-4444-8444-444444444444";
const MANIFEST = "55555555-5555-4555-8555-555555555555";

function document(): CampaignProposalDocument {
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
    readiness: { canPrepare: true, canLaunch: false, blockers: [] },
  };
}

const service = {
  request: vi.fn(),
  requestRevision: vi.fn(),
  decide: vi.fn(),
};

const context = vi.fn();

function handlers() {
  return createProposalRouteHandlers({
    context,
    serviceFor: () => service as unknown as CampaignProposalService,
  });
}

function params(extra: Record<string, string> = {}) {
  return Promise.resolve({ organizationId: ORGANIZATION, proposalId: PROPOSAL, ...extra });
}

function post(body: unknown) {
  return new Request("https://example.test/api/proposals", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  service.request.mockReset();
  service.requestRevision.mockReset();
  service.decide.mockReset();
  context.mockReset();
  context.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: "user" },
    supabase: {},
    membership: { role: "owner" },
  } satisfies ProposalRouteContext);
  service.request.mockResolvedValue({ status: "saved", value: { proposalId: PROPOSAL } });
  service.requestRevision.mockResolvedValue({
    status: "saved",
    value: { proposalVersionId: VERSION, version: 1, digest: proposalDigest(document()) },
  });
  service.decide.mockResolvedValue({
    status: "saved",
    value: { decisionId: "decision", linkedCampaignId: "campaign", authority: null },
  });
});

describe("who may approve", () => {
  it("demands the proposal-approval capability for an approval", async () => {
    await handlers().decide(
      post({
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-11",
      }),
      params(),
    );

    expect(context).toHaveBeenCalledWith(expect.anything(), "campaign.proposal_approve");
  });

  it("asks only for edit rights to request changes, which an operator holds", async () => {
    await handlers().decide(
      post({
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "changes_requested",
        reason: "Needs the lunch covers baseline.",
        idempotencyKey: "operator-changes-11",
      }),
      params(),
    );

    expect(context).toHaveBeenCalledWith(expect.anything(), "campaign.edit");
  });

  it("returns 403 when the capability check refuses, without reaching the service", async () => {
    context.mockRejectedValue(new DomainError("AUTHORIZATION_ERROR", "Not permitted."));

    const response = await handlers().decide(
      post({
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "operator-tries-11",
      }),
      params(),
    );

    expect(response.status).toBe(403);
    expect(service.decide).not.toHaveBeenCalled();
  });
});

describe("what a request body may carry", () => {
  it("refuses a body naming its own actor", async () => {
    const response = await handlers().decide(
      post({
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "forged-actor-11",
        actorId: "99999999-9999-4999-8999-999999999999",
      }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(service.decide).not.toHaveBeenCalled();
  });

  it("refuses a body naming its own organization", async () => {
    const response = await handlers().requestProposal(
      post({ sourceKind: "manual_request", organizationId: "22222222-2222-4222-8222-222222222222" }),
      params(),
    );

    expect(response.status).toBe(400);
    expect(service.request).not.toHaveBeenCalled();
  });

  it("takes the tenant from the session, not the request", async () => {
    await handlers().requestProposal(post({ sourceKind: "manual_request" }), params());

    expect(service.request).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION }),
    );
  });

  it("refuses a digest that is not a hash", async () => {
    const response = await handlers().decide(
      post({
        proposalVersionId: VERSION,
        proposalDigest: "not-a-hash",
        decision: "approved_for_preparation",
        idempotencyKey: "bad-digest-11",
      }),
      params(),
    );

    expect(response.status).toBe(400);
  });

  it("refuses a body that is not JSON at all", async () => {
    const response = await handlers().requestProposal(
      new Request("https://example.test/api/proposals", { method: "POST", body: "not json" }),
      params(),
    );

    expect(response.status).toBe(400);
  });
});

describe("how an outcome reaches the caller", () => {
  it("reports a refusal as the refusal it is, never as an empty success", async () => {
    service.requestRevision.mockResolvedValue({
      status: "needs_input",
      reasonCode: "market_claim_without_citation",
      declaredGaps: ["No external market research supports this."],
    });

    const response = await handlers().requestRevision(
      post({ document: document(), marketClaimKeys: ["delivery_demand"] }),
      params(),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "needs_input",
      reasonCode: "market_claim_without_citation",
    });
  });

  it("reports a stale revision as a conflict the caller can act on", async () => {
    service.decide.mockResolvedValue({ status: "stale_version" });

    const response = await handlers().decide(
      post({
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "stale-11",
      }),
      params(),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ outcome: "stale_version" });
  });

  it("distinguishes a replay from a fresh save by status, not only by body", async () => {
    service.request.mockResolvedValue({ status: "replayed", value: { proposalId: PROPOSAL } });

    const response = await handlers().requestProposal(
      post({ sourceKind: "business_signal", dedupeFingerprint: "weekday-lunch" }),
      params(),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ outcome: "replayed" });
  });

  it("reports an unavailable dependency as 503, not as a business refusal", async () => {
    service.decide.mockResolvedValue({ status: "unavailable" });

    const response = await handlers().decide(
      post({
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "dismissed",
        idempotencyKey: "unavailable-11",
      }),
      params(),
    );

    expect(response.status).toBe(503);
  });

  it("carries the authority an approval granted, so no caller has to assume", async () => {
    service.decide.mockResolvedValue({
      status: "saved",
      value: {
        decisionId: "decision",
        linkedCampaignId: "campaign",
        authority: {
          mayPrepareCreative: true,
          mayReserveMediaSpend: false,
          mayPublish: false,
          mayConfirmCreative: false,
          mayAuthorizeLaterVariation: false,
          generationCostCeiling: { amountMinor: 8000, currency: "AED" },
        },
      },
    });

    const response = await handlers().decide(
      post({
        proposalVersionId: VERSION,
        proposalDigest: proposalDigest(document()),
        decision: "approved_for_preparation",
        idempotencyKey: "owner-approves-11",
      }),
      params(),
    );

    await expect(response.json()).resolves.toMatchObject({
      authority: { mayPublish: false, mayReserveMediaSpend: false },
    });
  });
});
