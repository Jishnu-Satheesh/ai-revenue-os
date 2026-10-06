import { describe, expect, it } from "vitest";

import { brandRequestSchema } from "@/app/api/organizations/[organizationId]/brand/schema";

const guidelines = { palette: { primary: "#c8102e" }, rules: [], restrictedTerms: [] };
const logo = {
  variant: "primary" as const,
  brandAssetVersionId: "aaaaaaaa-0000-4000-8000-000000000001",
};

describe("brandRequestSchema", () => {
  it("accepts a guidelines-only save", () => {
    const parsed = brandRequestSchema.parse({ guidelines });
    expect(parsed.logo).toBeUndefined();
  });

  it("accepts a logo-only save", () => {
    const parsed = brandRequestSchema.parse({ logo });
    expect(parsed.guidelines).toBeUndefined();
  });

  it("refuses an empty request rather than reporting a save that wrote nothing", () => {
    // A cheerful 200 having written nothing reads as a successful save.
    expect(() => brandRequestSchema.parse({})).toThrow();
  });

  it("refuses an unknown key", () => {
    expect(() => brandRequestSchema.parse({ guidelines, colour: "red" })).toThrow();
  });

  it("refuses a rule that names no strength", () => {
    // The whole point of the feature: hard and soft are different statements,
    // and the boundary is where an unmarked one must be stopped.
    expect(() =>
      brandRequestSchema.parse({
        guidelines: { palette: {}, rules: [{ text: "Never show alcohol" }], restrictedTerms: [] },
      }),
    ).toThrow();
  });
});
