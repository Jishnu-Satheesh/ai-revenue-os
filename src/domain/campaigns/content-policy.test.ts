import { describe, expect, it } from "vitest";

import { evaluateContentPolicy, type ContentPolicyInput } from "@/domain/campaigns/content-policy";
import { validManifest } from "@/domain/campaigns/test-manifest";

/** A contract that has proved its limits, so hashtag rules can be enforced. */
const VERIFIED_LIMITS: ContentPolicyInput["limitsByChannel"] = {
  instagram: { maxHashtags: 30, maxCopyCharacters: 2_200 },
  facebook: { maxHashtags: 30, maxCopyCharacters: 2_200 },
};

function evaluate(overrides: Partial<ContentPolicyInput> = {}) {
  return evaluateContentPolicy({
    manifest: validManifest(),
    limitsByChannel: VERIFIED_LIMITS,
    restrictedTerms: [],
    ...overrides,
  });
}

function codes(result: ReturnType<typeof evaluateContentPolicy>) {
  return result.violations.map((violation) => violation.code);
}

describe("generation profiles", () => {
  it("passes a compliant brand-guided bundle", () => {
    expect(evaluate().violations).toEqual([]);
  });

  it("forbids any soft-convention departure under brand restricted", () => {
    const manifest = validManifest();
    manifest.generationProfile = "brand_restricted";

    expect(codes(evaluate({ manifest }))).toContain("profile_forbids_departure");
  });

  it("allows a brand-restricted bundle whose directions stretch nothing", () => {
    const manifest = validManifest();
    manifest.generationProfile = "brand_restricted";
    manifest.directions[2]!.softConventionDepartures = [];

    expect(codes(evaluate({ manifest }))).not.toContain("profile_forbids_departure");
  });

  it("keeps the control inside brand conventions under brand guided", () => {
    const manifest = validManifest();
    manifest.directions[0]!.softConventionDepartures = ["A brighter palette than approved."];

    expect(codes(evaluate({ manifest }))).toContain("departure_outside_experimental");
  });

  it("lets full visual freedom depart outside the experimental direction", () => {
    const manifest = validManifest();
    manifest.generationProfile = "full_visual_freedom";
    manifest.directions[0]!.softConventionDepartures = ["A brighter palette than approved."];

    expect(codes(evaluate({ manifest }))).not.toContain("departure_outside_experimental");
  });

  it("honours a per-direction override over the bundle profile", () => {
    const manifest = validManifest();
    manifest.generationProfile = "full_visual_freedom";
    manifest.directions[2]!.generationProfileOverride = "brand_restricted";

    expect(codes(evaluate({ manifest }))).toContain("profile_forbids_departure");
  });

  it("requires the experiment to disclose the convention it stretches", () => {
    const manifest = validManifest();
    manifest.directions[2]!.experiment!.stretchedConvention = "Something else entirely.";

    expect(codes(evaluate({ manifest }))).toContain("departure_not_disclosed");
  });

  it("never lets a profile excuse a hard constraint failure", () => {
    const manifest = validManifest();
    manifest.generationProfile = "full_visual_freedom";

    const result = evaluate({
      manifest,
      hardConstraintFailures: [
        { path: ["directions", 0, "copy", 0], message: "The claim is not supported by evidence." },
      ],
    });

    expect(codes(result)).toContain("hard_constraint_violated");
  });
});

