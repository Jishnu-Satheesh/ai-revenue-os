import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import type {
  AssetHomeRecord,
  PrivatePreviewImage,
} from "@/modules/campaigns/application/home-preview-types";
import {
  signHomePreviewImages,
  type HomePreviewStorage,
} from "@/modules/campaigns/infrastructure/home-preview-storage";

/**
 * The bounded gallery reads behind the organization home's creative section.
 *
 * Two sources feed it: finished poster renders (proof a renderer produced
 * output, never raw campaign assets or unfinished Creative History) and brand
 * references (recent parents with their latest usable version and its latest
 * review verdict). A third read resolves the single organization logo. Task 4
 * merges up to four posters plus up to four references by recordedAt DESC,
 * composite id ASC, taking four — these readers return records that already
 * carry comparable recordedAt values and composite ids, so that merge is a
 * pure sort, never another database round trip.
 *
 * Bounds (no query scales with the organization's history): poster rows <= 4,
 * parent ids <= 4 in one `.in` lookup, reference parents <= 4, versions <= 1
 * per parent, reviews <= 1 per selected version, logo probes <= 2. Signing is
 * one batch per bucket before any merge: <= 4 poster images plus <= 4
 * reference images, eight candidate signatures overall.
 */

export type HomeAssetTable =
  | "campaign_poster_renders"
  | "campaigns"
  | "organization_brand_assets"
  | "organization_brand_asset_versions"
  | "creative_asset_reviews";

export type HomeAssetQueryResult = {
  data: readonly Record<string, unknown>[] | null;
  error: unknown;
};

/**
 * The structural query surface the recipes need: filter, order, and bound
 * before execution, plus a bounded `.in` (at most four ids) for the single
 * poster-parent lookup. Chain results are thenable `{ data, error }`,
 * matching the session client's read path; no mutation, no service role, and
 * no table outside HomeAssetTable belongs here — notably never brand_context.
 */
export type HomeAssetQuery = PromiseLike<HomeAssetQueryResult> & {
  eq(column: string, value: string | boolean): HomeAssetQuery;
  in(column: string, values: readonly string[]): HomeAssetQuery;
  order(column: string, options: { ascending: boolean }): HomeAssetQuery;
  limit(count: number): HomeAssetQuery;
  is(column: string, value: null): HomeAssetQuery;
  not(column: string, operator: string, value: unknown): HomeAssetQuery;
};

export type HomeAssetPersistence = {
  from(table: HomeAssetTable): { select(columns: string): HomeAssetQuery };
};

export type ReadHomeAssetsInput = {
  database: HomeAssetPersistence;
  storage: HomePreviewStorage;
  organizationId: string;
  now: string;
  correlationId: string;
};

/** How many finished renders the poster gallery may consider. */
const HOME_POSTER_LIMIT = 4;
/** How many recent brand parents the reference gallery may consider. */
const HOME_REFERENCE_LIMIT = 4;
/** The parent-id bound for the single poster title lookup. */
const HOME_PARENT_ID_BOUND = 4;
/** Two active logos is ambiguity, not a choice: probe two to tell. */
const HOME_LOGO_PROBE_LIMIT = 2;

const uuidSchema = z.string().uuid();

const posterRowSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  campaign_id: uuidSchema,
  bundle_version_id: uuidSchema,
  template_key: z.string().min(1),
  script: z.string().min(1),
  output_storage_path: z.string().min(1).max(1024),
  output_width_px: z.number().int().positive(),
  output_height_px: z.number().int().positive(),
  rendered_at: z.string().min(1),
});

const campaignTitleRowSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  title: z.string(),
});

const brandAssetParentSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  label: z.string(),
  asset_role: z.string().min(1),
  archived_at: z.string().nullable(),
  created_at: z.string().min(1),
});

const brandAssetVersionSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  brand_asset_id: uuidSchema,
  version: z.number(),
  storage_path: z.string().min(1).max(1024),
  mime_type: z.string().min(1),
  width_px: z.number().int().positive(),
  height_px: z.number().int().positive(),
  created_at: z.string().min(1),
});

const creativeReviewSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  subject_id: uuidSchema,
  subject_kind: z.string(),
  verdict: z.enum(["approved", "rejected"]),
  reviewed_at: z.string().min(1),
});

function canonicalUtc(value: string): string {
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? value : new Date(milliseconds).toISOString();
}

