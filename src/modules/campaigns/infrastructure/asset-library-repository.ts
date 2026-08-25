import { z } from "zod";

import {
  assetLibraryReferenceSchema,
  assetMetadataMutationResultSchema,
  creativeReviewMutationResultSchema,
  creativeReviewReasonEntrySchema,
  type AssetLibraryStore,
} from "@/modules/campaigns/application/asset-library-service";

type PersistenceResult<T> = { data: T | null; error: { code?: string } | null };

type AssetLibraryQuery = {
  select(columns: string): AssetLibraryQuery;
  eq(column: string, value: unknown): AssetLibraryQuery;
  order(column: string, options: { ascending: boolean }): Promise<PersistenceResult<unknown>>;
};

type AssetLibraryTable =
  | "organization_brand_assets"
  | "organization_brand_asset_versions"
  | "creative_asset_reviews"
  | "creative_review_reasons";

export type AssetLibraryPersistence = {
  from(table: AssetLibraryTable): AssetLibraryQuery;
  rpc(
    name: "update_brand_asset_metadata" | "record_creative_asset_review",
    args: Record<string, unknown>,
  ): Promise<PersistenceResult<unknown>>;
};

const uuidSchema = z.string().uuid();
const brandAssetRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  label: z.string(),
  asset_role: z.string(),
  conditioning_roles: z.array(z.string()),
  tags: z.array(z.string()),
  scripts: z.array(z.string()),
  ownership: z.string(),
  archived_at: z.string().nullable(),
});
const brandAssetVersionRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  brand_asset_id: uuidSchema,
  version: z.number(),
  storage_path: z.string(),
  content_hash: z.string(),
  mime_type: z.string(),
  byte_size: z.number(),
  width_px: z.number(),
  height_px: z.number(),
  is_usable: z.boolean(),
});
const creativeReviewRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  subject_kind: z.string(),
  subject_id: uuidSchema,
  verdict: z.string(),
  reason_codes: z.array(z.string()),
  reviewed_at: z.string(),
});
const reviewReasonRowSchema = z.strictObject({
  key: z.string(),
  description: z.string(),
  owner_scope: z.string(),
  pack_slug: z.string().nullable(),
});

const ASSET_COLUMNS = [
  "id",
  "organization_id",
  "label",
  "asset_role",
  "conditioning_roles",
  "tags",
  "scripts",
  "ownership",
  "archived_at",
].join(",");
const VERSION_COLUMNS = [
  "id",
  "organization_id",
  "brand_asset_id",
  "version",
  "storage_path",
  "content_hash",
  "mime_type",
  "byte_size",
  "width_px",
  "height_px",
  "is_usable",
].join(",");
const REVIEW_COLUMNS = [
  "id",
  "organization_id",
  "subject_kind",
  "subject_id",
  "verdict",
  "reason_codes",
  "reviewed_at",
].join(",");

function persistenceError(): never {
  throw new Error("The asset library could not be read or changed.");
}

function canonicalUtc(value: unknown): unknown {
  if (value === null || typeof value !== "string") return value;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? value : new Date(milliseconds).toISOString();
}

function parseRows<T>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) persistenceError();
  const parsed = z.array(schema).safeParse(value);
  if (!parsed.success) persistenceError();
  return parsed.data;
}

