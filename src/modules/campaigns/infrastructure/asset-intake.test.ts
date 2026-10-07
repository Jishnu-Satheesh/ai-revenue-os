import sharp from "sharp";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  brandAssetPath,
  campaignAssetPath,
  ingestCampaignImage,
  type AssetIntakeAcceptance,
} from "@/modules/campaigns/infrastructure/asset-intake";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";

let png: Buffer;
let jpeg: Buffer;
let webp: Buffer;
let tiny: Buffer;

async function solid(format: "png" | "jpeg" | "webp", size = 512): Promise<Buffer> {
  const image = sharp({
    create: { width: size, height: size, channels: 3, background: { r: 20, g: 80, b: 160 } },
  });
  if (format === "png") return image.png().toBuffer();
  if (format === "jpeg") return image.jpeg().toBuffer();
  return image.webp().toBuffer();
}

beforeAll(async () => {
  [png, jpeg, webp, tiny] = await Promise.all([
    solid("png"),
    solid("jpeg"),
    solid("webp"),
    solid("png", 64),
  ]);
});

function accepted(result: Awaited<ReturnType<typeof ingestCampaignImage>>): AssetIntakeAcceptance {
  if (result.outcome !== "accepted") throw new Error(`expected acceptance, got ${result.reason}`);
  return result;
}

