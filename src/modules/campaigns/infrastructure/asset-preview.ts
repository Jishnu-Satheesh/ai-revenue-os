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
