import { z } from "zod";

import { creativeHistoryMetadataSchema } from "@/domain/campaigns/creative-history";
import { DomainError } from "@/lib/errors";
import type {
  CreativeHistoryFolderRecord,
  CreativeHistoryItemRecord,
  CreativeHistoryReviewRecord,
  CreativeHistoryStore,
  CreativeHistoryVersionRecord,
} from "@/modules/campaigns/application/creative-history-service";
import {
  throwCreativeHistoryMutationError,
  type CreativeHistoryPersistenceFailure,
} from "@/modules/campaigns/infrastructure/creative-history-persistence-error";

/**
 * Reading and writing the design library.
 *
 * Reads go through the caller's own session, so RLS decides what comes back:
 * `asset.read` gates every SELECT policy on these five tables. Writes go
 * through security-definer RPCs, because `authenticated` holds select-only
 * grants — there is no path from a browser session to a row that claims a file
 * is usable, or to a verdict nobody with `asset.review` recorded.
 *
 * Every row is parsed before it leaves here. That is not ceremony: these types
 * are hand-maintained (there is no local database to regenerate them from), so
 * a migration that renames a column has to fail loudly at the boundary rather
 * than quietly hand the read model an `undefined`.
 */

type PersistenceResult<T> = { data: T | null; error: CreativeHistoryPersistenceFailure | null };

type CreativeHistoryQuery = {
  select(columns: string): CreativeHistoryQuery;
  eq(column: string, value: unknown): CreativeHistoryQuery;
  order(column: string, options: { ascending: boolean }): Promise<PersistenceResult<unknown>>;
};

type CreativeHistoryTable =
  | "creative_folders"
  | "creative_items"
  | "creative_item_versions"
  | "creative_item_reviews"
  | "creative_review_reasons";

type CreativeHistoryRpc =
  | "create_creative_folder"
  | "create_creative_item"
  | "reserve_creative_item_version"
  | "finalize_creative_item_version"
  | "record_creative_item_review"
  | "archive_creative_item"
  | "confirm_creative_item_metadata";

export type CreativeHistoryPersistence = {
  from(table: CreativeHistoryTable): CreativeHistoryQuery;
  rpc(name: CreativeHistoryRpc, args: Record<string, unknown>): Promise<PersistenceResult<unknown>>;
};

const uuidSchema = z.string().uuid();
const jsonObjectSchema = z.record(z.string(), z.unknown());

const folderRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  parent_folder_id: uuidSchema.nullable(),
  name: z.string(),
  default_metadata: jsonObjectSchema.nullable(),
  archived_at: z.string().nullable(),
});

const itemRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  folder_id: uuidSchema.nullable(),
  label: z.string(),
  creative_type: z.string(),
  source_kind: z.string(),
  rights: jsonObjectSchema,
  confirmed_metadata: jsonObjectSchema.nullable(),
  proposed_metadata: jsonObjectSchema.nullable(),
  archived_at: z.string().nullable(),
  created_at: z.string(),
});

const versionRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  creative_item_id: uuidSchema,
  version: z.number().int().positive(),
  storage_path: z.string().nullable(),
  source_poster_render_id: uuidSchema.nullable(),
  content_hash: z.string().nullable(),
  mime_type: z.string().nullable(),
  byte_size: z.number().nullable(),
  width_px: z.number().nullable(),
  height_px: z.number().nullable(),
  is_usable: z.boolean(),
  finalized_at: z.string().nullable(),
  created_at: z.string(),
});

const reviewRowSchema = z.strictObject({
  id: uuidSchema,
  organization_id: uuidSchema,
  creative_item_version_id: uuidSchema,
  verdict: z.enum(["approved", "rejected"]),
  reason_codes: z.array(z.string()),
  note: z.string().nullable(),
  reviewed_at: z.string(),
  reviewed_by: uuidSchema,
});

const reviewReasonRowSchema = z.strictObject({
  key: z.string(),
  description: z.string(),
});

const FOLDER_COLUMNS = [
  "id",
  "organization_id",
  "parent_folder_id",
  "name",
  "default_metadata",
  "archived_at",
].join(",");
const ITEM_COLUMNS = [
  "id",
  "organization_id",
  "folder_id",
  "label",
  "creative_type",
  "source_kind",
  "rights",
  "confirmed_metadata",
  "proposed_metadata",
  "archived_at",
  "created_at",
].join(",");
const VERSION_COLUMNS = [
  "id",
  "organization_id",
  "creative_item_id",
  "version",
  "storage_path",
  "source_poster_render_id",
  "content_hash",
  "mime_type",
  "byte_size",
  "width_px",
  "height_px",
  "is_usable",
  "finalized_at",
  "created_at",
].join(",");
const REVIEW_COLUMNS = [
  "id",
  "organization_id",
  "creative_item_version_id",
  "verdict",
  "reason_codes",
  "note",
  "reviewed_at",
  "reviewed_by",
].join(",");

