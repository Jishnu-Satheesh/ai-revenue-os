import { describe, expect, it, vi } from "vitest";

const organizationA = "7e4402e6-283f-45a6-97e2-bde93fdf1bc9";
const organizationB = "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";

vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "test-publishable-key";
  process.env.GROWTH_INTELLIGENCE_MARKET_ORGANIZATION_IDS = "7e4402e6-283f-45a6-97e2-bde93fdf1bc9";
  process.env.GROWTH_INTELLIGENCE_SYNTHESIS_ORGANIZATION_IDS =
    "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";
  process.env.GROWTH_INTELLIGENCE_TRIAGE_ORGANIZATION_IDS = "7e4402e6-283f-45a6-97e2-bde93fdf1bc9";
  process.env.GROWTH_INTELLIGENCE_CAMPAIGN_DRAFT_ORGANIZATION_IDS =
    "b2ac5c0d-ae53-4e82-9f30-8c7c1de4d56f";
});

vi.mock("server-only", () => ({}));

import {
  assertGrowthIntelligenceAccess,
  hasGrowthIntelligenceAccess,
  parseGrowthIntelligenceOrganizationIds,
} from "@/modules/growth-intelligence/application/feature-access";

describe("Growth Intelligence rollout access", () => {
  it("fails closed when an increment allowlist is unset", () => {
    expect(parseGrowthIntelligenceOrganizationIds(undefined, "market")).toEqual(new Set());
  });

  it("parses trimmed organization UUIDs", () => {
    expect(
      parseGrowthIntelligenceOrganizationIds(`${organizationA}, ${organizationB}`, "market"),
    ).toEqual(new Set([organizationA, organizationB]));
  });

  it("rejects an empty allowlist entry", () => {
    expect(() => parseGrowthIntelligenceOrganizationIds(`${organizationA},`, "synthesis")).toThrow(
      /empty/i,
    );
  });

  it("rejects duplicate organization IDs regardless of UUID case", () => {
    expect(() =>
      parseGrowthIntelligenceOrganizationIds(
        `${organizationA},${organizationA.toUpperCase()}`,
        "triage",
      ),
    ).toThrow(/duplicates/i);
  });

  it("rejects a malformed organization ID", () => {
    expect(() => parseGrowthIntelligenceOrganizationIds("not-a-uuid", "market")).toThrow();
  });

  it("keeps the four release increments independent", () => {
    expect(hasGrowthIntelligenceAccess(organizationA, "market")).toBe(true);
    expect(hasGrowthIntelligenceAccess(organizationA, "synthesis")).toBe(false);
    expect(hasGrowthIntelligenceAccess(organizationA, "triage")).toBe(true);
    expect(hasGrowthIntelligenceAccess(organizationA, "campaign_draft")).toBe(false);

    expect(hasGrowthIntelligenceAccess(organizationB, "market")).toBe(false);
    expect(hasGrowthIntelligenceAccess(organizationB, "synthesis")).toBe(true);
    expect(hasGrowthIntelligenceAccess(organizationB, "triage")).toBe(false);
    expect(hasGrowthIntelligenceAccess(organizationB, "campaign_draft")).toBe(true);
  });

  it("matches enabled organization IDs case-insensitively", () => {
    expect(
      hasGrowthIntelligenceAccess(organizationA.toUpperCase(), "market", new Set([organizationA])),
    ).toBe(true);
  });

  it("refuses a disabled increment as unavailable", () => {
    expect(() =>
      assertGrowthIntelligenceAccess(organizationB, "market", new Set([organizationA])),
    ).toThrowError(expect.objectContaining({ code: "FEATURE_NOT_AVAILABLE" }));
  });
});
