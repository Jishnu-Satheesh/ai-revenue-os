import "server-only";

import { createHash } from "node:crypto";

/**
 * Turning an uploaded file into something a campaign may use.
 *
 * A browser's declared content type is a claim, not evidence: it is chosen by
 * whoever made the request. So nothing here trusts it. The bytes are identified
 * by their own leading signature, structurally parsed, rebuilt server-side
 * from image chunks alone, and only then hashed. The rebuild is the step that
 * matters most — it drops every metadata carrier (EXIF, XMP, ICC, comments,
 * text chunks, which routinely carry the exact GPS coordinates of a venue and
 * the device that took the photo) and it means the stored file is one this
 * server produced rather than one a stranger handed us.
 *
 * The parsing is deliberately dependency-free. A native decoder cannot be
 * counted on inside a serverless function — the platform's file tracing has
 * repeatedly failed to ship its companion libraries, which once turned every
 * upload endpoint into a 500, including ones that never touch image bytes.
 * Reading headers and rebuilding containers needs no native code, so there is
 * nothing missing to fail on. Anything the parser does not recognise is
 * refused as corrupt, which is the safe direction: generation would rather
 * see nothing than see bytes nobody validated.
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

type DecodedImage = {
  widthPx: number;
  heightPx: number;
  /** The rebuilt file: image chunks only, metadata carriers dropped. */
  bytes: Buffer;
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

  const decoded =
    sniffed === "image/png"
      ? decodePng(bytes)
      : sniffed === "image/jpeg"
        ? decodeJpeg(bytes)
        : decodeWebp(bytes);

  if (!decoded) {
    // Never describe what was wrong with the bytes: the message can echo
    // file contents back to whoever sent them.
    return {
      outcome: "rejected",
      reason: "corrupt_image",
      message: "The image could not be read. It may be incomplete or corrupted.",
    };
  }

  const { widthPx, heightPx } = decoded;
  if (
    widthPx < limits.minWidthPx ||
    heightPx < limits.minHeightPx ||
    widthPx > limits.maxWidthPx ||
    heightPx > limits.maxHeightPx
  ) {
    return {
      outcome: "rejected",
      reason: "dimensions_out_of_range",
      message: `The image is ${widthPx}x${heightPx}. Campaign images must be between ${limits.minWidthPx}x${limits.minHeightPx} and ${limits.maxWidthPx}x${limits.maxHeightPx}.`,
    };
  }

  return {
    outcome: "accepted",
    bytes: decoded.bytes,
    mimeType: sniffed,
    widthPx,
    heightPx,
    byteSize: decoded.bytes.length,
    contentHash: createHash("sha256").update(decoded.bytes).digest("hex"),
  };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * PNG, chunk by chunk. Only the chunks a viewer needs to paint the picture
 * survive — IHDR, PLTE, IDAT, IEND. Everything else (text, EXIF, timestamps,
 * embedded profiles) is left out of the rebuild. A file without an image
 * payload or without its end marker is truncated, not an image.
 */
function decodePng(bytes: Buffer): DecodedImage | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null;

  const kept: Buffer[] = [];
  let offset = 8;
  let width = 0;
  let height = 0;
  let seenImageData = false;
  let seenEnd = false;

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + 8 + length + 4;
    if (end > bytes.length) return null;
    const chunk = bytes.subarray(offset, end);

    if (kept.length === 0) {
      if (type !== "IHDR" || length !== 13) return null;
      width = bytes.readUInt32BE(offset + 8);
      height = bytes.readUInt32BE(offset + 12);
      if (width < 1 || height < 1) return null;
      if (
        crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
        bytes.readUInt32BE(offset + 8 + length)
      ) {
        return null;
      }
      kept.push(chunk);
    } else if (type === "IDAT") {
      if (
        crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
        bytes.readUInt32BE(offset + 8 + length)
      ) {
        return null;
      }
      seenImageData = true;
      kept.push(chunk);
    } else if (type === "PLTE") {
      if (
        crc32(bytes.subarray(offset + 4, offset + 8 + length)) !==
        bytes.readUInt32BE(offset + 8 + length)
      ) {
        return null;
      }
      kept.push(chunk);
    } else if (type === "IEND") {
      seenEnd = true;
      kept.push(chunk);
      break;
    }
    offset = end;
  }

  if (!seenImageData || !seenEnd) return null;
  return { widthPx: width, heightPx: height, bytes: Buffer.concat([PNG_SIGNATURE, ...kept]) };
}