function persistenceError(cause?: unknown): never {
  throw new DomainError("DOMAIN_ERROR", "The design library could not be read or changed.", cause);
}

/** Timestamps are stored in UTC; rendering in the organization's zone is the UI's job. */
function canonicalUtc(value: string | null): string | null {
  if (value === null) return null;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? value : new Date(milliseconds).toISOString();
}

function requireUtc(value: string): string {
  const canonical = canonicalUtc(value);
  if (canonical === null) persistenceError();
  return canonical;
}

function parseRows<T>(schema: z.ZodType<T>, value: unknown): T[] {
  if (!Array.isArray(value)) persistenceError();
  const parsed = z.array(schema).safeParse(value);
  if (!parsed.success) persistenceError(parsed.error);
  return parsed.data;
}

/**
 * An empty object means "nothing described yet" — it is the column default for
 * a folder with no suggested values, and it is not an error. Anything else that
 * will not parse is real drift between the migration and the domain schema, and
 * it is raised rather than quietly turned into "no metadata", because "no
 * metadata" is also what makes a design ineligible for selection.
 */
function parseMetadata(value: Record<string, unknown> | null) {
  if (value === null || Object.keys(value).length === 0) return null;
  const parsed = creativeHistoryMetadataSchema.safeParse(value);
  if (!parsed.success) persistenceError(parsed.error);
  return parsed.data;
}

function assertSameTenant(organizationId: string, rows: readonly { organization_id: string }[]) {
  // RLS has already filtered these. Checking again costs one pass and means a
  // future policy edit cannot quietly widen what this repository returns.
  if (rows.some((row) => row.organization_id !== organizationId)) persistenceError();
}

function rpcObject(data: unknown): Record<string, unknown> {
  if (data === null || typeof data !== "object" || Array.isArray(data)) persistenceError();
  return data as Record<string, unknown>;
}

