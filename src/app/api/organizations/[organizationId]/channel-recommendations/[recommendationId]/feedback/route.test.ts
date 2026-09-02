import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The real organization-context module is kept, so `apiErrorResponse` maps the
// domain error codes exactly as production does. Only its Supabase client
// import is stubbed, because constructing one needs environment this test has
// no business carrying.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const mocks = vi.hoisted(() => ({
  assertEnabled: vi.fn(),
  getOrganizationContext: vi.fn(),
  recordFeedback: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/modules/integrations/application/feature-access", () => ({
  assertGovernedChannelAnalysisEnabled: mocks.assertEnabled,
}));
vi.mock("@/lib/api/organization-context", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/organization-context")>(
    "@/lib/api/organization-context",
  );
  return { ...actual, getOrganizationContext: mocks.getOrganizationContext };
});
vi.mock("@/modules/analysis/application/triage", async () => ({
  ...(await vi.importActual<object>("@/modules/analysis/application/triage")),
  recordFeedback: mocks.recordFeedback,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/channel-recommendations/[recommendationId]/feedback/route";
import { DomainError } from "@/lib/errors";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const RECOMMENDATION = "55555555-5555-4555-8555-555555555555";

function request(body: unknown) {
  return new Request("https://example.test/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ organizationId: ORGANIZATION, recommendationId: RECOMMENDATION });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertEnabled.mockReturnValue(undefined);
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION,
    user: { id: "user-1" },
    membership: { role: "viewer" },
    supabase: { authenticatedSessionClient: true },
  });
  mocks.recordFeedback.mockResolvedValue({ recommendationId: RECOMMENDATION });
});

describe("POST channel recommendation feedback", () => {
  it("records any member's vote through their own session and returns the id voted on", async () => {
    const supabase = { authenticatedSessionClient: true };
    // Grading the narrator takes less authority than answering it: a viewer
    // may vote where they could not triage.
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION,
      user: { id: "user-1" },
      membership: { role: "viewer" },
      supabase,
    });

    const response = await POST(request({ helpful: false }), { params });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { recommendationId: string };
    expect(body.recommendationId).toBe(RECOMMENDATION);
    expect(mocks.recordFeedback).toHaveBeenCalledWith(
      { organizationId: ORGANIZATION, recommendationId: RECOMMENDATION, helpful: false },
      { supabase, actorId: "user-1" },
    );
  });

  it("refuses a caller who is not a member at all before doing any work", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access to this organization."),
    );

    const response = await POST(request({ helpful: true }), { params });

    expect(response.status).toBe(403);
    expect(mocks.assertEnabled).not.toHaveBeenCalled();
    expect(mocks.recordFeedback).not.toHaveBeenCalled();
  });

  it("refuses an organization the slice is not enabled for", async () => {
    mocks.assertEnabled.mockImplementation(() => {
      throw new DomainError("FEATURE_NOT_AVAILABLE", "Not enabled.");
    });

    const response = await POST(request({ helpful: true }), { params });

    expect(response.status).toBe(422);
    expect(mocks.recordFeedback).not.toHaveBeenCalled();
  });

  it("refuses a field the contract does not know rather than ignoring it", async () => {
    const response = await POST(request({ helpful: true, decision: "acknowledged" }), { params });

    expect(response.status).toBe(400);
    expect(mocks.recordFeedback).not.toHaveBeenCalled();
  });

  it("refuses a vote that is neither helpful nor not helpful", async () => {
    const response = await POST(request({ helpful: null }), { params });

    expect(response.status).toBe(400);
    expect(mocks.recordFeedback).not.toHaveBeenCalled();
  });

  it("reports the database's own refusal rather than inventing a success", async () => {
    mocks.recordFeedback.mockRejectedValue(
      new DomainError(
        "TENANT_SCOPE_ERROR",
        "This recommendation was not found. It may have been removed.",
      ),
    );

    const response = await POST(request({ helpful: true }), { params });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TENANT_SCOPE_ERROR");
  });

  it("logs ids and the vote kind only", async () => {
    await POST(request({ helpful: true }), { params });

    expect(mocks.info).toHaveBeenCalledWith(
      "channel_recommendation.feedback_recorded",
      expect.objectContaining({
        organizationId: ORGANIZATION,
        recommendationId: RECOMMENDATION,
      }),
    );
  });
});
