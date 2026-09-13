import { createHash } from "node:crypto";

import { z } from "zod";

import {
  creativeEligibility,
  creativeHistoryMetadataSchema,
  type CreativeHistoryEligibility,
  type CreativeHistoryMetadata,
} from "@/domain/campaigns/creative-history";
import { creativeReviewReasonCodeSchema } from "@/domain/campaigns/asset-library";
import { DomainError } from "@/lib/errors";
import type { AssetIntakeResult } from "@/modules/campaigns/infrastructure/asset-intake";

/**
 * The client's own design history: what they have put out before, what a human
 * decided about it, and why.
 *
 * The upload is deliberately three steps, not one, and the order is the whole
 * point:
 *
 *   reserve  — the database records the intent, the tenant and the exact object
 *              key. Nothing about the file is believed yet, because nothing has
 *              been seen.
 *   transfer — the browser puts the bytes at that key, through a private bucket
 *              whose policy checks the tenant again.
 *   finalize — the server fetches those bytes back, identifies them from their
 *              own leading signature, re-encodes them (which is what strips the
 *              GPS coordinates a phone photo of a restaurant carries), hashes
 *              what it produced, and only then marks the version usable.
 *
 * A single upload endpoint would have to believe whatever the browser said the
 * file was. "Believe the client" is how an arbitrary file ends up stored under
 * an image label.
 *
 * Two rules run through everything below:
 *
 *   A refusal is not a success with a sad face. `finalize` returns a tagged
 *   outcome, and a caller that cannot tell `usable` from `refused` cannot
 *   accidentally show "Uploaded".
 *
 *   One file's failure is its own. A batch of five where the third is a
 *   corrupt download leaves four usable designs and one to retry — it does not
 *   undo the four.
 */

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });

/** What the bucket itself will accept, read from the Storage configuration. */
export type CreativeHistoryStorageConfiguration = {
  bucket: string;
  allowedMimeTypes: readonly string[];
  maxBytes: number;
};

/**
 * The dimension side of the asset-intake contract.
 *
 * This is a port, not a copy: the composition root injects the same
 * `AssetIntakeLimits` the intake adapter itself enforces, so the browser DTO
 * and the actual re-encode gate can never drift apart. The application layer
 * names only the four fields it needs and never imports the adapter's default
 * constant directly — that would put a concrete infrastructure value inside
 * application code, which is exactly the layering the intake adapter's own
 * default is supposed to be free to change without an application edit.
 */
export type CreativeHistoryIntakeDimensionLimits = {
  /** The intake adapter's own byte ceiling, independent of the bucket's. */
  maxBytes: number;
  minWidthPx: number;
  minHeightPx: number;
  maxWidthPx: number;
  maxHeightPx: number;
};

// ---------------------------------------------------------------------------
// Request contracts
// ---------------------------------------------------------------------------

export const creativeHistoryRightsSchema = z.strictObject({
  status: z.enum(["owned", "licensed", "permission_confirmed"]),
  confirmedAt: timestampSchema,
  holder: z.string().trim().min(1).max(160).optional(),
});
export type CreativeHistoryRights = z.infer<typeof creativeHistoryRightsSchema>;

export const createCreativeFolderRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(160),
  parentFolderId: uuidSchema.nullable().default(null),
  defaultMetadata: creativeHistoryMetadataSchema.nullable().default(null),
});
export type CreateCreativeFolderRequest = z.input<typeof createCreativeFolderRequestSchema>;

export const reserveCreativeItemRequestSchema = z.strictObject({
  label: z.string().trim().min(1).max(160),
  creativeType: z.enum(["poster", "flyer", "social_post", "story", "carousel", "banner"]),
  /**
   * A Studio render is never created here. It arrives through the controlled
   * completion path that links a finished poster once, so the only source kinds
   * a person can upload are the two that describe a file they already had.
   */
  sourceKind: z
    .enum(["historical_upload", "qualified_legacy_delivered_creative"])
    .default("historical_upload"),
  folderId: uuidSchema.nullable().default(null),
  rights: creativeHistoryRightsSchema,
  /** A unique id per file in a batch, so two `poster.png` uploads never collide. */
  clientUploadId: z.string().trim().min(1).max(120),
});
export type ReserveCreativeItemRequest = z.input<typeof reserveCreativeItemRequestSchema>;

