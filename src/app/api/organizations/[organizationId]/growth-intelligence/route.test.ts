import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  readProfile: vi.fn(),
  createProfileRepository: vi.fn(() => ({ repository: true })),
  listClaimPage: vi.fn(),
  listSourcesByRuns: vi.fn(),
  listLinksByClaims: vi.fn(),
  listEventsByClaims: vi.fn(),
  listRequests: vi.fn(),
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
  createAuthenticatedMarketProfileRepository: mocks.createProfileRepository,
}));
vi.mock("@/modules/growth-intelligence/application/profile-service", () => ({
  createMarketProfileService: () => ({ read: mocks.readProfile }),
}));
vi.mock("@/modules/growth-intelligence/infrastructure/read-repository", () => ({
  createAuthenticatedGrowthIntelligenceReadRepository: () => ({
    listClaimPage: mocks.listClaimPage,
    listSourcesByRuns: mocks.listSourcesByRuns,
    listLinksByClaims: mocks.listLinksByClaims,
    listEventsByClaims: mocks.listEventsByClaims,
    listRequests: mocks.listRequests,
  }),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { GET } from "@/app/api/organizations/[organizationId]/growth-intelligence/route";
import { DomainError } from "@/lib/errors";

const organizationId = "10000000-0000-4000-8000-000000000001";
const profileVersionId = "70000000-0000-4000-8000-000000000007";

const profileView = {
  profile: {
    id: "30000000-0000-4000-8000-000000000003",
    currentVersionId: profileVersionId,
    enabled: true,
    nextDailyResearchDueAt: null,
    nextWeeklySynthesisDueAt: null,
  },
  versions: [],
  decisions: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "viewer" },
    supabase: { session: true },
  });
  mocks.hasPermission.mockReturnValue(true);
  mocks.readProfile.mockResolvedValue(profileView);
  mocks.listClaimPage.mockResolvedValue({ claims: [], nextCursor: null });
  mocks.listSourcesByRuns.mockResolvedValue([]);
  mocks.listLinksByClaims.mockResolvedValue([]);
  mocks.listEventsByClaims.mockResolvedValue([]);
  mocks.listRequests.mockResolvedValue([]);
});

function get(url: string) {
  return GET(new Request(url), { params: Promise.resolve({ organizationId }) });
}

describe("GET Growth Intelligence", () => {
  it("checks membership, rollout, and read permission before any tenant read", async () => {
    const order: string[] = [];
    mocks.getOrganizationContext.mockImplementation(async () => {
      order.push("membership");
      return {
        organizationId,
        user: { id: "user-1" },
        membership: { role: "viewer" },
        supabase: {},
      };
    });
    mocks.assertAccess.mockImplementation(() => order.push("rollout"));
    mocks.hasPermission.mockImplementation(() => {
      order.push("permission");
      return true;
    });
    mocks.readProfile.mockImplementation(async () => {
      order.push("read");
      return profileView;
    });

    const response = await get(`https://example.test/api/x?limit=5`);

    expect(response.status).toBe(200);
    expect(order).toEqual(["membership", "rollout", "permission", "read"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.listClaimPage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId, profileVersionId, limit: 5 }),
    );
  });

  it("refuses invalid pagination and geography inputs without touching the database", async () => {
    const badLimit = await get(`https://example.test/api/x?limit=5000`);
    expect(badLimit.status).toBe(400);
    expect(mocks.readProfile).not.toHaveBeenCalled();

    const badGeography = await get(`https://example.test/api/x?geography=planet`);
    expect(badGeography.status).toBe(400);
  });

  it("returns an empty watch without claim reads when no profile is confirmed", async () => {
    mocks.readProfile.mockResolvedValue({ profile: null, versions: [], decisions: [] });

    const response = await get(`https://example.test/api/x`);
    const body = (await response.json()) as {
      marketWatch: { signals: unknown[]; profileStatus: { state: string } };
    };

    expect(response.status).toBe(200);
    expect(body.marketWatch.signals).toEqual([]);
    expect(body.marketWatch.profileStatus.state).toBe("absent");
    expect(mocks.listClaimPage).not.toHaveBeenCalled();
  });

  it("does not reveal rollout state to a non-member", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access."),
    );

    const response = await get(`https://example.test/api/x`);

    expect(response.status).toBe(403);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("keeps cross-tenant rows out by scoping every read to the context organization", async () => {
    const otherOrganizationId = "20000000-0000-4000-8000-000000000002";
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId: otherOrganizationId,
      user: { id: "user-1" },
      membership: { role: "viewer" },
      supabase: {},
    });

    const response = await get(`https://example.test/api/x`);

    expect(response.status).toBe(200);
    expect(mocks.listClaimPage).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: otherOrganizationId }),
    );
    expect(mocks.listRequests).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: otherOrganizationId }),
    );
  });
});
