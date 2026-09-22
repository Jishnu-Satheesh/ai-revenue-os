import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  listCompetitors: vi.fn(),
  createCompetitor: vi.fn(),
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
vi.mock("@/modules/growth-intelligence/infrastructure/organization-competitor-repository", () => ({
  createAuthenticatedOrganizationCompetitorRepository: () => ({
    listCompetitors: mocks.listCompetitors,
    createCompetitor: mocks.createCompetitor,
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import {
  GET,
  POST,
} from "@/app/api/organizations/[organizationId]/growth-intelligence/competitors/route";
import { DomainError } from "@/lib/errors";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const USER = "70000000-0000-4000-8000-000000000007";

function context(role = "manager") {
  return {
    supabase: {},
    user: { id: USER },
    organizationId: ORGANIZATION,
    membership: { role },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue(context());
  mocks.hasPermission.mockReturnValue(true);
});

describe("GET organization competitors", () => {
  it("lists the caller's own organisation competitors", async () => {
    mocks.listCompetitors.mockResolvedValue([
      {
        id: "80000000-0000-4000-8000-000000000008",
        organizationId: ORGANIZATION,
        name: "Rival Kitchen",
        website: null,
        locationHint: null,
        createdAt: "2026-09-22T00:00:00.000Z",
        updatedAt: "2026-09-22T00:00:00.000Z",
      },
    ]);
    const response = await GET(
      new Request("https://example.test/competitors"),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { competitors: unknown[] };
    expect(body.competitors).toHaveLength(1);
    expect(mocks.listCompetitors).toHaveBeenCalledWith({ organizationId: ORGANIZATION });
  });

  it("maps a cross-organisation read to 404", async () => {
    mocks.listCompetitors.mockRejectedValue(
      new DomainError("TENANT_SCOPE_ERROR", "This competitor was not found in your organization."),
    );
    const response = await GET(
      new Request("https://example.test/competitors"),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(404);
  });
});

describe("POST organization competitors", () => {
  it("saves a competitor with Zod-validated input", async () => {
    mocks.createCompetitor.mockResolvedValue({ id: "competitor-1" });
    const response = await POST(
      new Request("https://example.test/competitors", {
        method: "POST",
        body: JSON.stringify({ name: "Rival Kitchen", website: "https://rival.example" }),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(201);
    expect(mocks.createCompetitor).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      name: "Rival Kitchen",
      website: "https://rival.example",
      actorId: USER,
    });
  });

  it("rejects an invalid website with 400", async () => {
    const response = await POST(
      new Request("https://example.test/competitors", {
        method: "POST",
        body: JSON.stringify({ name: "Rival Kitchen", website: "not-a-url" }),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(400);
    expect(mocks.createCompetitor).not.toHaveBeenCalled();
  });

  it("rejects a duplicate normalized name with 422", async () => {
    mocks.createCompetitor.mockRejectedValue(
      new DomainError("VALIDATION_ERROR", "That competitor is already listed."),
    );
    const response = await POST(
      new Request("https://example.test/competitors", {
        method: "POST",
        body: JSON.stringify({ name: "Rival Kitchen" }),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION }) },
    );
    expect(response.status).toBe(400);
  });
});
