import { describe, expect, it } from "vitest";

import { resolveDisplayLogo, type DisplayableVersion } from "@/modules/brand/application/display-logo";

const versionId = "aaaaaaaa-0000-4000-8000-000000000001";
const primary = { variant: "primary" as const, brandAssetVersionId: versionId };

function version(overrides: Partial<DisplayableVersion> = {}): DisplayableVersion {
  return {
    brandAssetVersionId: versionId,
    label: "Al Noor wordmark",
    storagePath: "org/logo.png",
    archivedAt: null,
    currentVerdict: null,
    ...overrides,
  };
}

const signed = { "org/logo.png": "https://signed.example/logo.png" };

describe("resolveDisplayLogo", () => {
  it("resolves a usable, unrejected mark that signed", () => {
    expect(
      resolveDisplayLogo({ logos: [primary], versions: [version()], signedUrls: signed }),
    ).toEqual({ url: "https://signed.example/logo.png", label: "Al Noor wordmark" });
  });

  it("draws nothing for a mark whose latest review is a rejection", () => {
    // The same rule the SQL applies when naming the canonical logo. A mark the
    // platform refuses to draw must not be one it hands an image model.
    expect(
      resolveDisplayLogo({
        logos: [primary],
        versions: [version({ currentVerdict: "rejected" })],
        signedUrls: signed,
      }),
    ).toBeNull();
  });

  it("draws a mark that was rejected once and approved since", () => {
    expect(
      resolveDisplayLogo({
        logos: [primary],
        versions: [version({ currentVerdict: "approved" })],
        signedUrls: signed,
      }),
    ).not.toBeNull();
  });

  it("draws nothing when the version is no longer in the library", () => {
    // The library lists only validated versions, so no match means bytes
    // nobody checked, or an archived image.
    expect(resolveDisplayLogo({ logos: [primary], versions: [], signedUrls: signed })).toBeNull();
  });

  it("draws nothing for an archived version", () => {
    expect(
      resolveDisplayLogo({
        logos: [primary],
        versions: [version({ archivedAt: "2026-09-01T00:00:00.000Z" })],
        signedUrls: signed,
      }),
    ).toBeNull();
  });

  it("costs only the logo when signing failed", () => {
    expect(
      resolveDisplayLogo({ logos: [primary], versions: [version()], signedUrls: {} }),
    ).toBeNull();
  });

  it("draws nothing when no logo is set, rather than a placeholder", () => {
    expect(resolveDisplayLogo({ logos: [], versions: [version()], signedUrls: signed })).toBeNull();
  });
});
