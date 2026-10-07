import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
});

vi.mock("server-only", () => ({}));

const testEnv = vi.hoisted(() => ({
  INTEGRATION_HUB_V1_ORGANIZATION_IDS: undefined as string | undefined,
  AGENT_CHAT_V1_ORGANIZATION_IDS: undefined as string | undefined,
  GOVERNED_REPORT_VALIDATION_ORGANIZATION_IDS: undefined as string | undefined,
  GOVERNED_REPORT_PROJECTION_ORGANIZATION_IDS: undefined as string | undefined,
  GOVERNED_ECONOMICS_READINESS_ORGANIZATION_IDS: undefined as string | undefined,
  GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS: undefined as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env: testEnv }));
vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { logger } from "@/lib/logger";
import {
  assertAgentChatEnabled,
  assertGovernedEconomicsReadinessEnabled,
  assertIntegrationHubEnabled,
  isAgentChatEnabled,
  isGovernedEconomicsReadinessEnabled,
  isIntegrationHubEnabled,
  parseAgentChatOrganizationIds,
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

describe("agent chat rollout access", () => {
  it("is off for everyone when the variable is unset", () => {
    // The default the rollout plan depends on. An unset variable parses to
    // an empty set, and an empty set enables nobody.
    expect(parseAgentChatOrganizationIds(undefined)).toEqual(new Set());
    expect(isAgentChatEnabled(organizationA, parseAgentChatOrganizationIds(undefined))).toBe(false);
  });

  it("parses trimmed organization UUIDs and rejects empties and duplicates", () => {
    expect(parseAgentChatOrganizationIds(`${organizationA}, ${organizationB}`)).toEqual(
      new Set([organizationA, organizationB]),
    );
    expect(() => parseAgentChatOrganizationIds(`${organizationA},,${organizationB}`)).toThrow();
    expect(() =>
      parseAgentChatOrganizationIds(`${organizationA},${organizationA.toUpperCase()}`),
    ).toThrow();
    expect(() => parseAgentChatOrganizationIds("not-a-uuid")).toThrow();
  });

  it("matches organization ids case-insensitively", () => {
    expect(isAgentChatEnabled(organizationA.toUpperCase(), new Set([organizationA]))).toBe(true);
    expect(isAgentChatEnabled(organizationB, new Set([organizationA]))).toBe(false);
  });

  it("blocks organizations outside the enabled rollout", () => {
    expect(() => assertAgentChatEnabled(organizationB)).toThrowError(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
    expect(() => assertAgentChatEnabled(organizationA)).toThrowError(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
  });

  it("fails closed with a named log when the ambient allowlist is typoed", () => {
    testEnv.INTEGRATION_HUB_V1_ORGANIZATION_IDS = "*";
    try {
      expect(isIntegrationHubEnabled(organizationA)).toBe(false);
      expect(isIntegrationHubEnabled(organizationB)).toBe(false);
      expect(logger.error).toHaveBeenCalledWith(
        "rollout_allowlist.invalid_config",
        expect.objectContaining({
          errorCode: expect.stringContaining("INTEGRATION_HUB_V1_ORGANIZATION_IDS"),
        }),
      );
    } finally {
      testEnv.INTEGRATION_HUB_V1_ORGANIZATION_IDS = undefined;
    }
  });
});
