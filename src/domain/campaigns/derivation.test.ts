import { describe, expect, it } from "vitest";

import { checkVariantDerivation } from "@/domain/campaigns/derivation";
import { campaignCreativeVariantSchema } from "@/domain/campaigns/variants";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";

const ASSET = "e0000000-0000-4000-8000-000000000001";

function variant(overrides: Record<string, unknown> = {}) {
  return {
    id: "f0000000-0000-4000-8000-000000000001",
    directionId: manifestIds.evidenceLed,
    assetId: ASSET,
    channel: "instagram" as const,
    placement: "feed_image" as const,
    hook: "Two courses, one price, weekdays only",
    caption: "Lunch that pays for itself. Two courses, one price, this week only.",
    hashtags: ["#lunchdeal", "#dubaieats"],
    callToAction: "Book a table",
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  const manifest = validManifest();
  return {
    manifest,
    variant: variant(),
    producedAssetIds: [ASSET],
    evidence: {
      offer: manifest.generationPolicy.lockedOfferRef,
      factKeys: manifest.generationPolicy.lockedAssertionKeys,
      factText: "lunch set price two courses one price weekday lunch capacity",
      restrictedTerms: [] as readonly string[],
    },
    limits: { maxHashtags: 30, maxCopyCharacters: 2_200 },
    existingContentHashes: [] as readonly string[],
    now: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

function codesFrom(result: ReturnType<typeof checkVariantDerivation>) {
  return result.outcome === "derived" ? [] : result.failures.map((failure) => failure.code);
}

describe("a variant may vary the pitch", () => {
  it("accepts one that changes only imagery, hook, caption, hashtags and CTA", () => {
    expect(checkVariantDerivation(input()).outcome).toBe("derived");
  });

  it("accepts a different image for the same direction", () => {
    const other = "e0000000-0000-4000-8000-000000000002";
    const result = checkVariantDerivation(
      input({ variant: variant({ assetId: other }), producedAssetIds: [ASSET, other] }),
    );

    expect(result.outcome).toBe("derived");
  });

  it("accepts a rewritten hook and caption", () => {
    const result = checkVariantDerivation(
      input({
        variant: variant({
          hook: "Your quietest hour, our best table",
          caption: "Weekday lunch, two courses, one price.",
        }),
      }),
    );

    expect(result.outcome).toBe("derived");
  });
});

describe("a variant may never change the promise", () => {
  it("refuses a field the schema does not define at all", () => {
    // The promise-bearing fields are not optional-and-checked, they are absent
    // from the type. A model that tries to send a spend ceiling or a placement
    // change is refused at the parse boundary, before any semantic check runs.
    for (const smuggled of [
      { spendCeiling: { amountMinor: 100, currency: "AED" } },
      { scheduledFor: "2026-12-01T00:00:00.000Z" },
      { generationProfile: "full_visual_freedom" },
      { audience: "Everyone in Dubai" },
    ]) {
      expect(campaignCreativeVariantSchema.safeParse({ ...variant(), ...smuggled }).success).toBe(
        false,
      );
    }
  });

  it("refuses a direction the approved bundle does not contain", () => {
    const result = checkVariantDerivation(
      input({ variant: variant({ directionId: "d0000000-0000-4000-8000-000000000099" }) }),
    );

    expect(codesFrom(result)).toContain("unknown_direction");
  });

  it("refuses a channel or placement the direction's approved actions do not cover", () => {
    const result = checkVariantDerivation(
      input({ variant: variant({ channel: "facebook", placement: "image_story" }) }),
    );

    expect(codesFrom(result)).toContain("placement_not_approved");
  });

  it("refuses an asset that was not produced for this campaign", () => {
    const result = checkVariantDerivation(
      input({ variant: variant({ assetId: "e0000000-0000-4000-8000-0000000000ff" }) }),
    );

    expect(codesFrom(result)).toContain("asset_not_produced");
  });

  it("allows ordinary writing that merely contains a superlative word", () => {
    // "our best table" is not a claim about the world. A checker that rejects
    // ordinary writing gets ignored, and an ignored checker protects nothing.
    for (const caption of [
      "Grab our best table by the window.",
      "The best part is you are back at your desk by two.",
    ]) {
      expect(checkVariantDerivation(input({ variant: variant({ caption }) })).outcome).toBe(
        "derived",
      );
    }
  });

  it("refuses a ranking claim the pinned evidence does not carry", () => {
    for (const caption of [
      "Voted the number one restaurant in Dubai for 2026.",
      "The award-winning weekday lunch.",
      "Top-rated lunch in the district.",
    ]) {
      const result = checkVariantDerivation(input({ variant: variant({ caption }) }));
      expect(codesFrom(result)).toContain("unsourced_claim");
    }
  });

  it("refuses copy asserting something the pinned evidence does not carry", () => {
    const result = checkVariantDerivation(
      input({
        variant: variant({ caption: "Voted the number one restaurant in Dubai for 2026." }),
      }),
    );

    expect(codesFrom(result)).toContain("unsourced_claim");
  });

  it("refuses an offer when the policy locks none", () => {
    const manifest = validManifest();
    manifest.generationPolicy.lockedOfferRef = null;
    const result = checkVariantDerivation(
      input({
        manifest,
        variant: variant({ caption: "Half price on everything all week." }),
        evidence: { offer: null, factKeys: [], factText: "", restrictedTerms: [] },
      }),
    );

    expect(codesFrom(result)).toContain("invented_offer");
  });

  it("refuses a restricted term wherever it appears", () => {
    const result = checkVariantDerivation(
      input({
        variant: variant({ hook: "Guaranteed weight loss with every lunch" }),
        evidence: {
          offer: "lunch-set-menu-2026-09",
          factKeys: [],
          factText: "",
          restrictedTerms: ["guaranteed"],
        },
      }),
    );

    expect(codesFrom(result)).toContain("restricted_term");
  });
});

describe("a variant may not outlive or duplicate its policy", () => {
  it("refuses generation after the policy window has closed", () => {
    const result = checkVariantDerivation(input({ now: new Date("2026-10-01T00:00:00.000Z") }));

    expect(codesFrom(result)).toContain("policy_expired");
  });

  it("accepts a variant on the last day the policy is open", () => {
    // The manifest fixture's policy expires 2026-09-30T14:00:00Z.
    const result = checkVariantDerivation(input({ now: new Date("2026-09-30T13:59:59.000Z") }));

    expect(result.outcome).toBe("derived");
  });

  it("refuses a variant identical to one already generated", () => {
    // Two identical creatives split the same budget and teach nothing, so the
    // duplicate is a wasted impression rather than a second data point.
    const first = checkVariantDerivation(input());
    if (first.outcome !== "derived") throw new Error("expected the first variant to derive");

    const result = checkVariantDerivation(input({ existingContentHashes: [first.contentHash] }));

    expect(codesFrom(result)).toContain("duplicate_variant");
  });

  it("gives the same variant the same content hash every time", () => {
    const left = checkVariantDerivation(input());
    const right = checkVariantDerivation(input());
    if (left.outcome !== "derived" || right.outcome !== "derived") {
      throw new Error("expected both to derive");
    }

    expect(left.contentHash).toBe(right.contentHash);
  });

  it("gives a reordered hashtag list a different hash, because readers see the order", () => {
    const left = checkVariantDerivation(input());
    const right = checkVariantDerivation(
      input({ variant: variant({ hashtags: ["#dubaieats", "#lunchdeal"] }) }),
    );
    if (left.outcome !== "derived" || right.outcome !== "derived") {
      throw new Error("expected both to derive");
    }

    expect(left.contentHash).not.toBe(right.contentHash);
  });
});

describe("every failure is reported at once", () => {
  it("names each broken rule rather than stopping at the first", () => {
    const result = checkVariantDerivation(
      input({
        variant: variant({
          directionId: "d0000000-0000-4000-8000-000000000099",
          assetId: "e0000000-0000-4000-8000-0000000000ff",
        }),
        now: new Date("2026-10-01T00:00:00.000Z"),
      }),
    );

    const codes = codesFrom(result);
    expect(codes).toContain("unknown_direction");
    expect(codes).toContain("asset_not_produced");
    expect(codes).toContain("policy_expired");
  });
});
