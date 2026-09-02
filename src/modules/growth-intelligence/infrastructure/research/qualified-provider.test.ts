import { describe, expect, it } from "vitest";

import { DomainError } from "@/lib/errors";
import {
  EXA_ENTERPRISE_MARKET_RESEARCH_QUALIFICATION,
  getQualifiedMarketResearchAdapter,
} from "@/modules/growth-intelligence/infrastructure/research/qualified-provider";

describe("the market research provider qualification", () => {
  it("remains unavailable until the enterprise evidence gate is complete", async () => {
    const adapter = getQualifiedMarketResearchAdapter();

    expect(adapter.availability).toEqual({ available: false, provider: "exa" });
    expect(EXA_ENTERPRISE_MARKET_RESEARCH_QUALIFICATION.blockers).toEqual([
      "commercial_approval_missing",
      "enterprise_terms_unexecuted",
      "zero_retention_unverified",
      "derived_claim_storage_rights_unverified",
      "credential_missing",
      "controlled_canary_missing",
    ]);

    await expect(
      adapter.searchAndFetch({
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
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<DomainError>>({
        code: "FEATURE_NOT_AVAILABLE",
        message: "Market research is not enabled for this organization.",
      }),
    );

    await adapter
      .searchAndFetch({
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
      })
      .catch((error: unknown) => {
        expect(error).toBeInstanceOf(DomainError);
        expect((error as Error).message).not.toMatch(/exa|https?:|token|key/i);
      });
  });
});
