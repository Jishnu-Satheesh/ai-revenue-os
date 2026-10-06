import { z } from "zod";

import { creativeEligibility } from "@/domain/campaigns/creative-history";
import {
  admitGenerationReferences,
  studioReferenceSchema,
  type StudioReference,
} from "@/domain/creative-studio/schemas";
import { studioReferenceManifestDigest } from "@/domain/creative-studio/digest";
import {
  studioProviderProfileSchema,
  type StudioProviderProfile,
} from "@/domain/creative-studio/provider";
import { DomainError } from "@/lib/errors";
import type { BrandLogoSelection } from "@/domain/brand/logo";
import type { AssetLibraryReference } from "@/modules/campaigns/application/asset-library-service";
import type { CreativeHistoryItemRecord } from "@/modules/campaigns/application/creative-history-service";
import type {
  StudioReferenceSignEntry,
  StudioUploadRecord,
} from "@/modules/creative-studio/infrastructure/reference-reader";

/**
 * The validated source manifest: approved history, fresh uploads, products,
 * and brand marks, resolved against current eligibility and the qualified
 * provider's capacity.
 *
 * This is the manifest boundary. Everything generation may read is pinned
 * here by immutable identity, and everything that may not read is excluded
 * here with its reason — rejected and unreviewed history never become
 * references (the domain type cannot even name a rejected design), foreign
 * ids read as absent, and a review revoked between pick and dispatch excludes
 * on rebuild because every build reads fresh state. Nothing is cached, and
 * the original source records are never written: exclusion is a decision
 * about this manifest, not a change to the library.
 *
 * Capacity is enforced here too, against the Task 2 provider profile limits:
 * the per-kind ceilings first, then the profile's total image and payload
 * caps including the parent image and marker overlay the provider also
 * carries. Profile enablement and ratio support are dispatch-time checks and
 * stay with Task 5.
 */

// Where each reference kind's bytes live. The buckets are created by their
// own migrations (`studio-uploads` with the Studio tables, `creative-assets`
// with Creative History, `brand-assets` with the asset library); the paths
// come from the source records, never from the request.
const STUDIO_UPLOADS_BUCKET = "studio-uploads";
const CREATIVE_HISTORY_BUCKET = "creative-assets";
const BRAND_ASSETS_BUCKET = "brand-assets";

const uuidSchema = z.string().uuid();
const referenceIdSchema = z.string().trim().min(1).max(120);

const historySelectionSchema = z.strictObject({
  referenceId: referenceIdSchema,
  itemId: uuidSchema,
  versionId: uuidSchema,
});

const uploadSelectionSchema = z.strictObject({
  referenceId: referenceIdSchema,
  uploadId: uuidSchema,
});

const librarySelectionSchema = z.strictObject({
  referenceId: referenceIdSchema,
  versionId: uuidSchema,
});

export const studioManifestSelectionSchema = z.strictObject({
  history: z.array(historySelectionSchema),
  uploads: z.array(uploadSelectionSchema),
  products: z.array(librarySelectionSchema),
  marks: z.array(librarySelectionSchema),
});
export type StudioManifestSelection = z.infer<typeof studioManifestSelectionSchema>;

export type StudioManifestExclusionReason =
  | "not_found"
  | "not_ready"
  | "expired"
  | "rejected"
  | "unreviewed"
  | "archived"
  | "metadata_unconfirmed"
  | "version_not_usable"
  | "rights_missing"
  | "hash_missing"
  | "not_a_product"
  | "not_selected";

export type StudioManifestExclusion = {
  referenceId: string;
  kind: StudioReference["kind"];
  reason: StudioManifestExclusionReason;
  detail: string;
};

export type StudioReferenceManifest = {
  references: StudioReference[];
  digest: string;
  excluded: StudioManifestExclusion[];
  totalImages: number;
  estimatedInputBytes: number;
};

export type StudioReferencePreviewRefresh = {
  /** A null URL means the reference resolved ineligible: sign nothing for it. */
  previews: Record<string, string | null>;
  excluded: StudioManifestExclusion[];
};

export type StudioReferenceServiceDependencies = {
  readUpload(organizationId: string, uploadId: string): Promise<StudioUploadRecord | null>;
  readHistoryItem(
    organizationId: string,
    itemId: string,
  ): Promise<CreativeHistoryItemRecord | null>;
  listLibraryReferences(organizationId: string): Promise<readonly AssetLibraryReference[]>;
  readLogoSelections(organizationId: string): Promise<readonly BrandLogoSelection[]>;
  keyFor(entry: StudioReferenceSignEntry): string;
  signPaths(entries: readonly StudioReferenceSignEntry[]): Promise<Readonly<Record<string, string>>>;
};

