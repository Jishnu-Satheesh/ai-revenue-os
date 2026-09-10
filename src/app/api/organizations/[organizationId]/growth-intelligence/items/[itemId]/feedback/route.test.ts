import { beforeEach, describe, expect, it, vi } from "vitest";

import { NextResponse } from "next/server";

import { POST } from "@/app/api/organizations/[organizationId]/growth-intelligence/items/[itemId]/feedback/route";
import { DomainError, toPublicError } from "@/lib/errors";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const ITEM = "70000000-0000-4000-8000-000000000007";

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  recordFeedback: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
  apiErrorResponse: (error: unknown) => {
    const code = toPublicError(error).code;
    const status = code === "AUTHORIZATION_ERROR" ? 403 : code === "VALIDATION_ERROR" ? 400 : 422;
    return NextResponse.json({ error: toPublicError(error) }, { status });
  },
}));
vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  assertGrowthIntelligenceAccess: mocks.assertAccess,
}));
vi.mock("@/domain/access/permissions", () => ({
  hasOrganizationPermission: mocks.hasPermission,
}));
vi.mock("@/modules/growth-intelligence/application/triage-service", () => ({
  createGrowthIntelligenceTriageService: () => ({ recordFeedback: mocks.recordFeedback }),
}));
vi.mock("@/modules/growth-intelligence/infrastructure/synthesis-repository", () => ({
  createSynthesisRepository: vi.fn(() => ({})),
}));
vi.mock("@/domain/events/publisher", () => ({ createEventPublisher: vi.fn(() => ({})) }));
vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

function request(body: unknown) {
  return new Request("https://example.test/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    supabase: {},
    user: { id: "user-1" },
    organizationId: ORGANIZATION,
    membership: { role: "viewer" },
  });
  mocks.assertAccess.mockReturnValue(undefined);
  mocks.hasPermission.mockReturnValue(true);
  mocks.recordFeedback.mockResolvedValue({ itemId: ITEM, helpful: false });
});

describe("POST Growth Intelligence item feedback", () => {
  it("lets a member with read access save a vote through their own session", async () => {
    const response = await POST(request({ helpful: false }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, itemId: ITEM }),
    });

    expect(response.status).toBe(200);
    expect(mocks.recordFeedback).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      actorId: "user-1",
      itemId: ITEM,
      helpful: false,
    });
  });

  it("requires read access before reaching persistence", async () => {
    mocks.hasPermission.mockReturnValue(false);
    const response = await POST(request({ helpful: true }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, itemId: ITEM }),
    });
    expect(response.status).toBe(403);
    expect(mocks.recordFeedback).not.toHaveBeenCalled();
  });

  it("rejects unknown fields and null votes", async () => {
    for (const body of [{ helpful: null }, { helpful: true, decision: "planned" }]) {
      const response = await POST(request(body), {
        params: Promise.resolve({ organizationId: ORGANIZATION, itemId: ITEM }),
      });
      expect(response.status).toBe(400);
    }
    expect(mocks.recordFeedback).not.toHaveBeenCalled();
  });

  it("returns the database refusal instead of claiming success", async () => {
    mocks.recordFeedback.mockRejectedValue(
      new DomainError("TENANT_SCOPE_ERROR", "This record was not found."),
    );
    const response = await POST(request({ helpful: true }), {
      params: Promise.resolve({ organizationId: ORGANIZATION, itemId: ITEM }),
    });
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("TENANT_SCOPE_ERROR");
  });
});
