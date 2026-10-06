/**
 * Short-lived links to the artwork a bundle version carries.
 *
 * The bucket is private, and it stays private. An operator being asked to
 * attest that an image tells the truth has to actually see it, so the server
 * mints a signed URL per asset for that page load and nothing longer. A public
 * bucket would make every campaign image in every organization readable by
 * anyone who learned the path, which is a strange price to pay for a preview.
 */

const PREVIEW_BUCKET = "campaign-assets";

/**
 * Long enough to read a proposal properly, short enough that a link pasted
 * into a chat is dead by the time anyone follows it.
 */
const PREVIEW_TTL_SECONDS = 600;

export type AssetPathReader = {
  from(table: "campaign_assets"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        eq(
          column: string,
          value: string,
        ): Promise<{ data: { asset_key: string; storage_path: string }[] | null; error: unknown }>;
      };
    };
  };
};

export type SignedUrlSource = {
  storage: {
    from(bucket: string): {
      createSignedUrls(
        paths: string[],
        expiresIn: number,
      ): Promise<{
        data: { path: string | null; signedUrl: string }[] | null;
        error: unknown;
      }>;
    };
  };
};

/**
 * Preview URLs keyed by the manifest's asset id.
 *
 * A failure here returns an empty map rather than throwing. The proposal is
 * still reviewable without its pictures — the copy, schedule, spend and
 * measurement are all still there — and a page that refuses to render at all
 * because a thumbnail could not be signed is worse than one that shows the
 * artwork is unavailable.
 */
/**
 * Where each asset's bytes live, keyed by the manifest's asset id.
 *
 * A version created by editing copy carries exactly the images the version it
 * was edited from carried, and those paths come from the database rather than
 * from whoever made the request.
 */
export async function readAssetStoragePaths(
  database: AssetPathReader,
  input: { organizationId: string; bundleVersionId: string },
): Promise<Record<string, string>> {
  const { data, error } = await database
    .from("campaign_assets")
    .select("asset_key,storage_path")
    .eq("organization_id", input.organizationId)
    .eq("bundle_version_id", input.bundleVersionId);

  if (error || !data) return {};

  return Object.fromEntries(data.map((row) => [row.asset_key, row.storage_path]));
}

export async function readAssetPreviewUrls(
  database: AssetPathReader,
  storage: SignedUrlSource,
  input: { organizationId: string; bundleVersionId: string },
): Promise<Readonly<Record<string, string>>> {
  const { data, error } = await database
    .from("campaign_assets")
    .select("asset_key,storage_path")
    .eq("organization_id", input.organizationId)
    .eq("bundle_version_id", input.bundleVersionId);

  if (error || !data || data.length === 0) return {};

  const byPath = new Map(data.map((row) => [row.storage_path, row.asset_key]));
  const { data: signed, error: signError } = await storage.storage
    .from(PREVIEW_BUCKET)
    .createSignedUrls([...byPath.keys()], PREVIEW_TTL_SECONDS);

  if (signError || !signed) return {};

  const urls: Record<string, string> = {};
  for (const entry of signed) {
    // A per-path failure comes back as a row with no path rather than an
    // error, so one unsignable asset costs its own preview and no more.
    const assetId = entry.path === null ? undefined : byPath.get(entry.path);
    if (assetId && entry.signedUrl) urls[assetId] = entry.signedUrl;
  }
  return urls;
}

/**
 * One preview per bundle version, for the portfolio.
 *
 * Batched deliberately. Signing per campaign would mean two round trips for
 * every card on the page, and the usual fix for that — caching the signed
 * links — is exactly what must not happen to a short-lived credential for a
 * private bucket.
 *
 * A version whose asset cannot be signed simply has no preview. The portfolio
 * renders that as "preview unavailable" rather than as an empty frame, so a
 * signing failure never passes for a campaign with no artwork.
 */
export async function readListPreviewUrls(
  database: ListAssetPathReader,
  storage: SignedUrlSource,
  input: { organizationId: string; bundleVersionIds: readonly string[] },
): Promise<Readonly<Record<string, string>>> {
  const ids = [...new Set(input.bundleVersionIds)];
  if (ids.length === 0) return {};

  const { data, error } = await database
    .from("campaign_assets")
    .select("bundle_version_id,asset_key,storage_path")
    .eq("organization_id", input.organizationId)
    .in("bundle_version_id", [...ids]);

  if (error || !data || data.length === 0) return {};

  // The first asset of each version, by a stable key order, so the same
  // campaign shows the same picture on every render.
  const firstByVersion = new Map<string, string>();
  for (const row of [...data].sort((a, b) => a.asset_key.localeCompare(b.asset_key))) {
    if (!firstByVersion.has(row.bundle_version_id)) {
      firstByVersion.set(row.bundle_version_id, row.storage_path);
    }
  }

  const versionByPath = new Map(
    [...firstByVersion].map(([versionId, path]) => [path, versionId]),
  );

  const { data: signed, error: signError } = await storage.storage
    .from(PREVIEW_BUCKET)
    .createSignedUrls([...versionByPath.keys()], PREVIEW_TTL_SECONDS);

  if (signError || !signed) return {};

  const urls: Record<string, string> = {};
  for (const entry of signed) {
    const versionId = entry.path === null ? undefined : versionByPath.get(entry.path);
    if (versionId && entry.signedUrl) urls[versionId] = entry.signedUrl;
  }
  return urls;
}

/** The narrow read the portfolio needs: many versions at once. */
export type ListAssetPathReader = {
  from(table: "campaign_assets"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): {
        in(
          column: string,
          values: string[],
        ): Promise<{
          data: { bundle_version_id: string; asset_key: string; storage_path: string }[] | null;
          error: unknown;
        }>;
      };
    };
  };
};