type ResolvedSource = {
  reference: StudioReference;
  byteSize: number;
  bucket: string;
  storagePath: string;
};

type Selection =
  | { eligible: true; resolved: ResolvedSource }
  | { eligible: false; reason: StudioManifestExclusionReason; detail: string };

function historySelection(
  record: CreativeHistoryItemRecord | null,
  versionId: string,
): Selection {
  if (!record) {
    return {
      eligible: false,
      reason: "not_found",
      detail: "That design is not available in this organization.",
    };
  }
  const version = record.versions.find((entry) => entry.versionId === versionId) ?? null;
  if (!version) {
    return {
      eligible: false,
      reason: "not_found",
      detail: "That design version is not available in this organization.",
    };
  }
  // A design can be reviewed more than once; the most recent verdict is the
  // one that counts — the same latest-per-version rule the library applies
  // when it composes its views.
  const review =
    [...record.reviews]
      .filter((entry) => entry.versionId === versionId)
      .sort(
        (left, right) =>
          right.reviewedAt.localeCompare(left.reviewedAt) ||
          right.reviewId.localeCompare(left.reviewId),
      )[0] ?? null;
  // Eligibility is the authoritative rule, applied to the selected version's
  // own review — restating it here is how a design nobody reviewed would end
  // up treated as approved.
  const eligibility = creativeEligibility({
    archivedAt: record.archivedAt,
    confirmedMetadata: record.confirmedMetadata,
    currentReview: review ? { verdict: review.verdict } : null,
  });
  if (eligibility !== "eligible_approved") {
    const reason =
      eligibility === "archived"
        ? "archived"
        : eligibility === "metadata_unconfirmed"
          ? "metadata_unconfirmed"
          : eligibility === "unreviewed"
            ? "unreviewed"
            : "rejected";
    const detail =
      reason === "rejected"
        ? "That design was rejected in review, so it cannot be a reference."
        : reason === "unreviewed"
          ? "That design has not been reviewed yet, so it cannot be a reference."
          : reason === "archived"
            ? "That design has been archived, so it cannot be a reference."
            : "That design's details were never confirmed, so it cannot be a reference.";
    return { eligible: false, reason, detail };
  }
  if (
    !version.isUsable ||
    !review ||
    !version.contentHash ||
    !version.storagePath ||
    !version.byteSize
  ) {
    return {
      eligible: false,
      reason: "version_not_usable",
      detail: "That design's approved bytes are not available.",
    };
  }
  return {
    eligible: true,
    resolved: {
      reference: {
        kind: "approved_history",
        referenceId: "",
        versionId: version.versionId,
        reviewId: review.reviewId,
        contentHash: version.contentHash,
      },
      byteSize: version.byteSize,
      bucket: CREATIVE_HISTORY_BUCKET,
      storagePath: version.storagePath,
    },
  };
}

function uploadSelection(record: StudioUploadRecord | null): Selection {
  if (!record) {
    return {
      eligible: false,
      reason: "not_found",
      detail: "That upload is not available in this organization.",
    };
  }
  if (record.state === "expired") {
    return {
      eligible: false,
      reason: "expired",
      detail: "That upload expired before it was finalized.",
    };
  }
  if (record.state === "rejected") {
    return {
      eligible: false,
      reason: "rejected",
      detail: "That upload was refused, so it cannot be a reference.",
    };
  }
  if (record.state !== "ready") {
    return {
      eligible: false,
      reason: "not_ready",
      detail: "That upload has not been finalized yet, so it cannot be a reference.",
    };
  }
  const attestation = record.rightsAttestation;
  const attestationId = attestation["attestationId"];
  if (attestation["accepted"] !== true || typeof attestationId !== "string") {
    return {
      eligible: false,
      reason: "rights_missing",
      detail: "That upload carries no accepted rights attestation, so it cannot be a reference.",
    };
  }
  const attestationUuid = uuidSchema.safeParse(attestationId);
  if (
    !attestationUuid.success ||
    !record.finalHash ||
    !record.finalBytes ||
    !record.reservedPath
  ) {
    return {
      eligible: false,
      reason: "hash_missing",
      detail: "That upload's finalized record is incomplete, so it cannot be a reference.",
    };
  }
  // A fresh upload enters as an explicitly authorized current reference: the
  // attestation id travels in the manifest arm, and nothing here promotes it
  // to approved history.
  return {
    eligible: true,
    resolved: {
      reference: {
        kind: "uploaded_reference",
        referenceId: "",
        uploadId: record.uploadId,
        rightsAttestationId: attestationUuid.data,
        contentHash: record.finalHash,
      },
      byteSize: record.finalBytes,
      bucket: STUDIO_UPLOADS_BUCKET,
      storagePath: record.reservedPath,
    },
  };
}

