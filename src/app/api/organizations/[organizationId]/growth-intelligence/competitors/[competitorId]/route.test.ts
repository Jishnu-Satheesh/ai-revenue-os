import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  updateCompetitor: vi.fn(),
  deleteCompetitor: vi.fn(),
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
    updateCompetitor: mocks.updateCompetitor,
    deleteCompetitor: mocks.deleteCompetitor,
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import {
  DELETE,
  PATCH,
} from "@/app/api/organizations/[organizationId]/growth-intelligence/competitors/[competitorId]/route";
import { DomainError } from "@/lib/errors";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const COMPETITOR = "80000000-0000-4000-8000-000000000008";

function context() {
  return {
    supabase: {},
    user: { id: "70000000-0000-4000-8000-000000000007" },
    organizationId: ORGANIZATION,
    membership: { role: "manager" },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue(context());
  mocks.hasPermission.mockReturnValue(true);
});

describe("PATCH organization competitor", () => {
  it("updates the pinned row", async () => {
    mocks.updateCompetitor.mockResolvedValue({ id: COMPETITOR });
    const response = await PATCH(
      new Request("https://example.test/competitor", {
        method: "PATCH",
        body: JSON.stringify({ locationHint: "Near Marina Mall" }),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION, competitorId: COMPETITOR }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.updateCompetitor).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      competitorId: COMPETITOR,
      locationHint: "Near Marina Mall",
    });
  });

  it("maps a cross-organisation update to 404", async () => {
    mocks.updateCompetitor.mockRejectedValue(
      new DomainError("TENANT_SCOPE_ERROR", "This competitor was not found in your organization."),
    );
    const response = await PATCH(
      new Request("https://example.test/competitor", {
        method: "PATCH",
        body: JSON.stringify({ name: "Someone Else" }),
      }),
      { params: Promise.resolve({ organizationId: ORGANIZATION, competitorId: COMPETITOR }) },
    );
    expect(response.status).toBe(404);
  });
});

describe("DELETE organization competitor", () => {
  it("deletes the pinned row", async () => {
    mocks.deleteCompetitor.mockResolvedValue(undefined);
    const response = await DELETE(
      new Request("https://example.test/competitor", { method: "DELETE" }),
      { params: Promise.resolve({ organizationId: ORGANIZATION, competitorId: COMPETITOR }) },
    );
    expect(response.status).toBe(200);
    expect(mocks.deleteCompetitor).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      competitorId: COMPETITOR,
    });
  });

  it("maps a cross-organisation delete to 404", async () => {
    mocks.deleteCompetitor.mockRejectedValue(
      new DomainError("TENANT_SCOPE_ERROR", "This competitor was not found in your organization."),
    );
    const response = await DELETE(
      new Request("https://example.test/competitor", { method: "DELETE" }),
      { params: Promise.resolve({ organizationId: ORGANIZATION, competitorId: COMPETITOR }) },
    );
    expect(response.status).toBe(404);
  });
});
