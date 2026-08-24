import { describe, expect, it } from "vitest";

import {
  assetOwnershipSchema,
  assetTagComparisonKey,
  assetTagsMatch,
  assetTagsSchema,
  conditioningRoleSchema,
  creativeAssetReviewSchema,
  creativeReviewReasonCodeSchema,
  normalizeAssetTag,
  referenceModeSchema,
  referenceResolutionOutcomeSchema,
  referenceResolutionRefusalCodeSchema,
  scriptCodeSchema,
} from "@/domain/campaigns/asset-library";

describe("asset-library vocabulary", () => {
  it("accepts only the declared conditioning roles", () => {
    expect(conditioningRoleSchema.parse("subject")).toBe("subject");
    expect(conditioningRoleSchema.parse("avoid")).toBe("avoid");
    expect(conditioningRoleSchema.safeParse("background").success).toBe(false);
  });

  it("uses ISO 15924 script codes", () => {
    expect(scriptCodeSchema.parse("Latn")).toBe("Latn");
    expect(scriptCodeSchema.parse("Mlym")).toBe("Mlym");
    expect(scriptCodeSchema.safeParse("latin").success).toBe(false);
    expect(scriptCodeSchema.safeParse("LATN").success).toBe(false);
  });

  it("keeps ownership and reference mode separate", () => {
    expect(assetOwnershipSchema.parse("third_party")).toBe("third_party");
    expect(referenceModeSchema.parse("exact_match")).toBe("exact_match");
    expect(assetOwnershipSchema.safeParse("exact_match").success).toBe(false);
  });

  it("exposes the complete deterministic outcome and refusal vocabulary", () => {
    expect(referenceResolutionOutcomeSchema.parse("resolved")).toBe("resolved");
    expect(referenceResolutionOutcomeSchema.parse("synthesis_permitted")).toBe(
      "synthesis_permitted",
    );
    expect(referenceResolutionOutcomeSchema.parse("insufficient")).toBe("insufficient");
    expect(referenceResolutionRefusalCodeSchema.parse("no_declared_subject")).toBe(
      "no_declared_subject",
    );
    expect(referenceResolutionRefusalCodeSchema.safeParse("brand_constraints").success).toBe(false);
  });

  it("includes core and restaurant-pack rejection reasons", () => {
    expect(creativeReviewReasonCodeSchema.parse("wrong_subject")).toBe("wrong_subject");
    expect(creativeReviewReasonCodeSchema.parse("wrong_cuisine")).toBe("wrong_cuisine");
    expect(creativeReviewReasonCodeSchema.safeParse("looks_bad").success).toBe(false);
  });
});

describe("creativeAssetReviewSchema", () => {
  const subjectId = "10000000-0000-4000-8000-000000000001";

  it("requires a reason when an asset is rejected", () => {
    expect(
      creativeAssetReviewSchema.safeParse({
        subjectKind: "brand_asset_version",
        subjectId,
        verdict: "rejected",
        reasonCodes: [],
        note: null,
      }).success,
    ).toBe(false);
  });

  it("does not attach rejection reasons to an approval", () => {
    expect(
      creativeAssetReviewSchema.safeParse({
        subjectKind: "campaign_asset",
        subjectId,
        verdict: "approved",
        reasonCodes: ["wrong_subject"],
        note: null,
      }).success,
    ).toBe(false);
  });

  it("rejects unknown fields instead of silently dropping them", () => {
    expect(
      creativeAssetReviewSchema.safeParse({
        subjectKind: "brand_asset_version",
        subjectId,
        verdict: "approved",
        reasonCodes: [],
        note: null,
        organizationId: "20000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate reason codes instead of counting one reason twice", () => {
    expect(
      creativeAssetReviewSchema.safeParse({
        subjectKind: "brand_asset_version",
        subjectId,
        verdict: "rejected",
        reasonCodes: ["wrong_subject", "wrong_subject"],
        note: null,
      }).success,
    ).toBe(false);
  });
});

describe("asset tag normalization", () => {
  it("normalizes tags to NFC without erasing non-Latin scripts", () => {
    expect(normalizeAssetTag("  Cafe\u0301  ")).toBe("Café");
    expect(normalizeAssetTag("മലയാളം")).toBe("മലയാളം");
    expect(normalizeAssetTag("العربية")).toBe("العربية");
  });

  it("compares normalized tags case-insensitively", () => {
    expect(assetTagComparisonKey(" CAFE\u0301 ")).toBe(assetTagComparisonKey("café"));
    expect(assetTagsMatch("Weekend", "weekend")).toBe(true);
  });

  it("rejects duplicates by the same comparison rule every caller shares", () => {
    expect(assetTagsSchema.safeParse(["Weekend", "weekend"]).success).toBe(false);
    expect(assetTagsSchema.safeParse(["Cafe\u0301", "Café"]).success).toBe(false);
  });

  it("counts Unicode code points rather than UTF-16 storage units", () => {
    expect(assetTagsSchema.safeParse(["🍛".repeat(60)]).success).toBe(true);
    expect(assetTagsSchema.safeParse(["🍛".repeat(61)]).success).toBe(false);
  });
});
