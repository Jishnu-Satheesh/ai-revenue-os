import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createDispatchPlanner,
  type PlannedPublish,
} from "@/modules/campaigns/infrastructure/dispatch-planner";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";

const ORG = "11111111-1111-4111-8111-111111111111";
const VERSION = "d1000000-0000-4000-8000-000000000001";

function action(overrides: Record<string, unknown> = {}) {
  const manifest = validManifest();
  return {
    organizationId: ORG,
    campaignId: manifest.campaignId,
    bundleVersionId: VERSION,
    actionRunId: "e1000000-0000-4000-8000-000000000001",
    actionKey: manifestIds.actionControl,
    scheduledFor: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

function persistence(overrides: Record<string, unknown> = {}) {
  const manifest = validManifest();
  const tables: Record<string, Record<string, unknown>[]> = {
    campaign_bundle_versions: [{ manifest }],
    campaign_assets: manifest.assets.map((asset) => ({
      asset_key: asset.id,
      storage_path: `${ORG}/campaign/${asset.id}.jpg`,
    })),
    integration_account_mappings: [{ external_account_id: "17841400000000000" }],
    ...(overrides.tables as Record<string, Record<string, unknown>[]>),
  };

  const signed = vi.fn(async () => ({
    data: { signedUrl: "https://storage.test/signed?token=x" },
    error: null,
  }));

  return {
    signed,
    client: {
      from: (table: string) => {
        const rows = tables[table] ?? [];
        const terminal = {
          then: (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null }),
          eq: () => terminal,
        };
        return { select: () => terminal };
      },
      storage: { from: () => ({ createSignedUrl: signed }) },
      ...(overrides.client as Record<string, unknown>),
    },
  };
}

function planner(overrides: Record<string, unknown> = {}) {
  const store = persistence(overrides);
  const requests = new Map<string, PlannedPublish>();
  return {
    plan: createDispatchPlanner(store.client as never, requests),
    requests,
    signed: store.signed,
  };
}

describe("the asset is made briefly fetchable, because Meta collects it itself", () => {
  it("signs the stored asset rather than sending a private path", async () => {
    const { plan, requests, signed } = planner();
    await plan.plan(action() as never);

    expect(signed).toHaveBeenCalled();
    expect(requests.get(action().actionRunId)?.imageUrl).toContain("https://");
  });

  it("signs for fifteen minutes, three times Meta's polling ceiling", async () => {
    // Too short and a container expires mid-processing with the image half
    // fetched; too long and a public link to unpublished creative outlives the
    // work it was for.
    const { plan, signed } = planner();
    await plan.plan(action() as never);

    expect(signed).toHaveBeenCalledWith(expect.any(String), 900);
  });

  it("gives up rather than planning a call with no reachable image", async () => {
    const { plan } = planner({
      client: {
        storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: {} }) }) },
      },
    });

    expect(await plan.plan(action() as never)).toBeNull();
  });
});

describe("the plan describes exactly the approved action", () => {
  it("chooses the tool key from the approved placement", async () => {
    const { plan } = planner();
    const result = await plan.plan(action() as never);

    expect(result).toMatchObject({ toolKey: "meta.publish_image" });
  });

  it("uses the copy written for this channel and placement", async () => {
    const { plan, requests } = planner();
    await plan.plan(action() as never);
    const manifest = validManifest();
    const control = manifest.directions[0];

    expect(requests.get(action().actionRunId)?.caption).toContain(control.copy[0].hook);
  });

  it("carries the asset's real mime type, so the adapter can refuse a non-JPEG", async () => {
    const { plan, requests } = planner();
    await plan.plan(action() as never);

    expect(requests.get(action().actionRunId)?.mimeType).toBe(validManifest().assets[0].mimeType);
  });

  it("refuses an action the approved version does not contain", async () => {
    const { plan } = planner();

    expect(
      await plan.plan(action({ actionKey: "b0000000-0000-4000-8000-0000000000ff" }) as never),
    ).toBeNull();
  });

  it("refuses when the provider account is not mapped", async () => {
    const { plan } = planner({ tables: { integration_account_mappings: [] } });

    expect(await plan.plan(action() as never)).toBeNull();
  });

  it("refuses when the asset has no stored bytes", async () => {
    const { plan } = planner({ tables: { campaign_assets: [] } });

    expect(await plan.plan(action() as never)).toBeNull();
  });
});

describe("idempotency survives replanning", () => {
  it("keys on the action run, so a retried dispatch replays instead of republishing", async () => {
    const { plan } = planner();
    const result = await plan.plan(action() as never);

    expect(result).toMatchObject({ idempotencyKey: `action:${action().actionRunId}` });
  });

  it("gives the same digest twice even though the signed URL differs", async () => {
    // The URL changes on every plan. Including it would make two attempts at
    // one publication look like two different requests and defeat the
    // idempotency it feeds.
    const first = planner();
    let counter = 0;
    first.signed.mockImplementation(async () => ({
      data: { signedUrl: `https://storage.test/signed?token=${(counter += 1)}` },
      error: null,
    }));

    const a = await first.plan.plan(action() as never);
    const b = await first.plan.plan(action() as never);

    expect(a?.requestDigest).toBe(b?.requestDigest);
  });
});
