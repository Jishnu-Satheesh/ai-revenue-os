import { z } from "zod";

import { assetTruthClassSchema, type CampaignAssetTruthClass } from "@/domain/campaigns/schemas";

/**
 * What the platform drew, grouped the way an operator looks for it.
 *
 * An operator does not think "show me asset `a0dd1ef4`". They think "what did
 * we make for the Onam campaign, and which round was that". So the shape here
 * is campaign, then bundle version, then images — which is also the order the
 * provenance runs in.
 *
 * This is a session-scoped read. It uses the caller's own client, so RLS
 * decides what is visible; there is no service-role read on this path. The
 * organization filter is belt-and-braces on top of that, and a row that comes
 * back for the wrong tenant is treated as corruption rather than filtered out
 * quietly.
 */

const assetRowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  bundle_version_id: z.string().uuid(),
  storage_path: z.string().min(1),
  mime_type: z.string().min(1),
  width_px: z.number().int().positive(),
  height_px: z.number().int().positive(),
  truth_class: assetTruthClassSchema,
  alt_text: z.string().nullable(),
  created_at: z.string().min(1),
});

const versionRowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  campaign_id: z.string().uuid(),
  version: z.number().int().positive(),
  created_at: z.string().min(1),
});

const campaignRowSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  title: z.string().min(1),
});

export type CampaignOutputImage = {
  id: string;
  storagePath: string;
  mimeType: string;
  widthPx: number;
  heightPx: number;
  truthClass: CampaignAssetTruthClass;
  altText: string | null;
};

export type CampaignOutputVersion = {
  bundleVersionId: string;
  version: number;
  createdAt: string;
  images: readonly CampaignOutputImage[];
};

export type CampaignOutputGroup = {
  campaignId: string;
  title: string;
  versions: readonly CampaignOutputVersion[];
};

type QueryResult = { data: unknown; error: unknown };

export type CampaignOutputPersistence = {
  from(table: "campaign_assets" | "campaign_bundle_versions" | "campaigns"): {
    select(columns: string): {
      eq(
        column: string,
        value: string,
      ): PromiseLike<QueryResult> & {
        order(column: string, options: { ascending: boolean }): PromiseLike<QueryResult>;
      };
    };
  };
};

function readError(): never {
  throw new Error("The campaign output could not be read.");
}

function parseRows<T>(schema: z.ZodType<T>, value: unknown, organizationId: string): T[] {
  if (!Array.isArray(value)) readError();
  const parsed = z.array(schema).safeParse(value);
  if (!parsed.success) readError();
  if (
    parsed.data.some(
      (row) => (row as { organization_id: string }).organization_id !== organizationId,
    )
  ) {
    readError();
  }
  return parsed.data;
}

export async function readCampaignOutput(
  persistence: CampaignOutputPersistence,
  organizationId: string,
): Promise<readonly CampaignOutputGroup[]> {
  const [assetsResult, versionsResult, campaignsResult] = await Promise.all([
    persistence
      .from("campaign_assets")
      .select(
        "id, organization_id, bundle_version_id, storage_path, mime_type, width_px, height_px, truth_class, alt_text, created_at",
      )
      .eq("organization_id", organizationId),
    persistence
      .from("campaign_bundle_versions")
      .select("id, organization_id, campaign_id, version, created_at")
      .eq("organization_id", organizationId),
    persistence
      .from("campaigns")
      .select("id, organization_id, title")
      .eq("organization_id", organizationId),
  ]);
  if (assetsResult.error || versionsResult.error || campaignsResult.error) readError();

  const assets = parseRows(assetRowSchema, assetsResult.data, organizationId);
  const versions = parseRows(versionRowSchema, versionsResult.data, organizationId);
  const campaigns = parseRows(campaignRowSchema, campaignsResult.data, organizationId);

  const imagesByVersion = new Map<string, CampaignOutputImage[]>();
  for (const asset of assets) {
    const held = imagesByVersion.get(asset.bundle_version_id) ?? [];
    held.push({
      id: asset.id,
      storagePath: asset.storage_path,
      mimeType: asset.mime_type,
      widthPx: asset.width_px,
      heightPx: asset.height_px,
      truthClass: asset.truth_class,
      altText: asset.alt_text,
    });
    imagesByVersion.set(asset.bundle_version_id, held);
  }

  const versionsByCampaign = new Map<string, CampaignOutputVersion[]>();
  for (const version of versions) {
    const images = imagesByVersion.get(version.id) ?? [];
    // A bundle version that produced nothing is not output, and listing it
    // would pad the page with rows that have nothing to look at.
    if (images.length === 0) continue;
    const held = versionsByCampaign.get(version.campaign_id) ?? [];
    held.push({
      bundleVersionId: version.id,
      version: version.version,
      createdAt: version.created_at,
      images: images.sort((left, right) => left.id.localeCompare(right.id)),
    });
    versionsByCampaign.set(version.campaign_id, held);
  }

  return campaigns
    .map((campaign) => ({
      campaignId: campaign.id,
      title: campaign.title,
      // Newest round first: the last thing generated is what is being judged.
      versions: (versionsByCampaign.get(campaign.id) ?? []).sort(
        (left, right) => right.version - left.version,
      ),
    }))
    .filter((group) => group.versions.length > 0)
    .sort((left, right) => left.title.localeCompare(right.title));
}
