import { z } from "zod";

import { brandGuidelinesSchema } from "@/domain/brand/guidelines";
import { brandLogoSelectionSchema } from "@/domain/brand/logo";

/**
 * The body of a brand identity save.
 *
 * Its own file rather than `route.ts`, because a Next route module may export
 * only route handlers — a violation there typechecks fine until `.next/dev`
 * types exist, which is how one shipped in this repository once already.
 *
 * At least one of the two must be present. An empty body would return a
 * cheerful 200 having written nothing, which an operator reads as a saved
 * change.
 */
export const brandRequestSchema = z
  .strictObject({
    guidelines: brandGuidelinesSchema.optional(),
    logo: brandLogoSelectionSchema.optional(),
  })
  .refine(
    (body) => body.guidelines !== undefined || body.logo !== undefined,
    "Supply brand guidelines, a logo, or both.",
  );
export type BrandRequest = z.infer<typeof brandRequestSchema>;
