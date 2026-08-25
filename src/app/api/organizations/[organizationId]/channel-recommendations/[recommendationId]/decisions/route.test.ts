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
  triageRecommendation: vi.fn(),
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
  triageRecommendation: mocks.triageRecommendation,
}));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/channel-recommendations/[recommendationId]/decisions/route";
import { DomainError } from "@/lib/errors";

const ORGANIZATION = "44444444-4444-4444-8444-444444444444";
const RECOMMENDATION = "55555555-5555-4555-8555-555555555555";

function request(body: unknown) {
  return new Request("https://example.test/decisions", {
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
    membership: { role: "operator" },
    supabase: { authenticatedSessionClient: true },
  });
  mocks.triageRecommendation.mockResolvedValue({ recommendationId: RECOMMENDATION });
});

describe("POST channel recommendation decisions", () => {
  it("records the operator's answer through the member's own session and returns its id", async () => {
    const supabase = { authenticatedSessionClient: true };
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION,
      user: { id: "user-1" },
      membership: { role: "operator" },
      supabase,
    });

    const response = await POST(
      request({ decision: "dismissed", reason: "Already handled offline." }),
      { params },
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { recommendationId: string };
    expect(body.recommendationId).toBe(RECOMMENDATION);
    expect(mocks.triageRecommendation).toHaveBeenCalledWith(
      {
        organizationId: ORGANIZATION,
        recommendationId: RECOMMENDATION,
        decision: "dismissed",
        reason: "Already handled offline.",
      },
      { supabase, actorId: "user-1" },
    );
  });

  it("refuses a member whose role cannot answer recommendations", async () => {
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION,
      user: { id: "user-1" },
      membership: { role: "viewer" },
      supabase: {},
    });

    const response = await POST(request({ decision: "planned" }), { params });

    expect(response.status).toBe(403);
    expect(mocks.triageRecommendation).not.toHaveBeenCalled();
  });

  it("refuses a caller from outside the organization before doing any work", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access to this organization."),
    );

    const response = await POST(request({ decision: "planned" }), { params });

    expect(response.status).toBe(403);
    expect(mocks.assertEnabled).not.toHaveBeenCalled();
    expect(mocks.triageRecommendation).not.toHaveBeenCalled();
  });

  it("refuses an organization the slice is not enabled for", async () => {
    mocks.assertEnabled.mockImplementation(() => {
      throw new DomainError("FEATURE_NOT_AVAILABLE", "Not enabled.");
    });

    const response = await POST(request({ decision: "acknowledged" }), { params });

    expect(response.status).toBe(422);
    expect(mocks.triageRecommendation).not.toHaveBeenCalled();
  });

  it("refuses a field the contract does not know rather than ignoring it", async () => {
    const response = await POST(
      request({ decision: "acknowledged", helpful: true }),
      { params },
    );

    expect(response.status).toBe(400);
    expect(mocks.triageRecommendation).not.toHaveBeenCalled();
  });

  it("blocks a dismissal without a reason on this side of the database", async () => {
    const response = await POST(request({ decision: "dismissed" }), { params });

    expect(response.status).toBe(400);
    expect(mocks.triageRecommendation).not.toHaveBeenCalled();
  });

  it("blocks a dismissal whose reason is shorter than the storage contract asks", async () => {
    const response = await POST(request({ decision: "dismissed", reason: "no" }), { params });

    expect(response.status).toBe(400);
    expect(mocks.triageRecommendation).not.toHaveBeenCalled();
  });

  it("reports the database's own refusal rather than inventing a success", async () => {
    mocks.triageRecommendation.mockRejectedValue(
      new DomainError(
        "TENANT_SCOPE_ERROR",
        "This recommendation was not found. It may have been removed.",
      ),
    );

    const response = await POST(request({ decision: "planned" }), { params });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("TENANT_SCOPE_ERROR");
  });

  it("logs ids and the decision kind only, never the reason text", async () => {
    await POST(request({ decision: "dismissed", reason: "Already handled offline." }), { params });

    expect(mocks.info).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(mocks.info.mock.calls[0])).not.toContain("Already handled offline.");
    expect(mocks.info).toHaveBeenCalledWith(
      "channel_recommendation.triaged",
      expect.objectContaining({
        organizationId: ORGANIZATION,
        recommendationId: RECOMMENDATION,
        decisionKind: "dismissed",
        correlationId: expect.any(String),
      }),
    );
  });
});
