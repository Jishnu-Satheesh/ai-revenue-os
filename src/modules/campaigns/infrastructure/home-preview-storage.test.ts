import { describe, expect, it, vi } from "vitest";

import {
  HOME_PREVIEW_TTL_SECONDS,
  signHomePreviewImages,
  type HomePreviewStorage,
} from "@/modules/campaigns/infrastructure/home-preview-storage";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-09-11T12:00:00.000Z";
const CORRELATION_ID = "33333333-3333-4333-8333-333333333333";

function image(
  overrides: {
    id?: string;
    path?: string;
    alt?: string;
    width?: number;
    height?: number;
  } = {},
) {
  return {
    id: "44444444-4444-4444-8444-444444444444",
    path: `${ORGANIZATION_ID}/poster-a.png`,
    alt: "Weekday evening demand lift",
    width: 1080,
    height: 1080,
    ...overrides,
  };
}

function storage(
  handler: (paths: string[]) => {
    data: { path: string | null; signedUrl: string }[] | null;
    error: unknown;
  } = (paths) => ({
    data: paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })),
    error: null,
  }),
) {
  const createSignedUrls = vi.fn(async (paths: string[]) => handler(paths));
  const source = {
    storage: { from: () => ({ createSignedUrls }) },
  } as unknown as HomePreviewStorage;
  return { source, createSignedUrls };
}

const baseInput = {
  organizationId: ORGANIZATION_ID,
  bucket: "campaign-assets" as const,
  now: NOW,
  correlationId: CORRELATION_ID,
};

describe("home preview signing contract", () => {
  it("uses a 600-second expiry, never longer", () => {
    expect(HOME_PREVIEW_TTL_SECONDS).toBe(600);
  });

  it("signs each image against the given bucket with that exact TTL", async () => {
    const { source, createSignedUrls } = storage();

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [
        image(),
        image({
          id: "55555555-5555-4555-8555-555555555555",
          path: `${ORGANIZATION_ID}/poster-b.png`,
        }),
      ],
    });

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    const [paths, expiresIn] = createSignedUrls.mock.calls[0] as unknown as [string[], number];
    expect(paths).toEqual([`${ORGANIZATION_ID}/poster-a.png`, `${ORGANIZATION_ID}/poster-b.png`]);
    expect(expiresIn).toBe(600);
    expect(Object.keys(signed)).toEqual([
      "44444444-4444-4444-8444-444444444444",
      "55555555-5555-4555-8555-555555555555",
    ]);
  });

  it("stamps expiry exactly 600 seconds after the request clock", async () => {
    const { source } = storage();

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [image()],
    });

    expect(signed["44444444-4444-4444-8444-444444444444"]).toEqual({
      url: `https://signed.example/${ORGANIZATION_ID}/poster-a.png`,
      alt: "Weekday evening demand lift",
      width: 1080,
      height: 1080,
      expiresAt: "2026-09-11T12:10:00.000Z",
    });
  });

  it("carries no storage path or bucket in the signed record", async () => {
    // The signer answers with opaque bearer URLs here, as production does.
    const { source } = storage((paths) => ({
      data: paths.map((path) => ({ path, signedUrl: "https://signed.example/opaque-token" })),
      error: null,
    }));

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [image()],
    });

    const record = signed["44444444-4444-4444-8444-444444444444"];
    expect(Object.keys(record ?? {}).sort()).toEqual(
      ["alt", "expiresAt", "height", "url", "width"].sort(),
    );
    const serialized = JSON.stringify(record);
    expect(serialized).not.toContain("poster-a.png");
    expect(serialized).not.toContain("brand-assets");
    expect(serialized).not.toContain("campaign-assets");
  });

  it("does not touch storage when there is nothing to sign", async () => {
    const { source, createSignedUrls } = storage();

    await expect(
      signHomePreviewImages({ ...baseInput, storage: source, images: [] }),
    ).resolves.toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("refuses more than eight images with a domain-safe error", async () => {
    const { source, createSignedUrls } = storage();
    const images = Array.from({ length: 9 }, (_, index) =>
      image({
        id: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
        path: `${ORGANIZATION_ID}/poster-${index}.png`,
      }),
    );

    await expect(signHomePreviewImages({ ...baseInput, storage: source, images })).rejects.toThrow(
      "could not be signed",
    );
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("signs exactly eight images", async () => {
    const { source, createSignedUrls } = storage();
    const images = Array.from({ length: 8 }, (_, index) =>
      image({
        id: `66666666-6666-4666-8666-${String(index).padStart(12, "0")}`,
        path: `${ORGANIZATION_ID}/poster-${index}.png`,
      }),
    );

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images,
    });

    expect(createSignedUrls).toHaveBeenCalledTimes(1);
    expect(Object.keys(signed)).toHaveLength(8);
  });
});

