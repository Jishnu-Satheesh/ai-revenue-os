import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: {} }));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "22222222-2222-4222-8222-222222222222";
const BUNDLE_ID = "33333333-3333-4333-8333-333333333333";
const DIGEST = "c".repeat(64);

const campaignRouteContext = vi.fn();
const publishOrganizationEvent = vi.fn();
const getVersion = vi.fn();
const rpc = vi.fn();

vi.mock("@/modules/campaigns/application/route-context", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/campaigns/application/route-context")>();
  return { ...actual, campaignRouteContext: (...args: unknown[]) => campaignRouteContext(...args) };
});
vi.mock("@/lib/api/organization-context", () => ({
  apiErrorResponse: (error: unknown) =>
    Response.json(
      { error: { message: error instanceof Error ? error.message : "error" } },
      { status: 400 },
    ),
  publishOrganizationEvent: (...args: unknown[]) => publishOrganizationEvent(...args),
}));
vi.mock("@/modules/campaigns/infrastructure/repository", () => ({
  createCampaignReadRepository: () => ({ getVersion }),
}));

import { POST as scheduleRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/schedule/route";

function params() {
  return Promise.resolve({ organizationId: ORGANIZATION_ID, campaignId: CAMPAIGN_ID });
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/campaigns/schedule", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function body() {
  return { bundleVersionId: BUNDLE_ID, bundleDigest: DIGEST, idempotencyKey: "owner-schedules-11" };
}

beforeEach(() => {
  campaignRouteContext.mockReset();
  publishOrganizationEvent.mockReset();
  getVersion.mockReset();
  rpc.mockReset();
  campaignRouteContext.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    user: { id: "user" },
    supabase: { rpc },
  });
  getVersion.mockResolvedValue({ campaignId: CAMPAIGN_ID, digest: DIGEST });
  rpc.mockResolvedValue({ data: { created_count: 1, total_count: 1 }, error: null });
});

describe("scheduling without publication authority", () => {
  it("refuses visibly with the unblocking act, rather than a generic failure", async () => {
    // The gate fails closed in the database; the route translates that refusal
    // into the one act that unblocks it, so the operator is not left retrying
    // the same call.
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "campaign_schedule_requires_launch_authority" },
    });

    const response = await scheduleRoute(jsonRequest(body()), { params: params() });

    expect(await response.json()).toEqual({
      error: {
        message:
          "Publication has not been authorized for these exact outputs yet. Authorize publication first, then schedule again.",
      },
    });
    expect(publishOrganizationEvent).not.toHaveBeenCalled();
  });

  it("keeps the generic copy for failures that are not the authority gate", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "40001", message: "serialization failure" } });

    const response = await scheduleRoute(jsonRequest(body()), { params: params() });

    expect(await response.json()).toEqual({
      error: { message: "The campaign could not be scheduled." },
    });
    expect(publishOrganizationEvent).not.toHaveBeenCalled();
  });
});
