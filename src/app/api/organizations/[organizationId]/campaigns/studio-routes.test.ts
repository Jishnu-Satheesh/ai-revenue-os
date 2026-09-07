import { beforeEach, describe, expect, it, vi } from "vitest";

// The POST routes hand work to a worker, which pulls in env (server-only) and
// the Trigger SDK. Both are stubbed so these stay route tests; the dispatch
// itself is covered in poster-dispatch's own tests.
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: {} }));
vi.mock("@trigger.dev/sdk", () => ({
  tasks: { trigger: vi.fn(async () => ({ id: "run_worker_1" })) },
}));

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const VERSION_ID = "f0000000-0000-4000-8000-000000000001";
const PLATE_ID = "a0000000-0000-4000-8000-0000000000aa";
const DIGEST = "a".repeat(64);
const USER_ID = "b0000000-0000-4000-8000-0000000000bb";

const getOrganizationContext = vi.fn();
const assertCampaignsEnabled = vi.fn();
const getVersion = vi.fn();
const listVersions = vi.fn();
const getLiveApproval = vi.fn();
const readPosterStudioView = vi.fn();
const readPosterTemplates = vi.fn();
const dispatchPosterRender = vi.fn();
const dispatchPlateEdit = vi.fn();
const rolesSeen: unknown[] = [];

vi.mock("@/lib/api/organization-context", () => ({
  apiErrorResponse: (error: unknown) =>
    Response.json(
      { error: { message: error instanceof Error ? error.message : "error" } },
      { status: 400 },
    ),
  getOrganizationContext: (params: unknown, roles: unknown) => {
    rolesSeen.push(roles);
    return getOrganizationContext(params, roles);
  },
}));
vi.mock("@/modules/campaigns/application/feature-access", () => ({
  assertCampaignsEnabled: (...args: unknown[]) => assertCampaignsEnabled(...args),
}));
vi.mock("@/modules/campaigns/infrastructure/repository", () => ({
  createCampaignReadRepository: () => ({ getVersion, listVersions, getLiveApproval }),
  createCampaignVersionWriter: () => ({ createVersion: vi.fn() }),
}));
vi.mock("@/modules/campaigns/infrastructure/poster-studio-reader", () => ({
  readPosterStudioView: (...args: unknown[]) => readPosterStudioView(...args),
  readPosterTemplates: (...args: unknown[]) => readPosterTemplates(...args),
}));
vi.mock("@/modules/campaigns/infrastructure/poster-dispatch", () => ({
  dispatchPosterRender: (...args: unknown[]) => dispatchPosterRender(...args),
  dispatchPlateEdit: (...args: unknown[]) => dispatchPlateEdit(...args),
}));

import { GET as templatesRoute } from "@/app/api/organizations/[organizationId]/poster-templates/route";
import { GET as studioRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/studio/route";
import { POST as rendersRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/renders/route";
import { POST as plateEditsRoute } from "@/app/api/organizations/[organizationId]/campaigns/[campaignId]/plate-edits/route";
import { validManifest } from "@/domain/campaigns/test-manifest";

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

/** A session client that answers the two direct table reads the routes make. */
function supabaseWith(rows: Record<string, unknown[]>) {
  return {
    from(table: string) {
      return {
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: rows[table] ?? [], error: null }),
          }),
        }),
      };
    },
  };
}

const manifest = validManifest();

function renderBody(overrides: Record<string, unknown> = {}) {
  return {
    bundleVersionId: VERSION_ID,
    bundleDigest: DIGEST,
    plateAssetId: PLATE_ID,
    directionId: manifest.directions[0].id,
    channel: "instagram",
    templateKey: "core_feed_headline",
    templateVersion: 1,
    script: "Latn",
    extra: null,
    ...overrides,
  };
}

function editBody(overrides: Record<string, unknown> = {}) {
  return {
    bundleVersionId: VERSION_ID,
    bundleDigest: DIGEST,
    parentPlateAssetId: PLATE_ID,
    annotations: [
      {
        ordinal: 1,
        bounds: { xPx: 100, yPx: 100, widthPx: 200, heightPx: 200 },
        instruction: "Make the curry look less orange.",
      },
    ],
    idempotencyKey: "edit-key-000001",
    ...overrides,
  };
}

