import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { logger } from "@/lib/logger";
import {
  parseOrganizationAllowlist,
  resolveOrganizationAllowlist,
  RolloutAllowlistError,
} from "@/lib/rollout-allowlist";

const OPTIONS = {
  variableName: "CAMPAIGNS_V1_ORGANIZATION_IDS",
  label: "Campaign rollout organization IDs",
} as const;

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseOrganizationAllowlist", () => {
  it("treats blank as disabled", () => {
    expect(parseOrganizationAllowlist(undefined, OPTIONS).size).toBe(0);
    expect(parseOrganizationAllowlist("", OPTIONS).size).toBe(0);
    expect(parseOrganizationAllowlist("   ", OPTIONS).size).toBe(0);
  });

  it("parses trimmed UUIDs and lowercases them", () => {
    expect(parseOrganizationAllowlist(` ${ORG_A} , ${ORG_B} `, OPTIONS)).toEqual(
      new Set([ORG_A, ORG_B]),
    );
    expect(parseOrganizationAllowlist(ORG_A.toUpperCase(), OPTIONS)).toEqual(new Set([ORG_A]));
  });

  it("names the variable and entry on a non-UUID value", () => {
    const error = (() => {
      try {
        parseOrganizationAllowlist("*", OPTIONS);
        return null;
      } catch (thrown) {
        return thrown;
      }
    })();
    expect(error).toBeInstanceOf(RolloutAllowlistError);
    expect((error as RolloutAllowlistError).variableName).toBe("CAMPAIGNS_V1_ORGANIZATION_IDS");
    expect((error as Error).message).toContain("CAMPAIGNS_V1_ORGANIZATION_IDS");
    expect((error as Error).message).toContain('"*"');
  });

  it("rejects empty entries and duplicates with the legacy wording", () => {
    expect(() => parseOrganizationAllowlist(`${ORG_A},,${ORG_B}`, OPTIONS)).toThrow(/empty/i);
    expect(() => parseOrganizationAllowlist(`${ORG_A},${ORG_A}`, OPTIONS)).toThrow(/duplicates/i);
  });

  it("enforces the cap when one is configured", () => {
    expect(() =>
      parseOrganizationAllowlist(`${ORG_A},${ORG_B}`, { ...OPTIONS, maxEntries: 1 }),
    ).toThrow(/1/);
  });
});

describe("resolveOrganizationAllowlist", () => {
  it("returns the parsed set for valid input without logging", () => {
    expect(resolveOrganizationAllowlist(ORG_A, OPTIONS)).toEqual(new Set([ORG_A]));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("fails closed on a typoed list and logs the variable name", () => {
    expect(resolveOrganizationAllowlist("*", OPTIONS).size).toBe(0);
    expect(resolveOrganizationAllowlist("not-a-uuid", OPTIONS).size).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      "rollout_allowlist.invalid_config",
      expect.objectContaining({
        errorCode: expect.stringContaining("CAMPAIGNS_V1_ORGANIZATION_IDS"),
      }),
    );
  });
});
