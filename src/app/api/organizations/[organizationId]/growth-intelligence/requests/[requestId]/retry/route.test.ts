import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  rpc: vi.fn(),
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
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/growth-intelligence/requests/[requestId]/retry/route";
import { DomainError } from "@/lib/errors";

const organizationId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const idempotencyKey = "retry-key-000000000001";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: { rpc: mocks.rpc },
  });
  mocks.hasPermission.mockReturnValue(true);
  mocks.rpc.mockResolvedValue({
    data: { requestId, status: "pending", outcome: "retried", replayed: false },
    error: null,
  });
});

function post(body: unknown) {
  return POST(
    new Request("https://example.test/retry", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ organizationId, requestId }) },
  );
}

describe("POST Growth Intelligence request retry", () => {
  it("retries through the fenced RPC with server-owned identity and correlation", async () => {
    const response = await post({ idempotencyKey });
    const body = (await response.json()) as {
      request: { requestId: string };
      correlationId: string;
    };

    expect(response.status).toBe(200);
    expect(body.request.requestId).toBe(requestId);
    expect(mocks.rpc).toHaveBeenCalledWith("retry_growth_intelligence_request", {
      p_organization_id: organizationId,
      p_actor_id: "user-1",
      p_request_id: requestId,
      p_idempotency_key: idempotencyKey,
      p_correlation_id: expect.any(String),
    });
    expect(response.headers.get("x-correlation-id")).toBe(body.correlationId);
  });

  it("refuses viewers before touching the retry entry point", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await post({ idempotencyKey });

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed bodies and cross-tenant identifiers", async () => {
    const shortKey = await post({ idempotencyKey: "short" });
    expect(shortKey.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();

    const crossTenant = await POST(
      new Request("https://example.test/retry", {
        method: "POST",
        body: JSON.stringify({ idempotencyKey }),
      }),
      { params: Promise.resolve({ organizationId, requestId: "not-a-uuid" }) },
    );
    expect(crossTenant.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps an ineligible request to a safe retryable failure, not a server error", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "growth_intelligence_request_not_retryable" },
    });

    const response = await post({ idempotencyKey });

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).not.toBe("UNEXPECTED_ERROR");
  });

  it("replays identical retries without duplicating work", async () => {
    mocks.rpc.mockResolvedValue({
      data: { requestId, status: "pending", outcome: "retried", replayed: true },
      error: null,
    });

    const response = await post({ idempotencyKey });
    const body = (await response.json()) as { request: { replayed: boolean } };

    expect(response.status).toBe(200);
    expect(body.request.replayed).toBe(true);
  });

  it("prefers the server-owned organization context over route params", async () => {
    const canonical = "30000000-0000-4000-8000-000000000003";
    mocks.getOrganizationContext.mockResolvedValue({
      organizationId: canonical,
      user: { id: "user-1" },
      membership: { role: "operator" },
      supabase: { rpc: mocks.rpc },
    });

    const response = await post({ idempotencyKey });

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "retry_growth_intelligence_request",
      expect.objectContaining({
        p_organization_id: canonical,
      }),
    );
  });

  it("does not reveal rollout state to a non-member", async () => {
    mocks.getOrganizationContext.mockRejectedValue(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access."),
    );

    const response = await post({ idempotencyKey });

    expect(response.status).toBe(403);
    expect(mocks.assertAccess).not.toHaveBeenCalled();
  });
});