function logPreviewFailure(input: {
  organizationId: string;
  correlationId: string;
  source: "posters" | "references" | "logo";
  code: string;
}): void {
  // Safe fields only: identifiers and a bounded code. Never a title, a path,
  // a URL, or the raw persistence error that caused this line.
  logger.error("organization_home.preview_failed", {
    organizationId: input.organizationId,
    correlationId: input.correlationId,
    errorCode: `${input.source}:${input.code}`,
  });
}

/**
 * A source failure: the loader settles the whole gallery source from this.
 * One indistinguishable message — whether a row vanished, a policy refused,
 * or another tenant's row leaked into the selection is not something the
 * caller can act on, and saying which would confirm that data exists.
 */
function posterSourceFailure(input: {
  organizationId?: string;
  correlationId: string;
  code: string;
}): never {
  logPreviewFailure({
    organizationId: input.organizationId ?? "",
    correlationId: input.correlationId,
    source: "posters",
    code: input.code,
  });
  throw new DomainError("DOMAIN_ERROR", "The home gallery could not be loaded.");
}

function referenceSourceFailure(input: {
  organizationId?: string;
  correlationId: string;
  code: string;
}): never {
  logPreviewFailure({
    organizationId: input.organizationId ?? "",
    correlationId: input.correlationId,
    source: "references",
    code: input.code,
  });
  throw new DomainError("DOMAIN_ERROR", "The home gallery could not be loaded.");
}

/** A logo failure is a null logo, never a failed home. */
function logoUnavailable(input: {
  organizationId: string;
  correlationId: string;
  code: string;
}): null {
  logPreviewFailure({ ...input, source: "logo" });
  return null;
}

/**
 * Whether a recorded path stays inside its tenant prefix without dot games.
 * Defense in depth beside Task 2's signer, which enforces the same rule: a
 * path that fails here names another tenant's bytes from a tenant row, which
 * is corruption the loader should see as a failed source, not a blank tile.
 */
function isTenantPath(path: string, organizationId: string): boolean {
  if (!path.startsWith(`${organizationId}/`)) return false;
  return !path
    .split("/")
    .some((segment) => segment === "" || segment === "." || segment === "..");
}

/**
 * Finished poster renders, newest first, with their parent campaign titles.
 *
 * The render's `state="rendered"` is the only verdict that matters here:
 * verification payloads are technical evidence and plate reviews belong to a
 * different subject, so neither is read and the review line always says
 * "Review not recorded". Separate render records stay separate — no dedupe by
 * looks. A poster whose parent campaign is missing or inaccessible is omitted
 * with a safe linkage log; its title and bytes never surface.
 */
