import { z } from "zod";

/**
 * A brand's rules, as data the platform can act on.
 *
 * `hard_constraints`, `soft_conventions` and `restricted_terms` have been read
 * from `brand_context`, rendered into the image prompt by `reference-prompt.ts`
 * and checked by `content-policy.ts` since the generation context was written.
 * Nothing has ever written them, so every campaign in every organization has
 * been generated against three empty arrays. These are the shapes that fill
 * them.
 *
 * Every bound here is copied from `generationContextSchema`, which consumes
 * these values. Choosing a different one would either truncate silently or
 * admit a value the consumer rejects.
 */

export const BRAND_RULE_STRENGTHS = ["hard", "soft"] as const;
export type BrandRuleStrength = (typeof BRAND_RULE_STRENGTHS)[number];

/**
 * Hard or soft, chosen by the author and never inferred.
 *
 * "Never show alcohol" and "we usually lead with the food" are different kinds
 * of statement, and a platform that cannot tell them apart either refuses work
 * it should have offered or publishes work it should have refused.
 */
export const brandRuleSchema = z.strictObject({
  text: z.string().trim().min(3).max(400),
  strength: z.enum(BRAND_RULE_STRENGTHS),
});
export type BrandRule = z.infer<typeof brandRuleSchema>;

/** Lower-cased on the way in, so two spellings of one colour compare equal. */
export const hexColorSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^#[0-9a-f]{6}$/, "A colour is a six-digit hex value, like #c8102e.");

/**
 * Absent slots stay absent. A brand with one colour has one colour, and
 * inventing a secondary would put a colour nobody chose onto their artwork.
 */
export const brandPaletteSchema = z.strictObject({
  primary: hexColorSchema.optional(),
  secondary: hexColorSchema.optional(),
  tertiary: hexColorSchema.optional(),
});
export type BrandPalette = z.infer<typeof brandPaletteSchema>;

export const brandGuidelinesSchema = z.strictObject({
  palette: brandPaletteSchema,
  rules: z.array(brandRuleSchema).max(120),
  restrictedTerms: z.array(z.string().trim().min(1).max(80)).max(200),
});
export type BrandGuidelines = z.infer<typeof brandGuidelinesSchema>;

/**
 * The two lists the generation context already takes.
 *
 * Order is preserved within each list, so an operator reading the rendered
 * prompt sees their rules in the order they wrote them rather than in an order
 * this function chose.
 */
export function splitRulesByStrength(rules: readonly BrandRule[]): {
  hardConstraints: string[];
  softConventions: string[];
} {
  const hardConstraints: string[] = [];
  const softConventions: string[] = [];
  for (const rule of rules) {
    if (rule.strength === "hard") hardConstraints.push(rule.text);
    else softConventions.push(rule.text);
  }
  return { hardConstraints, softConventions };
}
