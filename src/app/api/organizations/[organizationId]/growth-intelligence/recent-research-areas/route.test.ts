import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  readRecent: vi.fn(),
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
vi.mock("@/modules/growth-intelligence/application/recent-research-areas", () => ({
  readRecentResearchAreas: mocks.readRecent,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { GET } from "@/app/api/organizations/[organizationId]/growth-intelligence/recent-research-areas/route";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    supabase: {},
    user: { id: "70000000-0000-4000-8000-000000000007" },
    organizationId: ORGANIZATION,
    membership: { role: "manager" },
  });
  mocks.hasPermission.mockReturnValue(true);
});

describe("GET recent research areas", () => {
  it("returns most-recent-first plus the single most recent", async () => {
    mocks.readRecent.mockResolvedValue({ areas: ["Deira", "Marina"], mostRecent: "Deira" });
    const response = await GET(
      new Request("https://example.test/recent-research-areas"),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { areas: string[]; mostRecent: string | null };
    expect(body.areas).toEqual(["Deira", "Marina"]);
    expect(body.mostRecent).toBe("Deira");
    expect(mocks.readRecent).toHaveBeenCalledWith(ORGANIZATION);
  });

  it("degrades to empty rather than failing the dialog", async () => {
    mocks.readRecent.mockResolvedValue({ areas: [], mostRecent: null });
    const response = await GET(
      new Request("https://example.test/recent-research-areas"),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { areas: string[]; mostRecent: string | null };
    expect(body).toMatchObject({ areas: [], mostRecent: null });
  });
});
