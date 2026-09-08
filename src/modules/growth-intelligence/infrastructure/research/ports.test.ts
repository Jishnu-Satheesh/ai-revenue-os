import { describe, expect, it } from "vitest";

import {
  approvedResearchScopeSchema,
  researchRetrievalResultSchema,
  type ResearchAdapter,
  type ResearchRequest,
} from "@/modules/growth-intelligence/infrastructure/research/ports";

const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";
const CLAIM_ID = "22222222-2222-4222-8222-222222222222";
const EXCERPT_DIGEST = "a".repeat(64);

function validSource(excerptText = "A bounded snippet of permitted evidence.") {
  return {
    sourceUrl: "https://directory.example/competitor-one",
    domain: "directory.example",
    publisher: "City Guide",
    sourceClass: "public_signal" as const,
    excerptText,
    excerptDigest: EXCERPT_DIGEST,
    retrievedAt: "2026-09-08T10:00:00.000Z",
  };
}

function validResult() {
  return {
    sources: [validSource()],
    coverage: [
      {
        slotKey: "local_market",
        kind: "local_market" as const,
        outcome: "supported" as const,
        attemptIds: [ATTEMPT_ID],
        acceptedClaimIds: [CLAIM_ID],
      },
    ],
    attempts: [
      {
        attemptId: ATTEMPT_ID,
        slotKey: "local_market",
        usage: { kind: "reported" as const, microsUsd: 1_200 },
      },
    ],
  };
}

function validRequest(): ResearchRequest {
  return {
    scope: {
      publicBusinessName: "Cochin Kitchen",
      approvedDomains: ["cochinkitchen.example"],
      niches: ["Kerala cuisine"],
      city: "Dubai",
      countryCode: "AE",
      topics: ["weekend dining"],
      competitors: [],
    },
    maxQueries: 1,
    maxResultsPerQuery: 1,
    maxResponseBytes: 1024,
    maxRedirects: 0,
    timeoutMs: 1000,
    maxCostMicrosUsd: 1,
  };
}

describe("research retrieval result", () => {
  it("accepts a bounded result with coverage and attempt usage references", () => {
    expect(researchRetrievalResultSchema.parse(validResult())).toEqual(validResult());
  });

  it("keeps unknown attempt cost reserved instead of converting it to zero", () => {
    const parsed = researchRetrievalResultSchema.parse({
      ...validResult(),
      attempts: [{ attemptId: ATTEMPT_ID, slotKey: "local_market", usage: { kind: "unknown" } }],
    });

    expect(parsed.attempts[0]?.usage).toEqual({ kind: "unknown" });
  });

  it("rejects a 41st retained source", () => {
    expect(() =>
      researchRetrievalResultSchema.parse({
        ...validResult(),
        sources: Array.from({ length: 41 }, () => validSource()),
      }),
    ).toThrow(/40/i);
  });

  it("rejects a retained source without excerpt text", () => {
    expect(() =>
      researchRetrievalResultSchema.parse({
        ...validResult(),
        sources: [validSource("")],
      }),
    ).toThrow(/excerpt text/i);
  });

  it("rejects an excerpt longer than 2,000 characters", () => {
    expect(() =>
      researchRetrievalResultSchema.parse({
        ...validResult(),
        sources: [validSource("x".repeat(2_001))],
      }),
    ).toThrow(/2,?000/i);
  });

  it("rejects retained excerpt text beyond 64 KiB in total", () => {
    expect(() =>
      researchRetrievalResultSchema.parse({
        ...validResult(),
        sources: Array.from({ length: 33 }, () => validSource("x".repeat(2_000))),
      }),
    ).toThrow(/64 KiB/i);
  });

  it("requires a coverage manifest entry for retrieved work", () => {
    expect(() => researchRetrievalResultSchema.parse({ ...validResult(), coverage: [] })).toThrow();
    expect(() =>
      researchRetrievalResultSchema.parse({
        ...validResult(),
        coverage: [{ ...validResult().coverage[0]!, outcome: "done" }],
      }),
    ).toThrow();
  });

  it("refuses more coverage entries than the 26 planned query slots", () => {
    expect(() =>
      researchRetrievalResultSchema.parse({
        ...validResult(),
        coverage: Array.from({ length: 27 }, (_, index) => ({
          slotKey: `topic-${index}`,
          kind: "topic" as const,
          outcome: "not_started" as const,
          attemptIds: [],
          acceptedClaimIds: [],
        })),
      }),
    ).toThrow(/26/i);
  });

  it("refuses more attempt references than the 28-attempt run ceiling", () => {
    expect(() =>
      researchRetrievalResultSchema.parse({
        ...validResult(),
        attempts: Array.from({ length: 29 }, (_, index) => ({
          attemptId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          slotKey: "local_market",
          usage: { kind: "unknown" as const },
        })),
      }),
    ).toThrow(/28/i);
  });

  it("refuses raw provider payloads beside the validated contract", () => {
    expect(() =>
      researchRetrievalResultSchema.parse({ ...validResult(), providerRawBody: { hits: [] } }),
    ).toThrow();
    expect(() =>
      researchRetrievalResultSchema.parse({
        ...validResult(),
        sources: [{ ...validSource(), rawHtml: "<html>unqualified page</html>" }],
      }),
    ).toThrow();
  });

  it("lets an adapter return the validated result instead of an impossible promise", async () => {
    const adapter: ResearchAdapter = {
      availability: { available: true, provider: "brave" },
      searchAndFetch: async () => researchRetrievalResultSchema.parse(validResult()),
    };

    const result = await adapter.searchAndFetch(validRequest());

    expect(result.sources).toHaveLength(1);
    expect(result.coverage[0]?.outcome).toBe("supported");
  });
});

