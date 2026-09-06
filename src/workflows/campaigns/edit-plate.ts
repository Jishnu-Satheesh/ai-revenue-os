import { logger } from "@/lib/logger";
import { admitPlateEdit, type PlateAnnotation } from "@/domain/campaigns/plate-edit";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type {
  MaskedEditRequest,
  MaskedEditResult,
} from "@/modules/campaigns/infrastructure/plate-compositor";
import type { CampaignPlateEditPayload } from "@/workflows/campaigns/contracts";

/**
 * Changing part of a plate, and only that part.
 *
 * The order here is the whole safety argument, so it is worth reading as an
 * order rather than a list. The regions are admitted first, against the plate's
 * real dimensions. The model is then asked for a new image, and whatever it
 * returns is composited back inside the marks -- so nothing it does can reach a
 * pixel the operator did not mark, however the instruction was worded.
 *
 * Then the result becomes a **new bundle version**, not a quiet substitution
 * into the old one. Assets are material by the repository's own rule: an edited
 * plate changes what a client would publish, so it changes the digest, and a
 * changed digest invalidates the approval that was given for something else.
 * Editing in place would leave an approval pointing at an image nobody
 * approved, which is the exact failure the version chain exists to prevent.
 *
 * A caller wanting the old behaviour -- edit the approved thing quietly -- is
 * asking for a thing this system deliberately cannot do.
 */

export type PlateEditContext = {
  readonly manifest: CampaignBundleManifest;
  readonly parentStoragePath: string;
  readonly parentContentHash: string;
  readonly parentWidthPx: number;
  readonly parentHeightPx: number;
  readonly parentMimeType: "image/png" | "image/jpeg" | "image/webp";
  /** True when an approval is live against the parent version right now. */
  readonly parentVersionApproved: boolean;
  readonly negativeRules: readonly string[];
};

export type PlateEditContextReader = {
  read(input: {
    organizationId: string;
    campaignId: string;
    bundleVersionId: string;
    parentPlateAssetId: string;
  }): Promise<PlateEditContext | null>;
};

export type PlateEditPlanner = {
  /**
   * Asks the model for the edited image. Returns bytes and nothing decided:
   * the caller composites, and the caller judges.
   */
  draw(input: {
    prompt: string;
    parent: Uint8Array;
    parentMimeType: "image/png" | "image/jpeg" | "image/webp";
    widthPx: number;
    heightPx: number;
    signal: AbortSignal;
  }): Promise<{ bytes: Uint8Array; modelId: string; costMinor: number | null }>;
};

export type PlateEditStore = {
  record(input: {
    organizationId: string;
    campaignId: string;
    parentPlateAssetId: string;
    childPlateAssetId: string;
    maskStoragePath: string;
    maskContentHash: string;
    unionCoverageRatio: number;
    annotations: readonly PlateAnnotation[];
    negativeRules: readonly string[];
    modelId: string;
    costMinor: number | null;
    idempotencyKey: string;
    editedBy: string;
  }): Promise<{ editId: string; childPlateAssetId: string; replayed: boolean }>;
};

export type EditedVersionWriter = {
  /**
   * Creates the successor version carrying the edited plate, and returns the
   * asset id the new version gave it. The digest changes, so any approval
   * against the parent stops applying.
   */
  create(input: {
    organizationId: string;
    campaignId: string;
    parentBundleVersionId: string;
    replacingAssetId: string;
    storagePath: string;
    contentHash: string;
    widthPx: number;
    heightPx: number;
  }): Promise<{ bundleVersionId: string; assetId: string } | null>;
};

