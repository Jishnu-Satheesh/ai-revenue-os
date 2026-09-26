import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createSupabaseStudioReferenceSigner,
  createStudioUploadRecordReader,
  signEntryKey,
} from "@/modules/creative-studio/infrastructure/reference-reader";

const ORG = "00000000-0000-4000-8000-000000000001";
const FOREIGN_ORG = "00000000-0000-4000-8000-000000000099";
const UPLOAD = "00000000-0000-4000-8000-000000000002";
const ACTOR = "00000000-0000-4000-8000-000000000003";
const HASH = "c".repeat(64);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: UPLOAD,
    organization_id: ORG,
    actor_id: ACTOR,
    reserved_path: `${ORG}/${UPLOAD}/hero.png`,
    state: "reserved",
    rights_attestation: { accepted: true },
    final_hash: null,
    final_mime: null,
    final_width: null,
    final_height: null,
    final_bytes: null,
    expires_at: "2100-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function persistenceWith(data: Record<string, unknown> | null, error: unknown = null) {
  const maybeSingle = vi.fn(async () => ({ data, error }));
  const eqInner = vi.fn(() => ({ maybeSingle }));
  const eqOuter = vi.fn(() => ({ eq: eqInner }));
  const select = vi.fn(() => ({ eq: eqOuter }));
  const from = vi.fn(() => ({ select }));
  return { persistence: { from }, from, select, eqOuter, eqInner, maybeSingle };
}

describe("studio upload record reader", () => {
  it("reads a reservation row through the tenant-scoped select", async () => {
    const { persistence, from, eqOuter, eqInner } = persistenceWith(row());
    const reader = createStudioUploadRecordReader(persistence);

    const record = await reader.read(ORG, UPLOAD);

    expect(record).toMatchObject({
      organizationId: ORG,
      uploadId: UPLOAD,
      actorId: ACTOR,
      reservedPath: `${ORG}/${UPLOAD}/hero.png`,
      state: "reserved",
      expiresAt: "2100-01-01T00:00:00.000Z",
    });
    expect(from).toHaveBeenCalledWith("studio_uploads");
    expect(eqOuter).toHaveBeenCalledWith("organization_id", ORG);
    expect(eqInner).toHaveBeenCalledWith("id", UPLOAD);
  });

  it("returns null when no row exists, without throwing", async () => {
    const { persistence } = persistenceWith(null);
    const reader = createStudioUploadRecordReader(persistence);

    await expect(reader.read(ORG, UPLOAD)).resolves.toBeNull();
  });

  it("reads a foreign upload as absent rather than leaking it", async () => {
    const { persistence } = persistenceWith(row({ organization_id: FOREIGN_ORG }));
    const reader = createStudioUploadRecordReader(persistence);

    await expect(reader.read(ORG, UPLOAD)).resolves.toBeNull();
  });

  it("refuses a row it cannot parse instead of handing on an undefined", async () => {
    const { persistence } = persistenceWith(row({ state: "teleported" }));
    const reader = createStudioUploadRecordReader(persistence);

    await expect(reader.read(ORG, UPLOAD)).rejects.toThrow(/could not be read/);
  });

  it("reports a failed read instead of returning an empty record", async () => {
    const { persistence } = persistenceWith(null, { message: "connection reset" });
    const reader = createStudioUploadRecordReader(persistence);

    await expect(reader.read(ORG, UPLOAD)).rejects.toThrow(/could not be read/);
  });

  it("parses finalized bytes on a ready row", async () => {
    const { persistence } = persistenceWith(
      row({
        state: "ready",
        final_hash: HASH,
        final_mime: "image/png",
        final_width: 1080,
        final_height: 1350,
        final_bytes: 812_345,
      }),
    );
    const reader = createStudioUploadRecordReader(persistence);

    const record = await reader.read(ORG, UPLOAD);

    expect(record).toMatchObject({
      state: "ready",
      finalHash: HASH,
      finalMime: "image/png",
      finalWidth: 1080,
      finalHeight: 1350,
      finalBytes: 812_345,
    });
  });
});