export const reserveCreativeVersionRequestSchema = z.strictObject({
  itemId: uuidSchema,
  clientUploadId: z.string().trim().min(1).max(120),
});
export type ReserveCreativeVersionRequest = z.input<typeof reserveCreativeVersionRequestSchema>;

export const completeCreativeUploadRequestSchema = z.strictObject({
  itemId: uuidSchema,
  versionId: uuidSchema,
});
export type CompleteCreativeUploadRequest = z.input<typeof completeCreativeUploadRequestSchema>;

export const creativeHistoryReviewRequestSchema = z
  .strictObject({
    itemId: uuidSchema,
    /** The verdict belongs to exact bytes, never to a folder or a design name. */
    versionId: uuidSchema,
    verdict: z.enum(["approved", "rejected"]),
    reasonCodes: z.array(creativeReviewReasonCodeSchema).max(15).default([]),
    note: z.string().trim().min(1).max(500).nullable().default(null),
  })
  .superRefine((review, context) => {
    if (new Set(review.reasonCodes).size !== review.reasonCodes.length) {
      context.addIssue({ code: "custom", path: ["reasonCodes"], message: "Reasons must be unique." });
    }
    if (review.verdict === "rejected" && review.reasonCodes.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "Say why this design was rejected. The reason is what a future campaign learns from.",
      });
    }
    if (review.verdict === "approved" && review.reasonCodes.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "An approved design cannot carry rejection reasons.",
      });
    }
  });
export type CreativeHistoryReviewRequest = z.input<typeof creativeHistoryReviewRequestSchema>;

export const confirmCreativeMetadataRequestSchema = z.strictObject({
  itemId: uuidSchema,
  confirmedMetadata: creativeHistoryMetadataSchema.nullable(),
});
export type ConfirmCreativeMetadataRequest = z.input<typeof confirmCreativeMetadataRequestSchema>;

export const proposeCreativeMetadataRequestSchema = z.strictObject({
  itemId: uuidSchema,
  proposedMetadata: creativeHistoryMetadataSchema.nullable(),
});
export type ProposeCreativeMetadataRequest = z.input<typeof proposeCreativeMetadataRequestSchema>;

// ---------------------------------------------------------------------------
// Persistence records: what the repository hands back, already tenant-checked
// ---------------------------------------------------------------------------

export type CreativeHistoryFolderRecord = {
  organizationId: string;
  folderId: string;
  parentFolderId: string | null;
  name: string;
  defaultMetadata: CreativeHistoryMetadata | null;
  archivedAt: string | null;
};

export type CreativeHistoryReviewRecord = {
  reviewId: string;
  versionId: string;
  verdict: "approved" | "rejected";
  reasonCodes: readonly string[];
  note: string | null;
  reviewedAt: string;
  reviewedBy: string;
};

export type CreativeHistoryVersionRecord = {
  organizationId: string;
  versionId: string;
  itemId: string;
  version: number;
  storagePath: string | null;
  sourcePosterRenderId: string | null;
  contentHash: string | null;
  mimeType: string | null;
  byteSize: number | null;
  widthPx: number | null;
  heightPx: number | null;
  isUsable: boolean;
  finalizedAt: string | null;
  createdAt: string;
};

