import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
});

vi.mock("server-only", () => ({}));

import {
  assertGovernedEconomicsReadinessEnabled,
  assertIntegrationHubEnabled,
  isGovernedEconomicsReadinessEnabled,
  isIntegrationHubEnabled,
  parseIntegrationOrganizationIds,
} from "@/modules/integrations/application/feature-access";

const organizationA = "7e4402e6-283f-45a6-97e2-bde93fdf1bc9";
const organizationB = "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";

describe("Integration Hub rollout access", () => {
  it("parses trimmed organization UUIDs into an enabled set", () => {
    expect(parseIntegrationOrganizationIds(`${organizationA}, ${organizationB}`)).toEqual(
      new Set([organizationA, organizationB]),
    );
  });

  it("rejects malformed organization IDs", () => {
    expect(() => parseIntegrationOrganizationIds("not-a-uuid")).toThrow();
  });

  it("rejects duplicate organization IDs", () => {
    expect(() => parseIntegrationOrganizationIds(`${organizationA},${organizationA}`)).toThrow();
  });

  it("rejects duplicate organization IDs regardless of UUID case", () => {
    expect(() =>
      parseIntegrationOrganizationIds(`${organizationA},${organizationA.toUpperCase()}`),
    ).toThrow();
  });

  it("allows uppercase organization IDs when the rollout set is enabled", () => {
    expect(() =>
      assertIntegrationHubEnabled(organizationA.toUpperCase(), new Set([organizationA])),
    ).not.toThrow();
  });

  it("reports rollout membership without throwing for composed read surfaces", () => {
    expect(isIntegrationHubEnabled(organizationA, new Set([organizationA]))).toBe(true);
    expect(isIntegrationHubEnabled(organizationB, new Set([organizationA]))).toBe(false);
  });

  it("blocks organizations outside the enabled rollout", () => {
    expect(() => assertIntegrationHubEnabled(organizationB, new Set([organizationA]))).toThrowError(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
  });
});

describe("governed economics readiness rollout", () => {
  it("is off for an organization outside the enabled set", () => {
    expect(isGovernedEconomicsReadinessEnabled(organizationB, new Set([organizationA]))).toBe(
      false,
    );
  });

  it("is off for everyone when the variable is unset", () => {
    // The default the rollback plan depends on. An unset variable parses to an
    // empty set, and an empty set enables nobody.
    expect(
      isGovernedEconomicsReadinessEnabled(
        organizationA,
        parseIntegrationOrganizationIds(undefined),
      ),
    ).toBe(false);
  });

  it("is on for an enabled organization whatever case its ID arrives in", () => {
    expect(
      isGovernedEconomicsReadinessEnabled(organizationA.toUpperCase(), new Set([organizationA])),
    ).toBe(true);
  });

  it("refuses a disabled organization as an unavailable feature rather than a denial", () => {
    // FEATURE_NOT_AVAILABLE becomes a 404 at the boundary. A 403 would confirm
    // the surface exists, which is a roadmap leak rather than an access answer.
    expect(() => assertGovernedEconomicsReadinessEnabled(organizationB)).toThrowError(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
  });
});