export function createAssetLibraryRepository(
  persistence: AssetLibraryPersistence,
): AssetLibraryStore {
  return {
    async listReferences(organizationId) {
      const [assetsResult, versionsResult, reviewsResult] = await Promise.all([
        persistence
          .from("organization_brand_assets")
          .select(ASSET_COLUMNS)
          .eq("organization_id", organizationId)
          .order("label", { ascending: true }),
        persistence
          .from("organization_brand_asset_versions")
          .select(VERSION_COLUMNS)
          .eq("organization_id", organizationId)
          .eq("is_usable", true)
          .order("version", { ascending: false }),
        persistence
          .from("creative_asset_reviews")
          .select(REVIEW_COLUMNS)
          .eq("organization_id", organizationId)
          .eq("subject_kind", "brand_asset_version")
          .order("reviewed_at", { ascending: false }),
      ]);
      if (assetsResult.error || versionsResult.error || reviewsResult.error) persistenceError();

      const assets = parseRows(brandAssetRowSchema, assetsResult.data);
      const versions = parseRows(brandAssetVersionRowSchema, versionsResult.data);
      const reviews = parseRows(creativeReviewRowSchema, reviewsResult.data).map((review) => ({
        ...review,
        reviewed_at: canonicalUtc(review.reviewed_at) as string,
      }));
      if (
        [...assets, ...versions, ...reviews].some((row) => row.organization_id !== organizationId)
      ) {
        persistenceError();
      }

      const assetsById = new Map(assets.map((asset) => [asset.id, asset]));
      const currentReviewByVersion = new Map<string, (typeof reviews)[number]>();
      reviews
        .sort(
          (left, right) =>
            right.reviewed_at.localeCompare(left.reviewed_at) || right.id.localeCompare(left.id),
        )
        .forEach((review) => {
          if (!currentReviewByVersion.has(review.subject_id)) {
            currentReviewByVersion.set(review.subject_id, review);
          }
        });

      return versions.map((version) => {
        const asset = assetsById.get(version.brand_asset_id);
        if (!asset) persistenceError();
        const review = currentReviewByVersion.get(version.id) ?? null;
        const parsed = assetLibraryReferenceSchema.safeParse({
          organizationId,
          brandAssetId: asset.id,
          brandAssetVersionId: version.id,
          label: asset.label,
          assetRole: asset.asset_role,
          conditioningRoles: asset.conditioning_roles,
          tags: asset.tags,
          scripts: asset.scripts,
          ownership: asset.ownership,
          archivedAt: canonicalUtc(asset.archived_at),
          version: version.version,
          storagePath: version.storage_path,
          contentHash: version.content_hash,
          mimeType: version.mime_type,
          byteSize: version.byte_size,
          widthPx: version.width_px,
          heightPx: version.height_px,
          currentVerdict: review?.verdict ?? null,
          currentReasonCodes: review?.reason_codes ?? [],
          currentReviewedAt: review?.reviewed_at ?? null,
        });
        if (!parsed.success) persistenceError();
        return parsed.data;
      });
    },

    async updateMetadata(input) {
      const inputMetadata = {
        organization_id: input.organizationId,
        brand_asset_id: input.brandAssetId,
        ...(input.conditioningRoles === undefined
          ? {}
          : { conditioning_roles: input.conditioningRoles }),
        ...(input.tags === undefined ? {} : { tags: input.tags }),
        ...(input.scripts === undefined ? {} : { scripts: input.scripts }),
        ...(input.archived === undefined ? {} : { archived: input.archived }),
      };
      const { data, error } = await persistence.rpc("update_brand_asset_metadata", {
        target_organization_id: input.organizationId,
        input_metadata: inputMetadata,
      });
      if (error || !data) persistenceError();
      const row = data as Record<string, unknown>;
      const parsed = assetMetadataMutationResultSchema.safeParse({
        brandAssetId: row.brand_asset_id,
        archivedAt: canonicalUtc(row.archived_at),
      });
      if (!parsed.success) persistenceError();
      return parsed.data;
    },

    async recordReview(input) {
      const { data, error } = await persistence.rpc("record_creative_asset_review", {
        target_organization_id: input.organizationId,
        input_review: {
          organization_id: input.organizationId,
          subject_kind: input.subjectKind,
          subject_id: input.subjectId,
          verdict: input.verdict,
          reason_codes: input.reasonCodes,
          note: input.note,
        },
      });
      if (error || !data) persistenceError();
      const row = data as Record<string, unknown>;
      const parsed = creativeReviewMutationResultSchema.safeParse({
        reviewId: row.review_id,
        verdict: row.verdict,
        reviewedAt: canonicalUtc(row.reviewed_at),
      });
      if (!parsed.success) persistenceError();
      return parsed.data;
    },

    async listReviewReasons() {
      const { data, error } = await persistence
        .from("creative_review_reasons")
        .select("key,description,owner_scope,pack_slug")
        .order("key", { ascending: true });
      if (error) persistenceError();
      return parseRows(reviewReasonRowSchema, data).map((row) => {
        const parsed = creativeReviewReasonEntrySchema.safeParse({
          code: row.key,
          description: row.description,
          ownerScope: row.owner_scope,
          packSlug: row.pack_slug,
        });
        if (!parsed.success) persistenceError();
        return parsed.data;
      });
    },
  };
}
