import "server-only";

import { createHash } from "node:crypto";

import sharp from "sharp";
import type { Sharp } from "sharp";

/**
 * Turning an uploaded file into something a campaign may use.
 *
 * A browser's declared content type is a claim, not evidence: it is chosen by
 * whoever made the request. So nothing here trusts it. The bytes are identified
 * by their own leading signature, decoded, re-encoded server-side, and only
 * then hashed. Re-encoding is the step that matters most — it strips EXIF
 * (which routinely carries the exact GPS coordinates of a venue and the device
 * that took the photo) and it means the stored file is one this server produced
 * rather than one a stranger handed us.
 */

export type AssetIntakeFormat = "image/jpeg" | "image/png" | "image/webp";

export type AssetIntakeLimits = {
  maxBytes: number;
  maxWidthPx: number;
  maxHeightPx: number;
  minWidthPx: number;
  minHeightPx: number;
};

export const DEFAULT_ASSET_INTAKE_LIMITS: AssetIntakeLimits = {
  maxBytes: 15 * 1024 * 1024,
  maxWidthPx: 8_000,
  maxHeightPx: 8_000,
  // Below this an image cannot be a usable social asset at any placement, and
  // accepting it would only defer the failure to the provider.
  minWidthPx: 200,
  minHeightPx: 200,
};

export type AssetIntakeRejection = {
  outcome: "rejected";
  reason:
    | "empty_file"
    | "too_large"
    | "unsupported_format"
    | "declared_type_mismatch"
    | "corrupt_image"
    | "dimensions_out_of_range";
  message: string;
};

export type AssetIntakeAcceptance = {
  outcome: "accepted";
  bytes: Buffer;
  mimeType: AssetIntakeFormat;
  widthPx: number;
  heightPx: number;
  byteSize: number;
  /** Taken over the re-encoded bytes, so it identifies what is actually stored. */
  contentHash: string;
};

export type AssetIntakeResult = AssetIntakeAcceptance | AssetIntakeRejection;

/**
 * Leading bytes, not file extensions and not declared MIME types. A PNG is a
 * PNG because it starts like one.
 */
function sniffFormat(bytes: Buffer): AssetIntakeFormat | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export async function ingestCampaignImage(input: {
  bytes: Buffer;
  /** What the client said it was. Checked against the bytes, never believed. */
  declaredMimeType?: string;
  limits?: AssetIntakeLimits;
}): Promise<AssetIntakeResult> {
  const limits = input.limits ?? DEFAULT_ASSET_INTAKE_LIMITS;
  const { bytes } = input;

  if (bytes.length === 0) {
    return { outcome: "rejected", reason: "empty_file", message: "The file is empty." };
  }
  if (bytes.length > limits.maxBytes) {
    return {
      outcome: "rejected",
      reason: "too_large",
      message: `The file is larger than the ${Math.floor(limits.maxBytes / 1024 / 1024)} MB limit.`,
    };
  }

  const sniffed = sniffFormat(bytes);
  if (!sniffed) {
    return {
      outcome: "rejected",
      reason: "unsupported_format",
      message: "Only JPEG, PNG, and WebP images can be used in a campaign.",
    };
  }

  // A mismatch is not merely a wrong label. It is the shape of an upload trying
  // to be treated as something it is not, so it is refused rather than silently
  // corrected.
  if (input.declaredMimeType && input.declaredMimeType !== sniffed) {
    return {
      outcome: "rejected",
      reason: "declared_type_mismatch",
      message: "The file contents do not match the type the upload declared.",
    };
  }

  try {
    const pipeline = sharp(bytes, { failOn: "error" });
    const metadata = await pipeline.metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    if (
      width < limits.minWidthPx ||
      height < limits.minHeightPx ||
      width > limits.maxWidthPx ||
      height > limits.maxHeightPx
    ) {
      return {
        outcome: "rejected",
        reason: "dimensions_out_of_range",
        message: `The image is ${width}x${height}. Campaign images must be between ${limits.minWidthPx}x${limits.minHeightPx} and ${limits.maxWidthPx}x${limits.maxHeightPx}.`,
      };
    }

    // Re-encode without metadata. `sharp` drops EXIF, ICC, and XMP unless asked
    // to keep them, so this is where location and device data stop travelling
    // with a brand photo.
    const reEncoded = await encode(sharp(bytes, { failOn: "error" }), sniffed);

    return {
      outcome: "accepted",
      bytes: reEncoded,
      mimeType: sniffed,
      widthPx: width,
      heightPx: height,
      byteSize: reEncoded.length,
      contentHash: createHash("sha256").update(reEncoded).digest("hex"),
    };
  } catch {
    // Never surface the decoder's message: it can echo file contents.
    return {
      outcome: "rejected",
      reason: "corrupt_image",
      message: "The image could not be read. It may be incomplete or corrupted.",
    };
  }
}

function encode(pipeline: Sharp, format: AssetIntakeFormat): Promise<Buffer> {
  switch (format) {
    case "image/jpeg":
      return pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    case "image/png":
      return pipeline.png({ compressionLevel: 9 }).toBuffer();
    case "image/webp":
      return pipeline.webp({ quality: 90 }).toBuffer();
  }
}

/**
 * `organizationId/campaignId/bundleVersionId/assetId.ext`.
 *
 * The tenant is the first segment because that is what the storage policy
 * checks. Building the path anywhere else would let a caller decide which
 * organization's folder to write into.
 */
export function campaignAssetPath(input: {
  organizationId: string;
  campaignId: string;
  bundleVersionId: string;
  assetId: string;
  mimeType: AssetIntakeFormat;
}): string {
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[
    input.mimeType
  ];
  return `${input.organizationId}/${input.campaignId}/${input.bundleVersionId}/${input.assetId}.${extension}`;
}

/** `organizationId/brandAssetId/versionId/filename`. */
export function brandAssetPath(input: {
  organizationId: string;
  brandAssetId: string;
  versionId: string;
  mimeType: AssetIntakeFormat;
}): string {
  const extension = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" }[
    input.mimeType
  ];
  return `${input.organizationId}/${input.brandAssetId}/${input.versionId}/source.${extension}`;
}
