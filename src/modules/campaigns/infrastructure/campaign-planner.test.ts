import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createModelRouter } from "@/ai/model-router";
import { validManifest } from "@/domain/campaigns/test-manifest";
import {
  createCampaignPlanner,
  createRevisionPlanner,
  createSupabaseCampaignAssetStorage,
} from "@/modules/campaigns/infrastructure/campaign-planner";
import { createGenerationContextLoader } from "@/modules/campaigns/infrastructure/generation-readers";
import type { GenerationContextPersistence } from "@/modules/campaigns/infrastructure/generation-readers";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "e0000000-0000-4000-8000-000000000002";
const RUN_ID = "e0000000-0000-4000-8000-000000000001";
const VERSION_ID = "f0000000-0000-4000-8000-000000000001";
const CLAIM_TOKEN = "d0000000-0000-4000-8000-000000000009";

const ROUTER = createModelRouter({ textModel: "gemini-text", imageModel: "imagen-1" });
const CONTEXT = {
  organizationId: ORGANIZATION_ID,
  campaignId: CAMPAIGN_ID,
  correlationId: "d0000000-0000-4000-8000-000000000001",
};

let png: Buffer;
beforeAll(async () => {
  png = await sharp({
    create: { width: 1024, height: 1024, channels: 3, background: { r: 10, g: 20, b: 30 } },
  })
    .png()
    .toBuffer();
});

const generatePlan = vi.fn();
const generateImage = vi.fn();
const generatePatch = vi.fn();
const upload = vi.fn();

function planner() {
  return createCampaignPlanner(
    {
      provider: { generatePlan, generateImage, generatePatch },
      router: ROUTER,
      storage: { upload },
    },
    CONTEXT,
  );
}

function generationContext() {
  return {
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    sourceSnapshotId: SNAPSHOT_ID,
    generationProfile: "brand_guided" as const,
    objective: "Increase weekday lunch covers",
    audience: "Nearby office workers",
    offer: null,
    currency: "AED",
    timeZone: "Asia/Dubai",
    facts: [],
    hardConstraints: ["Never imply a health claim."],
    softConventions: [],
    restrictedTerms: [],
    brandAssetVersionIds: [],
    syntheticAssetsAllowed: true,
    primaryMetricKey: "contribution.incremental_gross_profit",
    baselineSource: "ledger",
    generatedAt: "2026-08-16T09:00:00.000Z",
    earliestScheduledFor: "2026-08-16T10:00:00.000Z",
  };
}

beforeEach(() => {
  for (const spy of [generatePlan, generateImage, generatePatch, upload]) spy.mockReset();
  generatePlan.mockResolvedValue({
    output: { anything: true },
    modelId: "gemini-text",
    usage: { inputTokens: 10, outputTokens: 5, estimatedCostMinor: 100 },
  });
  generateImage.mockResolvedValue({
    image: {
      bytes: png,
      mimeType: "image/png",
      widthPx: 1024,
      heightPx: 1024,
      modelId: "imagen-1",
    },
    usage: { inputTokens: null, outputTokens: null, estimatedCostMinor: 50 },
  });
  upload.mockResolvedValue({ ok: true });
});

