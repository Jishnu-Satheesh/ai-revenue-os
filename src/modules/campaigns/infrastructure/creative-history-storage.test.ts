import { describe, expect, it, vi } from "vitest";

import {
  createSupabaseCreativeHistoryObjectStore,
  creativeHistoryStoragePath,
  CREATIVE_HISTORY_BUCKET,
  CREATIVE_HISTORY_PREVIEW_TTL_SECONDS,
} from "@/modules/campaigns/infrastructure/creative-history-storage";

const ORGANIZATION_ID = "10000000-0000-4000-8000-000000000001";

describe("the object key builder", () => {
  it("is rooted in the caller's own tenant, with no extension claimed before the bytes are read", () => {
    const path = creativeHistoryStoragePath({
      organizationId: ORGANIZATION_ID,
      uploadIntentId: "50000000-0000-4000-8000-000000000001",
    });

    expect(path).toBe(
      `${ORGANIZATION_ID}/creative-history/50000000-0000-4000-8000-000000000001/source`,
    );
    expect(path.startsWith(`${ORGANIZATION_ID}/`)).toBe(true);
    expect(path.includes(".")).toBe(false);
  });
});

function fakeClient(overrides: {
  download?: (path: string) => Promise<{ data: Blob | null; error: unknown }>;
  upload?: (
    path: string,
    body: Buffer,
    options: { contentType: string; upsert: boolean },
  ) => Promise<{ error: unknown }>;
  createSignedUrls?: (
    paths: string[],
    expiresIn: number,
  ) => Promise<{ data: { path: string | null; signedUrl: string }[] | null; error: unknown }>;
}) {
  return {
    storage: {
      from: vi.fn((bucket: string) => {
        expect(bucket).toBe(CREATIVE_HISTORY_BUCKET);
        return {
          download: overrides.download ?? (async () => ({ data: null, error: "not called" })),
          upload: overrides.upload ?? (async () => ({ error: "not called" })),
          createSignedUrls:
            overrides.createSignedUrls ?? (async () => ({ data: null, error: "not called" })),
        };
      }),
    },
  };
}

describe("the private storage adapter", () => {
  it("returns bytes on a successful download", async () => {
    const bytes = Buffer.from("hello");
    const store = createSupabaseCreativeHistoryObjectStore(
      fakeClient({
        download: async () => ({ data: new Blob([bytes]), error: null }),
      }),
    );

    const result = await store.download("some/path");
    expect(result).toEqual(bytes);
  });

  it("returns null rather than throwing when nothing is at the reserved key", async () => {
    const store = createSupabaseCreativeHistoryObjectStore(
      fakeClient({ download: async () => ({ data: null, error: { message: "not found" } }) }),
    );

    await expect(store.download("missing/path")).resolves.toBeNull();
  });

  it("uploads with upsert so a validated re-encode replaces the browser's own upload at the same key", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const store = createSupabaseCreativeHistoryObjectStore(fakeClient({ upload }));

    const stored = await store.upload({
      path: "org/path",
      bytes: Buffer.from("x"),
      contentType: "image/png",
    });

    expect(stored).toBe(true);
    expect(upload).toHaveBeenCalledWith(
      "org/path",
      Buffer.from("x"),
      expect.objectContaining({ contentType: "image/png", upsert: true }),
    );
  });

  it("reports upload failure as false rather than throwing", async () => {
    const store = createSupabaseCreativeHistoryObjectStore(
      fakeClient({ upload: async () => ({ error: { message: "denied" } }) }),
    );

    await expect(
      store.upload({ path: "org/path", bytes: Buffer.from("x"), contentType: "image/png" }),
    ).resolves.toBe(false);
  });

  it("signs only the paths it is given, for a bounded ttl", async () => {
    const createSignedUrls = vi.fn(async () => ({
      data: [{ path: "org/a", signedUrl: "https://signed.example/a" }],
      error: null,
    }));
    const store = createSupabaseCreativeHistoryObjectStore(fakeClient({ createSignedUrls }));

    const urls = await store.signPreviews(["org/a"]);

    expect(urls).toEqual({ "org/a": "https://signed.example/a" });
    expect(createSignedUrls).toHaveBeenCalledWith(["org/a"], CREATIVE_HISTORY_PREVIEW_TTL_SECONDS);
  });

  it("never calls the client for an empty path list", async () => {
    const createSignedUrls = vi.fn();
    const store = createSupabaseCreativeHistoryObjectStore(fakeClient({ createSignedUrls }));

    await expect(store.signPreviews([])).resolves.toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("degrades to no previews rather than throwing when signing fails outright", async () => {
    const store = createSupabaseCreativeHistoryObjectStore(
      fakeClient({ createSignedUrls: async () => ({ data: null, error: { message: "denied" } }) }),
    );

    await expect(store.signPreviews(["org/a"])).resolves.toEqual({});
  });

  it("drops only the one path a per-file signing failure names", async () => {
    const store = createSupabaseCreativeHistoryObjectStore(
      fakeClient({
        createSignedUrls: async () => ({
          data: [
            { path: "org/a", signedUrl: "https://signed.example/a" },
            { path: null, signedUrl: "" },
          ],
          error: null,
        }),
      }),
    );

    const urls = await store.signPreviews(["org/a", "org/b"]);
    expect(urls).toEqual({ "org/a": "https://signed.example/a" });
  });
});