beforeEach(() => {
  rolesSeen.length = 0;
  for (const spy of [
    getOrganizationContext,
    assertCampaignsEnabled,
    getVersion,
    listVersions,
    getLiveApproval,
    readPosterStudioView,
    readPosterTemplates,
    dispatchPosterRender,
    dispatchPlateEdit,
  ]) {
    spy.mockReset();
  }
  getOrganizationContext.mockResolvedValue({
    organizationId: ORGANIZATION_ID,
    user: { id: USER_ID },
    supabase: supabaseWith({
      campaign_assets: [{ width_px: 1080, height_px: 1080, bundle_version_id: VERSION_ID }],
      campaign_source_snapshots: [{ facts: { dishes: ["Kingfish curry"] } }],
    }),
    membership: { role: "operator" },
  });
  getVersion.mockResolvedValue({
    id: VERSION_ID,
    campaignId: CAMPAIGN_ID,
    digest: DIGEST,
    manifest,
  });
  listVersions.mockResolvedValue([{ id: VERSION_ID }]);
  getLiveApproval.mockResolvedValue(null);
  readPosterStudioView.mockResolvedValue({ offers: [], renders: [] });
  readPosterTemplates.mockResolvedValue({ templates: [], unreadable: [] });
  dispatchPosterRender.mockResolvedValue({ workerId: "run_worker_1" });
  dispatchPlateEdit.mockResolvedValue({ workerId: "run_worker_2" });
});

describe("who may do what", () => {
  /**
   * Reading what a poster would say is not producing one. A viewer holds
   * `campaign.read` and must not hold `poster.render`, or the cheapest way to
   * spend a tenant's model budget is a read-only account.
   */
  it("admits a viewer to the reads and refuses them the renders", async () => {
    await studioRoute(new Request("http://localhost/studio"), { params: params() });
    await templatesRoute(new Request("http://localhost/templates"), { params: params() });
    await rendersRoute(jsonRequest(renderBody()), { params: params() });
    await plateEditsRoute(jsonRequest(editBody()), { params: params() });

    const [studio, templates, renders, edits] = rolesSeen as string[][];
    expect(studio).toContain("viewer");
    expect(templates).toContain("viewer");
    expect(renders).not.toContain("viewer");
    expect(edits).not.toContain("viewer");
    expect([...renders].sort()).toEqual(["admin", "operator", "owner"]);
  });

  it("checks membership before the rollout gate, so tenants cannot be enumerated", async () => {
    const order: string[] = [];
    getOrganizationContext.mockImplementation(async () => {
      order.push("membership");
      return {
        organizationId: ORGANIZATION_ID,
        user: { id: USER_ID },
        supabase: supabaseWith({}),
        membership: { role: "operator" },
      };
    });
    assertCampaignsEnabled.mockImplementation(() => order.push("gate"));

    await studioRoute(new Request("http://localhost/studio"), { params: params() });

    expect(order).toEqual(["membership", "gate"]);
  });
});

describe("the studio read", () => {
  it("reads the version an operator named", async () => {
    await studioRoute(new Request(`http://localhost/studio?bundleVersionId=${VERSION_ID}`), {
      params: params(),
    });

    expect(readPosterStudioView).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      ORGANIZATION_ID,
      CAMPAIGN_ID,
      VERSION_ID,
    );
  });

  it("refuses a campaign with no version rather than returning an empty studio", async () => {
    listVersions.mockResolvedValue([]);

    const response = await studioRoute(new Request("http://localhost/studio"), {
      params: params(),
    });

    expect(response.status).toBe(400);
    expect(readPosterStudioView).not.toHaveBeenCalled();
  });

  it("refuses another campaign's version", async () => {
    readPosterStudioView.mockResolvedValue(null);

    const response = await studioRoute(new Request("http://localhost/studio"), {
      params: params(),
    });

    expect(response.status).toBe(400);
  });
});

