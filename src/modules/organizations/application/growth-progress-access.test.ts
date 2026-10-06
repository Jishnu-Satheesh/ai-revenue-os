import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const testEnv = vi.hoisted(() => ({
  OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS: undefined as string | undefined,
}));
vi.mock("@/lib/env", () => ({ env: testEnv }));

import {
  OVERVIEW_GROWTH_PROGRESS_MAX_ORGANIZATIONS,
  assertOverviewGrowthProgressEnabled,
  isOverviewGrowthProgressEnabled,
  parseOverviewGrowthProgressOrganizationIds,
} from "@/modules/organizations/application/growth-progress-access";

const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";

function uuid(index: number): string {
  const tail = String(index).padStart(12, "0");
  return `33333333-3333-4333-8333-${tail}`;
}

describe("parseOverviewGrowthProgressOrganizationIds", () => {
  it("treats blank as disabled", () => {
    expect(parseOverviewGrowthProgressOrganizationIds(undefined).size).toBe(0);
    expect(parseOverviewGrowthProgressOrganizationIds("").size).toBe(0);
    expect(parseOverviewGrowthProgressOrganizationIds("   ").size).toBe(0);
  });

  it("parses a strict UUID allowlist", () => {
    const parsed = parseOverviewGrowthProgressOrganizationIds(` ${ORG_A} , ${ORG_B} `);
    expect([...parsed].sort()).toEqual([ORG_A, ORG_B].sort());
  });

  it("rejects non-UUID, empty and duplicate identifiers", () => {
    expect(() => parseOverviewGrowthProgressOrganizationIds("not-a-uuid")).toThrow();
    expect(() => parseOverviewGrowthProgressOrganizationIds(`${ORG_A},,${ORG_B}`)).toThrow();
    expect(() => parseOverviewGrowthProgressOrganizationIds(`${ORG_A}, ${ORG_A}`)).toThrow();
    expect(() =>
      parseOverviewGrowthProgressOrganizationIds(`${ORG_A}, ${ORG_A.toUpperCase()}`),
    ).toThrow();
  });

  it("caps the allowlist at 100 entries", () => {
    expect(OVERVIEW_GROWTH_PROGRESS_MAX_ORGANIZATIONS).toBe(100);
    const hundred = Array.from({ length: 100 }, (_, index) => uuid(index + 1)).join(",");
    expect(parseOverviewGrowthProgressOrganizationIds(hundred).size).toBe(100);
    const hundredOne = `${hundred},${uuid(101)}`;
    expect(() => parseOverviewGrowthProgressOrganizationIds(hundredOne)).toThrow(/100/);
  });
});

describe("isOverviewGrowthProgressEnabled", () => {
  it("matches case-insensitively against the configured list", () => {
    const enabled = parseOverviewGrowthProgressOrganizationIds(ORG_A);
    expect(isOverviewGrowthProgressEnabled(ORG_A.toUpperCase(), enabled)).toBe(true);
    expect(isOverviewGrowthProgressEnabled(ORG_B, enabled)).toBe(false);
  });

  it("reads the server allowlist by default", () => {
    testEnv.OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS = ORG_A;
    expect(isOverviewGrowthProgressEnabled(ORG_A)).toBe(true);
    expect(isOverviewGrowthProgressEnabled(ORG_B)).toBe(false);
    testEnv.OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS = undefined;
    expect(isOverviewGrowthProgressEnabled(ORG_A)).toBe(false);
  });

  it("asserts with a typed denial for outsiders", () => {
    const enabled = parseOverviewGrowthProgressOrganizationIds(ORG_A);
    expect(() => assertOverviewGrowthProgressEnabled(ORG_A, enabled)).not.toThrow();
    expect(() => assertOverviewGrowthProgressEnabled(ORG_B, enabled)).toThrowError(
      expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }),
    );
  });
});
