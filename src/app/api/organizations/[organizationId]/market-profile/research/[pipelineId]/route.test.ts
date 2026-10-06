import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  readPipeline: vi.fn(),
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
vi.mock("@/modules/growth-intelligence/infrastructure/research-read-repository", () => ({
  createAuthenticatedResearchReadRepository: () => ({
    readPipeline: mocks.readPipeline,
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { GET } from "@/app/api/organizations/[organizationId]/market-profile/research/[pipelineId]/route";
import { DomainError } from "@/lib/errors";

const organizationId = "10000000-0000-4000-8000-000000000001";
const pipelineId = "30000000-0000-4000-8000-000000000003";

const pipelineView = {
  pipelineId,
  organizationId,
  branchId: "20000000-0000-4000-8000-000000000002",
  scopeLabel: "Marina",
  stage: "ready",
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
  mocks.readPipeline.mockResolvedValue(pipelineView);
});

function get(url: string, pipeline: string = pipelineId) {
  return GET(new Request(url), {
    params: Promise.resolve({ organizationId, pipelineId: pipeline }),
  });
}

describe("GET research pipeline status", () => {
  it("lets a viewer read pipeline status", async () => {
    const response = await get(`https://example.test/api/x`);
    const body = (await response.json()) as { pipeline: { pipelineId: string } };

    expect(response.status).toBe(200);
    expect(body.pipeline.pipelineId).toBe(pipelineId);
    expect(mocks.readPipeline).toHaveBeenCalledWith({ organizationId, pipelineId });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("lets an operator read pipeline status", async () => {
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId,
      user: { id: "user-2" },
      membership: { role: "operator" },
      supabase: { session: true },
    });

    const response = await get(`https://example.test/api/x`);

    expect(response.status).toBe(200);
  });

  it("returns 404 for a foreign tenant without revealing existence", async () => {
    mocks.readPipeline.mockResolvedValue(null);

    const response = await get(`https://example.test/api/x`);
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("TENANT_SCOPE_ERROR");
  });

  it("refuses an unreadable organization without touching pipeline reads", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await get(`https://example.test/api/x`);

    expect(response.status).toBe(403);
    expect(mocks.readPipeline).not.toHaveBeenCalled();
  });

  it("rejects malformed pipeline ids without a tenant read", async () => {
    const response = await get(`https://example.test/api/x`, "not-a-uuid");

    expect(response.status).toBe(400);
    expect(mocks.readPipeline).not.toHaveBeenCalled();
  });

  it("does not reveal rollout state to a non-member", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access."),
    );

    const response = await get(`https://example.test/api/x`);

    expect(response.status).toBe(403);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });
});
