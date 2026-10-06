import { z } from "zod";

/**
 * Which stored image is this organization's mark.
 *
 * A selection, never an upload. It points at an
 * `organization_brand_asset_versions` row, so the logo has already been
 * sniffed by its leading bytes, decoded, re-encoded server-side and hashed —
 * the platform never shows or transmits logo bytes it did not produce.
 */

export const BRAND_LOGO_VARIANTS = ["primary", "dark"] as const;
export type BrandLogoVariant = (typeof BRAND_LOGO_VARIANTS)[number];

export const brandLogoVariantSchema = z.enum(BRAND_LOGO_VARIANTS);

export const brandLogoSelectionSchema = z.strictObject({
  variant: brandLogoVariantSchema,
  brandAssetVersionId: z.string().uuid(),
});
export type BrandLogoSelection = z.infer<typeof brandLogoSelectionSchema>;

/**
 * The variant to show on a given ground.
 *
 * `dark` is optional and falls back to `primary` rather than recolouring it. A
 * mark redrawn in another colour is not the mark, which is exactly what
 * `brand_mark_distorted` exists to record when a model does it; doing it
 * ourselves would be worse.
 *
 * `primary` is required for any logo to resolve. A brand that has supplied only
 * a dark variant has not told us what its mark normally looks like, and
 * inverting the dark one to find out would be inventing it.
 */
export function resolveLogoForTheme(
  selections: readonly BrandLogoSelection[],
  theme: "light" | "dark",
): BrandLogoSelection | null {
  const primary = selections.find((entry) => entry.variant === "primary") ?? null;
  if (theme === "light") return primary;
  return selections.find((entry) => entry.variant === "dark") ?? primary;
}