describe("queuing a render", () => {
  it("queues the render and answers with the worker", async () => {
    const response = await rendersRoute(jsonRequest(renderBody()), { params: params() });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ workerId: "run_worker_1" });
    expect(dispatchPosterRender).toHaveBeenCalledWith(
      expect.objectContaining({ script: "Latn", templateKey: "core_feed_headline" }),
    );
  });

  /** A stale tab would otherwise render words from a proposal that has changed. */
  it("refuses a digest that no longer matches the version", async () => {
    const response = await rendersRoute(jsonRequest(renderBody({ bundleDigest: "b".repeat(64) })), {
      params: params(),
    });

    expect(response.status).toBe(400);
    expect(dispatchPosterRender).not.toHaveBeenCalled();
  });

  it("refuses a version belonging to another campaign", async () => {
    getVersion.mockResolvedValue({
      id: VERSION_ID,
      campaignId: "c0000000-0000-4000-8000-0000000000ff",
      digest: DIGEST,
      manifest,
    });

    const response = await rendersRoute(jsonRequest(renderBody()), { params: params() });

    expect(response.status).toBe(400);
    expect(dispatchPosterRender).not.toHaveBeenCalled();
  });

  /**
   * The free box is the one ungoverned thing a poster can draw, so it is the
   * one place an unapproved offer could reach artwork. It answers to the same
   * rule generated variant copy does.
   */
  it("refuses an offer typed into the free box", async () => {
    const response = await rendersRoute(
      jsonRequest(renderBody({ extra: "50% off this week only" })),
      { params: params() },
    );

    expect(response.status).toBe(400);
    expect(dispatchPosterRender).not.toHaveBeenCalled();
  });

  it("allows free text the campaign's own evidence supports", async () => {
    const response = await rendersRoute(jsonRequest(renderBody({ extra: "Kingfish curry" })), {
      params: params(),
    });

    expect(response.status).toBe(202);
    expect(dispatchPosterRender).toHaveBeenCalledWith(
      expect.objectContaining({ extra: "Kingfish curry" }),
    );
  });
});

describe("queuing a plate edit", () => {
  it("queues the edit and reports what it will cover", async () => {
    const response = await plateEditsRoute(jsonRequest(editBody()), { params: params() });

    expect(response.status).toBe(202);
    const body = await response.json();
    expect(body.workerId).toBe("run_worker_2");
    // 200x200 of 1080x1080.
    expect(body.unionCoverageRatio).toBeCloseTo(40_000 / 1_166_400, 6);
  });

  /**
   * The operator is withdrawing an approval by editing. Being told afterwards
   * -- when a dispatch refuses for want of an approval nobody knew had lapsed
   * -- is the failure this feature is most likely to cause.
   */
  it("says before the edit runs that it will invalidate a live approval", async () => {
    getLiveApproval.mockResolvedValue({
      bundleVersionId: VERSION_ID,
      bundleDigest: DIGEST,
      expiresAt: "2099-01-01T00:00:00.000Z",
      revokedAt: null,
    });

    const response = await plateEditsRoute(jsonRequest(editBody()), { params: params() });

    expect((await response.json()).invalidatesApproval).toBe(true);
  });

  it("does not claim an invalidation when no approval stands", async () => {
    const response = await plateEditsRoute(jsonRequest(editBody()), { params: params() });

    expect((await response.json()).invalidatesApproval).toBe(false);
  });

  it("refuses a region that runs off the plate, before anything is queued", async () => {
    const response = await plateEditsRoute(
      jsonRequest(
        editBody({
          annotations: [
            {
              ordinal: 1,
              bounds: { xPx: 1000, yPx: 1000, widthPx: 200, heightPx: 200 },
              instruction: "Change this.",
            },
          ],
        }),
      ),
      { params: params() },
    );

    expect(response.status).toBe(400);
    expect(dispatchPlateEdit).not.toHaveBeenCalled();
  });

  /**
   * Editing one version's plate under another version's identity would produce
   * a successor whose parent is not the version it claims.
   */
  it("refuses a plate belonging to a different version", async () => {
    getOrganizationContext.mockResolvedValue({
      organizationId: ORGANIZATION_ID,
      user: { id: USER_ID },
      supabase: supabaseWith({
        campaign_assets: [
          {
            width_px: 1080,
            height_px: 1080,
            bundle_version_id: "f0000000-0000-4000-8000-0000000000ff",
          },
        ],
      }),
      membership: { role: "operator" },
    });

    const response = await plateEditsRoute(jsonRequest(editBody()), { params: params() });

    expect(response.status).toBe(400);
    expect(dispatchPlateEdit).not.toHaveBeenCalled();
  });

  it("records the member who marked the regions as the editor", async () => {
    await plateEditsRoute(jsonRequest(editBody()), { params: params() });

    expect(dispatchPlateEdit).toHaveBeenCalledWith(expect.objectContaining({ editedBy: USER_ID }));
  });
});