describe("hashtags", () => {
  it("detects duplicates case-insensitively without rewriting the display text", () => {
    const manifest = validManifest();
    manifest.directions[0]!.hashtagSets[0]!.tags = ["#DubaiEats", "#dubaieats"];

    const result = evaluate({ manifest });

    expect(codes(result)).toContain("hashtag_duplicate");
    expect(manifest.directions[0]!.hashtagSets[0]!.tags[0]).toBe("#DubaiEats");
  });

  it("blocks a restricted term wherever it appears in the tag", () => {
    const manifest = validManifest();
    manifest.directions[0]!.hashtagSets[0]!.tags = ["#FreeAlcohol"];

    expect(codes(evaluate({ manifest, restrictedTerms: ["alcohol"] }))).toContain(
      "hashtag_restricted",
    );
  });

  it("enforces the verified provider count limit", () => {
    const manifest = validManifest();
    manifest.directions[0]!.hashtagSets[0]!.tags = Array.from(
      { length: 4 },
      (_, index) => `#tag${index}`,
    );

    const result = evaluate({
      manifest,
      limitsByChannel: { instagram: { maxHashtags: 3, maxCopyCharacters: 2_200 } },
    });

    expect(codes(result)).toContain("hashtag_over_limit");
  });

  it("counts duplicates once against the limit, as the provider would", () => {
    const manifest = validManifest();
    manifest.directions[0]!.hashtagSets[0]!.tags = ["#a", "#A", "#b"];

    const result = evaluate({
      manifest,
      limitsByChannel: { instagram: { maxHashtags: 2, maxCopyCharacters: 2_200 } },
    });

    expect(codes(result)).not.toContain("hashtag_over_limit");
  });

  it("blocks rather than guesses when the contract proves no limit", () => {
    const result = evaluate({
      limitsByChannel: { instagram: { maxHashtags: null, maxCopyCharacters: null } },
    });

    expect(codes(result)).toContain("hashtag_limits_unverified");
  });

  it("has nothing to check when a set proposes no tags at all", () => {
    const manifest = validManifest();
    // Every direction declines to suggest hashtags, which is the truthful
    // bundle for a channel whose limit nobody has proven yet.
    for (const direction of manifest.directions) {
      for (const set of direction.hashtagSets) set.tags = [];
    }

    const result = evaluate({
      manifest,
      limitsByChannel: { instagram: { maxHashtags: null, maxCopyCharacters: null } },
    });

    expect(codes(result)).not.toContain("hashtag_limits_unverified");
  });

  it("blocks a channel the verified contract does not cover at all", () => {
    expect(codes(evaluate({ limitsByChannel: {} }))).toContain("hashtag_limits_unverified");
  });

  it("keeps internal content tags out of the published hashtag check", () => {
    const manifest = validManifest();
    manifest.directions[0]!.internalContentTags = ["margin-led", "margin-led"];

    // Internal tags are never published, so a repeat is not a provider concern.
    expect(codes(evaluate({ manifest }))).not.toContain("hashtag_duplicate");
  });
});

describe("experimental distinctness", () => {
  it("rejects an experiment that repeats the control's image and words", () => {
    const manifest = validManifest();
    manifest.directions[2]!.assetIds = [...manifest.directions[0]!.assetIds];
    manifest.directions[2]!.copy = manifest.directions[0]!.copy.map((entry) => ({ ...entry }));

    expect(codes(evaluate({ manifest }))).toContain("experiment_not_distinct");
  });

  it("accepts an experiment that keeps the image but changes the words", () => {
    const manifest = validManifest();
    manifest.directions[2]!.assetIds = [...manifest.directions[0]!.assetIds];

    expect(codes(evaluate({ manifest }))).not.toContain("experiment_not_distinct");
  });

  it("accepts an experiment that keeps the words but changes the image", () => {
    const manifest = validManifest();
    manifest.directions[2]!.copy = manifest.directions[0]!.copy.map((entry) => ({ ...entry }));

    expect(codes(evaluate({ manifest }))).not.toContain("experiment_not_distinct");
  });

  it("ignores capitalisation when judging whether the words differ", () => {
    const manifest = validManifest();
    manifest.directions[2]!.assetIds = [...manifest.directions[0]!.assetIds];
    manifest.directions[2]!.copy = manifest.directions[0]!.copy.map((entry) => ({
      ...entry,
      hook: entry.hook.toUpperCase(),
    }));

    expect(codes(evaluate({ manifest }))).toContain("experiment_not_distinct");
  });
});
