import { describe, expect, it } from "vitest";
import { createOrganizationInputSchema, goalInputSchema } from "@/domain/organizations/types";

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

  it("supports an explicitly branchless organization", () => {
    const organization = createOrganizationInputSchema.parse({
      name: "Remote Advisory",
      slug: "remote-advisory",
      industry: "consulting",
      countryCode: "GB",
      currency: "GBP",
      timezone: "Europe/London",
      firstBranch: null,
    });
    expect(organization.firstBranch).toBeNull();
  });

  it("requires a branch for branch-scoped goals", () => {
    expect(() =>
      goalInputSchema.parse({
        name: "Branch footfall",
        metric: "visits",
        baselineStatus: "unknown",
        targetValue: 100,
        unit: "visits",
        scopeKind: "branch",
      }),
    ).toThrow();
  });
});
