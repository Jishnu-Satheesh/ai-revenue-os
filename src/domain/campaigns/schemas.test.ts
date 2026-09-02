import { describe, expect, it } from "vitest";

import { bundleDigest } from "@/domain/campaigns/digest";
import {
  campaignBundleManifestSchema,
  campaignBundleModelManifestSchema,
  campaignBundleSchema,
  posterPlanSchema,
  subjectProfileSchema,
} from "@/domain/campaigns/schemas";
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

describe("campaignBundleModelManifestSchema", () => {
  it("does not let the image model declare its own truth class", () => {
    expect(campaignBundleModelManifestSchema.safeParse(validManifest()).success).toBe(false);
  });

  it("accepts a manifest whose assets leave truth classification to deterministic code", () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.assets = (manifest.assets as Array<Record<string, unknown>>).map((asset) => {
      const modelAsset = { ...asset };
      delete modelAsset.truthClass;
      return modelAsset;
    });

    expect(campaignBundleModelManifestSchema.safeParse(manifest).success).toBe(true);
  });
});

describe("posterPlan", () => {
  const plan = {
    placements: [{ placement: "feed_image", templateKey: "kerala_feed", templateVersion: 1 }],
    scripts: ["Mlym", "Latn"],
  };

  it("accepts a plan naming a template version and its scripts", () => {
    expect(posterPlanSchema.parse(plan).placements[0]?.templateVersion).toBe(1);
  });

  /**
   * A poster can only be drawn in a script we vendored a font for. Catching a
   * script with no font here, at the manifest boundary, beats catching it in the
   * worker -- or not catching it, which is the empty-box failure arriving by a
   * different door.
   */
  it("refuses a script no vendored font covers", () => {
    expect(posterPlanSchema.safeParse({ ...plan, scripts: ["Deva"] }).success).toBe(false);
  });

  it("refuses two templates for one placement", () => {
    const ambiguous = {
      ...plan,
      placements: [
        { placement: "feed_image", templateKey: "a_template", templateVersion: 1 },
        { placement: "feed_image", templateKey: "b_template", templateVersion: 1 },
      ],
    };

    expect(posterPlanSchema.safeParse(ambiguous).success).toBe(false);
  });

  it("refuses a repeated script, which would render the same poster twice", () => {
    expect(posterPlanSchema.safeParse({ ...plan, scripts: ["Latn", "Latn"] }).success).toBe(false);
  });

  it("refuses a floating template reference with no version", () => {
    const floating = {
      ...plan,
      placements: [{ placement: "feed_image", templateKey: "kerala_feed" }],
    };

    expect(posterPlanSchema.safeParse(floating).success).toBe(false);
  });

  it("is optional, so every manifest written before spec 020 stays valid", () => {
    expect(campaignBundleSchema.safeParse(validManifest()).success).toBe(true);
  });

  /**
   * Approval binds to a digest of the manifest. Choosing a template changes what
   * publishes, so it must change the digest -- and an absent plan must leave
   * every existing version's digest exactly as it was, or Task 2 would have
   * invalidated approvals that were never touched.
   */
  it("leaves an existing digest unchanged when absent, and changes it when present", () => {
    const without = validManifest();
    const before = bundleDigest(without);

    const parsedWithout = campaignBundleManifestSchema.parse(without);
    expect(parsedWithout.posterPlan).toBeUndefined();
    expect(bundleDigest(parsedWithout)).toBe(before);

    const withPlan = { ...without, posterPlan: posterPlanSchema.parse(plan) };
    expect(bundleDigest(withPlan)).not.toBe(before);
  });

  /**
   * Spec 020 section 10: no model chooses a template. Omitting the field from a
   * strict object makes a planner that proposes one fail to parse, rather than
   * having its proposal silently dropped where nobody would learn of it.
   */
  it("cannot be supplied by a model", () => {
    const manifest = validManifest() as unknown as Record<string, unknown>;
    manifest.assets = (manifest.assets as Array<Record<string, unknown>>).map((asset) => {
      const modelAsset = { ...asset };
      delete modelAsset.truthClass;
      return modelAsset;
    });
    manifest.posterPlan = plan;

    expect(campaignBundleModelManifestSchema.safeParse(manifest).success).toBe(false);
  });
});

describe("subjectProfileSchema", () => {
  const baseProfile = {
    id: "10000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000002",
    name: "Kerala fish curry",
    slug: "kerala-fish-curry",
    description: null,
    tags: ["fish curry", "കേരളം"],
    namesByScript: { Latn: "Kerala fish curry", Mlym: "കേരള മീൻ കറി" },
    mustNotAppear: ["naan", "cream"],
    illustratedStyle: false,
    state: "draft" as const,
    confirmedBy: null,
    confirmedAt: null,
    createdBy: "30000000-0000-4000-8000-000000000003",
    createdAt: "2026-08-24T10:00:00.000Z",
    updatedAt: "2026-08-24T10:00:00.000Z",
    archivedAt: null,
  };

  it("accepts a Unicode draft with ISO 15924 name keys", () => {
    expect(subjectProfileSchema.safeParse(baseProfile).success).toBe(true);
  });

  it("requires confirmed profiles to carry the human confirmation evidence", () => {
    expect(subjectProfileSchema.safeParse({ ...baseProfile, state: "confirmed" }).success).toBe(
      false,
    );

    expect(
      subjectProfileSchema.safeParse({
        ...baseProfile,
        state: "confirmed",
        description: "Kingfish steaks in a brick-red tamarind and coconut gravy.",
        confirmedBy: "40000000-0000-4000-8000-000000000004",
        confirmedAt: "2026-08-24T10:05:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects malformed script keys and unknown fields", () => {
    expect(
      subjectProfileSchema.safeParse({ ...baseProfile, namesByScript: { latin: "Fish curry" } })
        .success,
    ).toBe(false);
    expect(subjectProfileSchema.safeParse({ ...baseProfile, price: 2_500 }).success).toBe(false);
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