export type CreativeHistoryItemRecord = {
  organizationId: string;
  itemId: string;
  folderId: string | null;
  label: string;
  creativeType: string;
  sourceKind: string;
  rights: Record<string, unknown>;
  confirmedMetadata: CreativeHistoryMetadata | null;
  proposedMetadata: CreativeHistoryMetadata | null;
  archivedAt: string | null;
  createdAt: string;
  versions: readonly CreativeHistoryVersionRecord[];
  reviews: readonly CreativeHistoryReviewRecord[];
};

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export type CreativeHistoryStore = {
  listFolders(organizationId: string): Promise<readonly CreativeHistoryFolderRecord[]>;
  createFolder(input: {
    organizationId: string;
    name: string;
    parentFolderId: string | null;
    defaultMetadata: CreativeHistoryMetadata | null;
  }): Promise<{ folderId: string }>;
  listItems(input: {
    organizationId: string;
    includeArchived: boolean;
  }): Promise<readonly CreativeHistoryItemRecord[]>;
  readItem(input: {
    organizationId: string;
    itemId: string;
  }): Promise<CreativeHistoryItemRecord | null>;
  createItem(input: {
    organizationId: string;
    folderId: string | null;
    label: string;
    creativeType: string;
    sourceKind: string;
    rights: Record<string, unknown>;
    storagePath: string;
  }): Promise<{ itemId: string; versionId: string }>;
  reserveVersion(input: {
    organizationId: string;
    itemId: string;
    storagePath: string;
  }): Promise<{ itemId: string; versionId: string; version: number; storagePath: string }>;
  finalizeVersion(input: {
    organizationId: string;
    versionId: string;
    contentHash: string;
    mimeType: string;
    byteSize: number;
    widthPx: number;
    heightPx: number;
  }): Promise<void>;
  recordReview(input: {
    organizationId: string;
    versionId: string;
    verdict: "approved" | "rejected";
    reasonCodes: readonly string[];
    note: string | null;
  }): Promise<{ reviewId: string; verdict: string; reviewedAt: string }>;
  archiveItem(input: {
    organizationId: string;
    itemId: string;
  }): Promise<{ itemId: string; archivedAt: string }>;
  writeMetadata(input: {
    organizationId: string;
    itemId: string;
    confirmedMetadata?: CreativeHistoryMetadata | null;
    proposedMetadata?: CreativeHistoryMetadata | null;
  }): Promise<{ itemId: string; metadataConfirmed: boolean }>;
  listReviewReasons(): Promise<readonly { code: string; description: string }[]>;
};

export type CreativeHistoryObjectStore = {
  download(path: string): Promise<Buffer | null>;
  upload(input: { path: string; bytes: Buffer; contentType: string }): Promise<boolean>;
  signPreviews(paths: readonly string[]): Promise<Readonly<Record<string, string>>>;
};

export type CreativeHistoryIntake = (input: { bytes: Buffer }) => Promise<AssetIntakeResult>;

export type CreativeHistoryServiceDependencies = {
  store: CreativeHistoryStore;
  objects: CreativeHistoryObjectStore;
  ingest: CreativeHistoryIntake;
  storage: CreativeHistoryStorageConfiguration;
  /** The same dimension gate the intake adapter enforces, injected rather than imported. */
  intakeLimits: CreativeHistoryIntakeDimensionLimits;
  /** `organizationId/creative-history/uploadIntentId/source`. */
  storagePath(input: { organizationId: string; uploadIntentId: string }): string;
  /** Injected so a test can pin the intent id, and so nothing derives it from a filename. */
  newUploadIntentId?: () => string;
};

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

/**
 * Where an upload actually is. `usable` is the only one that means the design
 * can be shown as part of the library; `needs_review` says the bytes are good
 * but nobody has decided about them yet.
 */
export type CreativeHistoryUploadState =
  /**
   * A slot exists and its bytes are not validated yet. A row cannot tell
   * "nothing uploaded" from "uploaded, not finalized" — only reading the object
   * back can, and that is what `complete` does. So both live here, and the
   * finer distinction belongs to the completion outcome, which has looked.
   */
  | "reserved"
  /** No version row at all. A design in this state has nothing to show. */
  | "processing"
  | "usable"
  | "needs_review"
  | "refused";

export type CreativeHistoryVersionView = {
  versionId: string;
  version: number;
  state: "reserved" | "usable";
  sourceKind: "stored_file" | "studio_render";
  sourcePosterRenderId: string | null;
  contentHash: string | null;
  mimeType: string | null;
  byteSize: number | null;
  widthPx: number | null;
  heightPx: number | null;
  finalizedAt: string | null;
  createdAt: string;
  review: {
    verdict: "approved" | "rejected";
    reasonCodes: readonly string[];
    note: string | null;
    reviewedAt: string;
  } | null;
  previewUrl: string | null;
};

export type CreativeHistoryItemView = {
  organizationId: string;
  itemId: string;
  label: string;
  creativeType: string;
  sourceKind: string;
  folderId: string | null;
  folderName: string | null;
  /** A folder's suggestion. Never silently promoted into a human's answer. */
  folderDefaultMetadata: CreativeHistoryMetadata | null;
  /** What a person confirmed. This is what makes a design selectable. */
  confirmedMetadata: CreativeHistoryMetadata | null;
  /** What a model suggested. Advisory only, and always shown as such. */
  proposedMetadata: CreativeHistoryMetadata | null;
  metadataConfirmed: boolean;
  rights: Record<string, unknown>;
  archivedAt: string | null;
  createdAt: string;
  /** The newest version whose bytes are validated, or null while one is uploading. */
  currentVersion: CreativeHistoryVersionView | null;
  /** A reservation waiting for its bytes, if there is one. */
  pendingVersion: CreativeHistoryVersionView | null;
  versions: readonly CreativeHistoryVersionView[];
  eligibility: CreativeHistoryEligibility;
  uploadState: CreativeHistoryUploadState;
};

