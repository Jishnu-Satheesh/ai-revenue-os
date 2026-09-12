import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { validManifest } from "@/domain/campaigns/test-manifest";
import { bundleDigest } from "@/domain/campaigns/digest";
import {
  buildGenerationContext,
  renderGenerationPrompt,
} from "@/modules/campaigns/application/generation-context";
import { generateCampaignBundle } from "@/workflows/campaigns/generate-bundle";
import { reviseCampaignBundle } from "@/workflows/campaigns/revise-bundle";

const ORGANIZATION_ID = "fb430000-0000-4000-8000-000000000201";
const CAMPAIGN_ID = "fb430000-0000-4000-8000-000000000301";
const SNAPSHOT_ID = "fb430000-0000-4000-8000-000000000302";
const RUN_ID = "fb430000-0000-4000-8000-000000000303";
const VERSION_ID = "fb430000-0000-4000-8000-000000000304";
const CORRELATION_ID = "fb430000-0000-4000-8000-000000000305";
const MANIFEST_ID = "fb430000-0000-4000-8000-000000000306";
const DIGEST = "c".repeat(64);

function snapshot() {
  return {
    organizationProfile: "Neighbourhood kitchen.",
    brandVoice: "Warm and direct.",
    hardConstraints: ["Never imply a health claim."],
    objective: "Fill weekday lunch.",
    audience: "Nearby workers",
    currency: "AED",
    primaryMetricKey: "contribution.incremental_gross_profit",
    baselineSource: "channel_economics_entries weekday lunch",
  };
}

describe("generation memory context pinning", () => {
  it("carries the pinned manifest digest into the context", () => {
    const readiness = buildGenerationContext({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      generationProfile: "brand_guided",
      snapshot: snapshot(),
      brandAssetVersionIds: [],
      syntheticAssetsAllowed: false,
      now: new Date("2026-09-01T00:00:00.000Z"),
      memoryContext: { manifestId: MANIFEST_ID, digest: DIGEST },
    });

    if (readiness.outcome !== "ready") throw new Error("expected ready");
    expect(readiness.context.memoryContextDigest).toBe(DIGEST);
    expect(readiness.context.memoryContextManifestId).toBe(MANIFEST_ID);
  });

  it("renders the digest as text-only planning context, never as instructions", () => {
    const readiness = buildGenerationContext({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      generationProfile: "brand_guided",
      snapshot: snapshot(),
      brandAssetVersionIds: [],
      syntheticAssetsAllowed: false,
      now: new Date("2026-09-01T00:00:00.000Z"),
      memoryContext: { manifestId: MANIFEST_ID, digest: DIGEST },
    });
    if (readiness.outcome !== "ready") throw new Error("expected ready");

    const prompt = renderGenerationPrompt(readiness.context);
    expect(prompt).toContain("<memory_context>");
    expect(prompt).toContain(DIGEST);
    expect(prompt).toContain("never assertions");
  });

  it("runs without memory context when none was pinned", () => {
    const readiness = buildGenerationContext({
      organizationId: ORGANIZATION_ID,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      generationProfile: "brand_guided",
      snapshot: snapshot(),
      brandAssetVersionIds: [],
      syntheticAssetsAllowed: false,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    if (readiness.outcome !== "ready") throw new Error("expected ready");

    expect(readiness.context.memoryContextDigest).toBeNull();
    expect(renderGenerationPrompt(readiness.context)).toContain("No shared memory context");
  });
});

describe("generate carries the digest without leaking bytes", () => {
  it("passes the digest into image guidance while keeping rejected bytes out", async () => {
    const manifest = {
      ...validManifest(),
      assets: validManifest().assets.map(({ truthClass: _t, ...asset }) => asset),
    };
    const claim = vi.fn().mockResolvedValue({
      outcome: "claimed",
      claimToken: "token-1",
      attempt: 1,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      kind: "generate",
      correlationId: CORRELATION_ID,
    });
    const read = vi.fn().mockResolvedValue({
      snapshot: {
        ...snapshot(),
        objective: manifest.objective,
        primaryMetricKey: manifest.measurementPlan.primaryMetricKey,
        baselineSource: manifest.measurementPlan.baselineSource,
        offer: manifest.generationPolicy.lockedOfferRef,
        facts: manifest.generationPolicy.lockedAssertionKeys.map((key: string) => ({
          key,
          value: "Lunch runs at 41%.",
          sourceRef: "economics:2026-07",
        })),
      },
      generationProfile: "brand_guided" as const,
      brandAssetVersionIds: [],
      resolutionRequest: {
        subjectTags: ["curry"],
        subjectDescription: "Curry in a pot.",
        settingTags: [],
        occasionTags: [],
        styleTags: [],
        scripts: [],
      },
      declaredReferenceSlots: [],
      subjectDescription: "Curry in a pot.",
      creativeDirection: null,
      syntheticAssetsAllowed: false,
      memoryContext: { manifestId: MANIFEST_ID, digest: DIGEST },
    });
    const materializeAssets = vi.fn().mockResolvedValue({
      uploads: manifest.assets.map((asset: { id: string }, index: number) => ({
        assetId: asset.id,
        storagePath: `${ORGANIZATION_ID}/${CAMPAIGN_ID}/v/${asset.id}.png`,
        contentHash: String(index + 1).repeat(64),
        widthPx: 1024,
        heightPx: 1024,
        mimeType: "image/jpeg" as const,
        modelId: "test-image-model",
        promptVersionId: "campaign-image-prompt-v1",
      })),
      costMinor: 10,
    });

    await generateCampaignBundle(
      {
        organizationId: ORGANIZATION_ID,
        campaignId: CAMPAIGN_ID,
        runId: RUN_ID,
        correlationId: CORRELATION_ID,
        costCeilingMinor: 500_000,
      },
      {
        runs: {
          claim,
          complete: vi.fn(),
          fail: vi.fn(),
        },
        snapshots: { read },
        candidates: {
          read: vi.fn().mockResolvedValue({
            candidates: [],
            reasonRegistry: [],
          }),
        },
        referenceObjects: { read: vi.fn() },
        referenceContext: {
          pinResolution: vi.fn(),
          pinBlueprint: vi.fn(),
        },
        blueprintPlanner: {
          plan: vi.fn().mockResolvedValue({
            blueprint: {
              composition: "Pot centred.",
              framing: "Tight crop.",
              lighting: "Daylight.",
              cameraTreatment: "Natural.",
              palette: ["red"],
              focalPoint: "Curry.",
              surfaceNotes: [],
              propNotes: [],
              avoid: [],
            },
            planModelId: "plan-model",
            repairModelId: null,
            costMinor: 1,
          }),
        },
        planner: {
          plan: vi.fn().mockResolvedValue({ candidate: manifest, costMinor: 5 }),
          materializeAssets,
        },
        publisher: {
          publish: vi.fn().mockResolvedValue({
            bundleVersionId: VERSION_ID,
            version: 1,
            parentVersionId: null,
            revokedApprovalCount: 0,
          }),
        },
        limitsByChannel: {
          instagram: { maxHashtags: 30, maxCopyCharacters: 2200 },
          facebook: { maxHashtags: 30, maxCopyCharacters: 2200 },
        },
        isCancelled: () => false,
        clock: () => new Date("2026-09-01T00:00:00.000Z"),
      },
      new AbortController().signal,
    );

    expect(materializeAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        imageGuidance: expect.objectContaining({ memoryContextDigest: DIGEST }),
      }),
    );
  });
});

