import { describe, expect, it } from "vitest";

import {
  classifyMarketEvidenceFreshness,
  classifyMarketEvidenceSupport,
  MARKET_EVIDENCE_FRESHNESS_REGISTRY_VERSION,
} from "@/domain/growth-intelligence/evidence-quality";

function source(
  sourceId: string,
  publisherKey: string,
  sourceClass: "official" | "first_party" | "industry_research" | "public_signal",
  disposition: "supports" | "contradicts" = "supports",
) {
  return { sourceId, publisherKey, sourceClass, disposition } as const;
}

describe("classifyMarketEvidenceSupport", () => {
  it("classifies a direct fact from an official source as primary", () => {
    expect(
      classifyMarketEvidenceSupport({
        claimRole: "material",
        claimForm: "direct_fact",
        sources: [source("source-1", "dubai-statistics", "official")],
      }),
    ).toEqual({
      grade: "primary",
      rationaleCode: "DIRECT_FACT_PRIMARY_SOURCE",
      supportingSourceIds: ["source-1"],
      contradictingSourceIds: [],
    });
  });

  it("requires independent publishers for corroborated support", () => {
    expect(
      classifyMarketEvidenceSupport({
        claimRole: "material",
        claimForm: "inference",
        sources: [
          source("source-1", "publisher-a", "industry_research"),
          source("source-2", "publisher-b", "public_signal"),
        ],
      }).grade,
    ).toBe("corroborated");

    expect(
      classifyMarketEvidenceSupport({
        claimRole: "material",
        claimForm: "inference",
        sources: [
          source("source-1", "publisher-a", "industry_research"),
          source("source-2", "publisher-a", "public_signal"),
        ],
      }).grade,
    ).toBe("single_source");
  });

  it("keeps a supported background statement contextual", () => {
    expect(
      classifyMarketEvidenceSupport({
        claimRole: "contextual",
        claimForm: "inference",
        sources: [source("source-1", "publisher-a", "official")],
      }).grade,
    ).toBe("contextual");
  });

  it("classifies eligible disagreement as conflicted", () => {
    expect(
      classifyMarketEvidenceSupport({
        claimRole: "material",
        claimForm: "direct_fact",
        sources: [
          source("source-1", "publisher-a", "official"),
          source("source-2", "publisher-b", "official", "contradicts"),
        ],
      }),
    ).toEqual({
      grade: "conflicted",
      rationaleCode: "ELIGIBLE_SOURCES_DISAGREE",
      supportingSourceIds: ["source-1"],
      contradictingSourceIds: ["source-2"],
    });
  });

  it("refuses to grade a claim with no supporting source", () => {
    expect(() =>
      classifyMarketEvidenceSupport({
        claimRole: "material",
        claimForm: "direct_fact",
        sources: [source("source-1", "publisher-a", "official", "contradicts")],
      }),
    ).toThrow(/supporting source/i);
  });

  it("refuses duplicate source identities", () => {
    expect(() =>
      classifyMarketEvidenceSupport({
        claimRole: "material",
        claimForm: "direct_fact",
        sources: [
          source("source-1", "publisher-a", "official"),
          source("source-1", "publisher-b", "official"),
        ],
      }),
    ).toThrow(/source identities/i);
  });
});

describe("classifyMarketEvidenceFreshness", () => {
  it("uses a versioned deterministic freshness registry", () => {
    expect(MARKET_EVIDENCE_FRESHNESS_REGISTRY_VERSION).toBe(1);
  });

  it("moves an offer from current to stale to expired at exact boundaries", () => {
    const base = {
      claimCategory: "offer" as const,
      retrievedAt: "2026-08-01T00:00:00.000Z",
      observedAt: null,
      sourceState: "active" as const,
    };

    expect(
      classifyMarketEvidenceFreshness({ ...base, now: "2026-08-03T23:59:59.999Z" }).freshness,
    ).toBe("current");
    expect(
      classifyMarketEvidenceFreshness({ ...base, now: "2026-08-04T00:00:00.000Z" }).freshness,
    ).toBe("stale");
    expect(
      classifyMarketEvidenceFreshness({ ...base, now: "2026-08-08T00:00:00.000Z" }).freshness,
    ).toBe("expired");
  });

  it("uses the observation date when it is older than retrieval", () => {
    const result = classifyMarketEvidenceFreshness({
      claimCategory: "offer",
      observedAt: "2026-08-01T00:00:00.000Z",
      retrievedAt: "2026-08-06T00:00:00.000Z",
      now: "2026-08-06T00:00:00.000Z",
      sourceState: "active",
    });

    expect(result).toEqual({
      freshness: "stale",
      basisAt: "2026-08-01T00:00:00.000Z",
      staleAt: "2026-08-04T00:00:00.000Z",
      expiresAt: "2026-08-08T00:00:00.000Z",
      sourceState: "active",
      registryVersion: 1,
    });
  });

  it("retains withdrawn state independently of freshness", () => {
    const result = classifyMarketEvidenceFreshness({
      claimCategory: "structural_context",
      observedAt: null,
      retrievedAt: "2026-08-01T00:00:00.000Z",
      now: "2026-08-02T00:00:00.000Z",
      sourceState: "withdrawn",
    });

    expect(result.freshness).toBe("current");
    expect(result.sourceState).toBe("withdrawn");
  });

  it("rejects an invalid timestamp", () => {
    expect(() =>
      classifyMarketEvidenceFreshness({
        claimCategory: "offer",
        observedAt: null,
        retrievedAt: "yesterday",
        now: "2026-08-02T00:00:00.000Z",
        sourceState: "active",
      }),
    ).toThrow(/timestamp/i);
  });
});