describe("studio reference signer", () => {
  it("signs each bucket's paths with the five-minute ttl", async () => {
    const seen: { bucket: string; paths: string[]; ttl: number }[] = [];
    const from = vi.fn((bucket: string) => ({
      createSignedUrls: async (paths: string[], ttl: number) => {
        seen.push({ bucket, paths, ttl });
        return {
          data: paths.map((path) => ({ path, signedUrl: `https://cdn.test/${bucket}/${path}?sig=1` })),
          error: null,
        };
      },
    }));
    const signer = createSupabaseStudioReferenceSigner({ storage: { from } });

    const urls = await signer.signPaths([
      { bucket: "studio-uploads", path: `${ORG}/${UPLOAD}/hero.png` },
      { bucket: "creative-assets", path: `${ORG}/creative-history/intent/source` },
    ]);

    expect(seen).toEqual([
      { bucket: "studio-uploads", paths: [`${ORG}/${UPLOAD}/hero.png`], ttl: 300 },
      { bucket: "creative-assets", paths: [`${ORG}/creative-history/intent/source`], ttl: 300 },
    ]);
    expect(urls[signEntryKey({ bucket: "studio-uploads", path: `${ORG}/${UPLOAD}/hero.png` })]).toContain(
      "sig=1",
    );
  });

  it("signs anew against the same storage identity when a preview expires", async () => {
    let round = 0;
    const signed: string[][] = [];
    const from = vi.fn(() => ({
      createSignedUrls: async (paths: string[]) => {
        round += 1;
        signed.push(paths);
        return {
          data: paths.map((path) => ({ path, signedUrl: `https://cdn.test/${path}?sig=${round}` })),
          error: null,
        };
      },
    }));
    const signer = createSupabaseStudioReferenceSigner({ storage: { from } });
    const entry = { bucket: "studio-uploads", path: `${ORG}/${UPLOAD}/hero.png` };

    const first = await signer.signPaths([entry]);
    const second = await signer.signPaths([entry]);

    // Same identity re-signed, new URL: nothing moved, nothing rewritten.
    expect(signed).toEqual([[entry.path], [entry.path]]);
    expect(first[signEntryKey(entry)]).toContain("sig=1");
    expect(second[signEntryKey(entry)]).toContain("sig=2");
    expect(from).toHaveBeenCalledTimes(2);
  });

  it("lets one unsignable path cost only its own preview", async () => {
    const from = vi.fn(() => ({
      createSignedUrls: async (paths: string[]) => ({
        data: paths.map((path) =>
          path.includes("missing")
            ? { path: null, signedUrl: "" }
            : { path, signedUrl: `https://cdn.test/${path}` },
        ),
        error: null,
      }),
    }));
    const signer = createSupabaseStudioReferenceSigner({ storage: { from } });

    const urls = await signer.signPaths([
      { bucket: "studio-uploads", path: `${ORG}/missing.png` },
      { bucket: "studio-uploads", path: `${ORG}/present.png` },
    ]);

    expect(urls[`studio-uploads:${ORG}/missing.png`]).toBeUndefined();
    expect(urls[`studio-uploads:${ORG}/present.png`]).toContain("https://cdn.test/");
  });

  it("returns an empty map when signing fails, and signs nothing for no entries", async () => {
    const createSignedUrls = vi.fn(async () => ({ data: null, error: { message: "down" } }));
    const from = vi.fn(() => ({ createSignedUrls }));
    const signer = createSupabaseStudioReferenceSigner({ storage: { from } });

    await expect(signer.signPaths([{ bucket: "studio-uploads", path: "x" }])).resolves.toEqual({});
    await expect(signer.signPaths([])).resolves.toEqual({});
    expect(createSignedUrls).toHaveBeenCalledTimes(1);
  });
});
