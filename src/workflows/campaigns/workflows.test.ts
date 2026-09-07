import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { bundleDigest } from "@/domain/campaigns/digest";
import { validManifest } from "@/domain/campaigns/test-manifest";
import {
  campaignGenerationRequestDigest,
  parseCampaignGenerationPayload,
  parseCampaignRevisionPayload,
} from "@/workflows/campaigns/contracts";
import {
  generateCampaignBundle,
  type GenerateBundleDependencies,
} from "@/workflows/campaigns/generate-bundle";
import {
  reviseCampaignBundle,
  type ReviseBundleDependencies,
} from "@/workflows/campaigns/revise-bundle";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CAMPAIGN_ID = "c0000000-0000-4000-8000-000000000001";
const RUN_ID = "e0000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "e0000000-0000-4000-8000-000000000002";
const VERSION_ID = "f0000000-0000-4000-8000-000000000001";
const CORRELATION_ID = "d0000000-0000-4000-8000-000000000001";
const SUBJECT_ASSET_ID = "a0000000-0000-4000-8000-000000000008";
const SUBJECT_VERSION_ID = "a0000000-0000-4000-8000-000000000009";

const claim = vi.fn();
const complete = vi.fn();
const fail = vi.fn();
const readSnapshot = vi.fn();
const readCandidates = vi.fn();
const readReference = vi.fn();
const pinResolution = vi.fn();
const pinBlueprint = vi.fn();
const planBlueprint = vi.fn();
const plan = vi.fn();
const materializeAssets = vi.fn();
const publish = vi.fn();

const LIMITS = {
  instagram: { maxHashtags: 30, maxCopyCharacters: 2_200 },
  facebook: { maxHashtags: 30, maxCopyCharacters: 2_200 },
};

/**
 * A snapshot pinning exactly what the fixture manifest claims: its registered
 * metric, its baseline, the offer its policy locks, and every assertion key
 * that policy names. A snapshot that carried less would fail generation for
 * missing evidence rather than for whatever the test is actually about.
 */
function pinnedSnapshot() {
  const manifest = validManifest();
  return {
    snapshot: {
      organizationProfile: "Al Noor Kitchen.",
      brandVoice: "Warm and direct.",
      hardConstraints: ["Never imply a health claim."],
      softConventions: ["Food is always the hero image."],
      restrictedTerms: [],
      objective: manifest.objective,
      audience: "Nearby office workers",
      offer: manifest.generationPolicy.lockedOfferRef,
      currency: "AED",
      timeZone: "Asia/Dubai",
      primaryMetricKey: manifest.measurementPlan.primaryMetricKey,
      baselineSource: manifest.measurementPlan.baselineSource,
      facts: manifest.generationPolicy.lockedAssertionKeys.map((key) => ({
        key,
        value: "Lunch runs at 41% of capacity.",
        sourceRef: "economics:2026-07",
      })),
    },
    generationProfile: "brand_guided" as const,
    brandAssetVersionIds: [SUBJECT_VERSION_ID],
    resolutionRequest: {
      subjectTags: ["kingfish curry"],
      subjectDescription: "Kingfish curry in a clay pot.",
      settingTags: [],
      occasionTags: [],
      styleTags: [],
      scripts: [],
    },
    declaredReferenceSlots: [],
    subjectDescription: "Kingfish curry in a clay pot.",
    creativeDirection: "Warm daylight and a tight crop.",
    syntheticAssetsAllowed: false,
  };
}

function referenceCandidates() {
  return {
    candidates: [
      {
        brandAssetId: SUBJECT_ASSET_ID,
        brandAssetVersionId: SUBJECT_VERSION_ID,
        conditioningRoles: ["subject" as const],
        tags: ["kingfish curry"],
        scripts: [],
        ownership: "owned" as const,
        version: 1,
        currentVerdict: "approved" as const,
        currentReasonCodes: [],
        currentReviewedAt: "2026-08-24T10:00:00.000Z",
        archivedAt: null,
        requestedReferenceMode: "inspiration" as const,
        storagePath: `${ORGANIZATION_ID}/${SUBJECT_ASSET_ID}/${SUBJECT_VERSION_ID}/source`,
        mimeType: "image/png" as const,
      },
    ],
    reasonRegistry: [],
  };
}