export type CreativeHistoryFolderView = {
  folderId: string;
  parentFolderId: string | null;
  name: string;
  defaultMetadata: CreativeHistoryMetadata | null;
  archivedAt: string | null;
};

/**
 * Everything the browser needs to run an upload, and nothing it needs to be
 * trusted with. There is no worker key, no service role and no bucket
 * credential here — the browser writes through its own session, which the
 * storage policy checks against the same tenant the database checked.
 */
export type CreativeHistoryIntakeContract = {
  bucket: string;
  allowedMimeTypes: readonly string[];
  maxBytes: number;
  minWidthPx: number;
  minHeightPx: number;
  maxWidthPx: number;
  maxHeightPx: number;
  /** Client checks are early feedback. The server decides. */
  clientValidationIsAdvisory: true;
};

export type CreativeHistoryReservation = {
  itemId: string;
  versionId: string;
  version: number;
  clientUploadId: string;
  uploadIntentId: string;
  bucket: string;
  storagePath: string;
  intake: CreativeHistoryIntakeContract;
};

export type CreativeHistoryCompletionOutcome =
  | {
      status: "usable";
      itemId: string;
      versionId: string;
      /** True when a lost response was retried and the original result was replayed. */
      replayed: boolean;
      contentHash: string;
      mimeType: string;
      byteSize: number;
      widthPx: number;
      heightPx: number;
      uploadState: "needs_review";
    }
  | {
      status: "refused";
      itemId: string;
      versionId: string;
      reason:
        | "upload_missing"
        | "empty_file"
        | "too_large"
        | "unsupported_format"
        | "declared_type_mismatch"
        | "corrupt_image"
        | "dimensions_out_of_range"
        | "storage_failed";
      message: string;
      uploadState: "refused";
    }
  | {
      status: "conflict";
      itemId: string;
      versionId: string;
      reason: "changed_bytes";
      message: string;
      uploadState: "refused";
    };

export type CreativeHistoryBatchCompletionOutcome = {
  outcomes: readonly CreativeHistoryCompletionOutcome[];
  usableCount: number;
  retryable: readonly { itemId: string; versionId: string }[];
};

// ---------------------------------------------------------------------------

