import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
});

vi.mock("server-only", () => ({}));

import {
  assertIntegrationHubEnabled,
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
    expect(() => assertIntegrationHubEnabled(organizationA.toUpperCase(), new Set([organizationA]))).not.toThrow();
  });

  it("blocks organizations outside the enabled rollout", () => {
    expect(() => assertIntegrationHubEnabled(organizationB, new Set([organizationA]))).toThrowError(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
  });
});