const BLUEPRINT = {
  composition: "Centered clay pot with restrained negative space.",
  framing: "Tight overhead crop.",
  lighting: "Soft daylight from camera left.",
  cameraTreatment: "Natural 50mm treatment.",
  palette: ["brick red", "deep green"],
  focalPoint: "The curry at the centre.",
  surfaceNotes: ["matte stone"],
  propNotes: [],
  avoid: ["busy tableware"],
};

function modelManifest() {
  const manifest = validManifest();
  return {
    ...manifest,
    assets: manifest.assets.map(({ truthClass: _truthClass, ...asset }) => asset),
  };
}

function uploadsFor(manifest: ReturnType<typeof validManifest>) {
  return manifest.assets.map((asset, index) => ({
    assetId: asset.id,
    storagePath: `${ORGANIZATION_ID}/${CAMPAIGN_ID}/v/${asset.id}.png`,
    contentHash: String(index + 1).repeat(64),
    // Deliberately unlike the manifest's 1080x1080 png. An image model returns
    // whatever it returns, and this is what intake measured.
    widthPx: 1024,
    heightPx: 1024,
    mimeType: "image/jpeg" as const,
    modelId: "gemini-image-actual",
    promptVersionId: "campaign-image-prompt-v1",
  }));
}

function generateDeps(
  overrides: Partial<GenerateBundleDependencies> = {},
): GenerateBundleDependencies {
  return {
    runs: { claim, complete, fail },
    snapshots: { read: readSnapshot },
    candidates: { read: readCandidates },
    referenceObjects: { read: readReference },
    referenceContext: { pinResolution, pinBlueprint },
    blueprintPlanner: { plan: planBlueprint },
    planner: { plan, materializeAssets },
    publisher: { publish },
    limitsByChannel: LIMITS,
    isCancelled: () => false,
    clock: () => new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

const PAYLOAD = {
  organizationId: ORGANIZATION_ID,
  campaignId: CAMPAIGN_ID,
  runId: RUN_ID,
  correlationId: CORRELATION_ID,
  costCeilingMinor: 500_000,
};

beforeEach(() => {
  for (const spy of [
    claim,
    complete,
    fail,
    readSnapshot,
    readCandidates,
    readReference,
    pinResolution,
    pinBlueprint,
    planBlueprint,
    plan,
    materializeAssets,
    publish,
  ]) {
    spy.mockReset();
  }
  const manifest = modelManifest();
  claim.mockResolvedValue({
    outcome: "claimed",
    claimToken: "token-1",
    attempt: 1,
    campaignId: CAMPAIGN_ID,
    sourceSnapshotId: SNAPSHOT_ID,
    kind: "generate",
    correlationId: CORRELATION_ID,
  });
  readSnapshot.mockResolvedValue(pinnedSnapshot());
  readCandidates.mockResolvedValue(referenceCandidates());
  readReference.mockResolvedValue(new Uint8Array([1, 2, 3]));
  pinResolution.mockResolvedValue(undefined);
  pinBlueprint.mockResolvedValue(undefined);
  planBlueprint.mockResolvedValue({
    blueprint: BLUEPRINT,
    planModelId: "gemini-plan",
    repairModelId: null,
    costMinor: 25,
  });
  plan.mockResolvedValue({ candidate: manifest, costMinor: 1_000 });
  materializeAssets.mockResolvedValue({
    uploads: uploadsFor(validManifest()),
    costMinor: 2_000,
  });
  publish.mockResolvedValue({
    bundleVersionId: VERSION_ID,
    version: 1,
    parentVersionId: null,
    revokedApprovalCount: 0,
  });
});

describe("task payload contracts", () => {
  it("rejects a malformed payload before any client could be built", () => {
    expect(() => parseCampaignGenerationPayload({ organizationId: "not-a-uuid" })).toThrow();
    expect(() => parseCampaignGenerationPayload({ ...PAYLOAD, runId: "nope" })).toThrow();
  });

  it("rejects an unknown field rather than carrying it into the worker", () => {
    expect(() => parseCampaignGenerationPayload({ ...PAYLOAD, prompt: "smuggled" })).toThrow();
  });

  it("requires a positive cost ceiling, so no run is unbounded", () => {
    expect(() => parseCampaignGenerationPayload({ ...PAYLOAD, costCeilingMinor: 0 })).toThrow();
  });

  it("requires a revision to name the version it was written against", () => {
    expect(() => parseCampaignRevisionPayload(PAYLOAD)).toThrow();
    expect(
      parseCampaignRevisionPayload({
        ...PAYLOAD,
        baseVersionId: VERSION_ID,
        baseDigest: "a".repeat(64),
      }).baseVersionId,
    ).toBe(VERSION_ID);
  });

  it("gives the same request the same digest and a different one otherwise", () => {
    const base = {
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      kind: "generate" as const,
    };

    expect(campaignGenerationRequestDigest(base)).toBe(campaignGenerationRequestDigest(base));
    expect(
      campaignGenerationRequestDigest({ ...base, kind: "revise", baseVersionId: VERSION_ID }),
    ).not.toBe(campaignGenerationRequestDigest(base));
  });
});

describe("generateCampaignBundle", () => {
  it("publishes a version and completes the run", async () => {
    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "published", bundleVersionId: VERSION_ID });
    expect(complete).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: RUN_ID,
        claimToken: "token-1",
        resultVersionId: VERSION_ID,
      }),
    );
  });

  it("pins resolution before any model spend and pins every parsed blueprint before images", async () => {
    const order: string[] = [];
    pinResolution.mockImplementation(async () => void order.push("resolution"));
    plan.mockImplementation(async () => {
      order.push("bundle-plan");
      return { candidate: modelManifest(), costMinor: 1_000 };
    });
    planBlueprint.mockImplementation(async () => {
      order.push("blueprint-plan");
      return {
        blueprint: BLUEPRINT,
        planModelId: "gemini-plan",
        repairModelId: null,
        costMinor: 25,
      };
    });
    pinBlueprint.mockImplementation(async () => void order.push("blueprint-pin"));
    materializeAssets.mockImplementation(async () => {
      order.push("images");
      return { uploads: uploadsFor(validManifest()), costMinor: 2_000 };
    });

    await generateCampaignBundle(PAYLOAD, generateDeps(), new AbortController().signal);

    expect(order.indexOf("resolution")).toBeLessThan(order.indexOf("bundle-plan"));
    expect(order.indexOf("blueprint-pin")).toBeGreaterThan(order.lastIndexOf("blueprint-plan"));
    expect(order.indexOf("blueprint-pin")).toBeLessThan(order.indexOf("images"));
  });

  it("refuses no_declared_subject before pinning or model spend", async () => {
    readSnapshot.mockResolvedValue({
      ...pinnedSnapshot(),
      resolutionRequest: {
        subjectTags: [],
        subjectDescription: null,
        settingTags: [],
        occasionTags: [],
        styleTags: [],
        scripts: [],
      },
      subjectDescription: null,
    });
    readCandidates.mockResolvedValue({ candidates: [], reasonRegistry: [] });

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toEqual({ status: "needs_data", missing: ["no_declared_subject"] });
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: "no_declared_subject", costMinor: null }),
    );
    expect(pinResolution).not.toHaveBeenCalled();
    expect(plan).not.toHaveBeenCalled();
    expect(planBlueprint).not.toHaveBeenCalled();
  });

  it("fails rather than silently dropping a pinned reference whose bytes are unavailable", async () => {
    readReference.mockResolvedValue(null);

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "reference_bytes_unavailable" });
    expect(pinResolution).toHaveBeenCalledTimes(1);
    expect(plan).not.toHaveBeenCalled();
  });

  it("passes the exact reference bytes and per-asset blueprints into image generation", async () => {
    await generateCampaignBundle(PAYLOAD, generateDeps(), new AbortController().signal);

    expect(materializeAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        imageGuidance: expect.objectContaining({
          subjectDescription: "Kingfish curry in a clay pot.",
          references: [
            expect.objectContaining({
              role: "subject",
              ordinal: 0,
              mimeType: "image/png",
            }),
          ],
          blueprintsByAssetId: expect.any(Object),
        }),
      }),
    );
  });

  it("stands down when another worker holds the claim", async () => {
    claim.mockResolvedValue({ outcome: "already_claimed" });

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toEqual({ status: "skipped", reason: "already_claimed" });
    expect(plan).not.toHaveBeenCalled();
  });

  it("replays a finished run instead of generating again", async () => {
    claim.mockResolvedValue({
      outcome: "already_finished",
      status: "succeeded",
      resultVersionId: VERSION_ID,
      failureCode: null,
    });

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "replayed", resultVersionId: VERSION_ID });
    expect(plan).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("stops before spending anything when already cancelled", async () => {
    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps({ isCancelled: () => true }),
      new AbortController().signal,
    );

    expect(result).toEqual({ status: "cancelled" });
    expect(plan).not.toHaveBeenCalled();
  });

  it("stops between planning and image generation when cancelled mid-run", async () => {
    let cancelled = false;
    plan.mockImplementation(async () => {
      cancelled = true;
      return { candidate: modelManifest(), costMinor: 1_000 };
    });

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps({ isCancelled: () => cancelled }),
      new AbortController().signal,
    );

    expect(result).toEqual({ status: "cancelled" });
    expect(materializeAssets).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });

  it("respects an aborted signal as cancellation", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await generateCampaignBundle(PAYLOAD, generateDeps(), controller.signal);

    expect(result).toEqual({ status: "cancelled" });
  });

  it("reports a readiness gap without publishing anything", async () => {
    readSnapshot.mockResolvedValue({ ...pinnedSnapshot(), snapshot: { objective: "Sell lunch" } });

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result.status).toBe("needs_data");
    expect(publish).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: expect.stringContaining("needs_data:") }),
    );
  });

  it("repairs once and then gives up rather than looping", async () => {
    plan.mockResolvedValue({ candidate: "not a manifest", costMinor: 1_000 });

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "validation_failed" });
    expect(plan).toHaveBeenCalledTimes(2);
  });

  it("passes the named failures into the repair attempt", async () => {
    plan
      .mockResolvedValueOnce({ candidate: "not a manifest", costMinor: 1_000 })
      .mockResolvedValueOnce({ candidate: modelManifest(), costMinor: 1_000 });

    await generateCampaignBundle(PAYLOAD, generateDeps(), new AbortController().signal);

    expect(plan.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ repairFailures: expect.any(Array) }),
    );
  });

  it("stops at the cost ceiling instead of spending past it", async () => {
    plan.mockResolvedValue({ candidate: modelManifest(), costMinor: 900_000 });

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "cost_ceiling_exceeded" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("does not publish when the final image spend crosses the cost ceiling", async () => {
    materializeAssets.mockResolvedValue({
      uploads: uploadsFor(validManifest()),
      costMinor: PAYLOAD.costCeilingMinor,
    });

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "cost_ceiling_exceeded" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("never publishes when only some images were produced", async () => {
    const manifest = validManifest();
    materializeAssets.mockResolvedValue({
      uploads: uploadsFor(manifest).slice(0, 1),
      costMinor: 500,
    });

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "asset_generation_incomplete" });
    expect(publish).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  /**
   * The size and the type are decided by the bytes, exactly as the hash is.
   *
   * A model writes `widthPx` and `heightPx` into the manifest it proposes, and
   * those are a claim. Every generated asset on staging carried one: manifests
   * stating 1080x1080 and 1080x1350 for images that are all 1024x1024 -- the
   * second not merely the wrong scale but the wrong shape, sitting inside the
   * digest an approval binds to.
   */
  it("publishes the size and type of the bytes, not the size the model claimed", async () => {
    await generateCampaignBundle(PAYLOAD, generateDeps(), new AbortController().signal);

    const published = publish.mock.calls[0]?.[0] as {
      manifest: ReturnType<typeof validManifest>;
    };

    expect(validManifest().assets[0]?.widthPx).toBe(1080);
    expect(published.manifest.assets[0]).toMatchObject({
      widthPx: 1024,
      heightPx: 1024,
      mimeType: "image/jpeg",
    });
  });

  it("publishes the hash of the bytes that were actually stored", async () => {
    await generateCampaignBundle(PAYLOAD, generateDeps(), new AbortController().signal);

    const published = publish.mock.calls[0]?.[0] as {
      manifest: ReturnType<typeof validManifest>;
      digest: string;
    };
    expect(published.manifest.assets[0]?.contentHash).toBe("1".repeat(64));
    expect(published.manifest.assets[0]?.truthClass).toBe("synthetic_composite");
    expect(published.manifest.assets[0]?.provenance).toMatchObject({
      kind: "generated",
      modelId: "gemini-image-actual",
      promptVersionId: "campaign-image-prompt-v1",
      generationProfile: "brand_guided",
    });
    expect(
      published.manifest.assets[0]?.provenance.kind === "generated"
        ? published.manifest.assets[0].provenance.derivedFromBrandAssetVersionIds
        : [],
    ).toEqual([SUBJECT_VERSION_ID]);
    expect(published.digest).toBe(bundleDigest(published.manifest));
  });

  it("marks the run failed when the worker throws, rather than leaving it claimed", async () => {
    publish.mockRejectedValue(new Error("storage exploded"));

    await expect(
      generateCampaignBundle(PAYLOAD, generateDeps(), new AbortController().signal),
    ).rejects.toThrow("storage exploded");
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ failureCode: "worker_error" }));
  });

  it("fails safely when the pinned evidence is gone", async () => {
    readSnapshot.mockResolvedValue(null);

    const result = await generateCampaignBundle(
      PAYLOAD,
      generateDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "source_snapshot_missing" });
  });

  it("reads the snapshot named by the claim, not by the payload", async () => {
    await generateCampaignBundle(PAYLOAD, generateDeps(), new AbortController().signal);

    expect(readSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ sourceSnapshotId: SNAPSHOT_ID, campaignId: CAMPAIGN_ID }),
    );
  });
});