describe("ingestCampaignImage", () => {
  it("accepts a PNG and reports its real dimensions", async () => {
    const result = accepted(await ingestCampaignImage({ bytes: png }));

    expect(result.mimeType).toBe("image/png");
    expect(result.widthPx).toBe(512);
    expect(result.heightPx).toBe(512);
  });

  it("accepts JPEG and WebP", async () => {
    expect(accepted(await ingestCampaignImage({ bytes: jpeg })).mimeType).toBe("image/jpeg");
    expect(accepted(await ingestCampaignImage({ bytes: webp })).mimeType).toBe("image/webp");
  });

  it("identifies the format from the bytes, not the declared type", async () => {
    const result = await ingestCampaignImage({ bytes: png, declaredMimeType: "image/jpeg" });

    expect(result).toMatchObject({ outcome: "rejected", reason: "declared_type_mismatch" });
  });

  it("accepts a truthful declared type", async () => {
    const result = await ingestCampaignImage({ bytes: png, declaredMimeType: "image/png" });

    expect(result.outcome).toBe("accepted");
  });

  it("refuses a file that only claims to be an image", async () => {
    const result = await ingestCampaignImage({
      bytes: Buffer.from("<?php echo 'not an image'; ?>", "utf8"),
      declaredMimeType: "image/png",
    });

    expect(result).toMatchObject({ outcome: "rejected", reason: "unsupported_format" });
  });

  it("refuses an empty file", async () => {
    expect(await ingestCampaignImage({ bytes: Buffer.alloc(0) })).toMatchObject({
      outcome: "rejected",
      reason: "empty_file",
    });
  });

  it("refuses a file past the size limit before decoding it", async () => {
    const result = await ingestCampaignImage({
      bytes: png,
      limits: {
        maxBytes: 10,
        maxWidthPx: 8_000,
        maxHeightPx: 8_000,
        minWidthPx: 1,
        minHeightPx: 1,
      },
    });

    expect(result).toMatchObject({ outcome: "rejected", reason: "too_large" });
  });

  it("refuses an image too small to be a usable social asset", async () => {
    expect(await ingestCampaignImage({ bytes: tiny })).toMatchObject({
      outcome: "rejected",
      reason: "dimensions_out_of_range",
    });
  });

  it("refuses a truncated image rather than storing half of one", async () => {
    const result = await ingestCampaignImage({ bytes: png.subarray(0, 40) });

    expect(result.outcome).toBe("rejected");
  });

  it("never echoes the decoder's message back to a caller", async () => {
    const result = await ingestCampaignImage({ bytes: png.subarray(0, 40) });

    if (result.outcome !== "rejected") throw new Error("expected rejection");
    expect(result.message).toBe("The image could not be read. It may be incomplete or corrupted.");
  });

  it("hashes the re-encoded bytes, not the bytes that were uploaded", async () => {
    const result = accepted(await ingestCampaignImage({ bytes: png }));

    expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.byteSize).toBe(result.bytes.length);
  });

  it("strips metadata, so a venue photo stops carrying where it was taken", async () => {
    const withExif = await sharp({
      create: { width: 512, height: 512, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withExifMerge({ IFD0: { Copyright: "SECRET-LOCATION-MARKER" } })
      .jpeg()
      .toBuffer();

    const before = await sharp(withExif).metadata();
    expect(before.exif).toBeDefined();

    const result = accepted(await ingestCampaignImage({ bytes: withExif }));
    const after = await sharp(result.bytes).metadata();

    expect(after.exif).toBeUndefined();
    expect(result.bytes.includes(Buffer.from("SECRET-LOCATION-MARKER"))).toBe(false);
  });

  it("produces the same hash for the same input, so a re-upload is recognisable", async () => {
    const first = accepted(await ingestCampaignImage({ bytes: png }));
    const second = accepted(await ingestCampaignImage({ bytes: png }));

    expect(first.contentHash).toBe(second.contentHash);
  });

  it("reads non-square dimensions without transposing them", async () => {
    const wide = await sharp({
      create: { width: 300, height: 200, channels: 3, background: { r: 9, g: 9, b: 9 } },
    })
      .jpeg()
      .toBuffer();

    const result = accepted(await ingestCampaignImage({ bytes: wide }));

    expect(result.widthPx).toBe(300);
    expect(result.heightPx).toBe(200);
  });

  it("drops PNG text chunks, so a comment stops travelling with the file", async () => {
    const keyword = Buffer.from("Comment\0", "ascii");
    const text = Buffer.from("SECRET-LOCATION-MARKER", "utf8");
    const data = Buffer.concat([keyword, text]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const textChunk = Buffer.concat([length, Buffer.from("tEXt", "ascii"), data, Buffer.alloc(4)]);
    // A viewer reads up to IEND; the new chunk goes just before it.
    const withText = Buffer.concat([
      png.subarray(0, png.length - 12),
      textChunk,
      png.subarray(-12),
    ]);

    const result = accepted(await ingestCampaignImage({ bytes: withText }));

    expect(result.widthPx).toBe(512);
    expect(result.bytes.includes(Buffer.from("SECRET-LOCATION-MARKER"))).toBe(false);
  });

  it("refuses a PNG whose header checksum does not match its bytes", async () => {
    const tampered = Buffer.from(png);
    tampered[16] ^= 0x01;

    const result = await ingestCampaignImage({ bytes: tampered });

    expect(result).toMatchObject({ outcome: "rejected", reason: "corrupt_image" });
  });

  it("refuses a JPEG cut short of its end marker", async () => {
    const result = await ingestCampaignImage({ bytes: jpeg.subarray(0, jpeg.length - 100) });

    expect(result).toMatchObject({ outcome: "rejected", reason: "corrupt_image" });
  });

  it("strips WebP metadata and reads extended-container dimensions", async () => {
    const withExif = await sharp({
      create: { width: 512, height: 256, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .withMetadata({ exif: { IFD0: { Copyright: "SECRET-LOCATION-MARKER" } } })
      .webp()
      .toBuffer();

    const before = await sharp(withExif).metadata();
    expect(before.exif).toBeDefined();

    const result = accepted(await ingestCampaignImage({ bytes: withExif }));
    const after = await sharp(result.bytes).metadata();

    expect(result.widthPx).toBe(512);
    expect(result.heightPx).toBe(256);
    expect(after.exif).toBeUndefined();
    expect(result.bytes.includes(Buffer.from("SECRET-LOCATION-MARKER"))).toBe(false);
  });
});

describe("storage paths", () => {
  it("puts the tenant first, because that is what the storage policy checks", () => {
    const path = campaignAssetPath({
      organizationId: ORGANIZATION_ID,
      campaignId: "c0000000-0000-4000-8000-000000000001",
      bundleVersionId: "f0000000-0000-4000-8000-000000000001",
      assetId: "a0000000-0000-4000-8000-000000000001",
      mimeType: "image/png",
    });

    expect(path.split("/")[0]).toBe(ORGANIZATION_ID);
    expect(path.split("/")).toHaveLength(4);
    expect(path.endsWith(".png")).toBe(true);
  });

  it("uses the four-segment brand asset shape the policy expects", () => {
    const path = brandAssetPath({
      organizationId: ORGANIZATION_ID,
      brandAssetId: "b0000000-0000-4000-8000-000000000001",
      versionId: "f0000000-0000-4000-8000-000000000001",
      mimeType: "image/jpeg",
    });

    expect(path.split("/")).toHaveLength(4);
    expect(path.endsWith("source.jpg")).toBe(true);
  });
});
