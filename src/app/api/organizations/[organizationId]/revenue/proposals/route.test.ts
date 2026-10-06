import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  hasPermission: vi.fn(),
  campaignsGate: vi.fn(),
  growthGate: vi.fn(),
  readSource: vi.fn(),
  createProvider: vi.fn(),
  propose: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));
vi.mock("@/domain/access/permissions", () => ({
  hasOrganizationPermission: mocks.hasPermission,
}));
vi.mock("@/modules/campaigns/application/feature-access", () => ({
  isCampaignsEnabled: mocks.campaignsGate,
}));
vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  hasGrowthIntelligenceAccess: mocks.growthGate,
}));
vi.mock("@/modules/organizations/infrastructure/revenue-source", () => ({
  readRevenueSource: mocks.readSource,
}));
vi.mock("@/modules/organizations/infrastructure/revenue-proposal-provider", () => ({
  createRevenueProposalProvider: mocks.createProvider,
  REVENUE_PROPOSAL_MAX_ACTIONS: 10,
}));
vi.mock("@/lib/logger", () => ({
  logger: { warn: mocks.warn, info: vi.fn(), error: vi.fn() },
}));

import { POST } from "@/app/api/organizations/[organizationId]/revenue/proposals/route";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const FINDING_A = "22222222-2222-4222-8222-222222222221";

function sourceInput() {
  return {
    organizationId: ORG_ID,
    grain: "week" as const,
    history: [
      { label: "2026-08-04", minorUnits: 800_00, currency: "AED" },
      { label: "2026-08-11", minorUnits: 700_00, currency: "AED" },
    ],
    losses: [{ findingId: FINDING_A, minorUnits: 200_00, currency: "AED" }],
    actions: [
      {
        id: "rec-1",
        title: "Recover avoidable cancellations",
        kind: "recommendation" as const,
        status: "Planned",
        href: null,
        citedFindingId: FINDING_A,
        citedBasisMinorUnits: 200_00,
        citedCurrency: "AED",
        assumptionLow: null,
        assumptionHigh: null,
      },
    ],
    lastObservationDate: "2026-08-17",
    today: "2026-08-20",
    cutoffNote: "Reports through 2026-08-17.",
    coverageNote: "2 reporting channels · weekly buckets.",
  };
}

function stubContext() {
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
    membership: { role: "admin" },
    supabase,
  });
  return supabase;
}

function post(body: unknown) {
  return POST(
    new Request("https://example.test/revenue/proposals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ organizationId: ORG_ID }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.hasPermission.mockReturnValue(true);
  mocks.campaignsGate.mockReturnValue(true);
  mocks.growthGate.mockReturnValue(true);
  mocks.createProvider.mockReturnValue({ propose: mocks.propose });
  stubContext();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST revenue proposals", () => {
  it("refuses without the manage permission", async () => {
    mocks.hasPermission.mockImplementation(
      (role: unknown, permission: string) => permission !== "growth_intelligence.manage",
    );

    const response = await post({ idempotencyKey: "revenue-key-0000000001" });

    expect(response.status).toBe(403);
    expect(mocks.readSource).not.toHaveBeenCalled();
  });

  it("rejects a missing idempotency key", async () => {
    const response = await post({});

    expect(response.status).toBe(400);
    expect(mocks.readSource).not.toHaveBeenCalled();
  });

  it("fails closed to hold-current-level when the reads fail", async () => {
    mocks.readSource.mockResolvedValue({ status: "failed" });

    const response = await post({ idempotencyKey: "revenue-key-0000000001" });

    expect(response.status).toBe(422);
    expect(mocks.propose).not.toHaveBeenCalled();
  });

  it("fails closed to hold-current-level when the model fails", async () => {
    mocks.readSource.mockResolvedValue({
      status: "ready",
      input: sourceInput(),
      fetchedAt: "2026-08-20T00:00:00.000Z",
    });
    mocks.propose.mockRejectedValue(new Error("provider down"));

    const response = await post({ idempotencyKey: "revenue-key-0000000001" });
    const body = (await response.json()) as {
      scenario: { state: string; baselineMinorUnits: number; combinedHighMinorUnits: number };
      acceptedCount: number;
      aiNote: string;
    };

    expect(response.status).toBe(200);
    expect(body.scenario.state).toBe("ready");
    expect(body.scenario.baselineMinorUnits).toBe(700_00);
    expect(body.scenario.combinedHighMinorUnits).toBe(0);
    expect(body.acceptedCount).toBe(0);
    expect(body.aiNote).toMatch(/unavailable/);
  });

  it("attaches validated ranges and computes the scenario deterministically", async () => {
    mocks.readSource.mockResolvedValue({
      status: "ready",
      input: sourceInput(),
      fetchedAt: "2026-08-20T00:00:00.000Z",
    });
    mocks.propose.mockResolvedValue([
      {
        actionId: "rec-1",
        citedFindingId: FINDING_A,
        citedBasisMinorUnits: 200_00,
        currency: "AED",
        low: 0.1,
        high: 0.3,
      },
    ]);

    const response = await post({ idempotencyKey: "revenue-key-0000000001" });
    const body = (await response.json()) as {
      scenario: { state: string; combinedLowMinorUnits: number; combinedHighMinorUnits: number };
      acceptedCount: number;
      rejectedCount: number;
      aiNote: string;
    };

    expect(response.status).toBe(200);
    expect(body.scenario.combinedLowMinorUnits).toBe(20_00);
    expect(body.scenario.combinedHighMinorUnits).toBe(60_00);
    expect(body.acceptedCount).toBe(1);
    expect(body.rejectedCount).toBe(0);
    expect(mocks.propose).toHaveBeenCalledTimes(1);
    const request = mocks.propose.mock.calls[0]?.[0] as {
      request: { currency: string; losses: unknown[]; actions: unknown[] };
    };
    expect(request.request.currency).toBe("AED");
  });

  it("rejects ranges that cite no listed input without blocking the rest", async () => {
    mocks.readSource.mockResolvedValue({
      status: "ready",
      input: sourceInput(),
      fetchedAt: "2026-08-20T00:00:00.000Z",
    });
    mocks.propose.mockResolvedValue([
      {
        actionId: "rec-1",
        citedFindingId: "99999999-9999-4999-8999-999999999999",
        citedBasisMinorUnits: 100_00,
        currency: "AED",
        low: 0.1,
        high: 0.5,
      },
    ]);

    const response = await post({ idempotencyKey: "revenue-key-0000000001" });
    const body = (await response.json()) as {
      scenario: { combinedHighMinorUnits: number };
      acceptedCount: number;
      rejectedCount: number;
      aiNote: string;
    };

    expect(response.status).toBe(200);
    expect(body.scenario.combinedHighMinorUnits).toBe(0);
    expect(body.acceptedCount).toBe(0);
    expect(body.rejectedCount).toBe(1);
    expect(body.aiNote).toMatch(/rejected as uncited/);
  });
});
