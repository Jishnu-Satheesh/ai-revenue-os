import { z } from "zod";

import { bundleDigest } from "@/domain/campaigns/digest";
import { campaignBundleManifestSchema } from "@/domain/campaigns/schemas";
import type { CampaignVersionWriterPort } from "@/modules/campaigns/application/ports";
import type { EditedVersionWriter } from "@/workflows/campaigns/edit-plate";

/**
 * The successor version an edit produces.
 *
 * An edited plate is a different thing to publish, so it is a new version with
 * a new digest rather than a substitution into the old one -- assets are
 * material by this repository's own rule, and `create_campaign_bundle_version`
 * revokes any approval against the parent as it writes.
 *
 * This is the only way an asset can reach `campaign_assets`: that function is
 * the table's sole writer anywhere in the schema. So an edit cannot append a
 * row to an existing version even in principle, which is why editing in place
 * is not merely discouraged here but unavailable.
 *
 * **Why the asset id is read back.** The manifest identifies assets by a stable
 * key that survives every version; `campaign_assets` gives each version's copy
 * its own row id, and `campaign_plate_edits.child_plate_asset_id` points at the
 * row, not the key. Returning the key would satisfy the type and violate the
 * foreign key at the next step.
 */

type Row = Record<string, unknown>;

type Awaitable = PromiseLike<{ data: Row[] | null; error: unknown }>;

export type EditedVersionPersistence = {
  from(table: "campaign_bundle_versions" | "campaign_assets"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): { eq(column: string, value: string): Awaitable } & Awaitable;
    };
  };
};

const parentSchema = z.object({
  id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  source_snapshot_id: z.string().uuid(),
  manifest: campaignBundleManifestSchema,
});

const assetRowSchema = z.object({ id: z.string().uuid(), asset_key: z.string().uuid() });

export function createEditedVersionWriter(
  persistence: EditedVersionPersistence,
  versions: CampaignVersionWriterPort,
): EditedVersionWriter {
  return {
    async create(input) {
      const { data: parents, error: parentError } = await persistence
        .from("campaign_bundle_versions")
        .select("id, campaign_id, source_snapshot_id, manifest")
        .eq("organization_id", input.organizationId)
        .eq("id", input.parentBundleVersionId);
      if (parentError) return null;

      const parent = parentSchema.safeParse((parents ?? [])[0]);
      if (!parent.success || parent.data.campaign_id !== input.campaignId) return null;

      const { data: assets, error: assetError } = await persistence
        .from("campaign_assets")
        .select("id, asset_key, storage_path")
        .eq("organization_id", input.organizationId)
        .eq("bundle_version_id", input.parentBundleVersionId);
      if (assetError) return null;

      const rows = assets ?? [];
      const replacing = rows.find((row) => row.id === input.replacingAssetId);
      // The row id in the payload has to name an asset of this very version.
      if (!replacing || typeof replacing.asset_key !== "string") return null;
      const editedKey = replacing.asset_key;

      const storagePaths: Record<string, string> = {};
      for (const row of rows) {
        const parsed = assetRowSchema.safeParse(row);
        if (!parsed.success || typeof row.storage_path !== "string") return null;
        storagePaths[parsed.data.asset_key] = row.storage_path;
      }
      storagePaths[editedKey] = input.storagePath;

      const manifest = campaignBundleManifestSchema.parse({
        ...parent.data.manifest,
        version: parent.data.manifest.version + 1,
        assets: parent.data.manifest.assets.map((asset) =>
          asset.id === editedKey
            ? {
                ...asset,
                contentHash: input.contentHash,
                widthPx: input.widthPx,
                heightPx: input.heightPx,
                /**
                 * Provenance is carried over unchanged, and that is a known
                 * gap rather than an oversight. The manifest can say a model
                 * generated an image or that the brand supplied one; it has no
                 * way to say a model edited one under a mask. Recording the
                 * edit model here would overwrite which model produced the
                 * original, which is worse than leaving it.
                 *
                 * The full account lives in `campaign_plate_edits`: parent,
                 * child, mask hash, coverage, annotations, model and cost. A
                 * provenance kind for an edit is a manifest schema change with
                 * digest and approval consequences, so it belongs to its own
                 * decision rather than to this writer.
                 */
              }
            : asset,
        ),
      });

      const digest = bundleDigest(manifest);

      const result = await versions.createVersion({
        organizationId: input.organizationId,
        campaignId: input.campaignId,
        sourceSnapshotId: parent.data.source_snapshot_id,
        digest,
        manifest,
        assetStoragePaths: storagePaths,
      });

      // The new version's own row for the edited key. Read back rather than
      // derived: the row id is assigned by the insert inside the function.
      const { data: created, error: createdError } = await persistence
        .from("campaign_assets")
        .select("id, asset_key")
        .eq("organization_id", input.organizationId)
        .eq("bundle_version_id", result.bundleVersionId);
      if (createdError) return null;

      const child = (created ?? [])
        .map((row) => assetRowSchema.safeParse(row))
        .find((parsed) => parsed.success && parsed.data.asset_key === editedKey);
      if (!child || !child.success) return null;

      return { bundleVersionId: result.bundleVersionId, assetId: child.data.id };
    },
  };
}
