import { describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import {
  getQualifiedMarketResearchAdapter,
  QUALIFIED_RESEARCH_PROVIDER,
  RESEARCH_PROVIDER_REQUIRED_USES,
  resolveResearchAdapterAvailability,
  UNQUALIFIED_RESEARCH_AVAILABILITY,
} from "@/modules/growth-intelligence/infrastructure/research/qualified-provider";

const VALID_INPUT = {
  scope: {
    publicBusinessName: "Cochin Kitchen",
    approvedDomains: ["cochinkitchen.example"],
    niches: ["Kerala cuisine"],
    city: "Dubai",
    countryCode: "AE",
    topics: ["weekend dining"],
  },
  maxQueries: 1,
  maxResultsPerQuery: 1,
  maxResponseBytes: 1024,
  maxRedirects: 0,
  timeoutMs: 1000,
  maxCostMicrosUsd: 1,
};

describe("the market research provider qualification", () => {
  it("stays on Brave with the six required uses and a blocked baseline", () => {
    expect(QUALIFIED_RESEARCH_PROVIDER).toBe("brave");
    expect([...RESEARCH_PROVIDER_REQUIRED_USES]).toEqual([
      "snippet_storage",
      "commercial_inference",
      "organization_display",
      "derived_claims",
      "synthesis_reuse",
      "agreed_retention",
    ]);
    expect(UNQUALIFIED_RESEARCH_AVAILABILITY).toEqual({
      available: false,
      provider: "brave",
    });
  });

  it("remains unavailable until qualification passes", async () => {
    const adapter = getQualifiedMarketResearchAdapter();

    expect(adapter.availability).toEqual({ available: false, provider: "brave" });

    await expect(adapter.searchAndFetch({ ...VALID_INPUT })).rejects.toEqual(
      expect.objectContaining<Partial<DomainError>>({
        code: "FEATURE_NOT_AVAILABLE",
        message: "Market research is not enabled for this organization.",
      }),
    );

    await adapter.searchAndFetch({ ...VALID_INPUT }).catch((error: unknown) => {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as Error).message).not.toMatch(/exa|brave|https?:|token|key/i);
    });
  });

  it("maps a checked qualification onto availability and fails closed", () => {
    expect(
      resolveResearchAdapterAvailability({ provider: "brave", available: true, blockers: [] }),
    ).toEqual({ available: true, provider: "brave" });
    expect(
      resolveResearchAdapterAvailability({
        provider: "brave",
        available: false,
        blockers: ["credential_missing"],
      }),
    ).toEqual({ available: false, provider: "brave" });
    expect(() =>
      resolveResearchAdapterAvailability({
        provider: "brave",
        available: true,
        blockers: ["credential_missing"],
      }),
    ).toThrow();
  });

  it("fails closed for every missing requirement", () => {
    for (const blockers of [
      ["qualification_missing"],
      ["agreement_missing"],
      ["agreement_expired"],
      ["required_rights_missing"],
      ["rates_missing"],
      ["credential_missing"],
      ["model_bounds_missing"],
      ["controlled_canary_missing"],
    ]) {
      expect(
        resolveResearchAdapterAvailability({
          provider: "brave",
          available: false,
          blockers,
        }).available,
      ).toBe(false);
    }
  });
});
