import { z } from "zod";

import { CAMPAIGN_STATES } from "@/domain/campaigns/state-machine";
import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type {
  BundleVersionDetail,
  CampaignReadPort as SharedCampaignReadPort,
  CampaignSummary,
  GenerationRunSnapshot,
} from "@/modules/campaigns/application/ports";
import type {
  CampaignHomeRecord,
  PrivatePreviewImage,
} from "@/modules/campaigns/application/home-preview-types";
import { toCampaignListItem } from "@/modules/campaigns/application/studio-view";
import {
  signHomePreviewImages,
  type HomePreviewStorage,
} from "@/modules/campaigns/infrastructure/home-preview-storage";

/**
 * Three campaigns for the organization home, each with its chosen cover.
 *
 * This is not the Studio portfolio: `readCampaignList` loads every campaign
 * and every version list, which is honest for a portfolio and wasteful for a
 * three-item preview. This reader instead takes the three most recently
 * updated campaign ids first, then reads each campaign, its single newest
 * version row, and at most one cover candidate — all bounded before execution,
 * so the cost never grows with the organization's history.
 */

/**
 * The individual-record reads this recipe needs. Reuses the shared session
 * repository types; the unbounded `listCampaigns`/`listVersions` are
 * deliberately not part of this port.
 */
export type CampaignReadPort = Pick<
  SharedCampaignReadPort,
  "getCampaign" | "getVersion" | "latestGenerationRun"
>;

export type HomeCampaignTable =
  | "campaigns"
  | "campaign_bundle_versions"
  | "campaign_poster_renders"
  | "campaign_assets"
  | "creative_asset_reviews";

export type HomeCampaignQueryResult = {
  data: readonly Record<string, unknown>[] | null;
  error: unknown;
};

/**
 * The structural query surface the recipe needs: filter, order, and bound
 * before execution. Chain results are thenable `{ data, error }`, matching
 * the session client's read path; no mutation or service-role capability
 * belongs here.
 */
export type HomeCampaignQuery = PromiseLike<HomeCampaignQueryResult> & {
  eq(column: string, value: string): HomeCampaignQuery;
  order(column: string, options: { ascending: boolean }): HomeCampaignQuery;
  limit(count: number): HomeCampaignQuery;
  is(column: string, value: null): HomeCampaignQuery;
  not(column: string, operator: string, value: unknown): HomeCampaignQuery;
};

export type HomeCampaignPersistence = {
  from(table: HomeCampaignTable): { select(columns: string): HomeCampaignQuery };
};

export type ReadHomeCampaignsInput = {
  database: HomeCampaignPersistence;
  read: CampaignReadPort;
  storage: HomePreviewStorage;
  organizationId: string;
  now: string;
  correlationId: string;
  /** False keeps every campaign's text while skipping all artwork reads. */
  canReadArtwork: boolean;
};

/** How many campaigns the home preview may show. */
const HOME_CAMPAIGN_LIMIT = 3;

const uuidSchema = z.string().uuid();

const campaignIdRowSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
});

const versionRowSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  campaign_id: uuidSchema,
});

const posterRowSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  campaign_id: uuidSchema,
  bundle_version_id: uuidSchema,
  output_storage_path: z.string().min(1).max(1024),
  output_width_px: z.number().int().positive(),
  output_height_px: z.number().int().positive(),
});

const assetRowSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  bundle_version_id: uuidSchema,
  asset_key: uuidSchema,
  storage_path: z.string().min(1).max(1024),
  width_px: z.number().int().positive(),
  height_px: z.number().int().positive(),
  mime_type: z.string(),
  created_at: z.string(),
});

const reviewRowSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  subject_id: uuidSchema,
  subject_kind: z.string(),
  verdict: z.enum(["approved", "rejected"]),
  reviewed_at: z.string(),
});

/**
 * A campaign-source failure: the loader settles the whole Campaign section
 * from this. One indistinguishable message — whether a row vanished, a policy
 * refused, or a tenant leaked into the selection is not something the caller
 * can act on, and saying which would confirm another tenant's data exists.
 */
function campaignSourceFailure(context: {
  organizationId?: string;
  correlationId: string;
  campaignId?: string;
  code: string;
}): never {
  logger.error("organization_home.preview_failed", {
    organizationId: context.organizationId,
    correlationId: context.correlationId,
    campaignId: context.campaignId,
    errorCode: `campaigns:${context.code}`,
  });
  throw new DomainError("DOMAIN_ERROR", "The campaign preview could not be loaded.");
}

/** A cover failure: safe log, null cover, and the campaign text stays ready. */
function coverFailure(context: {
  organizationId: string;
  correlationId: string;
  campaignId: string;
  code: string;
}): null {
  logger.error("organization_home.preview_failed", {
    organizationId: context.organizationId,
    correlationId: context.correlationId,
    campaignId: context.campaignId,
    errorCode: `campaigns:${context.code}`,
  });
  return null;
}

