import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  assertEnabled: vi.fn(),
  campaignsGate: vi.fn(),
  growthGate: vi.fn(),
  dispatch: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/modules/organizations/application/growth-progress-access", () => ({
  assertOverviewGrowthProgressEnabled: mocks.assertEnabled,
}));
vi.mock("@/modules/campaigns/application/feature-access", () => ({
  isCampaignsEnabled: mocks.campaignsGate,
}));
vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  hasGrowthIntelligenceAccess: mocks.growthGate,
}));
vi.mock("@/modules/organizations/infrastructure/growth-publication-dispatch", () => ({
  dispatchGrowthBuildNow: mocks.dispatch,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: mocks.info, error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/growth/projection/route";

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function stubContext(role: string) {
  const maybeSingle = vi.fn(async () => ({
    data: { default_timezone: "Asia/Dubai" },
    error: null,
  }));
  const eq = vi.fn(() => ({ maybeSingle }));
  const select = vi.fn(() => ({ eq }));
  const supabase = { from: vi.fn(() => ({ select })), rpc: vi.fn() };
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId: ORG_ID,
    user: { id: "user-1" },
    membership: { role },
    supabase,
  });
}

function request(body: unknown) {
  return new Request(`http://localhost/api/organizations/${ORG_ID}/growth/projection`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const params = Promise.resolve({ organizationId: ORG_ID });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertEnabled.mockReturnValue(undefined);
  mocks.campaignsGate.mockReturnValue(true);
  mocks.growthGate.mockReturnValue(true);
  mocks.dispatch.mockResolvedValue(true);
  stubContext("admin");
});

describe("POST growth/projection", () => {
  it("dispatches tonight's build for an admin and answers 202", async () => {
    const response = await POST(request({ idempotencyKey: "a".repeat(16) }), { params });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ triggered: true });
    expect(mocks.dispatch).toHaveBeenCalledTimes(1);
    expect(mocks.dispatch.mock.calls[0]?.[0]).toMatchObject({
      organizationId: ORG_ID,
      timeZone: "Asia/Dubai",
      gates: { growth: true, campaigns: true },
    });
    expect(typeof mocks.dispatch.mock.calls[0]?.[0].snapshotDate).toBe("string");
  });

  it("refuses viewers and operators with 403 and never dispatches", async () => {
    for (const role of ["viewer", "operator"]) {
      stubContext(role);
      const response = await POST(request({ idempotencyKey: "b".repeat(16) }), { params });
      expect(response.status).toBe(403);
    }
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("refuses outside the allow-list without dispatching", async () => {
    const { DomainError } = await import("@/lib/errors");
    mocks.assertEnabled.mockImplementation(() => {
      throw new DomainError("FEATURE_NOT_AVAILABLE", "Not available.");
    });
    const response = await POST(request({ idempotencyKey: "c".repeat(16) }), { params });
    expect(response.status).toBe(403);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a missing idempotency key with 400", async () => {
    const response = await POST(request({}), { params });
    expect(response.status).toBe(400);
    expect(mocks.dispatch).not.toHaveBeenCalled();
  });

  it("answers 503 with honest copy when the worker cannot be reached", async () => {
    mocks.dispatch.mockResolvedValue(false);
    const response = await POST(request({ idempotencyKey: "d".repeat(16) }), { params });
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).toMatch(/scheduled run is unaffected/);
  });
});