describe("campaign planner", () => {
  it("leaves the model's content for the caller to parse, and fixes only identity", async () => {
    const result = await planner().plan({
      context: generationContext(),
      prompt: "evidence",
      signal: new AbortController().signal,
    });

    // Everything the model said about the campaign survives verbatim. Which
    // campaign it belongs to is not something the model gets to decide: the
    // database checks it against the row being written, so it is set here.
    const candidate = result.candidate as Record<string, unknown>;
    expect(candidate.anything).toBe(true);
    expect(candidate.campaignId).toBe("c0000000-0000-4000-8000-000000000001");
  });

  it("names the failures verbatim on a repair pass", async () => {
    await planner().plan({
      context: generationContext(),
      prompt: "evidence",
      signal: new AbortController().signal,
      repairFailures: [{ code: "invented_offer", detail: "promised a discount" }],
    });

    const call = generatePlan.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toContain("<validation_failures>");
    expect(call.prompt).toContain("invented_offer: promised a discount");
  });

  it("hashes the bytes it stored, not what the model claimed", async () => {
    const manifest = validManifest();
    const declared = manifest.assets[0]!.contentHash;

    const result = await planner().materializeAssets({
      context: generationContext(),
      manifest,
      signal: new AbortController().signal,
    });

    expect(result.uploads[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.uploads[0]?.contentHash).not.toBe(declared);
  });

  it("writes under the tenant's own folder, which is what the storage policy checks", async () => {
    await planner().materializeAssets({
      context: generationContext(),
      manifest: validManifest(),
      signal: new AbortController().signal,
    });

    const call = upload.mock.calls[0]?.[0] as { path: string };
    expect(call.path.split("/")[0]).toBe(ORGANIZATION_ID);
  });

  it("carries the hard constraints into the image prompt", async () => {
    await planner().materializeAssets({
      context: generationContext(),
      manifest: validManifest(),
      signal: new AbortController().signal,
    });

    const call = generateImage.mock.calls[0]?.[0] as { prompt: string };
    expect(call.prompt).toContain("Never imply a health claim.");
    expect(call.prompt).toContain("not documentary photography");
  });

  it("stops at the next image when the run is cancelled", async () => {
    const controller = new AbortController();
    generateImage.mockImplementation(async () => {
      controller.abort();
      return {
        image: { bytes: png, mimeType: "image/png", widthPx: 1024, heightPx: 1024, modelId: "i" },
        usage: { inputTokens: null, outputTokens: null, estimatedCostMinor: 50 },
      };
    });

    const result = await planner().materializeAssets({
      context: generationContext(),
      manifest: validManifest(),
      signal: controller.signal,
    });

    expect(result.uploads.length).toBeLessThan(validManifest().assets.length);
  });

  it("returns short when a generated image fails intake", async () => {
    generateImage.mockResolvedValue({
      image: {
        bytes: Buffer.from("not an image"),
        mimeType: "image/png",
        widthPx: 1024,
        heightPx: 1024,
        modelId: "i",
      },
      usage: { inputTokens: null, outputTokens: null, estimatedCostMinor: 50 },
    });

    const result = await planner().materializeAssets({
      context: generationContext(),
      manifest: validManifest(),
      signal: new AbortController().signal,
    });

    expect(result.uploads).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("returns short when storage refuses the write", async () => {
    upload.mockResolvedValue({ ok: false, reason: "upload_failed" });

    const result = await planner().materializeAssets({
      context: generationContext(),
      manifest: validManifest(),
      signal: new AbortController().signal,
    });

    expect(result.uploads).toEqual([]);
  });
});

describe("revision planner", () => {
  it("passes the operator's words through and returns an unparsed proposal", async () => {
    generatePatch.mockResolvedValue({
      output: { operations: [] },
      modelId: "gemini-text",
      usage: { inputTokens: 1, outputTokens: 1, estimatedCostMinor: 20 },
    });

    const result = await createRevisionPlanner({
      provider: { generatePlan, generateImage, generatePatch },
    }).proposePatch({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      correlationId: CONTEXT.correlationId,
      operatorPrompt: "Shorten the hook.",
      allowedPaths: ["directions[].copy[].hook"],
      currentSummary: "{}",
      signal: new AbortController().signal,
    });

    const proposal: unknown = result.proposal;
    expect(proposal).toEqual({ operations: [] });
    expect(result.costMinor).toBe(20);
  });
});

describe("storage adapter", () => {
  it("upserts, so a retried attempt rewrites its own object", async () => {
    const uploadFn = vi.fn(async () => ({ error: null }));
    const client = { storage: { from: () => ({ upload: uploadFn }) } };

    await createSupabaseCampaignAssetStorage(client).upload({
      path: `${ORGANIZATION_ID}/c/v/a.png`,
      bytes: png,
      contentType: "image/png",
    });

    const options = (uploadFn.mock.calls[0] as unknown as [string, Buffer, { upsert: boolean }])[2];
    expect(options).toMatchObject({ upsert: true });
  });

  it("never surfaces the storage message, which carries the tenant path", async () => {
    const client = {
      storage: {
        from: () => ({
          upload: async () => ({ error: { message: `denied for ${ORGANIZATION_ID}` } }),
        }),
      },
    };

    const result = await createSupabaseCampaignAssetStorage(client).upload({
      path: "p",
      bytes: png,
      contentType: "image/png",
    });

    expect(result).toEqual({ ok: false, reason: "upload_failed" });
  });
});

describe("generation context readers", () => {
  const base = validManifest();

  function loaderFor(data: unknown) {
    const rpc = vi.fn(async () => ({ data, error: null }));
    const loader = createGenerationContextLoader(
      { rpc } as unknown as GenerationContextPersistence,
      { organizationId: ORGANIZATION_ID, runId: RUN_ID },
    );
    return { loader, rpc };
  }

  const CONTEXT_ROW = {
    campaign_id: CAMPAIGN_ID,
    source_snapshot_id: SNAPSHOT_ID,
    kind: "revise",
    facts: { objective: "Sell lunch", syntheticAssetsAllowed: true },
    assertions: [],
    brand_asset_version_ids: [],
    campaign_title: "Weekday lunch",
    latest_version_id: VERSION_ID,
    operator_prompt: "Shorten the hook.",
    patch_scope: "copy",
    base_version: {
      id: VERSION_ID,
      digest: "a".repeat(64),
      manifest: base,
      source_snapshot_id: SNAPSHOT_ID,
      asset_storage_paths: { [base.assets[0]!.id]: "path.png" },
    },
  };

  it("sends the claim token, so a lapsed claim cannot read the run's context", async () => {
    const { loader, rpc } = loaderFor(CONTEXT_ROW);

    await loader.revisionPrompts.read({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      claimToken: CLAIM_TOKEN,
    });

    const [, args] = rpc.mock.calls[0] as unknown as [
      string,
      Record<string, Record<string, unknown>>,
    ];
    expect(args.input_context.claim_token).toBe(CLAIM_TOKEN);
  });

  it("reads once even when several readers need the same answer", async () => {
    const { loader, rpc } = loaderFor(CONTEXT_ROW);

    await loader.revisionPrompts.read({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      claimToken: CLAIM_TOKEN,
    });
    await loader.revisionSource.read({
      organizationId: ORGANIZATION_ID,
      bundleVersionId: VERSION_ID,
      claimToken: CLAIM_TOKEN,
    });

    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a snapshot read for a campaign this run does not hold", async () => {
    const { loader } = loaderFor(CONTEXT_ROW);

    const result = await loader.snapshots.read({
      organizationId: ORGANIZATION_ID,
      campaignId: "c0000000-0000-4000-8000-000000000099",
      sourceSnapshotId: SNAPSHOT_ID,
      claimToken: CLAIM_TOKEN,
    });

    expect(result).toBeNull();
  });

  it("returns the base version with the assets already stored for it", async () => {
    const { loader } = loaderFor(CONTEXT_ROW);

    const result = await loader.revisionSource.read({
      organizationId: ORGANIZATION_ID,
      bundleVersionId: VERSION_ID,
      claimToken: CLAIM_TOKEN,
    });

    expect(result?.latestVersionId).toBe(VERSION_ID);
    expect(Object.keys(result?.assetStoragePaths ?? {})).toHaveLength(1);
  });

  it("refuses a context payload that does not match the contract", async () => {
    const { loader } = loaderFor({ campaign_id: "not-a-uuid" });

    await expect(
      loader.revisionPrompts.read({
        organizationId: ORGANIZATION_ID,
        runId: RUN_ID,
        claimToken: CLAIM_TOKEN,
      }),
    ).rejects.toThrow(/could not be read/);
  });
});
