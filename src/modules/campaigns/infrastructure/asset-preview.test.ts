import { describe, expect, it, vi } from "vitest";

import {
  readAssetPreviewUrls,
  type AssetPathReader,
  type SignedUrlSource,
} from "@/modules/campaigns/infrastructure/asset-preview";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const VERSION_ID = "d1000000-0000-4000-8000-000000000001";
const ASSET_A = "a0000000-0000-4000-8000-000000000001";
const ASSET_B = "a0000000-0000-4000-8000-000000000002";

function database(
  rows: { asset_key: string; storage_path: string }[] | null,
  error: unknown = null,
) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ eq: async () => ({ data: rows, error }) }) }),
    }),
  } as unknown as AssetPathReader;
}

function storage(
  signed: { path: string | null; signedUrl: string }[] | null,
  error: unknown = null,
) {
  const createSignedUrls = vi.fn(async () => ({ data: signed, error }));
  return {
    source: { storage: { from: () => ({ createSignedUrls }) } } as unknown as SignedUrlSource,
    createSignedUrls,
  };
}

const input = { organizationId: ORGANIZATION_ID, bundleVersionId: VERSION_ID };

describe("preview links are keyed by the manifest's asset id", () => {
  it("maps each signed url back to the asset it belongs to", async () => {
    const { source } = storage([
      { path: "org/a.jpg", signedUrl: "https://signed/a" },
      { path: "org/b.jpg", signedUrl: "https://signed/b" },
    ]);

    const urls = await readAssetPreviewUrls(
      database([
        { asset_key: ASSET_A, storage_path: "org/a.jpg" },
        { asset_key: ASSET_B, storage_path: "org/b.jpg" },
      ]),
      source,
      input,
    );

    expect(urls).toEqual({ [ASSET_A]: "https://signed/a", [ASSET_B]: "https://signed/b" });
  });

  it("signs against the private campaign bucket with a short expiry", async () => {
    const { source, createSignedUrls } = storage([
      { path: "org/a.jpg", signedUrl: "https://signed/a" },
    ]);

    await readAssetPreviewUrls(
      database([{ asset_key: ASSET_A, storage_path: "org/a.jpg" }]),
      source,
      input,
    );

    const [paths, expiresIn] = createSignedUrls.mock.calls[0] as unknown as [string[], number];
    expect(paths).toEqual(["org/a.jpg"]);
    expect(expiresIn).toBeGreaterThan(0);
    expect(expiresIn).toBeLessThanOrEqual(3_600);
  });

  it("costs one asset its preview when only that one cannot be signed", async () => {
    const { source } = storage([
      { path: null, signedUrl: "" },
      { path: "org/b.jpg", signedUrl: "https://signed/b" },
    ]);

    const urls = await readAssetPreviewUrls(
      database([
        { asset_key: ASSET_A, storage_path: "org/a.jpg" },
        { asset_key: ASSET_B, storage_path: "org/b.jpg" },
      ]),
      source,
      input,
    );

    expect(urls).toEqual({ [ASSET_B]: "https://signed/b" });
  });
});

describe("a proposal stays reviewable without its pictures", () => {
  it("returns nothing rather than failing when the paths cannot be read", async () => {
    const { source } = storage([]);

    await expect(
      readAssetPreviewUrls(database(null, { code: "42501" }), source, input),
    ).resolves.toEqual({});
  });

  it("returns nothing rather than failing when signing is refused", async () => {
    const { source } = storage(null, { message: "denied" });

    await expect(
      readAssetPreviewUrls(
        database([{ asset_key: ASSET_A, storage_path: "org/a.jpg" }]),
        source,
        input,
      ),
    ).resolves.toEqual({});
  });

  it("does not call storage at all when the version carries no assets", async () => {
    const { source, createSignedUrls } = storage([]);

    await expect(readAssetPreviewUrls(database([]), source, input)).resolves.toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});
