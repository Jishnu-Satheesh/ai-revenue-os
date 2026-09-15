import { describe, expect, it } from "vitest";

import {
  brandContextFromBrandAssets,
  guidelinesFromBrandAssets,
  mergeBrandContext,
} from "@/domain/onboarding/canonical-promotion";

describe("brandContextFromBrandAssets", () => {
  it("promotes the selected traits as the readable voice", () => {
    // `load_campaign_creation_facts` reads `brand_context ->> 'voice'` as text
    // and hands it to the model as a fact, so the traits are joined into
    // something a reader recognises rather than stored as codes.
    expect(brandContextFromBrandAssets({ brandVoice: ["warm", "direct"] })).toEqual({
      voice: "Warm, Direct",
    });
  });

  it("keeps an unrecognised trait rather than dropping it", () => {
    // A vocabulary that grows must not silently lose answers already given.
    expect(brandContextFromBrandAssets({ brandVoice: ["warm", "bespoke"] })).toEqual({
      voice: "Warm, bespoke",
    });
  });

  it("promotes nothing when no voice was chosen", () => {
    // Absent, never invented. A fabricated voice would produce confident
    // creative nobody approved; a missing one becomes a named gap.
    expect(brandContextFromBrandAssets({ brandVoice: [] })).toBeNull();
    expect(brandContextFromBrandAssets({})).toBeNull();
    expect(brandContextFromBrandAssets({ brandVoice: "warm" })).toBeNull();
  });

  it("ignores blank entries instead of writing an empty voice", () => {
    expect(brandContextFromBrandAssets({ brandVoice: ["  ", ""] })).toBeNull();
  });
});

describe("mergeBrandContext", () => {
  it("keeps keys the incoming patch does not mention", () => {
    // The business identity section used to upsert brand_context wholesale, so
    // saving it erased a voice the brand assets section had already promoted.
    expect(mergeBrandContext({ voice: "Warm" }, { legalIdentity: "Al Noor LLC" })).toEqual({
      voice: "Warm",
      legalIdentity: "Al Noor LLC",
    });
  });

  it("lets a later answer replace an earlier one at the same key", () => {
    expect(mergeBrandContext({ voice: "Warm" }, { voice: "Premium" })).toEqual({
      voice: "Premium",
    });
  });

  it("treats a missing or malformed existing context as empty", () => {
    expect(mergeBrandContext(null, { voice: "Warm" })).toEqual({ voice: "Warm" });
    expect(mergeBrandContext("not an object", { voice: "Warm" })).toEqual({ voice: "Warm" });
    expect(mergeBrandContext([1, 2], { voice: "Warm" })).toEqual({ voice: "Warm" });
  });

  it("returns the existing context untouched when there is nothing to add", () => {
    expect(mergeBrandContext({ voice: "Warm" }, null)).toEqual({ voice: "Warm" });
  });
});

describe("guidelinesFromBrandAssets", () => {
  it("promotes palette, rules and terms together", () => {
    expect(
      guidelinesFromBrandAssets({
        palette: { primary: "#C8102E" },
        brandRules: [{ text: "Never show alcohol", strength: "hard" }],
        restrictedTerms: ["best in Dubai"],
      }),
    ).toEqual({
      palette: { primary: "#c8102e" },
      rules: [{ text: "Never show alcohol", strength: "hard" }],
      restrictedTerms: ["best in Dubai"],
    });
  });

  it("drops a rule with no strength rather than guessing one", () => {
    // Spec §5. A rule stored as soft when it was meant as absolute is worse
    // than a rule that was not stored: the operator believes the platform is
    // refusing work it will in fact happily publish.
    expect(guidelinesFromBrandAssets({ brandRules: [{ text: "Never show alcohol" }] })).toBeNull();
  });

  it("promotes nothing when the section supplies nothing", () => {
    // A blank write would replace rules another surface set with an empty list,
    // quietly removing constraints nobody asked to remove.
    expect(guidelinesFromBrandAssets({})).toBeNull();
    expect(
      guidelinesFromBrandAssets({ palette: {}, brandRules: [], restrictedTerms: [] }),
    ).toBeNull();
  });

  it("promotes a palette on its own, before any rule is written", () => {
    // Onboarding is filled in pieces. Requiring all three would mean a brand
    // that has only chosen its colours gets none of them stored.
    expect(guidelinesFromBrandAssets({ palette: { primary: "#c8102e" } })).toEqual({
      palette: { primary: "#c8102e" },
      rules: [],
      restrictedTerms: [],
    });
  });

  it("promotes nothing when a colour is not a colour", () => {
    // Refusing the whole record is deliberate: promoting the valid half would
    // report a successful save for answers that were silently discarded.
    expect(guidelinesFromBrandAssets({ palette: { primary: "crimson" } })).toBeNull();
  });
});