function productSelection(
  references: readonly AssetLibraryReference[],
  versionId: string,
): Selection {
  const reference = references.find((entry) => entry.brandAssetVersionId === versionId) ?? null;
  // The library lists validated versions only; absence here also covers a
  // version whose bytes were never checked.
  if (!reference) {
    return {
      eligible: false,
      reason: "not_found",
      detail: "That product image is not available in this organization.",
    };
  }
  if (reference.archivedAt !== null) {
    return {
      eligible: false,
      reason: "archived",
      detail: "That product image has been archived, so it cannot be a reference.",
    };
  }
  if (reference.assetRole !== "product") {
    return {
      eligible: false,
      reason: "not_a_product",
      detail: "That image is not a product image, so it cannot be a product reference.",
    };
  }
  // Product photography is subject evidence, not historical creative: no
  // review verdict is required, only validated bytes.
  return {
    eligible: true,
    resolved: {
      reference: {
        kind: "product",
        referenceId: "",
        versionId: reference.brandAssetVersionId,
        contentHash: reference.contentHash,
      },
      byteSize: reference.byteSize,
      bucket: BRAND_ASSETS_BUCKET,
      storagePath: reference.storagePath,
    },
  };
}

function brandMarkSelection(input: {
  logos: readonly BrandLogoSelection[];
  references: readonly AssetLibraryReference[];
  versionId: string;
}): Selection {
  const selected = input.logos.some((entry) => entry.brandAssetVersionId === input.versionId);
  if (!selected) {
    return {
      eligible: false,
      reason: "not_selected",
      detail: "That image is not a selected brand mark, so it cannot be a mark reference.",
    };
  }
  const reference =
    input.references.find((entry) => entry.brandAssetVersionId === input.versionId) ?? null;
  if (!reference) {
    return {
      eligible: false,
      reason: "not_found",
      detail: "That brand mark is not available in this organization.",
    };
  }
  // The storage half of the display-logo rule: a mark the platform refuses
  // to display must not be one it hands an image model. (Signing is the
  // other half and happens at preview time, not here.)
  if (reference.archivedAt !== null) {
    return {
      eligible: false,
      reason: "archived",
      detail: "That brand mark has been archived, so it cannot be a reference.",
    };
  }
  if (reference.currentVerdict === "rejected") {
    return {
      eligible: false,
      reason: "rejected",
      detail: "That brand mark was rejected in review, so it cannot be a reference.",
    };
  }
  return {
    eligible: true,
    resolved: {
      reference: {
        kind: "brand_mark",
        referenceId: "",
        versionId: reference.brandAssetVersionId,
        contentHash: reference.contentHash,
      },
      byteSize: reference.byteSize,
      bucket: BRAND_ASSETS_BUCKET,
      storagePath: reference.storagePath,
    },
  };
}

