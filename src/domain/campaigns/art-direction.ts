import { z } from "zod";

const directionTextSchema = z.string().trim().min(1).max(800);
const shortDirectionTextSchema = z.string().trim().min(1).max(300);

function uniqueNotes(maximumItems: number) {
  return z
    .array(shortDirectionTextSchema)
    .max(maximumItems)
    .superRefine((items, context) => {
      const comparisonKeys = items.map((item) => item.normalize("NFC").toLocaleLowerCase("und"));
      if (new Set(comparisonKeys).size !== comparisonKeys.length) {
        context.addIssue({ code: "custom", message: "Blueprint notes must be unique." });
      }
    });
}

/**
 * Visual treatment only. There is intentionally no subject or text field.
 * Subject identity is injected after this object parses, and copy is composed
 * deterministically by the Studio rather than painted into the image.
 */
export const artDirectionBlueprintSchema = z.strictObject({
  composition: directionTextSchema,
  framing: directionTextSchema,
  lighting: directionTextSchema,
  cameraTreatment: directionTextSchema,
  palette: uniqueNotes(8).min(1),
  focalPoint: directionTextSchema,
  surfaceNotes: uniqueNotes(8),
  propNotes: uniqueNotes(12),
  avoid: uniqueNotes(12),
});

export type ArtDirectionBlueprint = z.infer<typeof artDirectionBlueprintSchema>;
