import { describe, expect, it } from "vitest";

import { artDirectionBlueprintSchema } from "@/domain/campaigns/art-direction";

const VALID_BLUEPRINT = {
  composition: "A centered clay pot with restrained negative space.",
  framing: "Tight overhead crop.",
  lighting: "Soft window light from camera left.",
  cameraTreatment: "Natural 50mm look with shallow depth only behind the focal plane.",
  palette: ["brick red", "clay", "deep green"],
  focalPoint: "The kingfish and curry leaves at the centre of the pot.",
  surfaceNotes: ["matte dark stone surface"],
  propNotes: ["one folded neutral linen at the edge"],
  avoid: ["busy tableware", "glossy commercial lighting"],
};

describe("art direction blueprint", () => {
  it("accepts the complete bounded visual-treatment contract", () => {
    expect(artDirectionBlueprintSchema.parse(VALID_BLUEPRINT)).toEqual(VALID_BLUEPRINT);
  });

  it.each(["subject", "text"])("has no %s field by construction", (field) => {
    expect(
      artDirectionBlueprintSchema.safeParse({ ...VALID_BLUEPRINT, [field]: "change it" }).success,
    ).toBe(false);
  });

  it("bounds lists so a model cannot turn the blueprint into unreviewable prose", () => {
    expect(
      artDirectionBlueprintSchema.safeParse({
        ...VALID_BLUEPRINT,
        propNotes: Array.from({ length: 13 }, (_, index) => `prop ${index}`),
      }).success,
    ).toBe(false);
  });
});

describe("the blueprint's avoid notes", () => {
  it("accepts twelve distinct avoid notes and refuses a thirteenth", () => {
    const twelve = Array.from({ length: 12 }, (_, index) => `avoid note ${index + 1}`);

    expect(
      artDirectionBlueprintSchema.safeParse({ ...VALID_BLUEPRINT, avoid: twelve }).success,
    ).toBe(true);
    expect(
      artDirectionBlueprintSchema.safeParse({
        ...VALID_BLUEPRINT,
        avoid: [...twelve, "avoid note 13"],
      }).success,
    ).toBe(false);
  });

  it("refuses avoid notes that repeat, so the cap cannot be padded", () => {
    const parsed = artDirectionBlueprintSchema.safeParse({
      ...VALID_BLUEPRINT,
      avoid: ["busy tableware", "Busy Tableware"],
    });

    expect(parsed.success).toBe(false);
  });
});