describe("revision is a new immutable version; revalidation is a new bounded attempt", () => {
  const base = validManifest();
  const baseDigest = bundleDigest(base);

  function deps(overrides: Record<string, unknown> = {}) {
    const claim = vi.fn().mockResolvedValue({
      outcome: "claimed",
      claimToken: "token-1",
      attempt: 1,
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      kind: "revise",
      correlationId: CORRELATION_ID,
    });
    return {
      runs: { claim, complete: vi.fn(), fail: vi.fn() },
      source: {
        read: vi.fn().mockResolvedValue({
          campaignId: CAMPAIGN_ID,
          sourceSnapshotId: SNAPSHOT_ID,
          digest: baseDigest,
          manifest: base,
          latestVersionId: VERSION_ID,
          assetStoragePaths: {},
        }),
      },
      prompts: {
        read: vi.fn().mockResolvedValue({ prompt: "Shorten the hook.", scope: "copy" as const }),
      },
      planner: {
        proposePatch: vi.fn().mockResolvedValue({
          proposal: {
            operations: [
              {
                path: "directions[0].copy[0].hook",
                operation: "replace",
                value: "A quieter lunch",
              },
            ],
            summary: "Shortened.",
          },
          costMinor: 5,
        }),
      },
      publisher: {
        publish: vi.fn().mockResolvedValue({
          bundleVersionId: VERSION_ID,
          version: 2,
          parentVersionId: null,
          revokedApprovalCount: 1,
        }),
      },
      isCancelled: () => false,
      ...overrides,
    };
  }

  const payload = {
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    runId: RUN_ID,
    correlationId: CORRELATION_ID,
    costCeilingMinor: 500_000,
    baseVersionId: VERSION_ID,
    baseDigest,
  };

  it("publishes a new version rather than editing in place", async () => {
    const dependencies = deps();
    const result = await reviseCampaignBundle(payload, dependencies, new AbortController().signal);

    expect(result.status).toBe("published");
    expect(dependencies.publisher.publish).toHaveBeenCalled();
  });

  it("fails bounded when the pinned context changed instead of swapping silently", async () => {
    const dependencies = deps({
      revalidateMemoryContext: vi.fn().mockResolvedValue("changed"),
    });
    const result = await reviseCampaignBundle(payload, dependencies, new AbortController().signal);

    expect(result).toMatchObject({ status: "failed", failureCode: "memory_context_changed" });
    expect(dependencies.publisher.publish).not.toHaveBeenCalled();
  });

  it("passes the pinned manifest binding to revalidation", async () => {
    const revalidateMemoryContext = vi.fn().mockResolvedValue("valid");
    const dependencies = deps({ revalidateMemoryContext });
    dependencies.source.read = vi.fn().mockResolvedValue({
      campaignId: CAMPAIGN_ID,
      sourceSnapshotId: SNAPSHOT_ID,
      digest: baseDigest,
      manifest: base,
      latestVersionId: VERSION_ID,
      assetStoragePaths: {},
      memoryContext: { manifestId: MANIFEST_ID, digest: DIGEST },
    });
    const result = await reviseCampaignBundle(payload, dependencies, new AbortController().signal);

    expect(result.status).toBe("published");
    expect(revalidateMemoryContext).toHaveBeenCalledWith({
      manifestId: MANIFEST_ID,
      digest: DIGEST,
    });
  });
});
