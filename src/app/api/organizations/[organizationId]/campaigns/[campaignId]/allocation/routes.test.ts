import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const VARIANT_ID = "f0000000-0000-4000-8000-000000000001";

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

import { GET as allocationRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/allocation/route";
import { POST as resumeRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/variants/[variantId]/resume/route";

function params(overrides: Record<string, string> = {}) {
  return Promise.resolve({
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    variantId: VARIANT_ID,
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
    membership: { role: "operator" },
  });
});

describe("allocation ledger route", () => {
  it("reads the ledger scoped to the organization and campaign", async () => {
    const order = vi.fn(async () => ({
      data: [
        {
          id: "e1",
          variant_id: VARIANT_ID,
          rule_key: "diagnostic.spend_ceiling",
          rule_version: "v1",
          observed_value: 12000,
          threshold: 10000,
          resolved_margin_minor: null,
          resolved_margin_grade: null,
          action: "pause",
          reason_code: "spend_ceiling_exceeded",
          actor: "agent",
          occurred_at: "2026-08-19T12:00:00.000Z",
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

    const response = await allocationRoute(new Request("http://localhost/api"), {
      params: params(),
    });

    expect(response.status).toBe(200);
    expect(from).toHaveBeenCalledWith("campaign_allocation_events");
    expect(eq1).toHaveBeenCalledWith("organization_id", ORGANIZATION_ID);
    expect(eq2).toHaveBeenCalledWith("campaign_id", CAMPAIGN_ID);

    const body = await response.json();
    expect(body.events[0]).toMatchObject({
      variantId: VARIANT_ID,
      ruleKey: "diagnostic.spend_ceiling",
      observedValue: 12000,
      threshold: 10000,
      action: "pause",
      reasonCode: "spend_ceiling_exceeded",
    });
  });

  it("asks for read roles, which includes a viewer", async () => {
    const order = vi.fn(async () => ({ data: [], error: null }));
    getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      supabase: {
        from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order }) }) }) }),
      },
      membership: { role: "viewer" },
    });

    await allocationRoute(new Request("http://localhost/api"), { params: params() });

    const [, roles] = getOrganizationContext.mock.calls[0] as unknown as [unknown, string[]];
    expect(roles).toContain("viewer");
  });

  it("rejects a campaign id that is not a UUID", async () => {
    const response = await allocationRoute(new Request("http://localhost/api"), {
      params: params({ campaignId: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
  });
});

describe("resume route", () => {
  it("resumes through the operator-only RPC and reports the outcome", async () => {
    const rpc = vi.fn(async () => ({ data: { outcome: "resumed" }, error: null }));
    getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      supabase: { rpc },
      membership: { role: "operator" },
    });

    const response = await resumeRoute(new Request("http://localhost/api", { method: "POST" }), {
      params: params(),
    });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("resume_campaign_variant", {
      target_organization_id: ORGANIZATION_ID,
      input_resume: { organization_id: ORGANIZATION_ID, variant_id: VARIANT_ID },
    });
    expect(await response.json()).toEqual({ outcome: "resumed" });
  });

  it("asks for approving roles only: owner, admin, and operator", async () => {
    const rpc = vi.fn(async () => ({ data: { outcome: "resumed" }, error: null }));
    getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      supabase: { rpc },
      membership: { role: "owner" },
    });

    await resumeRoute(new Request("http://localhost/api", { method: "POST" }), {
      params: params(),
    });

    const [, roles] = getOrganizationContext.mock.calls[0] as unknown as [unknown, string[]];
    expect([...roles].sort()).toEqual(["admin", "operator", "owner"]);
  });

  it("rejects a variant id that is not a UUID", async () => {
    const response = await resumeRoute(new Request("http://localhost/api", { method: "POST" }), {
      params: params({ variantId: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
  });

  it("reports a refusal from the database rather than inventing success", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "42501", message: "forbidden" } }));
    getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      supabase: { rpc },
      membership: { role: "operator" },
    });

    const response = await resumeRoute(new Request("http://localhost/api", { method: "POST" }), {
      params: params(),
    });
    expect(response.status).toBe(400);
  });
});
