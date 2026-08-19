import { beforeEach, describe, expect, it, vi } from "vitest";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const PROPOSAL_ID = "d0000000-0000-4000-8000-000000000001";

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

import { POST as decisionRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/learning/[proposalId]/decision/route";

function params(overrides: Record<string, string> = {}) {
  return Promise.resolve({
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    proposalId: PROPOSAL_ID,
    ...overrides,
  });
}

function requestBody(decision: string) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ decision }),
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

describe("learning decision route", () => {
  it("records an operator's decision through the decision RPC, and nothing else", async () => {
    const rpc = vi.fn(async () => ({
      data: { outcome: "decided", proposal_id: PROPOSAL_ID, status: "dismissed" },
      error: null,
    }));
    getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      supabase: { rpc },
      membership: { role: "operator" },
    });

    const response = await decisionRoute(requestBody("dismiss"), { params: params() });

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("decide_campaign_learning_proposal", {
      target_organization_id: ORGANIZATION_ID,
      input_decision: {
        organization_id: ORGANIZATION_ID,
        proposal_id: PROPOSAL_ID,
        decision: "dismiss",
      },
    });

    const body = await response.json();
    expect(body).toEqual({ outcome: "decided", proposalId: PROPOSAL_ID, status: "dismissed" });
  });

  it("requests the approving roles, never a viewer", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      supabase: { rpc },
      membership: { role: "viewer" },
    });

    await decisionRoute(requestBody("dismiss"), { params: params() });

    // The route asks the organization context for the `campaign.approve`
    // permission, which resolves to owner/admin/operator — a viewer is never
    // in that set, so the context would refuse a viewer before any RPC runs.
    expect(getOrganizationContext).toHaveBeenCalled();
    const roles = getOrganizationContext.mock.calls[0]?.[1] as readonly string[];
    expect(roles).toEqual(["owner", "admin", "operator"]);
    expect(roles).not.toContain("viewer");
  });

  it("rejects a decision outside the three allowed choices", async () => {
    const response = await decisionRoute(requestBody("auto_promote"), { params: params() });
    expect(response.status).toBe(400);
  });

  it("rejects a proposal id that is not a UUID", async () => {
    const response = await decisionRoute(requestBody("dismiss"), {
      params: params({ proposalId: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
  });
});
