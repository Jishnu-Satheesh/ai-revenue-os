import { resolveLogoForTheme, type BrandLogoSelection } from "@/domain/brand/logo";

/**
 * The logo the platform may actually draw.
 *
 * A pointer that resolves is not the same as a mark that is still good, and
 * this is the difference. Three things have to hold before bytes go on screen:
 *
 * 1. The version is still in the library, which lists only versions the server
 *    decoded, re-encoded and hashed. A pointer with no match is one whose bytes
 *    were never validated or that has since been archived.
 * 2. Its latest review is not a rejection. Only the latest decides — an image
 *    rejected once and approved since is usable again, and treating any
 *    historical rejection as permanent would strand it.
 * 3. Its preview actually signed. A signing failure costs the logo and nothing
 *    else.
 *
 * This is the TypeScript half of the rule `load_campaign_creation_facts`
 * applies in SQL when it names `canonicalLogoVersionId`. They must agree: a
 * mark the platform refuses to display must not be one it hands an image model.
 */

export type DisplayLogo = { url: string; label: string };

export type DisplayableVersion = {
  brandAssetVersionId: string;
  label: string;
  storagePath: string;
  archivedAt: string | null;
  currentVerdict: "approved" | "rejected" | null;
};

export function resolveDisplayLogo(input: {
  logos: readonly BrandLogoSelection[];
  versions: readonly DisplayableVersion[];
  signedUrls: Readonly<Record<string, string>>;
  theme?: "light" | "dark";
}): DisplayLogo | null {
  const selection = resolveLogoForTheme(input.logos, input.theme ?? "light");
  if (!selection) return null;

  const version = input.versions.find(
    (entry) => entry.brandAssetVersionId === selection.brandAssetVersionId,
  );
  if (!version) return null;
  if (version.archivedAt !== null) return null;
  if (version.currentVerdict === "rejected") return null;

  const url = input.signedUrls[version.storagePath];
  return url ? { url, label: version.label } : null;
}
