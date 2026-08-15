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

const claim = vi.fn();
const complete = vi.fn();
const fail = vi.fn();
const readSnapshot = vi.fn();
const plan = vi.fn();
const materializeAssets = vi.fn();
const publish = vi.fn();

const LIMITS = {
  instagram: { maxHashtags: 30, maxCopyCharacters: 2_200 },
  facebook: { maxHashtags: 30, maxCopyCharacters: 2_200 },
};

/** A snapshot whose registered metric and baseline match the fixture manifest. */
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
      currency: "AED",
      timeZone: "Asia/Dubai",
      primaryMetricKey: manifest.measurementPlan.primaryMetricKey,
      baselineSource: manifest.measurementPlan.baselineSource,
      facts: [{ key: "gap", value: "Lunch runs at 41%.", sourceRef: "economics:2026-07" }],
    },
    generationProfile: "brand_guided" as const,
    brandAssetVersionIds: ["a0000000-0000-4000-8000-000000000009"],
    syntheticAssetsAllowed: false,
  };
}

function uploadsFor(manifest: ReturnType<typeof validManifest>) {
  return manifest.assets.map((asset, index) => ({
    assetId: asset.id,
    storagePath: `${ORGANIZATION_ID}/${CAMPAIGN_ID}/v/${asset.id}.png`,
    contentHash: String(index + 1).repeat(64),
  }));
}

function generateDeps(
  overrides: Partial<GenerateBundleDependencies> = {},
): GenerateBundleDependencies {
  return {
    runs: { claim, complete, fail },
    snapshots: { read: readSnapshot },
    planner: { plan, materializeAssets },
    publisher: { publish },
    limitsByChannel: LIMITS,
    isCancelled: () => false,
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
  for (const spy of [claim, complete, fail, readSnapshot, plan, materializeAssets, publish]) {
    spy.mockReset();
  }
  const manifest = validManifest();
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
  plan.mockResolvedValue({ candidate: manifest, costMinor: 1_000 });
  materializeAssets.mockResolvedValue({ uploads: uploadsFor(manifest), costMinor: 2_000 });
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
      return { candidate: validManifest(), costMinor: 1_000 };
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
      .mockResolvedValueOnce({ candidate: validManifest(), costMinor: 1_000 });

    await generateCampaignBundle(PAYLOAD, generateDeps(), new AbortController().signal);

    expect(plan.mock.calls[1]?.[0]).toEqual(
      expect.objectContaining({ repairFailures: expect.any(Array) }),
    );
  });

  it("stops at the cost ceiling instead of spending past it", async () => {
    plan.mockResolvedValue({ candidate: validManifest(), costMinor: 900_000 });

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

  it("publishes the hash of the bytes that were actually stored", async () => {
    await generateCampaignBundle(PAYLOAD, generateDeps(), new AbortController().signal);

    const published = publish.mock.calls[0]?.[0] as {
      manifest: ReturnType<typeof validManifest>;
      digest: string;
    };
    expect(published.manifest.assets[0]?.contentHash).toBe("1".repeat(64));
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
