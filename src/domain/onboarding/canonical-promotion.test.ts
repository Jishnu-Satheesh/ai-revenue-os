import { describe, expect, it } from "vitest";

import {
  brandContextFromBrandAssets,
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
