import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertAccess: vi.fn(),
  hasPermission: vi.fn(),
  decide: vi.fn(),
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
  createMarketProfileService: () => ({ decide: mocks.decide }),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/market-profile/versions/[versionId]/decisions/route";
import { DomainError } from "@/lib/errors";

const organizationId = "10000000-0000-4000-8000-000000000001";
const versionId = "20000000-0000-4000-8000-000000000002";
const correlationId = "90000000-0000-4000-8000-000000000009";

function request(body: unknown) {
  return new Request("https://example.test/market-profile/decisions", {
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
  mocks.decide.mockResolvedValue({
    decisionId: "30000000-0000-4000-8000-000000000003",
    profileVersionId: versionId,
    requestId: "40000000-0000-4000-8000-000000000004",
    decision: "confirmed",
    replayed: false,
  });
});

describe("POST Market Profile decision", () => {
  it("checks membership, rollout, permission, exact input, then service", async () => {
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
    mocks.decide.mockImplementation(async () => {
      order.push("service");
      return {
        decisionId: crypto.randomUUID(),
        profileVersionId: versionId,
        requestId: crypto.randomUUID(),
        decision: "confirmed",
        replayed: false,
      };
    });

    const response = await POST(
      request({
        decision: "confirmed",
        profileDigest: "a".repeat(64),
        reason: "Approved",
        idempotencyKey: "profile-decision-0001",
      }),
      { params: Promise.resolve({ organizationId, versionId }) },
    );

    expect(response.status).toBe(200);
    expect(order).toEqual(["membership", "rollout", "permission", "service"]);
    expect(mocks.decide).toHaveBeenCalledWith({
      organizationId,
      actorId: "user-1",
      profileVersionId: versionId,
      profileDigest: "a".repeat(64),
      decision: "confirmed",
      reason: "Approved",
      idempotencyKey: "profile-decision-0001",
      correlationId,
    });
  });

  it("checks permission before parsing the version or body", async () => {
    mocks.hasPermission.mockReturnValue(false);

    const response = await POST(request({ malformed: true }), {
      params: Promise.resolve({ organizationId, versionId: "not-a-uuid" }),
    });

    expect(response.status).toBe(403);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("rejects a malformed exact-version decision before persistence", async () => {
    const response = await POST(
      request({
        decision: "confirmed",
        profileDigest: "wrong",
        idempotencyKey: "profile-decision-0001",
      }),
      { params: Promise.resolve({ organizationId, versionId }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("rejects a malformed correlation id after permission and before persistence", async () => {
    const badRequest = new Request("https://example.test/market-profile/decisions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-correlation-id": "correlation-1" },
      body: JSON.stringify({
        decision: "confirmed",
        profileDigest: "a".repeat(64),
        idempotencyKey: "profile-decision-0001",
      }),
    });

    const response = await POST(badRequest, {
      params: Promise.resolve({ organizationId, versionId }),
    });

    expect(response.status).toBe(400);
    expect(mocks.hasPermission).toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
    expect(response.headers.get("x-correlation-id")).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("returns safe stale-version copy without leaking database detail", async () => {
    mocks.decide.mockRejectedValue(
      new DomainError("DOMAIN_ERROR", "This Market Profile version is no longer available."),
    );

    const response = await POST(
      request({
        decision: "disabled",
        profileDigest: "a".repeat(64),
        idempotencyKey: "profile-decision-0002",
      }),
      { params: Promise.resolve({ organizationId, versionId }) },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: {
        code: "DOMAIN_ERROR",
        message: "This Market Profile version is no longer available.",
      },
    });
  });
});
