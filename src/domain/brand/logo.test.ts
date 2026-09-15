import { describe, expect, it } from "vitest";

import { brandLogoSelectionSchema, resolveLogoForTheme } from "@/domain/brand/logo";

const primary = {
  variant: "primary" as const,
  brandAssetVersionId: "aaaaaaaa-0000-4000-8000-000000000001",
};
const dark = {
  variant: "dark" as const,
  brandAssetVersionId: "aaaaaaaa-0000-4000-8000-000000000002",
};

describe("brandLogoSelectionSchema", () => {
  it("refuses a variant the platform does not know", () => {
    expect(() =>
      brandLogoSelectionSchema.parse({
        variant: "mono",
        brandAssetVersionId: primary.brandAssetVersionId,
      }),
    ).toThrow();
  });
});

describe("resolveLogoForTheme", () => {
  it("uses the dark variant on dark ground when one is set", () => {
    expect(resolveLogoForTheme([primary, dark], "dark")).toEqual(dark);
  });

  it("falls back to primary rather than recolouring it", () => {
    // Spec §2. Recolouring somebody's mark is what brand_mark_distorted exists
    // to catch; doing it ourselves would be worse than a model doing it.
    expect(resolveLogoForTheme([primary], "dark")).toEqual(primary);
  });

  it("uses primary on light ground even when a dark variant exists", () => {
    expect(resolveLogoForTheme([primary, dark], "light")).toEqual(primary);
  });

  it("returns null when no logo is set, rather than a placeholder", () => {
    // Spec failure states: the platform shows its own mark, never something
    // that looks like a brand nobody supplied.
    expect(resolveLogoForTheme([], "light")).toBeNull();
    expect(resolveLogoForTheme([dark], "light")).toBeNull();
  });
});
