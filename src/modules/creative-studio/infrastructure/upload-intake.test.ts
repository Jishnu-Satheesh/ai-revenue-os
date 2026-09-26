import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

vi.mock("@/lib/env", () => ({
  env: {
    NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "public-key",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_test",
  },
}));

import sharp from "sharp";
import { z } from "zod";

import { DomainError } from "@/lib/errors";
import { ingestCampaignImage } from "@/modules/campaigns/infrastructure/asset-intake";
import {
  createStudioUploadCompleter,
  createStudioUploadReserver,
  createSupabaseStudioUploadObjectStore,
} from "@/modules/creative-studio/infrastructure/upload-intake";
import type { StudioUploadRecord } from "@/modules/creative-studio/infrastructure/reference-reader";

const ORG = "00000000-0000-4000-8000-000000000001";
const UPLOAD = "00000000-0000-4000-8000-000000000002";
const ACTOR = "00000000-0000-4000-8000-000000000003";
const ATTESTATION = "00000000-0000-4000-8000-000000000004";
const HASH = "d".repeat(64);
const PATH = `${ORG}/${UPLOAD}/hero.png`;

function record(overrides: Partial<StudioUploadRecord> = {}): StudioUploadRecord {
  return {
    organizationId: ORG,
    uploadId: UPLOAD,
    actorId: ACTOR,
    reservedPath: PATH,
    state: "reserved",
    rightsAttestation: {
      accepted: true,
      attestationId: ATTESTATION,
      authorizedAiProcessing: true,
      intendedUse: "Studio reference",
    },
    finalHash: null,
    finalMime: null,
    finalWidth: null,
    finalHeight: null,
    finalBytes: null,
    expiresAt: "2100-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function reserveRequest(overrides: Record<string, unknown> = {}) {
  return {
    kind: "design",
    declaredSize: 412_345,
    declaredMime: "image/png",
    filename: "hero.png",
    rights: {
      accepted: true,
      attestationId: ATTESTATION,
      authorizedAiProcessing: true,
      intendedUse: "Studio reference",
    },
    ...overrides,
  };
}

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: "#336699" },
  })
    .png()
    .toBuffer();
}

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: "#993366" },
  })
    .jpeg()
    .toBuffer();
}

async function jpegWithGps(): Promise<Buffer> {
  return sharp({
    create: { width: 400, height: 300, channels: 3, background: "#669933" },
  })
    .jpeg()
    .withExif({
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "25/1 16/1 0/1",
        GPSLongitudeRef: "E",
        GPSLongitude: "55/1 18/1 0/1",
      },
    })
    .toBuffer();
}