export async function readHomePosterAssets(
  input: ReadHomeAssetsInput,
): Promise<readonly AssetHomeRecord[]> {
  const { database, storage, organizationId, now, correlationId } = input;
  const context = { organizationId, correlationId };

  if (!uuidSchema.safeParse(organizationId).success) {
    posterSourceFailure({ correlationId, code: "invalid_organization" });
  }

  let posterRows: readonly Record<string, unknown>[];
  try {
    const { data, error } = await database
      .from("campaign_poster_renders")
      .select(
        "id,organization_id,campaign_id,bundle_version_id,template_key,script,output_storage_path,output_width_px,output_height_px,rendered_at",
      )
      .eq("organization_id", organizationId)
      .eq("state", "rendered")
      .not("output_storage_path", "is", null)
      .order("rendered_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HOME_POSTER_LIMIT);
    if (error || !data) posterSourceFailure({ ...context, code: "posters_unavailable" });
    posterRows = data;
  } catch (cause) {
    if (cause instanceof DomainError) throw cause;
    posterSourceFailure({ ...context, code: "posters_unavailable" });
  }

  const posters: z.infer<typeof posterRowSchema>[] = [];
  for (const row of posterRows.slice(0, HOME_POSTER_LIMIT)) {
    const parsed = posterRowSchema.safeParse(row);
    // A cross-tenant or malformed row in the selection is corruption, not a
    // gap to skip past: failing loudly keeps it visible instead of silently
    // dropping one tenant's render from another tenant's home.
    if (
      !parsed.success ||
      parsed.data.organization_id !== organizationId ||
      !isTenantPath(parsed.data.output_storage_path, organizationId)
    ) {
      posterSourceFailure({ ...context, code: "invalid_poster_row" });
    }
    posters.push(parsed.data);
  }
  if (posters.length === 0) return [];

  const campaignIds = [...new Set(posters.map((poster) => poster.campaign_id))];
  if (campaignIds.length > HOME_PARENT_ID_BOUND) {
    posterSourceFailure({ ...context, code: "parent_bound" });
  }

  let parentRows: readonly Record<string, unknown>[];
  try {
    const { data, error } = await database
      .from("campaigns")
      .select("id,organization_id,title")
      .eq("organization_id", organizationId)
      .in("id", campaignIds);
    if (error || !data) posterSourceFailure({ ...context, code: "parents_unavailable" });
    parentRows = data;
  } catch (cause) {
    if (cause instanceof DomainError) throw cause;
    posterSourceFailure({ ...context, code: "parents_unavailable" });
  }

  const titlesById = new Map<string, string>();
  for (const row of parentRows) {
    const parsed = campaignTitleRowSchema.safeParse(row);
    if (
      !parsed.success ||
      parsed.data.organization_id !== organizationId ||
      !campaignIds.includes(parsed.data.id)
    ) {
      posterSourceFailure({ ...context, code: "invalid_parent_row" });
    }
    titlesById.set(parsed.data.id, parsed.data.title);
  }

  const candidates: {
    record: AssetHomeRecord;
    path: string;
    width: number;
    height: number;
  }[] = [];
  for (const poster of posters) {
    const title = titlesById.get(poster.campaign_id);
    // A missing title is an inaccessible parent, not corruption to fail over:
    // omit the candidate and log the linkage without revealing the row.
    if (!title) {
      logPreviewFailure({ ...context, source: "posters", code: "parent_inaccessible" });
      continue;
    }
    candidates.push({
      record: {
        id: `poster:${poster.id}`,
        sourceKind: "poster_render",
        label: `${title} · ${poster.template_key} · ${poster.script}`,
        sourceLabel: "Finished poster render",
        reviewLabel: "Review not recorded",
        reviewState: "unreviewed",
        recordedAt: canonicalUtc(poster.rendered_at),
        image: null,
        sourceHref: `/organizations/${organizationId}/campaigns/${poster.campaign_id}?version=${poster.bundle_version_id}`,
      },
      path: poster.output_storage_path,
      width: poster.output_width_px,
      height: poster.output_height_px,
    });
  }

  // Storage trouble degrades to ready metadata with a null image: the gallery
  // keeps its text and the section stays ready.
  const signed = await signHomePreviewImages({
    storage,
    organizationId,
    bucket: "campaign-assets",
    images: candidates.map((candidate) => ({
      id: candidate.record.id,
      path: candidate.path,
      alt: candidate.record.label,
      width: candidate.width,
      height: candidate.height,
    })),
    now,
    correlationId,
  }).catch(() => ({} as Readonly<Record<string, PrivatePreviewImage>>));

  return candidates.map((candidate) => ({
    ...candidate.record,
    image: signed[candidate.record.id] ?? null,
  }));
}

type ReferenceCandidate = {
  record: AssetHomeRecord;
  path: string;
  width: number;
  height: number;
};

type LatestVersionRead =
  | { status: "ok"; version: z.infer<typeof brandAssetVersionSchema> }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "corrupt" };

async function readLatestVersion(input: {
  database: HomeAssetPersistence;
  organizationId: string;
  brandAssetId: string;
}): Promise<LatestVersionRead> {
  const { data, error } = await input.database
    .from("organization_brand_asset_versions")
    .select(
      "id,organization_id,brand_asset_id,version,storage_path,mime_type,width_px,height_px,created_at",
    )
    .eq("organization_id", input.organizationId)
    .eq("brand_asset_id", input.brandAssetId)
    .eq("is_usable", true)
    .order("version", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error || !data) return { status: "unavailable" };
  const [row] = data;
  // No usable version is an ordinary omission, never corruption.
  if (!row) return { status: "empty" };
  const parsed = brandAssetVersionSchema.safeParse(row);
  if (
    !parsed.success ||
    parsed.data.organization_id !== input.organizationId ||
    parsed.data.brand_asset_id !== input.brandAssetId ||
    !isTenantPath(parsed.data.storage_path, input.organizationId)
  ) {
    return { status: "corrupt" };
  }
  return { status: "ok", version: parsed.data };
}

