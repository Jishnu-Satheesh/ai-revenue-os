import { beforeEach, describe, expect, it, vi } from "vitest";

import { PUT } from "@/app/api/organizations/[organizationId]/growth-intelligence/preferences/[sourceKind]/[sourceId]/route";
import { DomainError } from "@/lib/errors";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const SOURCE = "70000000-0000-4000-8000-000000000007";

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  decideItem: vi.fn(),
  setPreference: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
  // Same status contract as the real apiErrorResponse; the mapping itself is
  // covered by the organization's own context tests. Zod errors carry issues
  // instead of a domain code.
  apiErrorResponse: (error: unknown) => {
    const record = (typeof error === "object" && error !== null ? error : {}) as {
      code?: unknown;
    };
    const status =
      record.code === "AUTHENTICATION_ERROR"
        ? 401
        : record.code === "AUTHORIZATION_ERROR"
          ? 403
          : record.code === "VALIDATION_ERROR" || "issues" in record
            ? 400
            : 422;
    return Response.json({ error: { code: record.code ?? "UNEXPECTED_ERROR" } }, { status });
  },
}));

vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  assertGrowthIntelligenceAccess: mocks.assertAccess,
}));

vi.mock("@/domain/access/permissions", () => ({
  hasOrganizationPermission: mocks.hasPermission,
}));

vi.mock("@/modules/growth-intelligence/application/triage-service", () => ({
  createGrowthIntelligenceTriageService: () => ({
    decideItem: mocks.decideItem,
    setPreference: mocks.setPreference,
  }),
}));

vi.mock("@/modules/growth-intelligence/infrastructure/synthesis-repository", () => ({
  createSynthesisRepository: vi.fn(() => ({})),
}));

vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: vi.fn(() => ({})),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: mocks.info, warn: mocks.warn, error: vi.fn(), debug: vi.fn() },
}));

function params(sourceKind = "synthesis_item") {
  return {
    params: Promise.resolve({ organizationId: ORGANIZATION, sourceKind, sourceId: SOURCE }),
  };
}

function request(body: unknown) {
  return new Request(`https://example.test/api/x`, {
    method: "PUT",
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
    membership: { role: "operator" },
  });
  mocks.assertAccess.mockReturnValue(undefined);
  mocks.hasPermission.mockReturnValue(true);
  mocks.setPreference.mockResolvedValue({ sourceKind: "synthesis_item", pinned: true });
});

describe("PUT preferences", () => {
  it("saves the actor's pin without touching the organization's records", async () => {
    const response = await PUT(request({ pinned: true }), params());
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ sourceKind: "synthesis_item", sourceId: SOURCE, pinned: true });
    expect(mocks.setPreference).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORGANIZATION,
        actorId: "user-1",
        sourceKind: "synthesis_item",
        sourceId: SOURCE,
        pinned: true,
        snoozedUntil: null,
      }),
    );
    expect(mocks.decideItem).not.toHaveBeenCalled();
  });

  it("accepts a horizon only for channel recommendations", async () => {
    const horizon = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const channel = await PUT(
      request({ pinned: false, snoozedUntil: horizon }),
      params("channel_recommendation"),
    );
    expect(channel.status).toBe(200);
    expect(mocks.setPreference).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKind: "channel_recommendation", snoozedUntil: horizon }),
    );

    const item = await PUT(request({ pinned: false, snoozedUntil: horizon }), params());
    expect(item.status).toBe(400);
  });

  it("refuses unknown source kinds, viewers, and cross-tenant names", async () => {
    const unknown = await PUT(request({ pinned: true }), {
      params: Promise.resolve({
        organizationId: ORGANIZATION,
        sourceKind: "campaign",
        sourceId: SOURCE,
      }),
    });
    expect(unknown.status).toBe(400);

    mocks.hasPermission.mockReturnValue(false);
    const viewer = await PUT(request({ pinned: true }), params());
    expect(viewer.status).toBe(403);
    mocks.hasPermission.mockReturnValue(true);

    mocks.setPreference.mockRejectedValue(
      new DomainError("TENANT_SCOPE_ERROR", "The named record was not found."),
    );
    const missing = await PUT(request({ pinned: true }), params("opportunity"));
    expect(missing.status).toBe(422);
  });
});