type CoverResult = {
  image: PrivatePreviewImage;
  label: "Finished render" | "Campaign image";
} | null;

async function signCover(input: {
  storage: HomePreviewStorage;
  organizationId: string;
  now: string;
  correlationId: string;
  recordId: string;
  path: string;
  alt: string;
  width: number;
  height: number;
}): Promise<PrivatePreviewImage | null> {
  const signed = await signHomePreviewImages({
    storage: input.storage,
    organizationId: input.organizationId,
    bucket: "campaign-assets",
    images: [
      {
        id: input.recordId,
        path: input.path,
        alt: input.alt,
        width: input.width,
        height: input.height,
      },
    ],
    now: input.now,
    correlationId: input.correlationId,
  });
  return signed[input.recordId] ?? null;
}

/**
 * One cover for the selected version, or null when none can be shown.
 *
 * A finished render wins and is labelled as one. Only with no qualifying
 * render does the newest generated asset get a look, and only its latest
 * review counts: a rejection means no cover, full stop — older assets are
 * never retried after one is refused. Any query or signing trouble degrades
 * to a null cover; the campaign's text was already validated and stays.
 */
async function readVersionCover(input: {
  database: HomeCampaignPersistence;
  storage: HomePreviewStorage;
  organizationId: string;
  now: string;
  correlationId: string;
  campaign: CampaignSummary;
  versionId: string;
}): Promise<CoverResult> {
  const { database, storage, organizationId, now, correlationId, campaign, versionId } = input;
  const coverContext = { organizationId, correlationId, campaignId: campaign.id };

  let posterRows: readonly Record<string, unknown>[];
  try {
    const { data, error } = await database
      .from("campaign_poster_renders")
      .select(
        "id,organization_id,campaign_id,bundle_version_id,output_storage_path,output_width_px,output_height_px,rendered_at",
      )
      .eq("organization_id", organizationId)
      .eq("campaign_id", campaign.id)
      .eq("bundle_version_id", versionId)
      .eq("state", "rendered")
      .not("output_storage_path", "is", null)
      .order("rendered_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (error || !data) return coverFailure({ ...coverContext, code: "poster_unavailable" });
    posterRows = data;
  } catch {
    return coverFailure({ ...coverContext, code: "poster_unavailable" });
  }

  const [posterRow] = posterRows;
  if (posterRow) {
    const parsed = posterRowSchema.safeParse(posterRow);
    if (
      parsed.success &&
      parsed.data.organization_id === organizationId &&
      parsed.data.campaign_id === campaign.id &&
      parsed.data.bundle_version_id === versionId
    ) {
      const image = await signCover({
        storage,
        organizationId,
        now,
        correlationId,
        recordId: parsed.data.id,
        path: parsed.data.output_storage_path,
        alt: campaign.title,
        width: parsed.data.output_width_px,
        height: parsed.data.output_height_px,
      });
      if (image) return { image, label: "Finished render" };
      return coverFailure({ ...coverContext, code: "poster_sign_unavailable" });
    }
    // Not the selected version's render: no qualifying poster row, so the
    // generated asset below still gets its look. The row itself is never used.
  }

  let assetRows: readonly Record<string, unknown>[];
  try {
    const { data, error } = await database
      .from("campaign_assets")
      .select(
        "id,organization_id,bundle_version_id,asset_key,storage_path,width_px,height_px,mime_type,created_at",
      )
      .eq("organization_id", organizationId)
      .eq("bundle_version_id", versionId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (error || !data) return coverFailure({ ...coverContext, code: "asset_unavailable" });
    assetRows = data;
  } catch {
    return coverFailure({ ...coverContext, code: "asset_unavailable" });
  }

  const [assetRow] = assetRows;
  // No generated image is ordinary, not a failure: nothing to log.
  if (!assetRow) return null;
  const asset = assetRowSchema.safeParse(assetRow);
  if (
    !asset.success ||
    asset.data.organization_id !== organizationId ||
    asset.data.bundle_version_id !== versionId
  ) {
    return coverFailure({ ...coverContext, code: "asset_unavailable" });
  }

  let reviewRows: readonly Record<string, unknown>[];
  try {
    const { data, error } = await database
      .from("creative_asset_reviews")
      .select("id,organization_id,subject_id,subject_kind,verdict,reviewed_at")
      .eq("organization_id", organizationId)
      .eq("subject_id", asset.data.id)
      .eq("subject_kind", "campaign_asset")
      .order("reviewed_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (error || !data) return coverFailure({ ...coverContext, code: "review_unavailable" });
    reviewRows = data;
  } catch {
    return coverFailure({ ...coverContext, code: "review_unavailable" });
  }

  const [reviewRow] = reviewRows;
  if (reviewRow) {
    const review = reviewRowSchema.safeParse(reviewRow);
    if (
      !review.success ||
      review.data.organization_id !== organizationId ||
      review.data.subject_id !== asset.data.id ||
      review.data.subject_kind !== "campaign_asset"
    ) {
      return coverFailure({ ...coverContext, code: "review_unavailable" });
    }
    // A rejection is a verdict, not an error: no cover, and no retry with an
    // older asset that the reviewer never cleared.
    if (review.data.verdict === "rejected") return null;
  }

  const image = await signCover({
    storage,
    organizationId,
    now,
    correlationId,
    recordId: asset.data.id,
    path: asset.data.storage_path,
    alt: campaign.title,
    width: asset.data.width_px,
    height: asset.data.height_px,
  });
  if (!image) return coverFailure({ ...coverContext, code: "asset_sign_unavailable" });
  return { image, label: "Campaign image" };
}

export async function readHomeCampaigns(
  input: ReadHomeCampaignsInput,
): Promise<readonly CampaignHomeRecord[]> {
  const { database, read, storage, organizationId, now, correlationId, canReadArtwork } = input;

  if (!uuidSchema.safeParse(organizationId).success) {
    campaignSourceFailure({ correlationId, code: "invalid_organization" });
  }

  let idRows: readonly Record<string, unknown>[];
  try {
    const { data, error } = await database
      .from("campaigns")
      .select("id,organization_id")
      .eq("organization_id", organizationId)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HOME_CAMPAIGN_LIMIT);
    if (error || !data)
      campaignSourceFailure({ organizationId, correlationId, code: "ids_unavailable" });
    idRows = data;
  } catch (cause) {
    if (cause instanceof DomainError) throw cause;
    campaignSourceFailure({ organizationId, correlationId, code: "ids_unavailable" });
  }

  const records: CampaignHomeRecord[] = [];
  for (const row of idRows.slice(0, HOME_CAMPAIGN_LIMIT)) {
    const parsed = campaignIdRowSchema.safeParse(row);
    // A cross-tenant or malformed row in the selection is corruption, not a
    // gap to skip past: failing loudly keeps it visible instead of silently
    // dropping one tenant's campaign from another tenant's home.
    if (!parsed.success || parsed.data.organization_id !== organizationId) {
      campaignSourceFailure({ organizationId, correlationId, code: "invalid_campaign_row" });
    }
    const campaignId = parsed.data.id;

    const campaign = await read.getCampaign(organizationId, campaignId);
    if (!campaign || campaign.organizationId !== organizationId) {
      campaignSourceFailure({
        organizationId,
        correlationId,
        campaignId,
        code: "campaign_unavailable",
      });
    }
    if (!(CAMPAIGN_STATES as readonly string[]).includes(campaign.state)) {
      campaignSourceFailure({ organizationId, correlationId, campaignId, code: "unknown_state" });
    }

    let versionRows: readonly Record<string, unknown>[];
    try {
      const { data, error } = await database
        .from("campaign_bundle_versions")
        .select("id,organization_id,campaign_id")
        .eq("organization_id", organizationId)
        .eq("campaign_id", campaignId)
        .order("version", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (error || !data) {
        campaignSourceFailure({
          organizationId,
          correlationId,
          campaignId,
          code: "version_unavailable",
        });
      }
      versionRows = data;
    } catch (cause) {
      if (cause instanceof DomainError) throw cause;
      campaignSourceFailure({
        organizationId,
        correlationId,
        campaignId,
        code: "version_unavailable",
      });
    }

    let latest: BundleVersionDetail | null = null;
    // Only the generation state explains a campaign with no proposal. A
    // settled campaign's run history is not what this preview is for.
    let run: GenerationRunSnapshot | null = null;
    if (versionRows.length === 0) {
      run = await read.latestGenerationRun(organizationId, campaignId);
    } else {
      const versionRef = versionRowSchema.safeParse(versionRows[0]);
      if (
        !versionRef.success ||
        versionRef.data.organization_id !== organizationId ||
        versionRef.data.campaign_id !== campaignId
      ) {
        campaignSourceFailure({
          organizationId,
          correlationId,
          campaignId,
          code: "invalid_version_row",
        });
      }
      const version = await read.getVersion(organizationId, versionRef.data.id);
      // A version id is a lookup key, not proof of belonging: it is checked
      // against this campaign rather than trusted.
      if (!version || version.campaignId !== campaignId) {
        campaignSourceFailure({
          organizationId,
          correlationId,
          campaignId,
          code: "version_unavailable",
        });
      }
      latest = version;
    }

    const item = toCampaignListItem(campaign, latest, run, now);

    let cover: PrivatePreviewImage | null = null;
    let coverLabel: CampaignHomeRecord["coverLabel"] = null;
    // Without artwork permission the text stands on its own: no cover
    // metadata, review, or signing call is made at all.
    if (canReadArtwork && latest) {
      const chosen = await readVersionCover({
        database,
        storage,
        organizationId,
        now,
        correlationId,
        campaign,
        versionId: latest.id,
      });
      if (chosen) {
        cover = chosen.image;
        coverLabel = chosen.label;
      }
    }

    records.push({ item, cover, coverLabel });
  }

  return records;
}