describe("approved research scope", () => {
  it("permits an empty approved-domain list when the business has no website", () => {
    const parsed = approvedResearchScopeSchema.parse({
      publicBusinessName: "Cochin Kitchen",
      approvedDomains: [],
      niches: ["Kerala cuisine"],
      city: "Dubai",
      countryCode: "AE",
      topics: ["weekend dining"],
    });

    expect(parsed.approvedDomains).toEqual([]);
  });

  it("still rejects duplicate approved domains", () => {
    expect(() =>
      approvedResearchScopeSchema.parse({
        publicBusinessName: "Cochin Kitchen",
        approvedDomains: ["cochinkitchen.example", "CochinKitchen.Example"],
        niches: ["Kerala cuisine"],
        city: "Dubai",
        countryCode: "AE",
        topics: ["weekend dining"],
      }),
    ).toThrow(/duplicate/i);
  });

  it("defaults competitors to empty and rejects duplicate or oversized leads", () => {
    const parsed = approvedResearchScopeSchema.parse({
      publicBusinessName: "Cochin Kitchen",
      approvedDomains: [],
      niches: ["Kerala cuisine"],
      city: "Dubai",
      countryCode: "AE",
      topics: ["weekend dining"],
    });
    expect(parsed.competitors).toEqual([]);

    expect(() =>
      approvedResearchScopeSchema.parse({
        publicBusinessName: "Cochin Kitchen",
        approvedDomains: [],
        niches: ["Kerala cuisine"],
        city: "Dubai",
        countryCode: "AE",
        topics: ["weekend dining"],
        competitors: [{ name: "Azure Dhow" }, { name: "azure dhow" }],
      }),
    ).toThrow(/duplicate/i);

    expect(() =>
      approvedResearchScopeSchema.parse({
        publicBusinessName: "Cochin Kitchen",
        approvedDomains: [],
        niches: ["Kerala cuisine"],
        city: "Dubai",
        countryCode: "AE",
        topics: ["weekend dining"],
        competitors: Array.from({ length: 6 }, (_, index) => ({ name: `Rival ${index}` })),
      }),
    ).toThrow();
  });

  it("keeps business reports and customer data out of competitor leads", () => {
    expect(() =>
      approvedResearchScopeSchema.parse({
        publicBusinessName: "Cochin Kitchen",
        approvedDomains: [],
        niches: ["Kerala cuisine"],
        city: "Dubai",
        countryCode: "AE",
        topics: ["weekend dining"],
        competitors: [{ name: "Azure Dhow", internalReport: "Q3 revenue" }],
      }),
    ).toThrow();
  });
});
