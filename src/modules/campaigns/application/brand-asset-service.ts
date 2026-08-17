import { z } from "zod";

import { DomainError } from "@/lib/errors";
import type { AssetIntakeResult } from "@/modules/campaigns/infrastructure/asset-intake";

/**
 * Turning an upload into a brand asset a campaign may use.
 *
 * The flow is deliberately three steps rather than one. The database reserves a
 * row and a path; the browser puts bytes at that path; the server then fetches
 * those bytes back, identifies them from their own leading signature,
 * re-encodes them, and only then marks the version usable.
 *
 * The round trip is the point. A single upload endpoint would have to believe
 * whatever the browser said the file was, and "believe the client" is how an
 * arbitrary file ends up stored under an image label. Reading the object back
 * means the only thing that ever decides is the bytes themselves.
 */

export const brandAssetReservationSchema = z.strictObject({
  brandAssetId: z.string().uuid(),
  versionId: z.string().uuid(),
  storagePath: z.string().min(1).max(1024),
});
export type BrandAssetReservation = z.infer<typeof brandAssetReservationSchema>;

export type BrandAssetStore = {
  reserve(input: {
    organizationId: string;
    brandAssetId: string | null;
    label: string | null;
    assetRole: string | null;
  }): Promise<BrandAssetReservation>;
  finalize(input: {
    organizationId: string;
    versionId: string;
    contentHash: string;
    mimeType: string;
    byteSize: number;
    widthPx: number;
    heightPx: number;
  }): Promise<void>;
};

export type BrandAssetObjectStore = {
  download(path: string): Promise<Buffer | null>;
  upload(input: { path: string; bytes: Buffer; contentType: string }): Promise<boolean>;
};

export type BrandAssetIntake = (input: { bytes: Buffer }) => Promise<AssetIntakeResult>;

export type BrandAssetServiceDependencies = {
  store: BrandAssetStore;
  objects: BrandAssetObjectStore;
  ingest: BrandAssetIntake;
};

export type CompleteUploadResult =
  | { status: "usable"; versionId: string; contentHash: string }
  | { status: "rejected"; reason: string; message: string };

export function createBrandAssetService(dependencies: BrandAssetServiceDependencies) {
  return {
    /** Step one: reserve the row and the path the browser will upload to. */
    async reserve(input: {
      organizationId: string;
      brandAssetId?: string;
      label?: string;
      assetRole?: string;
    }): Promise<BrandAssetReservation> {
      // Either an existing asset gets a new version, or a new asset is named.
      // Neither-nor would create an unlabelled asset nobody can identify later.
      if (!input.brandAssetId && (!input.label || !input.assetRole)) {
        throw new DomainError("VALIDATION_ERROR", "A new brand asset needs a label and a role.");
      }

      return dependencies.store.reserve({
        organizationId: input.organizationId,
        brandAssetId: input.brandAssetId ?? null,
        label: input.label ?? null,
        assetRole: input.assetRole ?? null,
      });
    },

    /**
     * Step three: read the uploaded bytes back and decide.
     *
     * Nothing the client said about the file is consulted. The re-encoded
     * bytes replace what was uploaded, so what is stored is a file this server
     * produced — which is also what strips the EXIF a venue photo arrives with.
     */
    async complete(input: {
      organizationId: string;
      versionId: string;
      storagePath: string;
    }): Promise<CompleteUploadResult> {
      // The path is checked against the tenant even though the database issued
      // it, because this method takes it from a request.
      if (!input.storagePath.startsWith(`${input.organizationId}/`)) {
        throw new DomainError("TENANT_SCOPE_ERROR", "That upload is not available.");
      }

      const uploaded = await dependencies.objects.download(input.storagePath);
      if (!uploaded) {
        return {
          status: "rejected",
          reason: "upload_missing",
          message: "No file was found at that upload location.",
        };
      }

      const ingested = await dependencies.ingest({ bytes: uploaded });
      if (ingested.outcome !== "accepted") {
        return { status: "rejected", reason: ingested.reason, message: ingested.message };
      }

      // Replaces the uploaded object with the canonical, metadata-stripped
      // version. If this fails the version stays unusable, which is the safe
      // direction: generation would rather see nothing than see bytes nobody
      // validated.
      const stored = await dependencies.objects.upload({
        path: input.storagePath,
        bytes: ingested.bytes,
        contentType: ingested.mimeType,
      });
      if (!stored) {
        return {
          status: "rejected",
          reason: "storage_failed",
          message: "The validated image could not be stored. Try uploading again.",
        };
      }

      await dependencies.store.finalize({
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
        versionId: input.versionId,
        contentHash: ingested.contentHash,
      };
    },
  };
}
