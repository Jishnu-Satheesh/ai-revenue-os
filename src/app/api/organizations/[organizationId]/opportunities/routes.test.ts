import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "99999999-9999-4999-8999-999999999999";
const OPPORTUNITY_ID = "22222222-2222-4222-8222-222222222222";

const listOpportunities = vi.fn();
const appendFeedback = vi.fn();
const getOrganizationContext = vi.fn();
const publishOrganizationEvent = vi.fn();

vi.mock("@/lib/api/organization-context", () => ({
  apiErrorResponse: (error: unknown) =>
    Response.json(
      { error: { message: error instanceof Error ? error.message : "error" } },
      { status: 400 },
    ),
  getOrganizationContext: (...args: unknown[]) => getOrganizationContext(...args),
  publishOrganizationEvent: (...args: unknown[]) => publishOrganizationEvent(...args),
}));
vi.mock("@/modules/decisions/infrastructure/repository", () => ({
  createDecisionRepository: () => ({ listOpportunities, appendFeedback }),
}));

import { GET } from "@/app/api/organizations/[organizationId]/opportunities/route";
import { POST } from "@/app/api/organizations/[organizationId]/opportunities/[opportunityId]/feedback/route";

function feedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: OPPORTUNITY_ID,
    organizationId: ORGANIZATION_ID,
    decisionRecordId: "33333333-3333-4333-8333-333333333333",
    playbookVersionId: "44444444-4444-4444-8444-444444444444",
    title: "Run a governed Meta campaign",
    summary: "A bounded recommendation.",
    evidenceTier: "computed",
    impactLowMinor: 600_000,
    impactHighMinor: 900_000,
    executionCostMinor: 450_000,
    expectedContributionMinor: 112_500,
    currency: "AED",
    timeToImpactDays: 7,
    status: "proposed",
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function context(role: string) {
  return {
    organizationId: ORGANIZATION_ID,
    user: { id: "user-1" },
    supabase: {},
    membership: { role },
  };
}

beforeEach(() => {
  listOpportunities.mockReset();
  appendFeedback.mockReset();
  publishOrganizationEvent.mockReset();
  getOrganizationContext.mockReset();
  getOrganizationContext.mockResolvedValue(context("operator"));
});

