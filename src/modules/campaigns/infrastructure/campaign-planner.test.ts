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
import {
  createGenerationContextLoader,
  createReferenceCandidateReader,
  createSupabaseReferenceObjectReader,
  type GenerationContextPersistence,
} from "@/modules/campaigns/infrastructure/generation-readers";
import {
  createGenerationReferenceContextWriter,
  type GenerationReferenceContextPersistence,
} from "@/modules/campaigns/infrastructure/creation-repository";

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

function imageGuidance() {
  const blueprint = {
    composition: "Centered pot with negative space.",
    framing: "Tight overhead crop.",
    lighting: "Soft daylight.",
    cameraTreatment: "Natural 50mm treatment.",
    palette: ["brick red", "deep green"],
    focalPoint: "The curry.",
    surfaceNotes: ["matte stone"],
    propNotes: [],
    avoid: ["busy tableware"],
  };
  return {
    subjectDescription:
      "Kingfish in brick-red coconut gravy, served in a clay pot with curry leaves.",
    resolution: {
      resolverVersion: 1 as const,
      outcome: "synthesis_permitted" as const,
      refusalCode: null,
      referenceSlots: [],
      avoidReferences: [
        {
          role: "avoid" as const,
          brandAssetId: "51111111-1111-4111-8111-111111111111",
          brandAssetVersionId: "61111111-1111-4111-8111-111111111111",
          reasonCodes: ["wrong_subject" as const],
        },
      ],
      negativeRules: [
        { code: "wrong_subject" as const, description: "Do not substitute another dish." },
      ],
    },
    references: [
      {
        role: "avoid" as const,
        ordinal: 0,
        mimeType: "image/png" as const,
        bytes: new Uint8Array([4, 5, 6]),
      },
    ],
    blueprintsByAssetId: Object.fromEntries(
      validManifest().assets.map((asset) => [asset.id, blueprint]),
    ),
    hardConstraints: ["Never imply a health claim."],
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

  it("never asks the model to declare an asset truth class", async () => {
    await planner().plan({
      context: generationContext(),
      prompt: "evidence",
      signal: new AbortController().signal,
    });

    const call = generatePlan.mock.calls[0]?.[0] as { outputContract: string };
    expect(call.outputContract).not.toContain("truthClass");
    expect(call.outputContract).toContain("altText");
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
      imageGuidance: imageGuidance(),
    });

    expect(result.uploads[0]?.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.uploads[0]?.contentHash).not.toBe(declared);
  });

  it("writes under the tenant's own folder, which is what the storage policy checks", async () => {
    await planner().materializeAssets({
      context: generationContext(),
      manifest: validManifest(),
      signal: new AbortController().signal,
      imageGuidance: imageGuidance(),
    });

    const call = upload.mock.calls[0]?.[0] as { path: string };
    expect(call.path.split("/")[0]).toBe(ORGANIZATION_ID);
  });

  it("draws from the declared subject and governed references, never accessibility alt text", async () => {
    const manifest = validManifest();
    await planner().materializeAssets({
      context: generationContext(),
      manifest,
      signal: new AbortController().signal,
      imageGuidance: imageGuidance(),
    });

    const call = generateImage.mock.calls[0]?.[0] as {
      prompt: string;
      references: Array<{ role: string; bytes: Uint8Array }>;
    };
    expect(call.prompt).toContain("Never imply a health claim.");
    expect(call.prompt).toContain("Kingfish in brick-red coconut gravy");
    expect(call.prompt).toContain("role=avoid ordinal=0 reasons=wrong_subject");
    expect(call.prompt).toContain("<art_direction_blueprint>");
    expect(call.prompt).toContain("Do not render text of any kind, in any script");
    expect(call.prompt).not.toContain(manifest.assets[0]!.altText);
    expect(call.references).toEqual(imageGuidance().references);
  });

  it("fails closed before image spend when governed image guidance is missing", async () => {
    await expect(
      planner().materializeAssets({
        context: generationContext(),
        manifest: validManifest(),
        signal: new AbortController().signal,
      } as never),
    ).rejects.toThrow("No governed image reference context is available");
    expect(generateImage).not.toHaveBeenCalled();
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
      imageGuidance: imageGuidance(),
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
      imageGuidance: imageGuidance(),
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
      imageGuidance: imageGuidance(),
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
    reference_slots: [],
    negative_rules: [],
    resolver_version: null,
    resolution_outcome: null,
    subject_profile_id: null,
    subject_description: "Kingfish in brick-red coconut gravy.",
    avoid_reference_version_ids: [],
    blueprint: null,
    plan_model_id: null,
    creative_direction: "Warm daylight and a tight crop.",
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

  it("carries the immutable subject and reference request into the worker", async () => {
    const { loader } = loaderFor({
      ...CONTEXT_ROW,
      facts: {
        ...CONTEXT_ROW.facts,
        subjectTags: ["മീൻ കറി"],
        settingTags: ["terrace"],
        occasionTags: ["weekend"],
        styleTags: ["warm"],
        scripts: ["Mlym", "Arab"],
      },
    });

    const result = await loader.snapshots.read({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      claimToken: CLAIM_TOKEN,
    });

    expect(result).toMatchObject({
      subjectDescription: "Kingfish in brick-red coconut gravy.",
      creativeDirection: "Warm daylight and a tight crop.",
      resolutionRequest: {
        subjectTags: ["മീൻ കറി"],
        settingTags: ["terrace"],
        occasionTags: ["weekend"],
        styleTags: ["warm"],
        scripts: ["Mlym", "Arab"],
      },
    });
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

describe("generation reference adapters", () => {
  it("maps current review evidence and storage metadata without dropping rejected candidates", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        candidates: [
          {
            brand_asset_id: "21111111-1111-4111-8111-111111111111",
            brand_asset_version_id: "31111111-1111-4111-8111-111111111111",
            label: "Rejected plating",
            asset_role: "reference",
            conditioning_roles: ["subject"],
            tags: ["മീൻ കറി"],
            scripts: [],
            ownership: "owned",
            version: 2,
            storage_path: `${ORGANIZATION_ID}/asset/version/source`,
            content_hash: "a".repeat(64),
            mime_type: "image/png",
            byte_size: 123,
            width_px: 512,
            height_px: 512,
            current_verdict: "rejected",
            current_reason_codes: ["not_our_plating"],
            current_reviewed_at: "2026-08-24T10:00:00.000Z",
          },
        ],
        rejected_reasons: [
          { code: "not_our_plating", description: "Do not use this plating style." },
        ],
      },
      error: null,
    }));

    const result = await createReferenceCandidateReader({ rpc } as never).read(ORGANIZATION_ID);

    expect(result.candidates[0]).toMatchObject({
      brandAssetVersionId: "31111111-1111-4111-8111-111111111111",
      currentVerdict: "rejected",
      currentReasonCodes: ["not_our_plating"],
      storagePath: `${ORGANIZATION_ID}/asset/version/source`,
      mimeType: "image/png",
    });
    expect(result.reasonRegistry).toEqual([
      { code: "not_our_plating", description: "Do not use this plating style." },
    ]);
    expect(rpc).toHaveBeenCalledWith("read_reference_candidates", {
      target_organization_id: ORGANIZATION_ID,
    });
  });

  it("reads reference bytes only from the private brand-assets bucket", async () => {
    const download = vi.fn(async () => ({
      data: new Blob([new Uint8Array([1, 2, 3])]),
      error: null,
    }));
    const from = vi.fn(() => ({ download }));

    const bytes = await createSupabaseReferenceObjectReader({ storage: { from } }).read(
      "a/b/source",
    );

    expect(from).toHaveBeenCalledWith("brand-assets");
    expect(download).toHaveBeenCalledWith("a/b/source");
    expect([...bytes!]).toEqual([1, 2, 3]);
  });

  it("pins resolution and blueprint through the claim-fenced worker RPC", async () => {
    const rpc = vi.fn(async () => ({ data: { replayed: false }, error: null }));
    const writer = createGenerationReferenceContextWriter({
      rpc,
    } as GenerationReferenceContextPersistence);
    const resolution = imageGuidance().resolution;

    await writer.pinResolution({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      claimToken: CLAIM_TOKEN,
      resolution,
    });
    await writer.pinBlueprint({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      claimToken: CLAIM_TOKEN,
      blueprint: { byAssetId: { asset: { composition: "tight" } } },
      planModelId: "gemini-plan",
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "pin_campaign_generation_run_reference_context",
      expect.objectContaining({
        target_organization_id: ORGANIZATION_ID,
        input_pin: expect.objectContaining({
          organization_id: ORGANIZATION_ID,
          run_id: RUN_ID,
          claim_token: CLAIM_TOKEN,
          phase: "resolution",
          resolver_version: 1,
          resolution_outcome: "synthesis_permitted",
          avoid_reference_version_ids: ["61111111-1111-4111-8111-111111111111"],
        }),
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "pin_campaign_generation_run_reference_context",
      expect.objectContaining({
        input_pin: expect.objectContaining({
          phase: "blueprint",
          plan_model_id: "gemini-plan",
        }),
      }),
    );
  });
});