export type PlateEditUploader = {
  upload(input: {
    path: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
};

export type EditPlateDependencies = {
  context: PlateEditContextReader;
  plates: { read(storagePath: string): Promise<Uint8Array | null> };
  planner: PlateEditPlanner;
  composite: (request: MaskedEditRequest) => Promise<MaskedEditResult>;
  /**
   * Two buckets, deliberately. The edited plate is creative and belongs beside
   * every other campaign asset; the union mask is provenance -- it says which
   * pixels a model was allowed to touch -- and belongs in `campaign-masks`,
   * which has its own policies and is never served as creative. One storage for
   * both would put an internal artefact in the bucket the platform publishes
   * from.
   */
  plateStorage: PlateEditUploader;
  maskStorage: PlateEditUploader;
  versions: EditedVersionWriter;
  edits: PlateEditStore;
  isCancelled: () => boolean;
};

export type EditPlateResult =
  | {
      status: "edited";
      editId: string;
      childPlateAssetId: string;
      bundleVersionId: string;
      replayed: boolean;
      /** True when this edit invalidated a live approval. Say so out loud. */
      invalidatedApproval: boolean;
    }
  | { status: "refused"; refusalCode: string; detail: string }
  | {
      status: "skipped";
      reason:
        | "context_unavailable"
        | "plate_unavailable"
        | "upload_failed"
        | "version_unavailable"
        | "cancelled";
    };

export function plateEditObjectPath(input: {
  organizationId: string;
  campaignId: string;
  bundleVersionId: string;
  contentHash: string;
  kind: "plate" | "mask";
}): string {
  return `${input.organizationId}/${input.campaignId}/${input.bundleVersionId}/edits/${input.kind}-${input.contentHash}.png`;
}

export async function editCampaignPlate(
  payload: CampaignPlateEditPayload,
  dependencies: EditPlateDependencies,
  buildPrompt: (input: {
    annotations: readonly PlateAnnotation[];
    negativeRules: readonly string[];
    plateWidthPx: number;
    plateHeightPx: number;
  }) => string,
  signal: AbortSignal,
): Promise<EditPlateResult> {
  if (dependencies.isCancelled()) return { status: "skipped", reason: "cancelled" };

  const context = await dependencies.context.read({
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    bundleVersionId: payload.bundleVersionId,
    parentPlateAssetId: payload.parentPlateAssetId,
  });
  if (context === null) return { status: "skipped", reason: "context_unavailable" };

  // Admitted against the plate's real size, before a model is paid anything.
  const admission = admitPlateEdit({
    annotations: payload.annotations,
    plateWidthPx: context.parentWidthPx,
    plateHeightPx: context.parentHeightPx,
  });

  if (!admission.admitted) {
    return {
      status: "refused",
      refusalCode: admission.refusals[0].code,
      detail: admission.refusals.map((refusal) => refusal.detail).join(" "),
    };
  }

  const parent = await dependencies.plates.read(context.parentStoragePath);
  if (parent === null) return { status: "skipped", reason: "plate_unavailable" };

  if (dependencies.isCancelled()) return { status: "skipped", reason: "cancelled" };

  const drawn = await dependencies.planner.draw({
    prompt: buildPrompt({
      annotations: payload.annotations,
      negativeRules: context.negativeRules,
      plateWidthPx: context.parentWidthPx,
      plateHeightPx: context.parentHeightPx,
    }),
    parent,
    parentMimeType: context.parentMimeType,
    widthPx: context.parentWidthPx,
    heightPx: context.parentHeightPx,
    signal,
  });

  // Whatever came back, bounded to the marks.
  const composited = await dependencies.composite({
    parent: Buffer.from(parent),
    child: Buffer.from(drawn.bytes),
    regions: payload.annotations.map((annotation) => annotation.bounds),
  });

  if (!composited.composited) {
    return {
      status: "refused",
      refusalCode: composited.refusalCode,
      detail: composited.detail,
    };
  }

  const platePath = plateEditObjectPath({
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    bundleVersionId: payload.bundleVersionId,
    contentHash: composited.contentHash,
    kind: "plate",
  });
  const maskPath = plateEditObjectPath({
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    bundleVersionId: payload.bundleVersionId,
    contentHash: composited.maskContentHash,
    kind: "mask",
  });

  // Both objects exist before any row points at either of them.
  const storedPlate = await dependencies.plateStorage.upload({
    path: platePath,
    bytes: composited.png,
    contentType: "image/png",
  });
  if (!storedPlate.ok) return { status: "skipped", reason: "upload_failed" };

  const storedMask = await dependencies.maskStorage.upload({
    path: maskPath,
    bytes: composited.maskPng,
    contentType: "image/png",
  });
  if (!storedMask.ok) return { status: "skipped", reason: "upload_failed" };

  const version = await dependencies.versions.create({
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    parentBundleVersionId: payload.bundleVersionId,
    replacingAssetId: payload.parentPlateAssetId,
    storagePath: platePath,
    contentHash: composited.contentHash,
    widthPx: composited.widthPx,
    heightPx: composited.heightPx,
  });
  if (version === null) return { status: "skipped", reason: "version_unavailable" };

  const recorded = await dependencies.edits.record({
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    parentPlateAssetId: payload.parentPlateAssetId,
    childPlateAssetId: version.assetId,
    maskStoragePath: maskPath,
    maskContentHash: composited.maskContentHash,
    unionCoverageRatio: admission.unionCoverageRatio,
    annotations: payload.annotations,
    negativeRules: context.negativeRules,
    modelId: drawn.modelId,
    costMinor: drawn.costMinor,
    idempotencyKey: payload.idempotencyKey,
    editedBy: payload.editedBy,
  });

  logger.info("campaign.plate_edited", {
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    correlationId: payload.correlationId,
  });

  return {
    status: "edited",
    editId: recorded.editId,
    childPlateAssetId: recorded.childPlateAssetId,
    bundleVersionId: version.bundleVersionId,
    replayed: recorded.replayed,
    invalidatedApproval: context.parentVersionApproved,
  };
}