function notAvailable(): never {
  throw new DomainError("TENANT_SCOPE_ERROR", "That design is not available.");
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function versionView(
  version: CreativeHistoryVersionRecord,
  review: CreativeHistoryReviewRecord | null,
  previewUrl: string | null,
): CreativeHistoryVersionView {
  return {
    versionId: version.versionId,
    version: version.version,
    state: version.isUsable ? "usable" : "reserved",
    sourceKind: version.sourcePosterRenderId === null ? "stored_file" : "studio_render",
    sourcePosterRenderId: version.sourcePosterRenderId,
    contentHash: version.contentHash,
    mimeType: version.mimeType,
    byteSize: version.byteSize,
    widthPx: version.widthPx,
    heightPx: version.heightPx,
    finalizedAt: version.finalizedAt,
    createdAt: version.createdAt,
    review:
      review === null
        ? null
        : {
            verdict: review.verdict,
            reasonCodes: review.reasonCodes,
            note: review.note,
            reviewedAt: review.reviewedAt,
          },
    previewUrl,
  };
}

/** Newest first, and stable when two rows share a timestamp. */
function byVersionDescending(
  left: CreativeHistoryVersionRecord,
  right: CreativeHistoryVersionRecord,
): number {
  return right.version - left.version || right.versionId.localeCompare(left.versionId);
}

function latestReviewByVersion(
  reviews: readonly CreativeHistoryReviewRecord[],
): Map<string, CreativeHistoryReviewRecord> {
  const latest = new Map<string, CreativeHistoryReviewRecord>();
  for (const review of [...reviews].sort(
    (left, right) =>
      right.reviewedAt.localeCompare(left.reviewedAt) || right.reviewId.localeCompare(left.reviewId),
  )) {
    // A design can be reviewed more than once; the most recent verdict is the
    // one that counts, and the earlier ones stay readable as history.
    if (!latest.has(review.versionId)) latest.set(review.versionId, review);
  }
  return latest;
}

function uploadStateFor(input: {
  archivedAt: string | null;
  currentVersion: CreativeHistoryVersionView | null;
  pendingVersion: CreativeHistoryVersionView | null;
}): CreativeHistoryUploadState {
  if (input.currentVersion === null) {
    return input.pendingVersion === null ? "processing" : "reserved";
  }
  if (input.archivedAt !== null) return "usable";
  return input.currentVersion.review === null ? "needs_review" : "usable";
}

export function createCreativeHistoryService(dependencies: CreativeHistoryServiceDependencies) {
  const newUploadIntentId = dependencies.newUploadIntentId ?? (() => crypto.randomUUID());

  const intakeContract: CreativeHistoryIntakeContract = {
    bucket: dependencies.storage.bucket,
    // The stricter of the two authorities. Storage refuses an object outside
    // its own list before any application code runs, and the intake contract
    // refuses anything it cannot decode — so the browser is told the
    // intersection rather than a number somebody typed into a component.
    allowedMimeTypes: dependencies.storage.allowedMimeTypes.filter((type) =>
      (["image/jpeg", "image/png", "image/webp"] as readonly string[]).includes(type),
    ),
    maxBytes: Math.min(dependencies.storage.maxBytes, dependencies.intakeLimits.maxBytes),
    minWidthPx: dependencies.intakeLimits.minWidthPx,
    minHeightPx: dependencies.intakeLimits.minHeightPx,
    maxWidthPx: dependencies.intakeLimits.maxWidthPx,
    maxHeightPx: dependencies.intakeLimits.maxHeightPx,
    clientValidationIsAdvisory: true,
  };

  async function composeViews(
    organizationId: string,
    items: readonly CreativeHistoryItemRecord[],
    folders: readonly CreativeHistoryFolderRecord[],
  ): Promise<readonly CreativeHistoryItemView[]> {
    const foldersById = new Map(folders.map((folder) => [folder.folderId, folder]));

    const previewPaths = items.flatMap((item) =>
      item.versions
        .filter((version) => version.isUsable && version.storagePath !== null)
        .map((version) => version.storagePath as string),
    );
    const previewUrls = await dependencies.objects.signPreviews(previewPaths);

    return items.map((item) => {
      const reviews = latestReviewByVersion(item.reviews);
      const ordered = [...item.versions].sort(byVersionDescending);
      const views = ordered.map((version) =>
        versionView(
          version,
          reviews.get(version.versionId) ?? null,
          version.storagePath === null ? null : (previewUrls[version.storagePath] ?? null),
        ),
      );

      const currentVersion = views.find((version) => version.state === "usable") ?? null;
      const pendingVersion = views.find((version) => version.state === "reserved") ?? null;
      const folder = item.folderId === null ? null : (foldersById.get(item.folderId) ?? null);

      return {
        organizationId,
        itemId: item.itemId,
        label: item.label,
        creativeType: item.creativeType,
        sourceKind: item.sourceKind,
        folderId: item.folderId,
        folderName: folder?.name ?? null,
        folderDefaultMetadata: folder?.defaultMetadata ?? null,
        confirmedMetadata: item.confirmedMetadata,
        proposedMetadata: item.proposedMetadata,
        metadataConfirmed: item.confirmedMetadata !== null,
        rights: item.rights,
        archivedAt: item.archivedAt,
        createdAt: item.createdAt,
        currentVersion,
        pendingVersion,
        versions: views,
        eligibility:
          currentVersion === null
            ? ((item.archivedAt !== null
                ? "archived"
                : "unreviewed") as CreativeHistoryEligibility)
            : creativeEligibility({
                archivedAt: item.archivedAt,
                confirmedMetadata: item.confirmedMetadata,
                currentReview: currentVersion.review,
              }),
        uploadState: uploadStateFor({
          archivedAt: item.archivedAt,
          currentVersion,
          pendingVersion,
        }),
      };
    });
  }

  async function reservationFor(
    organizationId: string,
    clientUploadId: string,
    reserve: (storagePath: string) => Promise<{
      itemId: string;
      versionId: string;
      version: number;
    }>,
  ): Promise<CreativeHistoryReservation> {
    const uploadIntentId = newUploadIntentId();
    const storagePath = dependencies.storagePath({ organizationId, uploadIntentId });
    // Built here, not accepted from the request: a caller that picks its own
    // key can pick another tenant's folder, and the only reason the storage
    // policy would catch that is that somebody remembered to write it.
    if (!storagePath.startsWith(`${organizationId}/`)) notAvailable();

    const reserved = await reserve(storagePath);
    return {
      ...reserved,
      clientUploadId,
      uploadIntentId,
      bucket: dependencies.storage.bucket,
      storagePath,
      intake: intakeContract,
    };
  }

  async function completeOne(input: {
    organizationId: string;
    itemId: string;
    versionId: string;
  }): Promise<CreativeHistoryCompletionOutcome> {
    const item = await dependencies.store.readItem({
      organizationId: input.organizationId,
      itemId: input.itemId,
    });
    if (!item) notAvailable();

    const reserved = item.versions.find((entry) => entry.versionId === input.versionId);
    // The path comes from the row, never from the request. A request that can
    // name its own object can name somebody else's.
    if (!reserved || reserved.storagePath === null) notAvailable();

    const uploaded = await dependencies.objects.download(reserved.storagePath);
    if (!uploaded) {
      return {
        status: "refused",
        itemId: input.itemId,
        versionId: input.versionId,
        reason: "upload_missing",
        message: "No file was found at that upload location. Try uploading it again.",
        uploadState: "refused",
      };
    }

    // A retry after a lost response. The stored object is already the
    // canonical re-encode this server produced, so hashing exactly what came
    // back is an exact comparison — no dependence on the encoder producing
    // identical bytes twice.
    if (reserved.isUsable) {
      const storedHash = sha256(uploaded);
      if (reserved.contentHash !== null && storedHash === reserved.contentHash) {
        return {
          status: "usable",
          itemId: input.itemId,
          versionId: input.versionId,
          replayed: true,
          contentHash: reserved.contentHash,
          mimeType: reserved.mimeType ?? "",
          byteSize: reserved.byteSize ?? uploaded.length,
          widthPx: reserved.widthPx ?? 0,
          heightPx: reserved.heightPx ?? 0,
          uploadState: "needs_review",
        };
      }
      return {
        status: "conflict",
        itemId: input.itemId,
        versionId: input.versionId,
        reason: "changed_bytes",
        message:
          "A different file is now at this upload slot. A finished version is never overwritten — start a new version instead.",
        uploadState: "refused",
      };
    }

    const ingested = await dependencies.ingest({ bytes: uploaded });
    if (ingested.outcome !== "accepted") {
      return {
        status: "refused",
        itemId: input.itemId,
        versionId: input.versionId,
        reason: ingested.reason,
        message: ingested.message,
        uploadState: "refused",
      };
    }

    // Replaces the browser's upload with the metadata-stripped re-encode at the
    // same key. If this fails the version stays unusable, which is the safe
    // direction: a campaign would rather see nothing than bytes nobody checked.
    const stored = await dependencies.objects.upload({
      path: reserved.storagePath,
      bytes: ingested.bytes,
      contentType: ingested.mimeType,
    });
    if (!stored) {
      return {
        status: "refused",
        itemId: input.itemId,
        versionId: input.versionId,
        reason: "storage_failed",
        message: "The checked image could not be stored. Try uploading it again.",
        uploadState: "refused",
      };
    }

    await dependencies.store.finalizeVersion({
      organizationId: input.organizationId,
      versionId: input.versionId,
      contentHash: ingested.contentHash,
      mimeType: ingested.mimeType,
      byteSize: ingested.byteSize,
      widthPx: ingested.widthPx,
      heightPx: ingested.heightPx,
    });

    return {
      status: "usable",
      itemId: input.itemId,
      versionId: input.versionId,
      replayed: false,
      contentHash: ingested.contentHash,
      mimeType: ingested.mimeType,
      byteSize: ingested.byteSize,
      widthPx: ingested.widthPx,
      heightPx: ingested.heightPx,
      // New bytes are always unreviewed, including a new version of a design
      // somebody approved last month. Approval belongs to exact bytes.
      uploadState: "needs_review",
    };
  }

  return {
    /** What the browser may send, and where. Contains no credential. */
    intakeContract(): CreativeHistoryIntakeContract {
      return intakeContract;
    },

    async listFolders(input: { organizationId: string }): Promise<readonly CreativeHistoryFolderView[]> {
      const folders = await dependencies.store.listFolders(input.organizationId);
      return folders.map((folder) => ({
        folderId: folder.folderId,
        parentFolderId: folder.parentFolderId,
        name: folder.name,
        defaultMetadata: folder.defaultMetadata,
        archivedAt: folder.archivedAt,
      }));
    },

    async createFolder(input: { organizationId: string } & CreateCreativeFolderRequest) {
      const { organizationId, ...submitted } = input;
      const request = createCreativeFolderRequestSchema.parse(submitted);

      if (request.parentFolderId !== null) {
        const folders = await dependencies.store.listFolders(organizationId);
        const parent = folders.find((folder) => folder.folderId === request.parentFolderId);
        // Checked here as well as in the trigger. The database refuses a
        // grandchild and a self-parent; this turns both into a sentence an
        // operator can act on, and refuses an archived parent besides.
        if (!parent) notAvailable();
        if (parent.parentFolderId !== null) {
          throw new DomainError(
            "VALIDATION_ERROR",
            "Folders go one level deep. Choose a top-level folder.",
          );
        }
        if (parent.archivedAt !== null) {
          throw new DomainError("VALIDATION_ERROR", "That folder has been archived.");
        }
      }

      return dependencies.store.createFolder({
        organizationId,
        name: request.name,
        parentFolderId: request.parentFolderId,
        defaultMetadata: request.defaultMetadata,
      });
    },

    async list(input: {
      organizationId: string;
      includeArchived?: boolean;
      folderId?: string | null;
      eligibility?: CreativeHistoryEligibility;
    }): Promise<readonly CreativeHistoryItemView[]> {
      const [items, folders] = await Promise.all([
        dependencies.store.listItems({
          organizationId: input.organizationId,
          includeArchived: input.includeArchived ?? false,
        }),
        dependencies.store.listFolders(input.organizationId),
      ]);
      const views = await composeViews(input.organizationId, items, folders);
      return views.filter(
        (view) =>
          (input.folderId === undefined || view.folderId === input.folderId) &&
          (input.eligibility === undefined || view.eligibility === input.eligibility),
      );
    },

    async read(input: {
      organizationId: string;
      itemId: string;
    }): Promise<CreativeHistoryItemView> {
      const [item, folders] = await Promise.all([
        dependencies.store.readItem(input),
        dependencies.store.listFolders(input.organizationId),
      ]);
      if (!item) notAvailable();
      const [view] = await composeViews(input.organizationId, [item], folders);
      if (!view) notAvailable();
      return view;
    },

    /** Step one for a design nobody has uploaded before. */
    async reserveItem(
      input: { organizationId: string } & ReserveCreativeItemRequest,
    ): Promise<CreativeHistoryReservation> {
      const { organizationId, ...submitted } = input;
      const request = reserveCreativeItemRequestSchema.parse(submitted);

      if (request.folderId !== null) {
        const folders = await dependencies.store.listFolders(organizationId);
        // The composite key in the database would refuse another tenant's
        // folder anyway; refusing it here means the operator gets a sentence
        // rather than a constraint name.
        if (!folders.some((folder) => folder.folderId === request.folderId)) notAvailable();
      }

      return reservationFor(organizationId, request.clientUploadId, async (storagePath) => {
        const created = await dependencies.store.createItem({
          organizationId,
          folderId: request.folderId,
          label: request.label,
          creativeType: request.creativeType,
          sourceKind: request.sourceKind,
          rights: creativeHistoryRightsSchema.parse(request.rights),
          storagePath,
        });
        return { ...created, version: 1 };
      });
    },

    /** Step one for a replacement file on a design that already exists. */
    async reserveVersion(
      input: { organizationId: string } & ReserveCreativeVersionRequest,
    ): Promise<CreativeHistoryReservation> {
      const { organizationId, ...submitted } = input;
      const request = reserveCreativeVersionRequestSchema.parse(submitted);
      return reservationFor(organizationId, request.clientUploadId, (storagePath) =>
        dependencies.store.reserveVersion({
          organizationId,
          itemId: request.itemId,
          storagePath,
        }),
      );
    },

    /** Step three: read the bytes back and decide. */
    async complete(
      input: { organizationId: string } & CompleteCreativeUploadRequest,
    ): Promise<CreativeHistoryCompletionOutcome> {
      const { organizationId, ...submitted } = input;
      const request = completeCreativeUploadRequestSchema.parse(submitted);
      return completeOne({ organizationId, ...request });
    },

    /**
     * A batch, where each file answers for itself.
     *
     * One corrupt file in five leaves four usable designs and one to retry.
     * Rolling the four back would throw away work nobody found fault with, and
     * an operator who has to re-upload everything after one failure stops
     * uploading anything.
     */
    async completeBatch(input: {
      organizationId: string;
      uploads: readonly CompleteCreativeUploadRequest[];
    }): Promise<CreativeHistoryBatchCompletionOutcome> {
      const outcomes: CreativeHistoryCompletionOutcome[] = [];
      for (const upload of input.uploads) {
        const request = completeCreativeUploadRequestSchema.parse(upload);
        try {
          outcomes.push(await completeOne({ organizationId: input.organizationId, ...request }));
        } catch (error) {
          // An unavailable member is still just one member. It is reported as
          // refused rather than thrown, so the rest of the batch survives it.
          outcomes.push({
            status: "refused",
            itemId: request.itemId,
            versionId: request.versionId,
            reason: "upload_missing",
            message:
              error instanceof DomainError
                ? error.message
                : "That upload could not be finished. Try uploading it again.",
            uploadState: "refused",
          });
        }
      }

      return {
        outcomes,
        usableCount: outcomes.filter((outcome) => outcome.status === "usable").length,
        // A conflict is not retryable at the same slot: those bytes are final.
        retryable: outcomes
          .filter((outcome) => outcome.status === "refused")
          .map((outcome) => ({ itemId: outcome.itemId, versionId: outcome.versionId })),
      };
    },

    /**
     * A human verdict on exact bytes.
     *
     * `asset.review` gates this and `asset.manage` gates everything else, so
     * the person who uploads a design is not automatically the person who
     * decides it was any good.
     */
    async review(input: { organizationId: string } & CreativeHistoryReviewRequest) {
      const { organizationId, ...submitted } = input;
      const request = creativeHistoryReviewRequestSchema.parse(submitted);
      const item = await dependencies.store.readItem({
        organizationId,
        itemId: request.itemId,
      });
      if (!item) notAvailable();

      const version = item.versions.find((entry) => entry.versionId === request.versionId);
      // A verdict names a version, and that version has to belong to the design
      // in the URL. Otherwise an approval could be aimed at somebody else's
      // bytes by editing one id in the request.
      if (!version) notAvailable();
      if (!version.isUsable) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "This design cannot be reviewed until its file has finished uploading.",
        );
      }

      return dependencies.store.recordReview({
        organizationId,
        versionId: request.versionId,
        verdict: request.verdict,
        reasonCodes: request.reasonCodes,
        note: request.note,
      });
    },

    /** What a person says this design is a picture of. */
    async confirmMetadata(
      input: { organizationId: string } & ConfirmCreativeMetadataRequest,
    ) {
      const { organizationId, ...submitted } = input;
      const request = confirmCreativeMetadataRequestSchema.parse(submitted);
      return dependencies.store.writeMetadata({
        organizationId,
        itemId: request.itemId,
        confirmedMetadata: request.confirmedMetadata,
      });
    },

    /**
     * What a model suggested this design is a picture of.
     *
     * Deliberately a separate method from `confirmMetadata`, writing a separate
     * column. A suggestion that could reach the confirmed column would make a
     * model's guess look like a person's answer, and selection eligibility
     * turns on that column.
     */
    async proposeMetadata(
      input: { organizationId: string } & ProposeCreativeMetadataRequest,
    ) {
      const { organizationId, ...submitted } = input;
      const request = proposeCreativeMetadataRequestSchema.parse(submitted);
      return dependencies.store.writeMetadata({
        organizationId,
        itemId: request.itemId,
        proposedMetadata: request.proposedMetadata,
      });
    },

    /** Archiving hides a design from selection and keeps every receipt it earned. */
    async archive(input: { organizationId: string; itemId: string }) {
      return dependencies.store.archiveItem({
        organizationId: input.organizationId,
        itemId: uuidSchema.parse(input.itemId),
      });
    },

    async reviewReasons() {
      return dependencies.store.listReviewReasons();
    },
  };
}

export type CreativeHistoryService = ReturnType<typeof createCreativeHistoryService>;
