import { describe, expect, it } from "vitest";
import {
  constraintInputSchema,
  createOrganizationInputSchema,
  goalInputSchema,
} from "@/domain/organizations/types";

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

describe("constraintInputSchema", () => {
  const baseConstraint = {
    constraintKey: "margin_floor.delivery",
    name: "Delivery margin floor",
    constraintType: "margin_floor",
    value: { minimumMarginPercent: 12 },
  };

  it("defaults to an organization scope with no subject", () => {
    const constraint = constraintInputSchema.parse(baseConstraint);
    expect(constraint.scopeKind).toBe("organization");
    expect(constraint.scopeRef).toBeUndefined();
    expect(constraint.severity).toBe("hard");
  });

  it("rejects a constraint key that is not a lower-case slug", () => {
    expect(() =>
      constraintInputSchema.parse({ ...baseConstraint, constraintKey: "Margin Floor" }),
    ).toThrow();
  });

  it("requires a subject for branch and channel scopes", () => {
    expect(() => constraintInputSchema.parse({ ...baseConstraint, scopeKind: "branch" })).toThrow();
    expect(() =>
      constraintInputSchema.parse({ ...baseConstraint, scopeKind: "channel" }),
    ).toThrow();
  });

  it("rejects a subject on an organization-scoped constraint", () => {
    expect(() => constraintInputSchema.parse({ ...baseConstraint, scopeRef: "talabat" })).toThrow();
  });

  it("accepts a scoped constraint with an effective date", () => {
    const constraint = constraintInputSchema.parse({
      ...baseConstraint,
      scopeKind: "channel",
      scopeRef: "talabat",
      effectiveFrom: "2026-08-10",
    });
    expect(constraint.scopeRef).toBe("talabat");
    expect(constraint.effectiveFrom).toBe("2026-08-10");
  });

  it("rejects a value that was omitted entirely", () => {
    expect(() =>
      constraintInputSchema.parse({
        constraintKey: baseConstraint.constraintKey,
        name: baseConstraint.name,
        constraintType: baseConstraint.constraintType,
      }),
    ).toThrow();
  });
});