export function createCreativeHistoryRepository(
  persistence: CreativeHistoryPersistence,
): CreativeHistoryStore {
  async function readFolders(organizationId: string): Promise<CreativeHistoryFolderRecord[]> {
    const { data, error } = await persistence
      .from("creative_folders")
      .select(FOLDER_COLUMNS)
      .eq("organization_id", organizationId)
      .order("name", { ascending: true });
    if (error) persistenceError(error);

    const rows = parseRows(folderRowSchema, data);
    assertSameTenant(organizationId, rows);
    return rows.map((row) => ({
      organizationId,
      folderId: row.id,
      parentFolderId: row.parent_folder_id,
      name: row.name,
      defaultMetadata: parseMetadata(row.default_metadata),
      archivedAt: canonicalUtc(row.archived_at),
    }));
  }

  async function readVersionsAndReviews(organizationId: string): Promise<{
    versions: CreativeHistoryVersionRecord[];
    reviews: CreativeHistoryReviewRecord[];
  }> {
    const [versionResult, reviewResult] = await Promise.all([
      persistence
        .from("creative_item_versions")
        .select(VERSION_COLUMNS)
        .eq("organization_id", organizationId)
        .order("version", { ascending: false }),
      persistence
        .from("creative_item_reviews")
        .select(REVIEW_COLUMNS)
        .eq("organization_id", organizationId)
        .order("reviewed_at", { ascending: false }),
    ]);
    if (versionResult.error || reviewResult.error) {
      persistenceError(versionResult.error ?? reviewResult.error);
    }

    const versionRows = parseRows(versionRowSchema, versionResult.data);
    const reviewRows = parseRows(reviewRowSchema, reviewResult.data);
    assertSameTenant(organizationId, versionRows);
    assertSameTenant(organizationId, reviewRows);

    return {
      versions: versionRows.map((row) => ({
        organizationId,
        versionId: row.id,
        itemId: row.creative_item_id,
        version: row.version,
        storagePath: row.storage_path,
        sourcePosterRenderId: row.source_poster_render_id,
        contentHash: row.content_hash,
        mimeType: row.mime_type,
        byteSize: row.byte_size,
        widthPx: row.width_px,
        heightPx: row.height_px,
        isUsable: row.is_usable,
        finalizedAt: canonicalUtc(row.finalized_at),
        createdAt: requireUtc(row.created_at),
      })),
      reviews: reviewRows.map((row) => ({
        reviewId: row.id,
        versionId: row.creative_item_version_id,
        verdict: row.verdict,
        reasonCodes: row.reason_codes,
        note: row.note,
        reviewedAt: requireUtc(row.reviewed_at),
        reviewedBy: row.reviewed_by,
      })),
    };
  }

  function composeItems(
    organizationId: string,
    itemRows: readonly z.infer<typeof itemRowSchema>[],
    versions: readonly CreativeHistoryVersionRecord[],
    reviews: readonly CreativeHistoryReviewRecord[],
  ): CreativeHistoryItemRecord[] {
    const versionsByItem = new Map<string, CreativeHistoryVersionRecord[]>();
    for (const version of versions) {
      const bucket = versionsByItem.get(version.itemId) ?? [];
      bucket.push(version);
      versionsByItem.set(version.itemId, bucket);
    }

    const reviewsByVersion = new Map<string, CreativeHistoryReviewRecord[]>();
    for (const review of reviews) {
      const bucket = reviewsByVersion.get(review.versionId) ?? [];
      bucket.push(review);
      reviewsByVersion.set(review.versionId, bucket);
    }

    return itemRows.map((row) => {
      const itemVersions = versionsByItem.get(row.id) ?? [];
      return {
        organizationId,
        itemId: row.id,
        folderId: row.folder_id,
        label: row.label,
        creativeType: row.creative_type,
        sourceKind: row.source_kind,
        rights: row.rights,
        confirmedMetadata: parseMetadata(row.confirmed_metadata),
        proposedMetadata: parseMetadata(row.proposed_metadata),
        archivedAt: canonicalUtc(row.archived_at),
        createdAt: requireUtc(row.created_at),
        versions: itemVersions,
        reviews: itemVersions.flatMap((version) => reviewsByVersion.get(version.versionId) ?? []),
      };
    });
  }

  return {
    listFolders: readFolders,

    async listItems(input) {
      const [itemResult, related] = await Promise.all([
        persistence
          .from("creative_items")
          .select(ITEM_COLUMNS)
          .eq("organization_id", input.organizationId)
          .order("created_at", { ascending: false }),
        readVersionsAndReviews(input.organizationId),
      ]);
      if (itemResult.error) persistenceError(itemResult.error);

      const rows = parseRows(itemRowSchema, itemResult.data);
      assertSameTenant(input.organizationId, rows);
      const visible = input.includeArchived ? rows : rows.filter((row) => row.archived_at === null);
      return composeItems(input.organizationId, visible, related.versions, related.reviews);
    },

    async readItem(input) {
      const [itemResult, related] = await Promise.all([
        persistence
          .from("creative_items")
          .select(ITEM_COLUMNS)
          .eq("organization_id", input.organizationId)
          .eq("id", input.itemId)
          .order("created_at", { ascending: false }),
        readVersionsAndReviews(input.organizationId),
      ]);
      if (itemResult.error) persistenceError(itemResult.error);

      const rows = parseRows(itemRowSchema, itemResult.data);
      assertSameTenant(input.organizationId, rows);
      // Another tenant's design is not "forbidden", it is absent: RLS returns
      // no row, and the caller cannot tell the two apart. That is the point.
      const [row] = rows;
      if (!row) return null;
      const [composed] = composeItems(
        input.organizationId,
        [row],
        related.versions,
        related.reviews,
      );
      return composed ?? null;
    },

    async createFolder(input) {
      const { data, error } = await persistence.rpc("create_creative_folder", {
        target_organization_id: input.organizationId,
        input_folder: {
          organization_id: input.organizationId,
          name: input.name,
          parent_folder_id: input.parentFolderId,
          default_metadata: input.defaultMetadata ?? {},
        },
      });
      if (error) throwCreativeHistoryMutationError(error);
      const parsed = z
        .strictObject({ folder_id: uuidSchema })
        .safeParse(rpcObject(data));
      if (!parsed.success) persistenceError(parsed.error);
      return { folderId: parsed.data.folder_id };
    },

    async createItem(input) {
      const { data, error } = await persistence.rpc("create_creative_item", {
        target_organization_id: input.organizationId,
        input_item: {
          organization_id: input.organizationId,
          folder_id: input.folderId,
          label: input.label,
          creative_type: input.creativeType,
          source_kind: input.sourceKind,
          rights: input.rights,
          storage_path: input.storagePath,
        },
      });
      if (error) throwCreativeHistoryMutationError(error);
      const parsed = z
        .strictObject({ item_id: uuidSchema, version_id: uuidSchema })
        .safeParse(rpcObject(data));
      if (!parsed.success) persistenceError(parsed.error);
      return { itemId: parsed.data.item_id, versionId: parsed.data.version_id };
    },

    async reserveVersion(input) {
      const { data, error } = await persistence.rpc("reserve_creative_item_version", {
        target_organization_id: input.organizationId,
        input_version: {
          organization_id: input.organizationId,
          item_id: input.itemId,
          storage_path: input.storagePath,
        },
      });
      if (error) throwCreativeHistoryMutationError(error);
      const parsed = z
        .strictObject({
          item_id: uuidSchema,
          version_id: uuidSchema,
          version: z.number().int().positive(),
          storage_path: z.string().min(1),
        })
        .safeParse(rpcObject(data));
      if (!parsed.success) persistenceError(parsed.error);
      return {
        itemId: parsed.data.item_id,
        versionId: parsed.data.version_id,
        version: parsed.data.version,
        storagePath: parsed.data.storage_path,
      };
    },

    async finalizeVersion(input) {
      const { error } = await persistence.rpc("finalize_creative_item_version", {
        target_organization_id: input.organizationId,
        input_version: {
          organization_id: input.organizationId,
          version_id: input.versionId,
          // Every value here was read out of the stored bytes, never taken from
          // the request that uploaded them.
          content_hash: input.contentHash,
          mime_type: input.mimeType,
          byte_size: input.byteSize,
          width_px: input.widthPx,
          height_px: input.heightPx,
        },
      });
      if (error) throwCreativeHistoryMutationError(error);
    },

    async recordReview(input) {
      const { data, error } = await persistence.rpc("record_creative_item_review", {
        target_organization_id: input.organizationId,
        input_review: {
          organization_id: input.organizationId,
          creative_item_version_id: input.versionId,
          verdict: input.verdict,
          reason_codes: input.reasonCodes,
          note: input.note,
        },
      });
      if (error) throwCreativeHistoryMutationError(error);
      const parsed = z
        .strictObject({
          review_id: uuidSchema,
          verdict: z.enum(["approved", "rejected"]),
          reviewed_at: z.string(),
        })
        .safeParse(rpcObject(data));
      if (!parsed.success) persistenceError(parsed.error);
      return {
        reviewId: parsed.data.review_id,
        verdict: parsed.data.verdict,
        reviewedAt: requireUtc(parsed.data.reviewed_at),
      };
    },

    async archiveItem(input) {
      const { data, error } = await persistence.rpc("archive_creative_item", {
        target_organization_id: input.organizationId,
        input_item: { organization_id: input.organizationId, item_id: input.itemId },
      });
      if (error) throwCreativeHistoryMutationError(error);
      const parsed = z
        .strictObject({ item_id: uuidSchema, archived_at: z.string() })
        .safeParse(rpcObject(data));
      if (!parsed.success) persistenceError(parsed.error);
      return { itemId: parsed.data.item_id, archivedAt: requireUtc(parsed.data.archived_at) };
    },

    async writeMetadata(input) {
      const { data, error } = await persistence.rpc("confirm_creative_item_metadata", {
        target_organization_id: input.organizationId,
        input_metadata: {
          organization_id: input.organizationId,
          item_id: input.itemId,
          // Present only when the caller meant to change it. An absent key
          // leaves the column alone, so confirming a description never wipes
          // the model's proposal and vice versa.
          ...("confirmedMetadata" in input ? { confirmed_metadata: input.confirmedMetadata } : {}),
          ...("proposedMetadata" in input ? { proposed_metadata: input.proposedMetadata } : {}),
        },
      });
      if (error) throwCreativeHistoryMutationError(error);
      const parsed = z
        .strictObject({
          item_id: uuidSchema,
          metadata_confirmed: z.boolean(),
          updated_at: z.string(),
        })
        .safeParse(rpcObject(data));
      if (!parsed.success) persistenceError(parsed.error);
      return {
        itemId: parsed.data.item_id,
        metadataConfirmed: parsed.data.metadata_confirmed,
      };
    },

    async listReviewReasons() {
      const { data, error } = await persistence
        .from("creative_review_reasons")
        .select("key,description")
        .order("key", { ascending: true });
      if (error) persistenceError(error);
      return parseRows(reviewReasonRowSchema, data).map((row) => ({
        code: row.key,
        description: row.description,
      }));
    },
  };
}