describe("signing failures stay local to the image", () => {
  it("returns no images when signing is refused outright", async () => {
    const { source } = storage(() => ({ data: null, error: { message: "denied" } }));

    await expect(
      signHomePreviewImages({ ...baseInput, storage: source, images: [image()] }),
    ).resolves.toEqual({});
  });

  it("returns no images when the signer answers with nothing", async () => {
    const { source } = storage(() => ({ data: null, error: null }));

    await expect(
      signHomePreviewImages({ ...baseInput, storage: source, images: [image()] }),
    ).resolves.toEqual({});
  });

  it("keeps the signable image when only one path fails", async () => {
    const { source } = storage((paths) => ({
      data: paths.map((path) =>
        path.endsWith("poster-a.png")
          ? { path: null, signedUrl: "" }
          : { path, signedUrl: `https://signed.example/${path}` },
      ),
      error: null,
    }));

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [
        image(),
        image({
          id: "55555555-5555-4555-8555-555555555555",
          path: `${ORGANIZATION_ID}/poster-b.png`,
        }),
      ],
    });

    expect(Object.keys(signed)).toEqual(["55555555-5555-4555-8555-555555555555"]);
  });

  it("maps shuffled responses by exact path, not response position", async () => {
    const { source } = storage((paths) => ({
      data: [...paths].reverse().map((path) => ({
        path,
        signedUrl: `https://signed.example${path}`,
      })),
      error: null,
    }));

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [
        image(),
        image({
          id: "55555555-5555-4555-8555-555555555555",
          path: `${ORGANIZATION_ID}/poster-b.png`,
        }),
      ],
    });

    expect(signed["44444444-4444-4444-8444-444444444444"]?.url).toBe(
      `https://signed.example${ORGANIZATION_ID}/poster-a.png`,
    );
    expect(signed["55555555-5555-4555-8555-555555555555"]?.url).toBe(
      `https://signed.example${ORGANIZATION_ID}/poster-b.png`,
    );
  });

  it("ignores returned paths that were never requested", async () => {
    const { source } = storage((paths) => ({
      data: [
        ...paths.map((path) => ({ path, signedUrl: `https://signed.example/${path}` })),
        { path: `${ORGANIZATION_ID}/intruder.png`, signedUrl: "https://signed.example/evil" },
      ],
      error: null,
    }));

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [image()],
    });

    expect(Object.keys(signed)).toEqual(["44444444-4444-4444-8444-444444444444"]);
  });
});

describe("untrusted paths never reach the signer", () => {
  it("rejects other-tenant paths before signing", async () => {
    const { source, createSignedUrls } = storage();

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [
        image(),
        image({
          id: "55555555-5555-4555-8555-555555555555",
          path: `${OTHER_ORGANIZATION_ID}/poster-b.png`,
        }),
      ],
    });

    const [paths] = createSignedUrls.mock.calls[0] as unknown as [string[], number];
    expect(paths).toEqual([`${ORGANIZATION_ID}/poster-a.png`]);
    expect(Object.keys(signed)).toEqual(["44444444-4444-4444-8444-444444444444"]);
  });

  it("rejects traversal segments even under the tenant prefix", async () => {
    const { source, createSignedUrls } = storage();

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [
        image({ path: `${ORGANIZATION_ID}/../${OTHER_ORGANIZATION_ID}/evil.png` }),
        image({
          id: "55555555-5555-4555-8555-555555555555",
          path: `${ORGANIZATION_ID}/./evil.png`,
        }),
        image({
          id: "77777777-7777-4777-8777-777777777777",
          path: `${ORGANIZATION_ID}//evil.png`,
        }),
      ],
    });

    expect(signed).toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });

  it("rejects empty ids, empty alt text and non-positive dimensions", async () => {
    const { source, createSignedUrls } = storage();

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [
        image({ id: "" }),
        image({ id: "55555555-5555-4555-8555-555555555555", alt: "" }),
        image({ id: "77777777-7777-4777-8777-777777777777", width: 0 }),
        image({ id: "88888888-8888-4888-8888-888888888888", height: -4 }),
        image({ id: "99999999-9999-4999-8999-999999999999", width: 10.5 }),
      ],
    });

    expect(signed).toEqual({});
    expect(createSignedUrls).not.toHaveBeenCalled();
  });
});

describe("shared artwork keeps separate record identities", () => {
  it("dedupes the shared path for signing but returns both records", async () => {
    const { source, createSignedUrls } = storage();

    const signed = await signHomePreviewImages({
      ...baseInput,
      storage: source,
      images: [image(), image({ id: "55555555-5555-4555-8555-555555555555" })],
    });

    const [paths] = createSignedUrls.mock.calls[0] as unknown as [string[], number];
    expect(paths).toEqual([`${ORGANIZATION_ID}/poster-a.png`]);
    expect(Object.keys(signed).sort()).toEqual(
      ["44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555"].sort(),
    );
    expect(signed["44444444-4444-4444-8444-444444444444"]?.url).toBe(
      signed["55555555-5555-4555-8555-555555555555"]?.url,
    );
  });
});