async function readLatestReview(input: {
  database: HomeAssetPersistence;
  organizationId: string;
  versionId: string;
}): Promise<z.infer<typeof creativeReviewSchema> | null | "unavailable" | "corrupt"> {
  const { data, error } = await input.database
    .from("creative_asset_reviews")
    .select("id,organization_id,subject_id,subject_kind,verdict,reviewed_at")
    .eq("organization_id", input.organizationId)
    .eq("subject_id", input.versionId)
    .eq("subject_kind", "brand_asset_version")
    .order("reviewed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (error || !data) return "unavailable";
  const [row] = data;
  // No review row is "Unreviewed", never a manufactured verdict.
  if (!row) return null;
  const parsed = creativeReviewSchema.safeParse(row);
  if (
    !parsed.success ||
    parsed.data.organization_id !== input.organizationId ||
    parsed.data.subject_id !== input.versionId ||
    parsed.data.subject_kind !== "brand_asset_version"
  ) {
    return "corrupt";
  }
  return parsed.data;
}

/**
 * Recent brand references: the newest parents, each with its latest usable
 * version and that version's latest review verdict.
 *
 * Only the newest verdict counts — an older approval never rescues a current
 * rejection, and there is no fallback to a previously approved version. A
 * rejected current version omits the candidate outright. The record carries
 * the version's date and the parent's saved label, and points at /assets.
 */
export async function readHomeReferenceAssets(
  input: ReadHomeAssetsInput,
): Promise<readonly AssetHomeRecord[]> {
  const { database, storage, organizationId, now, correlationId } = input;
  const context = { organizationId, correlationId };

  if (!uuidSchema.safeParse(organizationId).success) {
    referenceSourceFailure({ correlationId, code: "invalid_organization" });
  }

  let parentRows: readonly Record<string, unknown>[];
  try {
    const { data, error } = await database
      .from("organization_brand_assets")
      .select("id,organization_id,label,asset_role,archived_at,created_at")
      .eq("organization_id", organizationId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(HOME_REFERENCE_LIMIT);
    if (error || !data) referenceSourceFailure({ ...context, code: "parents_unavailable" });
    parentRows = data;
  } catch (cause) {
    if (cause instanceof DomainError) throw cause;
    referenceSourceFailure({ ...context, code: "parents_unavailable" });
  }

  const parents: z.infer<typeof brandAssetParentSchema>[] = [];
  for (const row of parentRows.slice(0, HOME_REFERENCE_LIMIT)) {
    const parsed = brandAssetParentSchema.safeParse(row);
    if (
      !parsed.success ||
      parsed.data.organization_id !== organizationId ||
      parsed.data.archived_at !== null
    ) {
      referenceSourceFailure({ ...context, code: "invalid_parent_row" });
    }
    parents.push(parsed.data);
  }
  if (parents.length === 0) return [];

  const candidates: ReferenceCandidate[] = [];
  for (const parent of parents) {
    let version: z.infer<typeof brandAssetVersionSchema> | null;
    try {
      const result = await readLatestVersion({
        database,
        organizationId,
        brandAssetId: parent.id,
      });
      if (result.status === "unavailable") {
        referenceSourceFailure({ ...context, code: "versions_unavailable" });
      }
      if (result.status === "corrupt") {
        referenceSourceFailure({ ...context, code: "invalid_version_row" });
      }
      version = result.status === "ok" ? result.version : null;
    } catch (cause) {
      if (cause instanceof DomainError) throw cause;
      referenceSourceFailure({ ...context, code: "versions_unavailable" });
    }
    if (!version) continue;

    let review: z.infer<typeof creativeReviewSchema> | null;
    try {
      const result = await readLatestReview({
        database,
        organizationId,
        versionId: version.id,
      });
      if (result === "unavailable") {
        referenceSourceFailure({ ...context, code: "reviews_unavailable" });
      }
      if (result === "corrupt") {
        referenceSourceFailure({ ...context, code: "invalid_review_row" });
      }
      review = result;
    } catch (cause) {
      if (cause instanceof DomainError) throw cause;
      referenceSourceFailure({ ...context, code: "reviews_unavailable" });
    }
    // A rejection is a verdict, not an error: the candidate goes away, and no
    // older approved version is consulted to replace it.
    if (review && review.verdict === "rejected") continue;

    candidates.push({
      record: {
        id: `reference:${version.id}`,
        sourceKind: "brand_reference",
        label: parent.label,
        sourceLabel: "Brand reference",
        reviewLabel: review ? "Approved reference" : "Unreviewed reference",
        reviewState: review ? "approved" : "unreviewed",
        recordedAt: canonicalUtc(version.created_at),
        image: null,
        sourceHref: `/organizations/${organizationId}/assets`,
      },
      path: version.storage_path,
      width: version.width_px,
      height: version.height_px,
    });
  }

  // Newest version first so the records arrive in merge order; Task 4's final
  // take-4 re-sorts by the same rule across both sources.
  candidates.sort((left, right) => {
    if (left.record.recordedAt !== right.record.recordedAt) {
      return left.record.recordedAt < right.record.recordedAt ? 1 : -1;
    }
    return left.record.id < right.record.id ? -1 : 1;
  });

  const signed = await signHomePreviewImages({
    storage,
    organizationId,
    bucket: "brand-assets",
    images: candidates.map((candidate) => ({
      id: candidate.record.id,
      path: candidate.path,
      alt: candidate.record.label || "Brand reference",
      width: candidate.width,
      height: candidate.height,
    })),
    now,
    correlationId,
  }).catch(() => ({} as Readonly<Record<string, PrivatePreviewImage>>));

  return candidates.map((candidate) => ({
    ...candidate.record,
    image: signed[candidate.record.id] ?? null,
  }));
}

/**
 * The single organization logo, or null when there is none to show.
 *
 * Exactly one active logo parent proceeds to the reference recipe — latest
 * usable version, latest review — and only a current approval qualifies.
 * Zero logos is a name-only masthead, two is ambiguity, a rejected or
 * unreviewed current version is simply not shown yet, and any read or signing
 * trouble degrades to null. None of these are setup errors, and nothing is
 * ever synthesized: no brand_context guessing, no product photograph, no
 * generated icon.
 */
export async function readHomeLogo(
  input: ReadHomeAssetsInput,
): Promise<PrivatePreviewImage | null> {
  const { database, storage, organizationId, now, correlationId } = input;
  const context = { organizationId, correlationId };

  if (!uuidSchema.safeParse(organizationId).success) {
    return logoUnavailable({ ...context, code: "invalid_organization" });
  }

  let parentRows: readonly Record<string, unknown>[];
  try {
    const { data, error } = await database
      .from("organization_brand_assets")
      .select("id,organization_id,label,asset_role,archived_at,created_at")
      .eq("organization_id", organizationId)
      .eq("asset_role", "logo")
      .is("archived_at", null)
      .order("id", { ascending: true })
      .limit(HOME_LOGO_PROBE_LIMIT);
    if (error || !data) return logoUnavailable({ ...context, code: "logo_unavailable" });
    parentRows = data;
  } catch {
    return logoUnavailable({ ...context, code: "logo_unavailable" });
  }

  const parents: z.infer<typeof brandAssetParentSchema>[] = [];
  for (const row of parentRows.slice(0, HOME_LOGO_PROBE_LIMIT)) {
    const parsed = brandAssetParentSchema.safeParse(row);
    if (
      !parsed.success ||
      parsed.data.organization_id !== organizationId ||
      parsed.data.asset_role !== "logo" ||
      parsed.data.archived_at !== null
    ) {
      return logoUnavailable({ ...context, code: "invalid_logo_row" });
    }
    parents.push(parsed.data);
  }
  // Missing or ambiguous is not a setup error: stay silent, show no logo.
  if (parents.length !== 1) return null;
  const parent = parents[0] as z.infer<typeof brandAssetParentSchema>;

  let version: z.infer<typeof brandAssetVersionSchema> | null;
  try {
    const result = await readLatestVersion({ database, organizationId, brandAssetId: parent.id });
    if (result.status === "unavailable") {
      return logoUnavailable({ ...context, code: "logo_version_unavailable" });
    }
    if (result.status === "corrupt") {
      return logoUnavailable({ ...context, code: "invalid_logo_version" });
    }
    version = result.status === "ok" ? result.version : null;
  } catch {
    return logoUnavailable({ ...context, code: "logo_version_unavailable" });
  }
  if (!version) return null;

  let review: z.infer<typeof creativeReviewSchema> | null;
  try {
    const result = await readLatestReview({ database, organizationId, versionId: version.id });
    if (result === "unavailable") {
      return logoUnavailable({ ...context, code: "logo_review_unavailable" });
    }
    if (result === "corrupt") {
      return logoUnavailable({ ...context, code: "invalid_logo_review" });
    }
    review = result;
  } catch {
    return logoUnavailable({ ...context, code: "logo_review_unavailable" });
  }
  // Only a current approval puts a logo in the masthead.
  if (!review || review.verdict !== "approved") return null;

  let signed: Readonly<Record<string, PrivatePreviewImage>>;
  try {
    signed = await signHomePreviewImages({
      storage,
      organizationId,
      bucket: "brand-assets",
      images: [
        {
          id: parent.id,
          path: version.storage_path,
          alt: parent.label || "Organization logo",
          width: version.width_px,
          height: version.height_px,
        },
      ],
      now,
      correlationId,
    });
  } catch {
    return logoUnavailable({ ...context, code: "logo_sign_unavailable" });
  }
  return signed[parent.id] ?? logoUnavailable({ ...context, code: "logo_sign_unavailable" });
}
