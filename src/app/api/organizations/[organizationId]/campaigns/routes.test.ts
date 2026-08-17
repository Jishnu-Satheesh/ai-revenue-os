import { beforeEach, describe, expect, it, vi } from "vitest";

// The routes now hand each enqueued run to a worker, which pulls in env
// (server-only) and the Trigger SDK. Both are stubbed so these stay route
// tests; the dispatch itself is covered in generation-dispatch.test.ts.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { CAMPAIGN_GENERATION_COST_CEILING_MINOR: undefined } }));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn(async () => ({ id: "run_worker_1" })) },
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "99999999-9999-4999-8999-999999999999";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const VERSION_ID = "f0000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "e0000000-0000-4000-8000-000000000002";
const ATTESTATION_ID = "d0000000-0000-4000-8000-000000000001";

const getOrganizationContext = vi.fn();
const publishOrganizationEvent = vi.fn();
const assertCampaignsEnabled = vi.fn();
const listCampaigns = vi.fn();
const getCampaign = vi.fn();
const getVersion = vi.fn();
const listVersions = vi.fn();
const getLiveApproval = vi.fn();
const recordAttestation = vi.fn();
const approve = vi.fn();
const enqueue = vi.fn();

vi.mock("@/lib/api/organization-context", () => ({
  apiErrorResponse: (error: unknown) =>
    Response.json(
      { error: { message: error instanceof Error ? error.message : "error" } },
      { status: 400 },
    ),
  getOrganizationContext: (...args: unknown[]) => getOrganizationContext(...args),
  publishOrganizationEvent: (...args: unknown[]) => publishOrganizationEvent(...args),
}));
vi.mock("@/modules/campaigns/application/feature-access", () => ({
  assertCampaignsEnabled: (...args: unknown[]) => assertCampaignsEnabled(...args),
}));
vi.mock("@/modules/campaigns/infrastructure/repository", () => ({
  createCampaignReadRepository: () => ({
    listCampaigns,
    getCampaign,
    getVersion,
    listVersions,
    getLiveApproval,
    recordAttestation,
    approve,
  }),
  createCampaignVersionWriter: () => ({ createVersion: vi.fn() }),
}));
vi.mock("@/modules/campaigns/infrastructure/run-repository", () => ({
  createCampaignRunDispatcher: () => ({ enqueue }),
  createCampaignRunStore: () => ({}),
}));
vi.mock("@/domain/events/publisher", () => ({
  createEventPublisher: () => ({ publish: vi.fn() }),
}));

import { GET as listRoute } from "@/app/api/organizations/[organizationId]/campaigns/route";
import { GET as detailRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/route";
import { POST as attestRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/attest/route";
import { POST as approveRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/approve/route";
import { POST as revisionsRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/revisions/route";

function params(overrides: Record<string, string> = {}) {
  return Promise.resolve({
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    ...overrides,
  });
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/campaigns", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  for (const spy of [
    getOrganizationContext,
    publishOrganizationEvent,
    assertCampaignsEnabled,
    listCampaigns,
    getCampaign,
    getVersion,
    listVersions,
    getLiveApproval,
    recordAttestation,
    approve,
    enqueue,
  ]) {
    spy.mockReset();
  }
  getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    user: { id: "user-1" },
    supabase: {},
    membership: { role: "operator" },
  });
  listCampaigns.mockResolvedValue([]);
  getCampaign.mockResolvedValue({ id: CAMPAIGN_ID, organizationId: ORGANIZATION_ID });
  listVersions.mockResolvedValue([]);
  getLiveApproval.mockResolvedValue(null);
  enqueue.mockResolvedValue({ runId: "run-1", replayed: false });
});

describe("campaign route authorization", () => {
  it("checks membership before the rollout gate, so tenants cannot be enumerated", async () => {
    const order: string[] = [];
    getOrganizationContext.mockImplementation(async () => {
      order.push("membership");
      return {
        organizationId: ORGANIZATION_ID,
        user: { id: "user-1" },
        supabase: {},
        membership: { role: "operator" },
      };
    });
    assertCampaignsEnabled.mockImplementation(() => order.push("gate"));

    await listRoute(new Request("http://localhost/api/campaigns"), { params: params() });

    expect(order).toEqual(["membership", "gate"]);
  });

  it("never reaches the gate when membership fails", async () => {
    getOrganizationContext.mockRejectedValue(new Error("Authentication is required."));

    const response = await listRoute(new Request("http://localhost/api/campaigns"), {
      params: params(),
    });

    expect(response.status).toBe(400);
    expect(assertCampaignsEnabled).not.toHaveBeenCalled();
  });

  it("refuses when the organization is outside the rollout", async () => {
    assertCampaignsEnabled.mockImplementation(() => {
      throw new Error("Campaigns are not available for this organization.");
    });

    const response = await listRoute(new Request("http://localhost/api/campaigns"), {
      params: params(),
    });

    expect(response.status).toBe(400);
    expect(listCampaigns).not.toHaveBeenCalled();
  });

  it("asks for the roles that may attest, not merely any member", async () => {
    recordAttestation.mockResolvedValue(ATTESTATION_ID);
    getVersion.mockResolvedValue(null);

    await attestRoute(
      jsonRequest({
        bundleVersionId: VERSION_ID,
        bundleDigest: "a".repeat(64),
        statement: "I reviewed every image.",
      }),
      { params: params() },
    );

    const [, roles] = getOrganizationContext.mock.calls[0] as unknown as [unknown, string[]];
    expect([...roles].sort()).toEqual(["admin", "operator", "owner"]);
  });
});

