import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";
import { createDeliverableRouteHandlers } from "@/modules/campaigns/application/deliverable-route-handlers";
import type { DeliverableRouteContext } from "@/modules/campaigns/application/deliverable-route-handlers";
import type { CampaignDeliverableService } from "@/modules/campaigns/application/deliverable-service";

const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN = "22222222-2222-4222-8222-222222222222";
const VERSION = "44444444-4444-4444-8444-444444444444";
const HASH = "a".repeat(64);

const service = {
  recordVersion: vi.fn(),
  reviewVersion: vi.fn(),
  publicationEligibility: vi.fn(),
  listForCampaign: vi.fn(),
  completion: vi.fn(),
};

const context = vi.fn();

function handlers() {
  return createDeliverableRouteHandlers({
    context,
    serviceFor: () => service as unknown as CampaignDeliverableService,
  });
}

function params(extra: Record<string, string> = {}) {
  return Promise.resolve({
    organizationId: ORGANIZATION,
    campaignId: CAMPAIGN,
    deliverableVersionId: VERSION,
    ...extra,
  });
}

function post(body: unknown) {
  return new Request("https://example.test/api/deliverables", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function approvalBody(overrides: Record<string, unknown> = {}) {
  return {
    contentHash: HASH,
    decision: "approved",
    idempotencyKey: "reviewer-approves-11",
    ...overrides,
  };
}

beforeEach(() => {
  Object.values(service).forEach((fn) => fn.mockReset());
  context.mockReset();
  context.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: "user" },
    supabase: {},
    membership: { role: "owner" },
  } satisfies DeliverableRouteContext);
  service.reviewVersion.mockResolvedValue({
    status: "saved",
    value: { reviewId: "review" },
  });
  service.publicationEligibility.mockResolvedValue({ publishable: true });
  service.listForCampaign.mockResolvedValue([]);
});

describe("who may review a finished output", () => {
  it("demands the version-approval capability", async () => {
    await handlers().review(post(approvalBody()), params());

    expect(context).toHaveBeenCalledWith(expect.anything(), "campaign.approve");
  });

  it("asks only for read rights to see which outputs may be published", async () => {
    await handlers().list(new Request("https://example.test/d"), params());

    expect(context).toHaveBeenCalledWith(expect.anything(), "campaign.read");
  });

  it("returns 403 when the capability check refuses, without reaching the service", async () => {
    context.mockRejectedValue(new DomainError("AUTHORIZATION_ERROR", "Not permitted."));

    const response = await handlers().review(post(approvalBody()), params());

    expect(response.status).toBe(403);
    expect(service.reviewVersion).not.toHaveBeenCalled();
  });
});

describe("what a request body may say", () => {
  it("takes the version from the path, so a body cannot review a different output", async () => {
    const other = "99999999-9999-4999-8999-999999999999";
    const response = await handlers().review(
      post(approvalBody({ deliverableVersionId: other })),
      params(),
    );

    // A stray field is a refusal, not something quietly ignored.
    expect(response.status).toBe(400);
    expect(service.reviewVersion).not.toHaveBeenCalled();
  });

  it("refuses a body naming its own reviewer", async () => {
    const response = await handlers().review(
      post(approvalBody({ actorId: "77777777-7777-4777-8777-777777777777" })),
      params(),
    );

    expect(response.status).toBe(400);
    expect(service.reviewVersion).not.toHaveBeenCalled();
  });

  it("refuses a body naming its own tenant", async () => {
    const response = await handlers().review(
      post(approvalBody({ organizationId: "88888888-8888-4888-8888-888888888888" })),
      params(),
    );

    expect(response.status).toBe(400);
  });

  it("never lets the caller name the tenant it writes to", async () => {
    await handlers().review(post(approvalBody()), params());

    expect(service.reviewVersion).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: ORGANIZATION }),
    );
  });

  it("refuses a malformed version id in the path", async () => {
    const response = await handlers().review(
      post(approvalBody()),
      params({ deliverableVersionId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(service.reviewVersion).not.toHaveBeenCalled();
  });

  it("refuses a body that is not valid JSON", async () => {
    const response = await handlers().review(
      new Request("https://example.test/api/deliverables", { method: "POST", body: "{" }),
      params(),
    );

    expect(response.status).toBe(400);
  });
});

describe("how an outcome reaches the client", () => {
  it("reports a saved review as 201", async () => {
    const response = await handlers().review(post(approvalBody()), params());

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      outcome: "saved",
      reviewId: "review",
    });
  });

  it("reports a replay as 200, so a retry does not look like a second review", async () => {
    service.reviewVersion.mockResolvedValue({
      status: "replayed",
      value: { reviewId: "review" },
    });

    const response = await handlers().review(post(approvalBody()), params());

    expect(response.status).toBe(200);
  });

  it("says why a rejection was refused rather than reporting an empty success", async () => {
    service.reviewVersion.mockResolvedValue({
      status: "needs_input",
      reasonCode: "rejection_requires_reason",
    });

    const response = await handlers().review(
      post(approvalBody({ decision: "rejected" })),
      params(),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      outcome: "needs_input",
      reasonCode: "rejection_requires_reason",
    });
  });

  it("reports bytes that moved as a conflict, not as a malformed request", async () => {
    service.reviewVersion.mockResolvedValue({ status: "content_changed" });

    const response = await handlers().review(post(approvalBody()), params());

    // Nothing was wrong with what was sent. The output changed underneath it,
    // and the honest answer is "look at what is there now".
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ outcome: "content_changed" });
  });

  it("reports a superseded version distinctly from a changed one", async () => {
    service.reviewVersion.mockResolvedValue({ status: "superseded" });

    const response = await handlers().review(post(approvalBody()), params());

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ outcome: "superseded" });
  });

  it("reports an unreachable database as 503, never as a business refusal", async () => {
    service.reviewVersion.mockResolvedValue({ status: "unavailable" });

    const response = await handlers().review(post(approvalBody()), params());

    expect(response.status).toBe(503);
  });

  it("returns each output with its verdict and the reason it is blocked", async () => {
    service.listForCampaign.mockResolvedValue([
      {
        id: "deliverable",
        channel: "instagram",
        placement: "feed",
        language: "en",
        format: "feed",
        ordinal: 1,
        state: "ready_for_review",
        currentVersion: { id: VERSION, version: 1, contentHash: HASH, createdAt: "2026-09-13T10:00:00.000Z" },
        eligibility: { publishable: false, reasonCode: "never_reviewed" },
      },
    ]);

    const response = await handlers().list(new Request("https://example.test/d"), params());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deliverables: [{ eligibility: { publishable: false, reasonCode: "never_reviewed" } }],
    });
  });

  it("lists a planned output that was never produced rather than hiding it", async () => {
    // An incomplete campaign must look incomplete, not finished.
    service.listForCampaign.mockResolvedValue([
      {
        id: "deliverable",
        channel: "instagram",
        placement: "feed",
        language: "ar",
        format: "feed",
        ordinal: 2,
        state: "preparing",
        currentVersion: null,
        eligibility: { publishable: false, reasonCode: "never_reviewed" },
      },
    ]);

    const response = await handlers().list(new Request("https://example.test/d"), params());

    await expect(response.json()).resolves.toMatchObject({
      deliverables: [{ currentVersion: null, state: "preparing" }],
    });
  });

  it("refuses a malformed campaign id in the path", async () => {
    const response = await handlers().list(
      new Request("https://example.test/d"),
      params({ campaignId: "not-a-uuid" }),
    );

    expect(response.status).toBe(400);
    expect(service.listForCampaign).not.toHaveBeenCalled();
  });
});
