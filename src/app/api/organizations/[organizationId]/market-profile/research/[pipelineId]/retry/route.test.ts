import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  readPipeline: vi.fn(),
  retrySynthesis: vi.fn(),
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
    retrySynthesis: mocks.retrySynthesis,
  }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/market-profile/research/[pipelineId]/retry/route";
import { DomainError } from "@/lib/errors";

const organizationId = "10000000-0000-4000-8000-000000000001";
const pipelineId = "30000000-0000-4000-8000-000000000003";
const requestId = "60000000-0000-4000-8000-000000000006";
const idempotencyKey = "retry-key-1234567890";

function pipelineView(stage: string) {
  return {
    pipelineId,
    organizationId,
    branchId: "20000000-0000-4000-8000-000000000002",
    scopeLabel: "Marina",
    stage,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-2" },
    membership: { role: "operator" },
    supabase: { session: true },
  });
  mocks.hasPermission.mockReturnValue(true);
  mocks.readPipeline.mockResolvedValue(pipelineView("synthesis_failed"));
  mocks.retrySynthesis.mockResolvedValue({ requestId, status: "pending", replayed: false });
});

function post(body: unknown) {
  return POST(
    new Request("https://example.test/api/x", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ organizationId, pipelineId }) },
  );
}

describe("POST research pipeline retry", () => {
  it("retries eligible failed analysis with only an idempotency key", async () => {
    const response = await post({ idempotencyKey });
    const body = (await response.json()) as {
      retry: { pipelineId: string; requestId: string; replayed: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.retry).toEqual({ pipelineId, requestId, status: "pending", replayed: false });
    expect(mocks.retrySynthesis).toHaveBeenCalledWith({
      organizationId,
      pipelineId,
      actorId: "user-2",
      idempotencyKey,
      correlationId: expect.any(String),
    });
  });

  it("replays the same retry key without duplicating work", async () => {
    mocks.retrySynthesis.mockResolvedValue({ requestId, status: "pending", replayed: true });

    const response = await post({ idempotencyKey });
    const body = (await response.json()) as { retry: { replayed: boolean } };

    expect(response.status).toBe(200);
    expect(body.retry.replayed).toBe(true);
  });

  it("refuses viewers without calling the retry RPC", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await post({ idempotencyKey });

    expect(response.status).toBe(403);
    expect(mocks.retrySynthesis).not.toHaveBeenCalled();
  });

  it("admits only eligible failed states and never runs the RPC otherwise", async () => {
    for (const stage of ["researching", "ready", "research_failed", "cancelled"]) {
      mocks.readPipeline.mockResolvedValue(pipelineView(stage));
      const response = await post({ idempotencyKey });
      expect(response.status).toBe(422);
    }
    expect(mocks.retrySynthesis).not.toHaveBeenCalled();
  });

  it("returns 404 for a foreign tenant without revealing existence", async () => {
    mocks.readPipeline.mockResolvedValue(null);

    const response = await post({ idempotencyKey });
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("TENANT_SCOPE_ERROR");
    expect(mocks.retrySynthesis).not.toHaveBeenCalled();
  });

  it("rejects client-supplied research inputs beyond the idempotency key", async () => {
    const response = await post({
      idempotencyKey,
      topics: ["hacked"],
      model: "other",
      scopeDigest: "b".repeat(64),
    });

    expect(response.status).toBe(400);
    expect(mocks.retrySynthesis).not.toHaveBeenCalled();
  });

  it("surfaces stale evidence as a safe retry refusal", async () => {
    mocks.retrySynthesis.mockRejectedValue(
      new DomainError("DOMAIN_ERROR", "The saved evidence is stale; start new research instead."),
    );

    const response = await post({ idempotencyKey });
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(422);
    expect(body.error.message).toMatch(/new research/);
  });
});