export function createStudioReferenceService(dependencies: StudioReferenceServiceDependencies) {
  async function resolveSelection(input: {
    organizationId: string;
    selection: StudioManifestSelection;
  }): Promise<{ resolved: { referenceId: string; resolved: ResolvedSource }[]; excluded: StudioManifestExclusion[] }> {
    const resolved: { referenceId: string; resolved: ResolvedSource }[] = [];
    const excluded: StudioManifestExclusion[] = [];

    const take = (
      referenceId: string,
      kind: StudioReference["kind"],
      selection: Selection,
    ): void => {
      if (!selection.eligible) {
        excluded.push({ referenceId, kind, reason: selection.reason, detail: selection.detail });
        return;
      }
      const reference = studioReferenceSchema.parse({
        ...selection.resolved.reference,
        referenceId,
      });
      resolved.push({ referenceId, resolved: { ...selection.resolved, reference } });
    };

    // One read per named item even when several versions come from it.
    const historyItems = new Map<string, CreativeHistoryItemRecord | null>();
    for (const entry of input.selection.history) {
      if (!historyItems.has(entry.itemId)) {
        historyItems.set(
          entry.itemId,
          await dependencies.readHistoryItem(input.organizationId, entry.itemId),
        );
      }
      take(
        entry.referenceId,
        "approved_history",
        historySelection(historyItems.get(entry.itemId) ?? null, entry.versionId),
      );
    }

    for (const entry of input.selection.uploads) {
      take(
        entry.referenceId,
        "uploaded_reference",
        uploadSelection(await dependencies.readUpload(input.organizationId, entry.uploadId)),
      );
    }

    const library =
      input.selection.products.length + input.selection.marks.length > 0
        ? await dependencies.listLibraryReferences(input.organizationId)
        : [];
    for (const entry of input.selection.products) {
      take(entry.referenceId, "product", productSelection(library, entry.versionId));
    }

    if (input.selection.marks.length > 0) {
      const logos = await dependencies.readLogoSelections(input.organizationId);
      for (const entry of input.selection.marks) {
        take(
          entry.referenceId,
          "brand_mark",
          brandMarkSelection({ logos, references: library, versionId: entry.versionId }),
        );
      }
    }

    return { resolved, excluded };
  }

  function checkReferenceIds(selection: StudioManifestSelection): void {
    const ids = [
      ...selection.history.map((entry) => entry.referenceId),
      ...selection.uploads.map((entry) => entry.referenceId),
      ...selection.products.map((entry) => entry.referenceId),
      ...selection.marks.map((entry) => entry.referenceId),
    ];
    if (new Set(ids).size !== ids.length) {
      throw new DomainError("VALIDATION_ERROR", "Reference ids must be unique within a manifest.");
    }
  }

  return {
    /**
     * Builds the validated manifest for a selection.
     *
     * Ineligible entries are excluded with their reasons; breaching a kind
     * ceiling or the profile's total capacity refuses the whole build,
     * because silently dropping a selected reference would change what the
     * operator asked to generate from.
     */
    async buildManifest(input: {
      organizationId: string;
      selection: unknown;
      profile: unknown;
      parentImageCount?: number;
      markerOverlayCount?: number;
      additionalInputBytes?: number;
    }): Promise<StudioReferenceManifest> {
      const organizationId = uuidSchema.parse(input.organizationId);
      const selection = studioManifestSelectionSchema.parse(input.selection);
      const profile: StudioProviderProfile = studioProviderProfileSchema.parse(input.profile);
      const parentImageCount = z.number().int().min(0).max(8).default(0).parse(input.parentImageCount);
      const markerOverlayCount = z
        .number()
        .int()
        .min(0)
        .max(8)
        .default(0)
        .parse(input.markerOverlayCount);
      const additionalInputBytes = z
        .number()
        .int()
        .min(0)
        .default(0)
        .parse(input.additionalInputBytes);
      checkReferenceIds(selection);

      const { resolved, excluded } = await resolveSelection({ organizationId, selection });
      const references = resolved.map((entry) => entry.resolved.reference);

      // Serialized payloads carry base64, so every stored byte costs ~4/3 on
      // the wire. The estimate deliberately overcounts rather than admitting
      // a manifest the provider would refuse halfway through dispatch.
      const estimatedInputBytes =
        Math.ceil(
          resolved.reduce((total, entry) => total + entry.resolved.byteSize, 0) * 4 / 3,
        ) + additionalInputBytes;
      const admission = admitGenerationReferences({
        references,
        parentImageCount,
        markerOverlayCount,
        estimatedInputBytes,
        profile: { maxImages: profile.maxImages, maxInputBytes: profile.maxInputBytes },
      });
      if (!admission.admitted) {
        throw new DomainError("VALIDATION_ERROR", admission.detail);
      }

      return {
        references,
        digest: studioReferenceManifestDigest(
          references.map((reference) => ({
            referenceId: reference.referenceId,
            kind: reference.kind,
            contentHash: reference.contentHash,
          })),
        ),
        excluded,
        totalImages: references.length + parentImageCount + markerOverlayCount,
        estimatedInputBytes,
      };
    },

    /**
     * Signs current previews for a selection, re-resolving eligibility first.
     *
     * An expired preview signs anew against the same storage identity — same
     * bucket, same path, new URL. A reference revoked since the manifest was
     * built signs nothing: its URL is null and it is excluded, because
     * revoked bytes must not be handed out again through a refresh.
     */
    async refreshPreviews(input: {
      organizationId: string;
      selection: unknown;
    }): Promise<StudioReferencePreviewRefresh> {
      const organizationId = uuidSchema.parse(input.organizationId);
      const selection = studioManifestSelectionSchema.parse(input.selection);
      checkReferenceIds(selection);

      const { resolved, excluded } = await resolveSelection({ organizationId, selection });
      const urls = await dependencies.signPaths(
        resolved.map((entry) => ({
          bucket: entry.resolved.bucket,
          path: entry.resolved.storagePath,
        })),
      );

      const previews: Record<string, string | null> = {};
      for (const entry of resolved) {
        previews[entry.referenceId] =
          urls[
            dependencies.keyFor({ bucket: entry.resolved.bucket, path: entry.resolved.storagePath })
          ] ?? null;
      }
      for (const entry of excluded) {
        previews[entry.referenceId] = null;
      }
      return { previews, excluded };
    },
  };
}
