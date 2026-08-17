import { describe, expect, it } from "vitest";

import { campaignBundleSchema } from "@/domain/campaigns/schemas";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";

function issuePaths(result: ReturnType<typeof campaignBundleSchema.safeParse>) {
  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
}

describe("campaignBundleSchema", () => {
  it("accepts a complete proposal", () => {
    expect(campaignBundleSchema.safeParse(validManifest()).success).toBe(true);
  });

  it("requires exactly one control direction", () => {
    const manifest = validManifest();
    manifest.directions[1]!.kind = "control";

    const result = campaignBundleSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("directions");
  });

  it("requires an evidence-led direction", () => {
    const manifest = validManifest();
    manifest.directions[1]!.kind = "experimental";
    manifest.directions[1]!.experiment = manifest.directions[2]!.experiment;

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("requires an experimental direction", () => {
    const manifest = validManifest();
    manifest.directions[2]!.kind = "evidence_led";
    manifest.directions[2]!.experiment = null;

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("requires the experimental direction to say what it challenges", () => {
    const manifest = validManifest();
    manifest.directions[2]!.experiment = null;

    const result = campaignBundleSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(issuePaths(result).some((path) => path.includes("experiment"))).toBe(true);
  });

  it("refuses an experiment block on a control direction", () => {
    const manifest = validManifest();
    manifest.directions[0]!.experiment = manifest.directions[2]!.experiment;

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("requires at least one action", () => {
    const manifest = validManifest();
    manifest.actions = [];

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("refuses an action pointing at a direction that does not exist", () => {
    const manifest = validManifest();
    manifest.actions[0]!.directionId = "d0000000-0000-4000-8000-000000000099";

    const result = campaignBundleSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(issuePaths(result).some((path) => path.startsWith("actions.0"))).toBe(true);
  });

  it("refuses a direction referencing an asset the bundle does not carry", () => {
    const manifest = validManifest();
    manifest.directions[0]!.assetIds = ["a0000000-0000-4000-8000-000000000099"];

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("refuses an asset no direction uses, so nothing unreviewed can ship", () => {
    const manifest = validManifest();
    manifest.assets.push({
      ...manifest.assets[0]!,
      id: "a0000000-0000-4000-8000-000000000044",
      contentHash: "4".repeat(64),
    });

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("requires copy for every channel and placement an action targets", () => {
    const manifest = validManifest();
    manifest.actions[0]!.placement = "image_story";

    const result = campaignBundleSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(issuePaths(result).some((path) => path.startsWith("actions.0"))).toBe(true);
  });

  it("requires a hashtag set for every channel an action targets", () => {
    const manifest = validManifest();
    manifest.actions[0]!.channel = "facebook";
    manifest.directions[0]!.copy[0]!.channel = "facebook";

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("refuses a spend ceiling in a different currency from the bundle ceiling", () => {
    const manifest = validManifest();
    manifest.actions[2]!.spendCeiling = { amountMinor: 10_000, currency: "USD" };

    const result = campaignBundleSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(issuePaths(result).some((path) => path.includes("spendCeiling"))).toBe(true);
  });

  it("refuses action ceilings that together exceed the approved bundle ceiling", () => {
    const manifest = validManifest();
    manifest.totalSpendCeiling = { amountMinor: 100_000, currency: "AED" };

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("refuses a paid action when the bundle declares no ceiling at all", () => {
    const manifest = validManifest();
    manifest.totalSpendCeiling = null;

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("accepts an entirely organic bundle with no ceiling", () => {
    const manifest = validManifest();
    manifest.actions = manifest.actions.map((action) => ({ ...action, spendCeiling: null }));
    manifest.totalSpendCeiling = null;

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(true);
  });

  it("refuses an internal content tag disguised as a public hashtag", () => {
    const manifest = validManifest();
    manifest.directions[0]!.internalContentTags = ["#lunch-offer"];

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("requires every asset to carry alt text", () => {
    const manifest = validManifest();
    manifest.assets[0]!.altText = "";

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("requires a generated asset to name the model that produced it", () => {
    const manifest = validManifest();
    manifest.assets[0]!.provenance = {
      kind: "generated",
      modelId: "",
      promptVersionId: "campaign-image-prompt-v1",
      generationProfile: "brand_guided",
      derivedFromBrandAssetVersionIds: [],
    };

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("rejects an unknown field rather than ignoring it", () => {
    const manifest = { ...validManifest(), smuggled: true };

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("keeps every direction's action reachable from its own direction id", () => {
    const manifest = validManifest();
    const directionIds = new Set(manifest.directions.map((direction) => direction.id));

    expect(manifest.actions.every((action) => directionIds.has(action.directionId))).toBe(true);
    expect(manifest.directions.map((direction) => direction.id)).toEqual([
      manifestIds.control,
      manifestIds.evidenceLed,
      manifestIds.experimental,
    ]);
  });
});

describe("generationPolicy", () => {
  it("is required, because an approval with no bound is not an approval", () => {
    const manifest = validManifest() as Record<string, unknown>;
    delete manifest.generationPolicy;

    const result = campaignBundleSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("generationPolicy");
  });

  it("declares itself version 2, because version 1 has no policy to read", () => {
    const manifest = { ...validManifest(), schemaVersion: 1 };

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("refuses a total cap that could starve a direction", () => {
    const manifest = validManifest();
    // Three directions at five each needs fifteen. Twelve means the first two
    // directions to generate can consume the budget and the experimental
    // direction — the one whose data matters most — gets whatever is left.
    manifest.generationPolicy.maxVariantsPerDirection = 5;
    manifest.generationPolicy.maxVariantsTotal = 12;

    const result = campaignBundleSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("generationPolicy.maxVariantsTotal");
  });

  it("accepts a total cap exactly large enough for every direction", () => {
    const manifest = validManifest();
    manifest.generationPolicy.maxVariantsPerDirection = 5;
    manifest.generationPolicy.maxVariantsTotal = 15;

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(true);
  });

  it("refuses a per-direction cap of zero rather than reading it as unlimited", () => {
    const manifest = validManifest();
    manifest.generationPolicy.maxVariantsPerDirection = 0;

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });

  it("refuses an expiry that is not a UTC instant", () => {
    const manifest = validManifest();
    manifest.generationPolicy.policyExpiresAt = "2026-09-30T12:00:00+04:00";

    const result = campaignBundleSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(issuePaths(result)).toContain("generationPolicy.policyExpiresAt");
  });

  it("accepts a past expiry, so a settled campaign stays readable", () => {
    // Whether the window is still open is an evaluation question with a clock.
    // A schema that refused a lapsed policy would make an approved campaign
    // unparseable the moment it ended, destroying its own audit trail.
    const manifest = validManifest();
    manifest.generationPolicy.policyExpiresAt = "2020-01-01T00:00:00.000Z";

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(true);
  });

  it("allows a campaign with no offer to lock nothing", () => {
    const manifest = validManifest();
    manifest.generationPolicy.lockedOfferRef = null;

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(true);
  });

  it("rejects an unknown policy field rather than ignoring it", () => {
    const manifest = validManifest();
    (manifest.generationPolicy as Record<string, unknown>).allowClaimEdits = true;

    expect(campaignBundleSchema.safeParse(manifest).success).toBe(false);
  });
});
