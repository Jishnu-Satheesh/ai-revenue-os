import { describe, expect, it } from "vitest";
import { createOrganizationInputSchema } from "@/domain/organizations/types";

describe("createOrganizationInputSchema", () => {
  it("accepts a normalized organization identity", () => {
    expect(
      createOrganizationInputSchema.parse({
        name: "Al Noor Kitchen",
        slug: "al-noor-kitchen",
        industry: "restaurant",
        countryCode: "AE",
        currency: "AED",
        timezone: "Asia/Dubai",
      }).currency,
    ).toBe("AED");
  });

  it("rejects unsafe slugs", () => {
    expect(() =>
      createOrganizationInputSchema.parse({
        name: "Test",
        slug: "not a slug",
        industry: "retail",
        countryCode: "US",
        currency: "USD",
        timezone: "UTC",
      }),
    ).toThrow();
  });
});
