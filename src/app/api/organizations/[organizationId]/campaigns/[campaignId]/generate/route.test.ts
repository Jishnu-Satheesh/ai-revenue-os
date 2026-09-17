import { beforeEach, describe, expect, it, vi } from "vitest";

// The route hands each enqueued run to a worker, which pulls in env
// (server-only) and the Trigger SDK. Both are stubbed so this stays a route
// test; the dispatch itself is covered in generation-dispatch.test.ts.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: { CAMPAIGN_GENERATION_COST_CEILING_MINOR: undefined } }));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn(async () => ({ id: "run_worker_1" })) },
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "e0000000-0000-4000-8000-000000000002";

const getOrganizationContext = vi.fn();
const publishOrganizationEvent = vi.fn();
const assertCampaignsEnabled = vi.fn();
const getCampaign = vi.fn();
const latestGenerationRun = vi.fn();
const enqueue = vi.fn();
const readApprovedCeiling = vi.fn();

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
  createCampaignReadRepository: () => ({ getCampaign, latestGenerationRun }),
}));
vi.mock("@/modules/campaigns/infrastructure/run-repository", () => ({
  createCampaignRunDispatcher: () => ({ enqueue }),
}));
vi.mock("@/modules/campaigns/application/generation-cap", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/modules/campaigns/application/generation-cap")>();
  return {
    ...actual,
    createApprovedGenerationCapReader: () => ({ readApprovedCeiling }),
  };
});

import { POST as generateRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/generate/route";

function params(overrides: Record<string, string> = {}) {
  return Promise.resolve({
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    ...overrides,
  });
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/api/campaigns/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** The snapshot read inside the route, via the member session client. */
function snapshotClient() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => ({
              order: () => ({
                limit: async () => ({ data: [{ id: SNAPSHOT_ID }], error: null }),
              }),
            }),
          }),
        }),
      }),
    }),
  };
}

beforeEach(() => {
  for (const spy of [
    getOrganizationContext,
    publishOrganizationEvent,
    assertCampaignsEnabled,
    getCampaign,
    latestGenerationRun,
    enqueue,
    readApprovedCeiling,
  ]) {
    spy.mockReset();
  }
  getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    user: { id: "user-1" },
    supabase: snapshotClient(),
    membership: { role: "operator" },
  });
  getCampaign.mockResolvedValue({ id: CAMPAIGN_ID, sourceKind: "campaign_proposal" });
  latestGenerationRun.mockResolvedValue(null);
  enqueue.mockResolvedValue({ runId: "run-1", replayed: false });
  readApprovedCeiling.mockResolvedValue({
    ceilingMinor: 8000,
    state: "approved_for_preparation",
  });
});

describe("the approval-to-generation link", () => {
  it("dispatches inside the approved purse and announces generation_started", async () => {
    const response = await generateRoute(jsonRequest({ idempotencyKey: "key-12345678" }), {
      params: params(),
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ runId: "run-1", replayed: false });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(publishOrganizationEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "campaign.generation_started" }),
    );
  });

  it("returns the existing run on double-click without a second announcement", async () => {
    enqueue.mockResolvedValue({ runId: "run-1", replayed: true });

    const first = await generateRoute(jsonRequest({ idempotencyKey: "key-12345678" }), {
      params: params(),
    });
    const second = await generateRoute(jsonRequest({ idempotencyKey: "key-12345678" }), {
      params: params(),
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ runId: "run-1", replayed: true });
    // One announcement per run, not per click: the replay must not announce a
    // second generation that never started.
    expect(publishOrganizationEvent).not.toHaveBeenCalled();
  });

  it("refuses a guessed campaign id from another tenant before anything is queued", async () => {
    // A campaign from org B is invisible from org A: the tenant-scoped read
    // returns null, and the route answers "not available" either way.
    getCampaign.mockResolvedValue(null);

    const response = await generateRoute(jsonRequest({ idempotencyKey: "key-12345678" }), {
      params: params(),
    });

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
    expect(publishOrganizationEvent).not.toHaveBeenCalled();
  });

  it("refuses before dispatch when the attempt costs more than the approval permits", async () => {
    // The worker default (500 minor) against a 100-minor purse.
    readApprovedCeiling.mockResolvedValue({ ceilingMinor: 100, state: "approved_for_preparation" });

    const response = await generateRoute(jsonRequest({ idempotencyKey: "key-12345678" }), {
      params: params(),
    });

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
    expect(publishOrganizationEvent).not.toHaveBeenCalled();
  });

  it("refuses before dispatch when the approval cannot be read", async () => {
    readApprovedCeiling.mockResolvedValue({ ceilingMinor: null, state: null });

    const response = await generateRoute(jsonRequest({ idempotencyKey: "key-12345678" }), {
      params: params(),
    });

    expect(response.status).toBe(400);
    expect(enqueue).not.toHaveBeenCalled();
    expect(publishOrganizationEvent).not.toHaveBeenCalled();
  });

  it("leaves campaigns without a proposal on the existing path", async () => {
    getCampaign.mockResolvedValue({ id: CAMPAIGN_ID, sourceKind: "manual_brief" });

    const response = await generateRoute(jsonRequest({ idempotencyKey: "key-12345678" }), {
      params: params(),
    });

    expect(response.status).toBe(202);
    expect(readApprovedCeiling).not.toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
