import { brandGuidelinesSchema, type BrandGuidelines } from "@/domain/brand/guidelines";
import { brandLogoSelectionSchema, type BrandLogoSelection } from "@/domain/brand/logo";
import { DomainError } from "@/lib/errors";
import type { BrandIdentityPorts } from "@/modules/brand/application/brand-identity-service";

/**
 * The database side of an organization's brand identity.
 *
 * Every call uses the caller's own session. There is no service-role path
 * here: forced RLS decides what may be read, the `brand.manage` policy decides
 * what may be written, and the composite foreign key on the logo pointer means
 * a cross-tenant reference fails in Postgres rather than relying on this layer
 * to have checked.
 */

type Filtered = {
  /** Chained, so a row can be narrowed by tenant *and* by its own id. */
  eq(column: string, value: string): Filtered;
  maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: unknown }>;
} & PromiseLike<{ data: Record<string, unknown>[] | null; error: unknown }>;

export type BrandIdentityPersistence = {
  from(table: string): {
    select(columns: string): Filtered;
    upsert(row: Record<string, unknown>): Promise<{ error: unknown }>;
  };
};


/** A brand that has set nothing has nothing. Not an error, and not a default. */
function noGuidelines(): BrandGuidelines {
  return { palette: {}, rules: [], restrictedTerms: [] };
}

export function createBrandIdentityAdapter(input: {
  persistence: BrandIdentityPersistence;
  organizationId: string;
  userId: string;
}): BrandIdentityPorts {
  const { persistence, organizationId, userId } = input;

  return {
    async readGuidelines() {
      const { data, error } = await persistence
        .from("organization_brand_guidelines")
        .select("palette, rules, restricted_terms")
        .eq("organization_id", organizationId)
        .maybeSingle();
      if (error) throw new DomainError("DOMAIN_ERROR", "The brand guidelines could not be read.");
      // An organization that has never set any has none, which is a real
      // answer. Absent is not an error and must not render as one.
      if (!data) return noGuidelines();

      const parsed = brandGuidelinesSchema.safeParse({
        palette: data.palette ?? {},
        rules: data.rules ?? [],
        restrictedTerms: data.restricted_terms ?? [],
      });
      // A stored row this build cannot parse is reported, never silently
      // downgraded to "no rules" — that would tell an operator their brand has
      // no constraints while generation was refusing on ones it could read.
      if (!parsed.success) {
        throw new DomainError("DOMAIN_ERROR", "The stored brand guidelines could not be read.");
      }
      return parsed.data;
    },

    async writeGuidelines(guidelines) {
      const { error } = await persistence.from("organization_brand_guidelines").upsert({
        organization_id: organizationId,
        palette: guidelines.palette,
        rules: guidelines.rules,
        restricted_terms: guidelines.restrictedTerms,
        updated_by: userId,
      });
      if (error) throw new DomainError("DOMAIN_ERROR", "The brand guidelines could not be saved.");
    },

    async readLogos() {
      const { data, error } = await persistence
        .from("organization_brand_logos")
        .select("variant, brand_asset_version_id")
        .eq("organization_id", organizationId);
      if (error) throw new DomainError("DOMAIN_ERROR", "The brand logo could not be read.");

      // A row that does not parse is dropped rather than failing the read. A
      // variant this build does not know about is not a reason to show the
      // organization no logo at all.
      return (data ?? []).flatMap((row): BrandLogoSelection[] => {
        const parsed = brandLogoSelectionSchema.safeParse({
          variant: row.variant,
          brandAssetVersionId: row.brand_asset_version_id,
        });
        return parsed.success ? [parsed.data] : [];
      });
    },

    async setLogo(selection) {
      const { error } = await persistence.from("organization_brand_logos").upsert({
        organization_id: organizationId,
        variant: selection.variant,
        brand_asset_version_id: selection.brandAssetVersionId,
        set_by: userId,
      });
      if (error) throw new DomainError("DOMAIN_ERROR", "The brand logo could not be saved.");
    },

    async isVersionUsable(brandAssetVersionId) {
      const { data, error } = await persistence
        .from("organization_brand_asset_versions")
        .select("is_usable")
        // Both filters matter. The tenant stops a pointer at another
        // organization's image; the id is the whole question being asked.
        .eq("organization_id", organizationId)
        .eq("id", brandAssetVersionId)
        .maybeSingle();
      // A read that failed is not evidence the image is fine. Refusing on
      // error keeps the safe direction: no logo rather than an unchecked one.
      if (error) return false;
      return data?.is_usable === true;
    },
  };
}
