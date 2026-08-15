import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createBrandAssetService } from "@/modules/campaigns/application/brand-asset-service";
import { ingestCampaignImage } from "@/modules/campaigns/infrastructure/asset-intake";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ASSET_ID = "b0000000-0000-4000-8000-000000000001";
const VERSION_ID = "f0000000-0000-4000-8000-000000000001";
const PATH = `${ORGANIZATION_ID}/${ASSET_ID}/${VERSION_ID}/source`;

const reserve = vi.fn();
const finalize = vi.fn();
const download = vi.fn();
const upload = vi.fn();

function service(ingest = ingestCampaignImage) {
  return createBrandAssetService({
    store: { reserve, finalize },
    objects: { download, upload },
    ingest,
  });
}

let png: Buffer;
let exifJpeg: Buffer;

beforeAll(async () => {
  png = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 5, g: 10, b: 15 } },
  })
    .png()
    .toBuffer();
  exifJpeg = await sharp({
    create: { width: 600, height: 600, channels: 3, background: { r: 1, g: 2, b: 3 } },
  })
    .withExifMerge({ IFD0: { Copyright: "VENUE-GPS-MARKER" } })
    .jpeg()
    .toBuffer();
});

beforeEach(() => {
  for (const spy of [reserve, finalize, download, upload]) spy.mockReset();
  reserve.mockResolvedValue({ brandAssetId: ASSET_ID, versionId: VERSION_ID, storagePath: PATH });
  download.mockResolvedValue(png);
  upload.mockResolvedValue(true);
});

describe("reserving an upload slot", () => {
  it("returns the path the database issued", async () => {
    const reservation = await service().reserve({
      organizationId: ORGANIZATION_ID,
      label: "Primary logo",
      assetRole: "logo",
    });

    expect(reservation.storagePath).toBe(PATH);
  });

  it("refuses a new asset with no label or role, which nobody could identify later", async () => {
    await expect(service().reserve({ organizationId: ORGANIZATION_ID })).rejects.toThrow(
      /needs a label and a role/,
    );
    expect(reserve).not.toHaveBeenCalled();
  });

  it("allows a new version of an existing asset without repeating its label", async () => {
    await service().reserve({ organizationId: ORGANIZATION_ID, brandAssetId: ASSET_ID });

    expect(reserve).toHaveBeenCalledWith(expect.objectContaining({ brandAssetId: ASSET_ID }));
  });
});

describe("completing an upload decides from the bytes alone", () => {
  it("promotes a real image and records what it read", async () => {
    const result = await service().complete({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      storagePath: PATH,
    });

    expect(result).toMatchObject({ status: "usable", versionId: VERSION_ID });
    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({ mimeType: "image/png", widthPx: 600, heightPx: 600 }),
    );
  });

  it("rejects a file that is not an image, whatever it was uploaded as", async () => {
    download.mockResolvedValue(Buffer.from("<?php echo 'hello'; ?>"));

    const result = await service().complete({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      storagePath: PATH,
    });

    expect(result).toMatchObject({ status: "rejected", reason: "unsupported_format" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("stores the re-encoded bytes, so what is kept is a file this server made", async () => {
    download.mockResolvedValue(exifJpeg);

    await service().complete({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      storagePath: PATH,
    });

    const stored = upload.mock.calls[0]?.[0] as { bytes: Buffer };
    expect(stored.bytes.includes(Buffer.from("VENUE-GPS-MARKER"))).toBe(false);
    expect(stored.bytes.equals(exifJpeg)).toBe(false);
  });

  it("hashes the stored bytes rather than the uploaded ones", async () => {
    const direct = await ingestCampaignImage({ bytes: png });
    if (direct.outcome !== "accepted") throw new Error("fixture should be accepted");

    await service().complete({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      storagePath: PATH,
    });

    expect(finalize).toHaveBeenCalledWith(
      expect.objectContaining({ contentHash: direct.contentHash }),
    );
  });

  it("leaves the version unusable when the validated bytes cannot be stored", async () => {
    upload.mockResolvedValue(false);

    const result = await service().complete({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      storagePath: PATH,
    });

    expect(result).toMatchObject({ status: "rejected", reason: "storage_failed" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("reports a missing upload rather than finalizing an empty version", async () => {
    download.mockResolvedValue(null);

    const result = await service().complete({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      storagePath: PATH,
    });

    expect(result).toMatchObject({ status: "rejected", reason: "upload_missing" });
    expect(finalize).not.toHaveBeenCalled();
  });

  it("refuses a path outside the caller's own organization", async () => {
    await expect(
      service().complete({
        organizationId: ORGANIZATION_ID,
        versionId: VERSION_ID,
        storagePath: `99999999-9999-4999-8999-999999999999/${ASSET_ID}/${VERSION_ID}/source`,
      }),
    ).rejects.toThrow(/not available/);
    expect(download).not.toHaveBeenCalled();
  });

  it("never passes a client-declared type into intake", async () => {
    const ingest = vi.fn(async (input: { bytes: Buffer }) => ingestCampaignImage(input));

    await service(ingest).complete({
      organizationId: ORGANIZATION_ID,
      versionId: VERSION_ID,
      storagePath: PATH,
    });

    expect(Object.keys(ingest.mock.calls[0]?.[0] ?? {})).toEqual(["bytes"]);
  });
});