/** JPEG markers that carry a two-byte length after the marker. */
function jpegMarkerHasLength(marker: number): boolean {
  if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) return false;
  return true;
}

/**
 * JPEG, segment by segment. APPn (where EXIF, XMP, ICC and thumbnails live)
 * and COM (free-text comments) are dropped; everything the decoder needs is
 * copied verbatim. A file with no frame header, no scan, or no end marker is
 * truncated, not a picture.
 */
function decodeJpeg(bytes: Buffer): DecodedImage | null {
  const total = bytes.length;
  if (total < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;

  const out: Buffer[] = [bytes.subarray(0, 2)];
  let offset = 2;
  let width = 0;
  let height = 0;
  let seenFrame = false;
  let seenScan = false;

  // Reads one length-carrying segment at offset, which must point at 0xFF.
  // Returns the segment end, or -1 when the bytes do not hold one.
  function readSegmentEnd(start: number): number {
    if (start + 4 > total || bytes[start] !== 0xff) return -1;
    const marker = bytes[start + 1];
    if (!jpegMarkerHasLength(marker)) return -1;
    const length = bytes.readUInt16BE(start + 2);
    if (length < 2 || start + 2 + length > total) return -1;
    return start + 2 + length;
  }

  while (offset + 1 < total) {
    if (bytes[offset] !== 0xff) return null;
    let markerAt = offset + 1;
    while (markerAt < total && bytes[markerAt] === 0xff) markerAt += 1;
    if (markerAt >= total) return null;
    const marker = bytes[markerAt];
    const segmentStart = markerAt - 1;

    if (marker === 0xd9) {
      out.push(Buffer.from([0xff, 0xd9]));
      if (!seenFrame || !seenScan) return null;
      return { widthPx: width, heightPx: height, bytes: Buffer.concat(out) };
    }

    if (marker === 0xda) {
      const headerEnd = readSegmentEnd(segmentStart);
      if (headerEnd === -1) return null;
      out.push(
        Buffer.concat([Buffer.from([0xff, 0xda]), bytes.subarray(segmentStart + 2, headerEnd)]),
      );
      seenScan = true;
      // Scan data runs until the next marker. 0xFF00 is escaped data, not a
      // marker; restart markers belong to the scan; anything else ends it.
      let cursor = headerEnd;
      const scanStart = cursor;
      while (true) {
        if (cursor + 1 >= total) return null;
        if (bytes[cursor] !== 0xff) {
          cursor += 1;
          continue;
        }
        const inner = bytes[cursor + 1];
        if (inner === 0x00 || (inner >= 0xd0 && inner <= 0xd7)) {
          cursor += 2;
          continue;
        }
        out.push(bytes.subarray(scanStart, cursor));
        offset = cursor;
        break;
      }
      continue;
    }

    const segmentEnd = readSegmentEnd(segmentStart);
    if (segmentEnd === -1) return null;

    if (marker >= 0xe0 && marker <= 0xef) {
      // APPn: EXIF, XMP, ICC, thumbnails. Dropped, never copied.
    } else if (marker === 0xfe) {
      // COM: a free-text comment. Dropped.
    } else {
      // Start-of-frame carries the dimensions: precision, height, width.
      // DHT (0xC4), JPG (0xC8) and DAC (0xCC) share the range but are tables,
      // not frames.
      if (
        marker >= 0xc0 &&
        marker <= 0xcf &&
        marker !== 0xc4 &&
        marker !== 0xc8 &&
        marker !== 0xcc
      ) {
        if (segmentEnd - segmentStart < 9) return null;
        const frameHeight = bytes.readUInt16BE(segmentStart + 5);
        const frameWidth = bytes.readUInt16BE(segmentStart + 7);
        if (frameWidth < 1 || frameHeight < 1) return null;
        if (!seenFrame) {
          width = frameWidth;
          height = frameHeight;
          seenFrame = true;
        }
      }
      out.push(
        Buffer.concat([Buffer.from([0xff, marker]), bytes.subarray(segmentStart + 2, segmentEnd)]),
      );
    }
    offset = segmentEnd;
  }

  return null;
}

/**
 * WebP. The container tells the truth about the picture: lossy and lossless
 * frames carry their dimensions in fixed headers, and the extended container
 * names its canvas outright. Metadata chunks (EXIF, XMP, ICCP) are dropped
 * and their feature flags cleared; a container whose declared size runs past
 * the bytes is truncated, not a picture.
 */
function decodeWebp(bytes: Buffer): DecodedImage | null {
  const total = bytes.length;
  if (total < 12) return null;
  const containerEnd = 8 + bytes.readUInt32LE(4);
  if (containerEnd > total) return null;
  const file = bytes.subarray(0, containerEnd);

  const kind = file.toString("ascii", 12, 16);
  if (kind === "VP8 ") {
    if (containerEnd < 30) return null;
    const payload = file.subarray(20);
    if (payload.length < 10) return null;
    if (payload[3] !== 0x9d || payload[4] !== 0x01 || payload[5] !== 0x2a) return null;
    const width = payload.readUInt16LE(6) & 0x3fff;
    const height = payload.readUInt16LE(8) & 0x3fff;
    if (width < 1 || height < 1) return null;
    return { widthPx: width, heightPx: height, bytes: file };
  }

  if (kind === "VP8L") {
    if (containerEnd < 25) return null;
    const payload = file.subarray(20);
    if (payload.length < 5 || payload[0] !== 0x2f) return null;
    const bits = payload.readUInt32LE(1);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >>> 14) & 0x3fff) + 1;
    if (width < 1 || height < 1) return null;
    return { widthPx: width, heightPx: height, bytes: file };
  }

  if (kind !== "VP8X") return null;
  if (containerEnd < 30) return null;
  if (file.readUInt32LE(16) < 10) return null;
  const flags = file[20];
  const width = file.readUIntLE(24, 3) + 1;
  const height = file.readUIntLE(27, 3) + 1;
  if (width < 1 || height < 1) return null;

  const kept: Buffer[] = [];
  let hasPicture = false;
  let offset = 30;
  while (offset + 8 <= containerEnd) {
    const chunkKind = file.toString("ascii", offset, offset + 4);
    const chunkSize = file.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkSize;
    if (dataEnd > containerEnd) return null;
    const paddedEnd = dataEnd + (chunkSize % 2);
    if (paddedEnd > containerEnd) return null;
    if (chunkKind === "EXIF" || chunkKind === "XMP " || chunkKind === "ICCP") {
      // Metadata carriers. Dropped, never copied.
    } else {
      if (chunkKind === "VP8 " || chunkKind === "VP8L") hasPicture = true;
      kept.push(file.subarray(offset, paddedEnd));
    }
    offset = paddedEnd;
  }
  if (!hasPicture) return null;

  const header = Buffer.from(file.subarray(0, 30));
  header[20] = flags & ~0x2c;
  const rebuiltSize = 22 + kept.reduce((sum, chunk) => sum + chunk.length, 0);
  header.writeUInt32LE(rebuiltSize, 4);
  return { widthPx: width, heightPx: height, bytes: Buffer.concat([header, ...kept]) };
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
