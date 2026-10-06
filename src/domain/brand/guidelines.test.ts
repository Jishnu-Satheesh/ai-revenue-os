import { describe, expect, it } from "vitest";

import {
  brandGuidelinesSchema,
  hexColorSchema,
  splitRulesByStrength,
} from "@/domain/brand/guidelines";

describe("hexColorSchema", () => {
  it("normalises a colour to lower case", () => {
    expect(hexColorSchema.parse("#C8102E")).toBe("#c8102e");
  });

  it("refuses anything that is not a six-digit hex colour", () => {
    for (const value of ["c8102e", "#c810", "#gggggg", "red", "#c8102e80"]) {
      expect(() => hexColorSchema.parse(value)).toThrow();
    }
  });
});

describe("brandGuidelinesSchema", () => {
  it("accepts a palette with only some slots filled", () => {
    // A brand with one colour has one colour. Requiring three would invent two.
    const parsed = brandGuidelinesSchema.parse({
      palette: { primary: "#c8102e" },
      rules: [],
      restrictedTerms: [],
    });
    expect(parsed.palette).toEqual({ primary: "#c8102e" });
  });

  it("refuses a rule with no strength", () => {
    // Spec §5: a hard rule is never inferred, so an unmarked rule is not stored.
    expect(() =>
      brandGuidelinesSchema.parse({
        palette: {},
        rules: [{ text: "Never show alcohol" }],
        restrictedTerms: [],
      }),
    ).toThrow();
  });

  it("refuses a restricted term long enough to be a sentence", () => {
    // Spec §6: terms are matched literally, so a paragraph would never match.
    expect(() =>
      brandGuidelinesSchema.parse({
        palette: {},
        rules: [],
        restrictedTerms: ["x".repeat(81)],
      }),
    ).toThrow();
  });
});

describe("splitRulesByStrength", () => {
  it("routes each rule to the list that can act on it", () => {
    const split = splitRulesByStrength([
      { text: "Never show alcohol", strength: "hard" },
      { text: "We usually lead with the food", strength: "soft" },
      { text: "Never imply a medical benefit", strength: "hard" },
    ]);

    expect(split.hardConstraints).toEqual([
      "Never show alcohol",
      "Never imply a medical benefit",
    ]);
    expect(split.softConventions).toEqual(["We usually lead with the food"]);
  });

  it("returns empty lists rather than null for a brand with no rules", () => {
    // The generation context takes arrays. A null here would become "none"
    // in one caller and a crash in another.
    expect(splitRulesByStrength([])).toEqual({ hardConstraints: [], softConventions: [] });
  });
});