describe("GET opportunities feed", () => {
  it("returns the tier-grouped feed for the authenticated organization", async () => {
    listOpportunities.mockResolvedValue([feedItem()]);

    const response = await GET(new Request("http://localhost/api/opportunities"), {
      params: Promise.resolve({ organizationId: ORGANIZATION_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(listOpportunities).toHaveBeenCalledWith(ORGANIZATION_ID);
    expect(body.feed.groups[0].evidenceTier).toBe("computed");
    expect(body.feed.groups[0].items[0].id).toBe(OPPORTUNITY_ID);
  });

  it("lets a viewer read the feed without offering an answer", async () => {
    getOrganizationContext.mockResolvedValue(context("viewer"));
    listOpportunities.mockResolvedValue([feedItem()]);

    const response = await GET(new Request("http://localhost/api/opportunities"), {
      params: Promise.resolve({ organizationId: ORGANIZATION_ID }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.feed.groups[0].items[0].availableActions).toEqual([]);
    expect(body.feed.groups[0].items[0].blockedReason).toBe("role_not_permitted");
  });

  it("fails closed when a row escapes the organization boundary", async () => {
    listOpportunities.mockResolvedValue([feedItem({ organizationId: OTHER_ORGANIZATION_ID })]);

    const response = await GET(new Request("http://localhost/api/opportunities"), {
      params: Promise.resolve({ organizationId: ORGANIZATION_ID }),
    });

    expect(response.status).toBe(400);
  });

  it("surfaces the membership failure rather than an empty feed", async () => {
    getOrganizationContext.mockRejectedValue(new Error("Authentication is required."));

    const response = await GET(new Request("http://localhost/api/opportunities"), {
      params: Promise.resolve({ organizationId: ORGANIZATION_ID }),
    });

    expect(response.status).toBe(400);
    expect(listOpportunities).not.toHaveBeenCalled();
  });
});

describe("POST opportunity feedback", () => {
  function request(body: unknown) {
    return new Request("http://localhost/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  const params = Promise.resolve({
    organizationId: ORGANIZATION_ID,
    opportunityId: OPPORTUNITY_ID,
  });

  it("appends an operator answer and reports the new feedback row", async () => {
    appendFeedback.mockResolvedValue("feedback-1");

    const response = await POST(request({ feedbackKind: "approved", reason: "Worth testing." }), {
      params,
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.feedbackId).toBe("feedback-1");
    expect(appendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        opportunityId: OPPORTUNITY_ID,
        feedbackKind: "approved",
        reason: "Worth testing.",
      }),
    );
  });

  it("requires a viewer to be refused before any write is attempted", async () => {
    getOrganizationContext.mockRejectedValue(new Error("Role is not permitted."));

    const response = await POST(request({ feedbackKind: "approved", reason: null }), { params });

    expect(response.status).toBe(400);
    expect(appendFeedback).not.toHaveBeenCalled();
  });

  it("asks the context for the roles that may answer an opportunity", async () => {
    appendFeedback.mockResolvedValue("feedback-1");

    await POST(request({ feedbackKind: "approved", reason: null }), { params });

    expect(getOrganizationContext).toHaveBeenCalledWith(expect.anything(), [
      "owner",
      "admin",
      "operator",
    ]);
  });

  it("rejects an edit that carries no bounded diff", async () => {
    const response = await POST(request({ feedbackKind: "edited", reason: null }), { params });

    expect(response.status).toBe(400);
    expect(appendFeedback).not.toHaveBeenCalled();
  });

  it("accepts an edit with its bounded diff and records it as a new plan source", async () => {
    appendFeedback.mockResolvedValue("feedback-2");

    const response = await POST(
      request({
        feedbackKind: "edited",
        reason: "Narrow the audience.",
        editDiff: { title: "Narrower Meta campaign" },
      }),
      { params },
    );

    expect(response.status).toBe(201);
    expect(appendFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        feedbackKind: "edited",
        editDiff: { title: "Narrower Meta campaign" },
      }),
    );
  });

  it("refuses an unknown feedback kind", async () => {
    const response = await POST(request({ feedbackKind: "promoted", reason: null }), { params });

    expect(response.status).toBe(400);
    expect(appendFeedback).not.toHaveBeenCalled();
  });

  it("refuses a body that tries to redirect the write to another organization", async () => {
    const response = await POST(
      request({
        feedbackKind: "approved",
        reason: null,
        organizationId: OTHER_ORGANIZATION_ID,
      }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(appendFeedback).not.toHaveBeenCalled();
  });

  it("refuses malformed JSON safely", async () => {
    const response = await POST(
      new Request("http://localhost/api/feedback", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(appendFeedback).not.toHaveBeenCalled();
  });

  it("rejects an opportunity id that is not a UUID", async () => {
    const response = await POST(request({ feedbackKind: "approved", reason: null }), {
      params: Promise.resolve({ organizationId: ORGANIZATION_ID, opportunityId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
    expect(appendFeedback).not.toHaveBeenCalled();
  });

  it("publishes a safe identifier-only event after the write is confirmed", async () => {
    appendFeedback.mockResolvedValue("feedback-1");

    await POST(request({ feedbackKind: "rejected", reason: "Not now." }), { params });

    expect(publishOrganizationEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION_ID,
        eventName: "decision.feedback_captured",
      }),
    );
    const [call] = publishOrganizationEvent.mock.calls;
    expect(JSON.stringify(call?.[0]?.payload ?? {})).not.toContain("Not now.");
  });

  it("does not publish an event when the write failed", async () => {
    appendFeedback.mockRejectedValue(new Error("Decision data could not be loaded or saved."));

    const response = await POST(request({ feedbackKind: "approved", reason: null }), { params });

    expect(response.status).toBe(400);
    expect(publishOrganizationEvent).not.toHaveBeenCalled();
  });
});