describe("reviseCampaignBundle", () => {
  const readSource = vi.fn();
  const readPrompt = vi.fn();
  const proposePatch = vi.fn();

  const base = validManifest();
  const baseDigest = bundleDigest(base);

  function reviseDeps(overrides: Partial<ReviseBundleDependencies> = {}): ReviseBundleDependencies {
    return {
      runs: { claim, complete, fail },
      source: { read: readSource },
      prompts: { read: readPrompt },
      planner: { proposePatch },
      publisher: { publish },
      isCancelled: () => false,
      ...overrides,
    };
  }

  const revisePayload = {
    ...PAYLOAD,
    baseVersionId: VERSION_ID,
    baseDigest,
  };

  beforeEach(() => {
    readSource.mockReset();
    readPrompt.mockReset();
    proposePatch.mockReset();
    claim.mockResolvedValue({
      outcome: "claimed",
      claimToken: "token-1",
      attempt: 1,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      kind: "revise",
      correlationId: CORRELATION_ID,
    });
    readSource.mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      digest: baseDigest,
      manifest: validManifest(),
      latestVersionId: VERSION_ID,
      assetStoragePaths: Object.fromEntries(
        base.assets.map((asset) => [asset.id, `${ORGANIZATION_ID}/c/v/${asset.id}.png`]),
      ),
    });
    readPrompt.mockResolvedValue({ prompt: "Shorten the hook.", scope: "copy" });
    proposePatch.mockResolvedValue({
      proposal: {
        operations: [
          { path: "directions[0].copy[0].hook", operation: "replace", value: "A quieter lunch" },
        ],
        summary: "Shortened the hook.",
      },
      costMinor: 500,
    });
  });

  it("publishes the revised version", async () => {
    const result = await reviseCampaignBundle(
      revisePayload,
      reviseDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "published", bundleVersionId: VERSION_ID });
  });

  it("refuses when the campaign moved on while the operator was typing", async () => {
    readSource.mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      digest: baseDigest,
      manifest: validManifest(),
      latestVersionId: "f0000000-0000-4000-8000-000000000002",
      assetStoragePaths: {},
    });

    const result = await reviseCampaignBundle(
      revisePayload,
      reviseDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "stale" });
    expect(proposePatch).not.toHaveBeenCalled();
  });

  it("refuses when the version was edited underneath the operator", async () => {
    readSource.mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      digest: "b".repeat(64),
      manifest: validManifest(),
      latestVersionId: VERSION_ID,
      assetStoragePaths: {},
    });

    const result = await reviseCampaignBundle(
      revisePayload,
      reviseDeps(),
      new AbortController().signal,
    );

    expect(result.status).toBe("stale");
  });

  it("refuses a patch that reaches outside the operator's scope", async () => {
    proposePatch.mockResolvedValue({
      proposal: {
        operations: [{ path: "totalSpendCeiling", operation: "replace", value: null }],
        summary: "Made it cheaper.",
      },
      costMinor: 500,
    });

    const result = await reviseCampaignBundle(
      revisePayload,
      reviseDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "rejected", reason: "path_never_patchable" });
    expect(publish).not.toHaveBeenCalled();
  });

  it("reuses the base version's stored assets rather than re-uploading", async () => {
    await reviseCampaignBundle(revisePayload, reviseDeps(), new AbortController().signal);

    const published = publish.mock.calls[0]?.[0] as { assetStoragePaths: Record<string, string> };
    expect(Object.keys(published.assetStoragePaths)).toHaveLength(base.assets.length);
  });

  it("reads the operator's words from storage, never from the payload", async () => {
    await reviseCampaignBundle(revisePayload, reviseDeps(), new AbortController().signal);

    expect(readPrompt).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      runId: RUN_ID,
      // The token proves the worker still holds the run, so a lapsed claim
      // cannot read the operator's instruction.
      claimToken: "token-1",
    });
    expect(JSON.stringify(revisePayload)).not.toContain("Shorten the hook");
  });

  it("stops at the cost ceiling", async () => {
    proposePatch.mockResolvedValue({ proposal: {}, costMinor: 900_000 });

    const result = await reviseCampaignBundle(
      revisePayload,
      reviseDeps(),
      new AbortController().signal,
    );

    expect(result).toMatchObject({ status: "failed", failureCode: "cost_ceiling_exceeded" });
  });

  it("stops before publishing when cancelled after the patch is built", async () => {
    let cancelled = false;
    proposePatch.mockImplementation(async () => {
      cancelled = true;
      return {
        proposal: {
          operations: [
            { path: "directions[0].copy[0].hook", operation: "replace", value: "Changed" },
          ],
          summary: "s",
        },
        costMinor: 100,
      };
    });

    const result = await reviseCampaignBundle(
      revisePayload,
      reviseDeps({ isCancelled: () => cancelled }),
      new AbortController().signal,
    );

    expect(result).toEqual({ status: "cancelled" });
    expect(publish).not.toHaveBeenCalled();
  });
});