function completerWith(deps: {
  row?: StudioUploadRecord | null;
  bytes?: Buffer | null;
  stored?: boolean;
  settled?: { uploadId: string; state: string; replayed: boolean };
  onSettle?: (receipt: Record<string, unknown>) => { uploadId: string; state: string; replayed: boolean };
}) {
  const readReservation = vi.fn(async () => deps.row ?? null);
  const download = vi.fn<(path: string) => Promise<Buffer | null>>(async () => deps.bytes ?? null);
  const upload = vi.fn<
    (input: { path: string; bytes: Buffer; contentType: string }) => Promise<boolean>
  >(async () => deps.stored ?? true);
  const settleReservation = vi.fn(async (input: { receipt: Record<string, unknown> }) => {
    if (deps.onSettle) return deps.onSettle(input.receipt);
    return deps.settled ?? { uploadId: UPLOAD, state: "ready", replayed: false };
  });
  const completer = createStudioUploadCompleter({
    readReservation,
    objects: { download, upload },
    ingest: ingestCampaignImage,
    settleReservation,
  });
  return { completer, readReservation, download, upload, settleReservation };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("studio upload reservation", () => {
  it("reserves through the fenced writer with the declared intent", async () => {
    const reserveReservation = vi.fn(async () => ({
      uploadId: UPLOAD,
      reservedPath: PATH,
      expiresAt: "2026-09-26T01:00:00Z",
    }));
    const reserver = createStudioUploadReserver({ reserveReservation });

    const reservation = await reserver.reserve({ organizationId: ORG, request: reserveRequest() });

    expect(reserveReservation).toHaveBeenCalledWith({
      organizationId: ORG,
      upload: {
        kind: "design",
        declaredSize: 412_345,
        declaredMime: "image/png",
        filename: "hero.png",
        rightsAttestation: {
          accepted: true,
          attestationId: ATTESTATION,
          authorizedAiProcessing: true,
          intendedUse: "Studio reference",
        },
      },
    });
    expect(reservation).toEqual({
      uploadId: UPLOAD,
      reservedPath: PATH,
      expiresAt: "2026-09-26T01:00:00Z",
      bucket: "studio-uploads",
      intake: {
        allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
        maxBytes: 15_728_640,
        minWidthPx: 200,
        minHeightPx: 200,
        maxWidthPx: 8_000,
        maxHeightPx: 8_000,
        clientValidationIsAdvisory: true,
      },
    });
  });

  it("refuses a reservation without accepted rights before any database call", async () => {
    const reserveReservation = vi.fn();
    const reserver = createStudioUploadReserver({ reserveReservation });

    await expect(
      reserver.reserve({
        organizationId: ORG,
        request: reserveRequest({ rights: { accepted: false } }),
      }),
    ).rejects.toThrow(z.ZodError);
    await expect(
      reserver.reserve({ organizationId: ORG, request: reserveRequest({ rights: undefined }) }),
    ).rejects.toThrow(z.ZodError);
    expect(reserveReservation).not.toHaveBeenCalled();
  });

  it("refuses a dishonest declaration before any database call", async () => {
    const reserveReservation = vi.fn();
    const reserver = createStudioUploadReserver({ reserveReservation });

    const bad = [
      reserveRequest({ kind: "video" }),
      reserveRequest({ declaredSize: 0 }),
      reserveRequest({ declaredSize: 15_728_641 }),
      reserveRequest({ declaredMime: "image/gif" }),
      reserveRequest({ filename: "../escape.png" }),
      reserveRequest({ filename: "a".repeat(201) }),
    ];
    for (const request of bad) {
      await expect(reserver.reserve({ organizationId: ORG, request })).rejects.toThrow(z.ZodError);
    }
    expect(reserveReservation).not.toHaveBeenCalled();
  });

  it("refuses a reservation whose path escapes the tenant, rather than returning it", async () => {
    const reserveReservation = vi.fn(async () => ({
      uploadId: UPLOAD,
      reservedPath: `foreign-org/${UPLOAD}/hero.png`,
      expiresAt: "2026-09-26T01:00:00Z",
    }));
    const reserver = createStudioUploadReserver({ reserveReservation });

    await expect(
      reserver.reserve({ organizationId: ORG, request: reserveRequest() }),
    ).rejects.toThrow(/invalid/);
  });
});

describe("studio upload completion", () => {
  it("verifies real bytes and settles with the hash of what was checked", async () => {
    const bytes = await png(640, 480);
    const { completer, download, upload, settleReservation } = completerWith({
      row: record(),
      bytes,
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    expect(download).toHaveBeenCalledWith(PATH);
    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("unreachable");
    expect(outcome.replayed).toBe(false);
    expect(outcome.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(outcome).toMatchObject({ mimeType: "image/png", widthPx: 640, heightPx: 480 });
    // The receipt carries the verified hash, so the settled record equals
    // the checked bytes by construction.
    expect(settleReservation).toHaveBeenCalledTimes(1);
    const receipt = settleReservation.mock.calls[0]![0]!.receipt;
    expect(receipt).toMatchObject({
      verdict: "ready",
      finalHash: outcome.contentHash,
      finalMime: "image/png",
      finalWidth: 640,
      finalHeight: 480,
      finalBytes: outcome.byteSize,
    });
    // The transferred object is replaced by the re-encode at the same key.
    expect(upload).toHaveBeenCalledTimes(1);
    const stored = upload.mock.calls[0]![0]!;
    expect(stored.path).toBe(PATH);
    expect(stored.contentType).toBe("image/png");
    expect(stored.bytes.equals(bytes)).toBe(false);
  });

  it("reads a foreign upload as absent and touches nothing", async () => {
    const { completer, download, upload, settleReservation } = completerWith({
      row: null,
      bytes: await png(640, 480),
    });

    const failure = await completer
      .complete({ organizationId: ORG, uploadId: UPLOAD, callerId: ACTOR })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).code).toBe("TENANT_SCOPE_ERROR");
    expect(download).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(settleReservation).not.toHaveBeenCalled();
  });

  it("refuses finalization by anyone but the member who reserved it", async () => {
    const { completer, download, settleReservation } = completerWith({
      row: record({ actorId: "00000000-0000-4000-8000-000000000007" }),
      bytes: await png(640, 480),
    });

    const failure = await completer
      .complete({ organizationId: ORG, uploadId: UPLOAD, callerId: ACTOR })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(DomainError);
    expect((failure as DomainError).code).toBe("TENANT_SCOPE_ERROR");
    expect(download).not.toHaveBeenCalled();
    expect(settleReservation).not.toHaveBeenCalled();
  });

  it("refuses a reservation row whose path escapes the tenant", async () => {
    const { completer, download, settleReservation } = completerWith({
      row: record({ reservedPath: `foreign/${UPLOAD}/hero.png` }),
      bytes: await png(640, 480),
    });

    const failure = await completer
      .complete({ organizationId: ORG, uploadId: UPLOAD, callerId: ACTOR })
      .catch((error: unknown) => error);

    expect((failure as DomainError).code).toBe("TENANT_SCOPE_ERROR");
    expect(download).not.toHaveBeenCalled();
    expect(settleReservation).not.toHaveBeenCalled();
  });

  it("records an expired reservation as expired without reading its bytes", async () => {
    const { completer, download, settleReservation } = completerWith({
      row: record({ expiresAt: "2000-01-01T00:00:00.000Z" }),
      bytes: await png(640, 480),
      settled: { uploadId: UPLOAD, state: "expired", replayed: false },
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    expect(outcome).toEqual({ status: "expired", uploadId: UPLOAD, replayed: false });
    expect(download).not.toHaveBeenCalled();
    expect(settleReservation).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadId: UPLOAD,
      receipt: { verdict: "rejected" },
    });
  });

  it("replays a duplicate finalization from the settled record, preserving the original", async () => {
    const { completer, download, upload, settleReservation } = completerWith({
      row: record({
        state: "ready",
        finalHash: HASH,
        finalMime: "image/png",
        finalWidth: 640,
        finalHeight: 480,
        finalBytes: 99_999,
      }),
      bytes: await png(100, 100),
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    // The settled record replays exactly — the changed object at the key is
    // never read, never re-encoded, never overwritten.
    expect(outcome).toEqual({
      status: "ready",
      uploadId: UPLOAD,
      replayed: true,
      contentHash: HASH,
      mimeType: "image/png",
      byteSize: 99_999,
      widthPx: 640,
      heightPx: 480,
    });
    expect(download).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
    expect(settleReservation).not.toHaveBeenCalled();
  });

  it("leaves the reservation open when the transfer never arrived", async () => {
    const { completer, upload, settleReservation } = completerWith({ row: record(), bytes: null });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "upload_missing", replayed: false });
    expect(upload).not.toHaveBeenCalled();
    expect(settleReservation).not.toHaveBeenCalled();
  });

  it("settles missing rights as rejected without judging the bytes", async () => {
    const { completer, download, settleReservation } = completerWith({
      row: record({ rightsAttestation: { accepted: false } }),
      bytes: await png(640, 480),
      settled: { uploadId: UPLOAD, state: "rejected", replayed: false },
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "missing_rights" });
    expect(download).not.toHaveBeenCalled();
    expect(settleReservation).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadId: UPLOAD,
      receipt: { verdict: "rejected" },
    });
  });

  it("refuses poisoned bytes whose content is not an image at all", async () => {
    const { completer, upload, settleReservation } = completerWith({
      row: record(),
      bytes: Buffer.from("<script>alert('not an image')</script>"),
      settled: { uploadId: UPLOAD, state: "rejected", replayed: false },
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
      declaredMime: "image/png",
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "unsupported_format" });
    expect(upload).not.toHaveBeenCalled();
    expect(settleReservation).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadId: UPLOAD,
      receipt: { verdict: "rejected" },
    });
  });

  it("refuses bytes whose content contradicts the declared type", async () => {
    const { completer, settleReservation } = completerWith({
      row: record(),
      bytes: await jpeg(640, 480),
      settled: { uploadId: UPLOAD, state: "rejected", replayed: false },
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
      declaredMime: "image/png",
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "declared_type_mismatch" });
    expect(settleReservation).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadId: UPLOAD,
      receipt: { verdict: "rejected" },
    });
  });

  it("refuses a decompression bomb rather than decoding it", async () => {
    const bomb = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000186a0000186a0802000000",
      "hex",
    );
    const { completer, upload, settleReservation } = completerWith({
      row: record(),
      bytes: bomb,
      settled: { uploadId: UPLOAD, state: "rejected", replayed: false },
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "corrupt_image" });
    expect(upload).not.toHaveBeenCalled();
    expect(settleReservation).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadId: UPLOAD,
      receipt: { verdict: "rejected" },
    });
  });

  it("strips EXIF coordinates from a venue photo before it becomes a reference", async () => {
    const taken = await jpegWithGps();
    expect(taken.includes(Buffer.from("Exif\0\0"))).toBe(true);
    const { completer, upload } = completerWith({ row: record(), bytes: taken });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
      declaredMime: "image/jpeg",
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("unreachable");
    expect(outcome).toMatchObject({ mimeType: "image/jpeg", widthPx: 400, heightPx: 300 });
    const stored = upload.mock.calls[0]![0]!;
    expect(stored.bytes.includes(Buffer.from("Exif\0\0"))).toBe(false);
    const metadata = await sharp(stored.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
  });

  it("refuses a file past the effective per-file limit", async () => {
    const { completer, settleReservation } = completerWith({
      row: record(),
      bytes: Buffer.alloc(15_728_640 + 1, 0xff),
      settled: { uploadId: UPLOAD, state: "rejected", replayed: false },
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "too_large" });
    expect(settleReservation).toHaveBeenCalledWith({
      organizationId: ORG,
      uploadId: UPLOAD,
      receipt: { verdict: "rejected" },
    });
  });

  it("refuses an empty file and a file too small to use", async () => {
    for (const bytes of [Buffer.alloc(0), await png(100, 100)]) {
      const { completer, settleReservation } = completerWith({
        row: record(),
        bytes,
        settled: { uploadId: UPLOAD, state: "rejected", replayed: false },
      });
      const outcome = await completer.complete({
        organizationId: ORG,
        uploadId: UPLOAD,
        callerId: ACTOR,
      });
      expect(outcome.status).toBe("refused");
      if (outcome.status !== "refused") throw new Error("unreachable");
      expect(["empty_file", "dimensions_out_of_range"]).toContain(outcome.reason);
      expect(settleReservation).toHaveBeenCalledWith({
        organizationId: ORG,
        uploadId: UPLOAD,
        receipt: { verdict: "rejected" },
      });
    }
  });

  it("leaves the reservation open when the validated bytes cannot be stored", async () => {
    const { completer, settleReservation } = completerWith({
      row: record(),
      bytes: await png(640, 480),
      stored: false,
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    expect(outcome).toMatchObject({ status: "refused", reason: "storage_failed" });
    expect(settleReservation).not.toHaveBeenCalled();
  });

  it("replays honestly when a concurrent finalization wins the race", async () => {
    const bytes = await png(640, 480);
    const { completer } = completerWith({
      row: record(),
      bytes,
      settled: { uploadId: UPLOAD, state: "ready", replayed: true },
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    expect(outcome.status).toBe("ready");
    if (outcome.status !== "ready") throw new Error("unreachable");
    expect(outcome.replayed).toBe(true);
    expect(outcome.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("falls back to a fresh read when the settlement contradicts the receipt", async () => {
    const bytes = await png(640, 480);
    const readReservation = vi
      .fn()
      .mockResolvedValueOnce(record())
      .mockResolvedValueOnce(record({ state: "expired" }));
    const settleReservation = vi.fn(async () => ({ uploadId: UPLOAD, state: "expired", replayed: true }));
    const completer = createStudioUploadCompleter({
      readReservation,
      objects: {
        download: vi.fn(async () => bytes),
        upload: vi.fn(async () => true),
      },
      ingest: ingestCampaignImage,
      settleReservation,
    });

    const outcome = await completer.complete({
      organizationId: ORG,
      uploadId: UPLOAD,
      callerId: ACTOR,
    });

    expect(outcome).toEqual({ status: "expired", uploadId: UPLOAD, replayed: true });
    expect(readReservation).toHaveBeenCalledTimes(2);
  });
});

describe("studio upload object store", () => {
  it("downloads bytes and upserts the re-encode at the same key", async () => {
    const bytes = await png(200, 200);
    const download = vi.fn(async () => ({ data: new Blob([new Uint8Array(bytes)]), error: null }));
    const upload = vi.fn(async () => ({ error: null }));
    const from = vi.fn(() => ({ download, upload }));
    const store = createSupabaseStudioUploadObjectStore({ storage: { from } });

    const fetched = await store.download(PATH);
    expect(fetched?.equals(bytes)).toBe(true);

    await expect(
      store.upload({ path: PATH, bytes, contentType: "image/png" }),
    ).resolves.toBe(true);
    expect(upload).toHaveBeenCalledWith(PATH, bytes, { contentType: "image/png", upsert: true });
    expect(from).toHaveBeenCalledWith("studio-uploads");
  });

  it("reads a missing or failed object as absent, and reports a failed store", async () => {
    const from = vi.fn(() => ({
      download: vi.fn(async () => ({ data: null, error: { message: "not found" } })),
      upload: vi.fn(async () => ({ error: { message: "denied" } })),
    }));
    const store = createSupabaseStudioUploadObjectStore({ storage: { from } });

    await expect(store.download(PATH)).resolves.toBeNull();
    await expect(
      store.upload({ path: PATH, bytes: Buffer.alloc(8), contentType: "image/png" }),
    ).resolves.toBe(false);
  });
});
