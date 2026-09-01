import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  propose: vi.fn(),
  createRepository: vi.fn(() => ({ repository: true })),
  createProvider: vi.fn(() => ({ provider: true })),
  warn: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  assertGrowthIntelligenceAccess: mocks.assertAccess,
}));
vi.mock("@/domain/access/permissions", () => ({
  hasOrganizationPermission: mocks.hasPermission,
}));
vi.mock("@/modules/growth-intelligence/infrastructure/profile-repository", () => ({
  createAuthenticatedMarketProfileRepository: mocks.createRepository,
}));
vi.mock("@/modules/growth-intelligence/infrastructure/profile-proposal-provider", () => ({
  createMarketProfileProposalProvider: mocks.createProvider,
}));
vi.mock("@/modules/growth-intelligence/application/profile-service", () => ({
  createMarketProfileService: () => ({ propose: mocks.propose }),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/market-profile/proposals/route";
import { DomainError } from "@/lib/errors";

const organizationId = "10000000-0000-4000-8000-000000000001";
const correlationId = "90000000-0000-4000-8000-000000000009";

function request(body: unknown) {
  return new Request("https://example.test/market-profile/proposals", {
    method: "POST",
    headers: { "content-type": "application/json", "x-correlation-id": correlationId },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: { session: true },
  });
  mocks.hasPermission.mockReturnValue(true);
  mocks.propose.mockResolvedValue({
    profileId: "20000000-0000-4000-8000-000000000002",
    profileVersionId: "30000000-0000-4000-8000-000000000003",
    version: 1,
    profileDigest: "a".repeat(64),
    replayed: false,
    isRevision: false,
  });
});

describe("POST Market Profile proposal", () => {
  it("runs membership, rollout, permission, body validation, then service", async () => {
    const order: string[] = [];
    mocks.getOrganizationContext.mockImplementation(async () => {
      order.push("membership");
      return {
        organizationId,
        user: { id: "user-1" },
        membership: { role: "operator" },
        supabase: {},
      };
    });
    mocks.assertAccess.mockImplementation(() => order.push("rollout"));
    mocks.hasPermission.mockImplementation(() => {
      order.push("permission");
      return true;
    });
    mocks.propose.mockImplementation(async () => {
      order.push("service");
      return {
        profileId: crypto.randomUUID(),
        profileVersionId: crypto.randomUUID(),
        version: 1,
        profileDigest: "a".repeat(64),
        replayed: false,
        isRevision: false,
      };
    });

    const response = await POST(
      request({ source: "ai", idempotencyKey: "profile-proposal-0001" }),
      { params: Promise.resolve({ organizationId }) },
    );

    expect(response.status).toBe(201);
    expect(order).toEqual(["membership", "rollout", "permission", "service"]);
    expect(mocks.propose).toHaveBeenCalledWith({
      organizationId,
      actorId: "user-1",
      source: "ai",
      idempotencyKey: "profile-proposal-0001",
      correlationId,
    });
  });

  it("validates only after permission and never calls the provider for malformed input", async () => {
    const response = await POST(
      request({ source: "ai", idempotencyKey: "short", rawWorkbook: true }),
      { params: Promise.resolve({ organizationId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.hasPermission).toHaveBeenCalled();
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
  });

  it("rejects a malformed correlation id after permission but before model cost", async () => {
    const badRequest = new Request("https://example.test/market-profile/proposals", {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": "correlation-1" },
      body: JSON.stringify({ source: "ai", idempotencyKey: "profile-proposal-0001" }),
    });

    const response = await POST(badRequest, { params: Promise.resolve({ organizationId }) });

    expect(response.status).toBe(400);
    expect(mocks.hasPermission).toHaveBeenCalled();
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.propose).not.toHaveBeenCalled();
    expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("does not construct a model provider for an operator-authored revision", async () => {
    const profileDocument = {
      schemaVersion: 1,
      publicIdentity: { approvedName: "A", domains: ["a.example"], publicUrls: [] },
      nicheDescriptors: ["consulting"],
      geographies: [
        { layer: "city", locationRef: "city:dubai", name: "Dubai", countryCode: "AE" },
        { layer: "country", locationRef: "country:ae", name: "UAE", countryCode: "AE" },
      ],
      competitors: [],
      topics: [{ key: "consulting", label: "Consulting", provenance: "operator" }],
      sourcePolicy: {
        excludedDomains: ["untrusted.example"],
        excludedPublishers: [],
        excludedCompetitorKeys: [],
        allowBoundedQuotes: false,
        maxQuotationCharacters: 0,
      },
      cadence: {
        timeZone: "Asia/Dubai",
        dailyLocalTime: "06:00",
        weeklyDay: "monday",
        weeklyLocalTime: "07:00",
      },
    };

    const response = await POST(
      request({
        source: "operator",
        profileDocument,
        idempotencyKey: "profile-proposal-0002",
      }),
      { params: Promise.resolve({ organizationId }) },
    );

    expect(response.status).toBe(201);
    expect(mocks.createProvider).not.toHaveBeenCalled();
  });

  it("returns a replay as 200 and blocks viewers before parsing", async () => {
    mocks.propose.mockResolvedValueOnce({
      profileId: crypto.randomUUID(),
      profileVersionId: crypto.randomUUID(),
      version: 1,
      profileDigest: "a".repeat(64),
      replayed: true,
      isRevision: false,
    });
    expect(
      (
        await POST(request({ source: "ai", idempotencyKey: "profile-proposal-0001" }), {
          params: Promise.resolve({ organizationId }),
        })
      ).status,
    ).toBe(200);

    mocks.hasPermission.mockReturnValue(false);
    const denied = await POST(request({ malformed: true }), {
      params: Promise.resolve({ organizationId }),
    });
    expect(denied.status).toBe(403);
    expect(mocks.propose).toHaveBeenCalledTimes(1);
  });

  it("does not reveal rollout state to a non-member", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access."),
    );

    const response = await POST(
      request({ source: "ai", idempotencyKey: "profile-proposal-0001" }),
      { params: Promise.resolve({ organizationId }) },
    );

    expect(response.status).toBe(403);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });
});
