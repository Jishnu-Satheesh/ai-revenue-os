import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  read: vi.fn(),
  createRepository: vi.fn(() => ({ repository: true })),
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
vi.mock("@/modules/growth-intelligence/application/profile-service", () => ({
  createMarketProfileService: () => ({ read: mocks.read }),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { GET } from "@/app/api/organizations/[organizationId]/market-profile/route";
import { DomainError } from "@/lib/errors";

const organizationId = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "viewer" },
    supabase: { session: true },
  });
  mocks.hasPermission.mockReturnValue(true);
  mocks.read.mockResolvedValue({ profile: null, versions: [], decisions: [] });
});

describe("GET Market Profile", () => {
  it("checks membership, rollout, and read permission in that order before loading", async () => {
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
    mocks.read.mockImplementation(async () => {
      order.push("service");
      return { profile: null, versions: [], decisions: [] };
    });

    const response = await GET(new Request("https://example.test/market-profile"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(200);
    expect(order).toEqual(["membership", "rollout", "permission", "service"]);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses a role without read permission before repository access", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await GET(new Request("https://example.test/market-profile"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("does not reveal rollout state to a non-member", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access."),
    );

    const response = await GET(new Request("https://example.test/market-profile"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(403);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });

  it("keeps unexpected database detail out of the public error", async () => {
    mocks.read.mockRejectedValue(new Error("column raw_customer_payload does not exist"));

    const response = await GET(new Request("https://example.test/market-profile"), {
      params: Promise.resolve({ organizationId }),
    });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      error: { code: "UNEXPECTED_ERROR", message: "Something went wrong. Please try again." },
    });
    expect(JSON.stringify(mocks.warn.mock.calls)).not.toContain("raw_customer_payload");
  });
});