describe("campaign reads", () => {
  it("lists campaigns for the authenticated organization", async () => {
    listCampaigns.mockResolvedValue([{ id: CAMPAIGN_ID }]);

    const response = await listRoute(new Request("http://localhost/api/campaigns"), {
      params: params(),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ campaigns: [{ id: CAMPAIGN_ID }] });
    expect(listCampaigns).toHaveBeenCalledWith(ORGANIZATION_ID);
  });

  it("returns the timeline with its approval status", async () => {
    listVersions.mockResolvedValue([{ id: VERSION_ID, version: 1, digest: "a".repeat(64) }]);
    getLiveApproval.mockResolvedValue({
      bundleVersionId: VERSION_ID,
      bundleDigest: "a".repeat(64),
      expiresAt: "2099-01-01T00:00:00.000Z",
      revokedAt: null,
    });

    const response = await detailRoute(new Request("http://localhost/api/campaigns/x"), {
      params: params(),
    });

    expect(await response.json()).toMatchObject({ approval: { status: { isApproved: true } } });
  });

  it("rejects a campaign id that is not a UUID", async () => {
    const response = await detailRoute(new Request("http://localhost/api/campaigns/x"), {
      params: params({ campaignId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
  });
});

describe("approval", () => {
  const approveBody = {
    bundleVersionId: VERSION_ID,
    bundleDigest: "a".repeat(64),
    attestationId: ATTESTATION_ID,
    expiresAt: "2099-01-01T00:00:00.000Z",
    actionKeys: ["b0000000-0000-4000-8000-000000000001"],
  };

  it("approves the exact version and reports the approval", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: CAMPAIGN_ID,
      manifest: { totalSpendCeiling: { amountMinor: 150_000, currency: "AED" } },
    });
    approve.mockResolvedValue("approval-1");

    const response = await approveRoute(jsonRequest(approveBody), { params: params() });

    expect(response.status).toBe(201);
    expect(approve).toHaveBeenCalledWith(
      expect.objectContaining({
        bundleVersionId: VERSION_ID,
        totalSpendCeiling: { amountMinor: 150_000, currency: "AED" },
      }),
    );
  });

  it("takes the spend ceiling from the stored version, never the request", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: CAMPAIGN_ID,
      manifest: { totalSpendCeiling: { amountMinor: 1_000, currency: "AED" } },
    });
    approve.mockResolvedValue("approval-1");

    await approveRoute(
      jsonRequest({ ...approveBody, totalSpendCeiling: { amountMinor: 999_999, currency: "AED" } }),
      { params: params() },
    );

    // The extra field is rejected outright by the strict schema, so no approval
    // is attempted at all.
    expect(approve).not.toHaveBeenCalled();
  });

  it("refuses a version belonging to a different campaign", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: "c0000000-0000-4000-8000-000000000099",
      manifest: { totalSpendCeiling: null },
    });

    const response = await approveRoute(jsonRequest(approveBody), { params: params() });

    expect(response.status).toBe(400);
    expect(approve).not.toHaveBeenCalled();
  });

  it("publishes an identifier-only approval event after the write", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: CAMPAIGN_ID,
      manifest: { totalSpendCeiling: null },
    });
    approve.mockResolvedValue("approval-1");

    await approveRoute(jsonRequest(approveBody), { params: params() });

    expect(publishOrganizationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "campaign.approved" }),
    );
  });

  it("refuses an approval that authorizes no actions", async () => {
    const response = await approveRoute(jsonRequest({ ...approveBody, actionKeys: [] }), {
      params: params(),
    });

    expect(response.status).toBe(400);
  });
});

describe("revisions", () => {
  const revisionBody = {
    baseVersionId: VERSION_ID,
    baseDigest: "a".repeat(64),
    prompt: "Shorten the hook.",
    scope: { kind: "copy", directionId: "d0000000-0000-4000-8000-000000000002" },
    idempotencyKey: "idem-key-12345678",
  };

  it("queues the revision rather than revising in the request", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: CAMPAIGN_ID,
      digest: "a".repeat(64),
      sourceSnapshotId: SNAPSHOT_ID,
      manifest: {},
    });

    const response = await revisionsRoute(jsonRequest(revisionBody), { params: params() });

    expect(response.status).toBe(202);
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "revise",
        operatorPrompt: "Shorten the hook.",
        patchScope: "copy",
        sourceSnapshotId: SNAPSHOT_ID,
      }),
    );
  });

  it("refuses when the version changed under the operator", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: CAMPAIGN_ID,
      digest: "b".repeat(64),
      sourceSnapshotId: SNAPSHOT_ID,
      manifest: {},
    });

    const response = await revisionsRoute(jsonRequest(revisionBody), { params: params() });

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a base version from another campaign", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: "c0000000-0000-4000-8000-000000000099",
      digest: "a".repeat(64),
      sourceSnapshotId: SNAPSHOT_ID,
      manifest: {},
    });

    const response = await revisionsRoute(jsonRequest(revisionBody), { params: params() });

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("reports a replayed enqueue as 200 rather than a second acceptance", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: CAMPAIGN_ID,
      digest: "a".repeat(64),
      sourceSnapshotId: SNAPSHOT_ID,
      manifest: {},
    });
    enqueue.mockResolvedValue({ runId: "run-1", replayed: true });

    const response = await revisionsRoute(jsonRequest(revisionBody), { params: params() });

    expect(response.status).toBe(200);
  });

  it("refuses malformed JSON safely", async () => {
    const response = await revisionsRoute(
      new Request("http://localhost/api/campaigns", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
      { params: params() },
    );

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("refuses a body that names another organization", async () => {
    const response = await revisionsRoute(
      jsonRequest({ ...revisionBody, organizationId: OTHER_ORGANIZATION_ID }),
      { params: params() },
    );

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
  });
});
