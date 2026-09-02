import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";

const getOrganizationContext = vi.fn();
const assertCampaignsEnabled = vi.fn();

vi.mock("@/lib/api/organization-context", () => ({
  apiErrorResponse: (error: unknown) =>
    Response.json(
      { error: { message: error instanceof Error ? error.message : "error" } },
      { status: 400 },
    ),
  getOrganizationContext: (...args: unknown[]) => getOrganizationContext(...args),
}));
vi.mock("@/modules/campaigns/application/feature-access", () => ({
  assertCampaignsEnabled: (...args: unknown[]) => assertCampaignsEnabled(...args),
}));

import { GET as outcomeRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/outcome/route";

function params(overrides: Record<string, string> = {}) {
  return Promise.resolve({
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    ...overrides,
  });
}

beforeEach(() => {
  getOrganizationContext.mockReset();
  assertCampaignsEnabled.mockReset();
  getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    user: { id: "user-1" },
    supabase: {},
    membership: { role: "viewer" },
  });
});

describe("outcome route", () => {
  it("reads the settled outcome scoped to the organization and campaign", async () => {
    const order = vi.fn(async () => ({
      data: [
        {
          id: "o1",
          verdict: "inconclusive",
          attribution_method: "observational_prepost",
          primary_metric_key: "revenue.purchase_value",
          outcome_window_days: 14,
          settlement_delay_days: 3,
          baseline_source: "goal_baseline_measured:revenue.purchase_value",
          baseline_lookback_days: 28,
          planned_exposure_count: 6,
          realized_exposure_count: "4",
          guardrail_state: "clear",
          realized_spend_minor: "4000",
          spend_ceiling_minor: "10000",
          spend_currency: "USD",
          estimate_minor: null,
          estimate_low_minor: null,
          estimate_high_minor: null,
          estimate_currency: null,
          evidence_tier: null,
          truncation_causes: [],
          limitations: ["The preregistered evidence bar was not met."],
          settled_at: "2026-08-20T00:00:00.000Z",
        },
      ],
      error: null,
    }));
    const eq2 = vi.fn(() => ({ order }));
    const eq1 = vi.fn(() => ({ eq: eq2 }));
    const select = vi.fn(() => ({ eq: eq1 }));
    const from = vi.fn(() => ({ select }));

    getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      supabase: { from },
      membership: { role: "viewer" },
    });

    const response = await outcomeRoute(new Request("http://localhost/api"), { params: params() });

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("campaign_outcomes");
    expect(eq1).toHaveBeenCalledWith("organization_id", ORGANIZATION_ID);
    expect(eq2).toHaveBeenCalledWith("campaign_id", CAMPAIGN_ID);

    const body = await response.json();
    expect(body.outcome).toMatchObject({
      verdict: "inconclusive",
      plannedExposureCount: 6,
      realizedExposureCount: 4,
      guardrailState: "clear",
      evidenceTier: null,
    });
  });

  it("returns an empty outcome when nothing is settled yet", async () => {
    const order = vi.fn(async () => ({ data: [], error: null }));
    getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      supabase: {
        from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order }) }) }) }),
      },
      membership: { role: "viewer" },
    });

    const response = await outcomeRoute(new Request("http://localhost/api"), { params: params() });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: null });
  });

  it("rejects a campaign id that is not a UUID", async () => {
    const response = await outcomeRoute(new Request("http://localhost/api"), {
      params: params({ campaignId: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
  });
});
