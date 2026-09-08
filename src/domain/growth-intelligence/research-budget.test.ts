import { describe, expect, it } from "vitest";

import {
  isResearchProviderQualified,
  isResearchSourceEligibleForSynthesis,
  renderResearchSourceState,
  RESEARCH_BUDGET_LIMITS,
  RESEARCH_PROVIDER_REQUIRED_USES,
  researchAttemptReservationSchema,
  researchExcerptProvenanceSchema,
  researchProviderQualificationSchema,
  researchQuoteSchema,
  researchSupportReviewSchema,
  researchWorkScopeSchema,
  settleResearchAttemptSchema,
  toResearchWorkScopeKey,
  validateResearchQuote,
} from "@/domain/growth-intelligence/research-budget";

const PIPELINE_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const ATTEMPT_ID = "33333333-3333-4333-8333-333333333333";
const CLAIM_TOKEN = "44444444-4444-4344-8344-444444444444";

describe("the unified research work scope", () => {
  it("accepts a pipeline scope and a request scope through one boundary", () => {
    expect(researchWorkScopeSchema.parse({ kind: "pipeline", pipelineId: PIPELINE_ID })).toEqual({
      kind: "pipeline",
      pipelineId: PIPELINE_ID,
    });
    expect(researchWorkScopeSchema.parse({ kind: "request", requestId: REQUEST_ID })).toEqual({
      kind: "request",
      requestId: REQUEST_ID,
    });
  });

  it("maps either scope onto the same ledger key shape", () => {
    expect(toResearchWorkScopeKey({ kind: "pipeline", pipelineId: PIPELINE_ID })).toEqual({
      kind: "pipeline",
      id: PIPELINE_ID,
    });
    expect(toResearchWorkScopeKey({ kind: "request", requestId: REQUEST_ID })).toEqual({
      kind: "request",
      id: REQUEST_ID,
    });
  });

  it("rejects a scope carrying both identities or an unknown kind", () => {
    expect(() =>
      researchWorkScopeSchema.parse({
        kind: "pipeline",
        pipelineId: PIPELINE_ID,
        requestId: REQUEST_ID,
      }),
    ).toThrow();
    expect(() =>
      researchWorkScopeSchema.parse({ kind: "organization", id: PIPELINE_ID }),
    ).toThrow();
  });
});

describe("research quote validation", () => {
  it("admits a bounded quote at the USD 1 ceiling", () => {
    expect(
      validateResearchQuote({
        quoteMicrosUsd: RESEARCH_BUDGET_LIMITS.maxPipelineReservationMicrosUsd,
        priceVersion: "brave-search-2026-09",
      }),
    ).toEqual({
      quoteMicrosUsd: 1_000_000,
      priceVersion: "brave-search-2026-09",
    });
  });

  it("refuses zero, negative and above-ceiling quotes before any paid call", () => {
    for (const quoteMicrosUsd of [0, -1, 1_000_001]) {
      expect(() =>
        researchQuoteSchema.parse({ quoteMicrosUsd, priceVersion: "brave-search-2026-09" }),
      ).toThrow();
    }
  });

  it("refuses a blank price version", () => {
    expect(() => researchQuoteSchema.parse({ quoteMicrosUsd: 100, priceVersion: "   " })).toThrow();
  });
});

describe("attempt reservation and settlement inputs", () => {
  it("accepts a bounded per-attempt reservation through the unified scope", () => {
    expect(
      researchAttemptReservationSchema.parse({
        scope: { kind: "pipeline", pipelineId: PIPELINE_ID },
        phase: "research",
        slotKey: "local-market",
        attemptIndex: 0,
        maximumMicrosUsd: 100_000,
        claimToken: CLAIM_TOKEN,
      }).maximumMicrosUsd,
    ).toBe(100_000);
  });

  it("refuses an over-ceiling worst case and an empty slot key", () => {
    expect(() =>
      researchAttemptReservationSchema.parse({
        scope: { kind: "request", requestId: REQUEST_ID },
        phase: "synthesis",
        slotKey: "weekly-synthesis",
        attemptIndex: 0,
        maximumMicrosUsd: 1_000_001,
        claimToken: CLAIM_TOKEN,
      }),
    ).toThrow();
    expect(() =>
      researchAttemptReservationSchema.parse({
        scope: { kind: "request", requestId: REQUEST_ID },
        phase: "synthesis",
        slotKey: "  ",
        attemptIndex: 0,
        maximumMicrosUsd: 100,
        claimToken: CLAIM_TOKEN,
      }),
    ).toThrow();
  });

  it("settles reported, estimated and unknown usage without zero-filling", () => {
    expect(
      settleResearchAttemptSchema.parse({
        attemptId: ATTEMPT_ID,
        usage: { kind: "unknown" },
      }).usage,
    ).toEqual({ kind: "unknown" });
    expect(
      settleResearchAttemptSchema.parse({
        attemptId: ATTEMPT_ID,
        usage: { kind: "reported", microsUsd: 50_000 },
      }).usage,
    ).toEqual({ kind: "reported", microsUsd: 50_000 });
  });
});

describe("provider qualification", () => {
  it("requires the six design rights and nothing less", () => {
    expect([...RESEARCH_PROVIDER_REQUIRED_USES]).toEqual([
      "snippet_storage",
      "commercial_inference",
      "organization_display",
      "derived_claims",
      "synthesis_reuse",
      "agreed_retention",
    ]);
  });

  it("fails closed on any blocker and on contradictory shapes", () => {
    expect(
      isResearchProviderQualified({ provider: "brave", available: false, blockers: ["x"] }),
    ).toBe(false);
    expect(() =>
      researchProviderQualificationSchema.parse({
        provider: "brave",
        available: true,
        blockers: ["credential_missing"],
      }),
    ).toThrow();
    expect(() =>
      researchProviderQualificationSchema.parse({
        provider: "brave",
        available: false,
        blockers: [],
      }),
    ).toThrow();
  });

  it("passes a complete qualification with no blockers", () => {
    expect(isResearchProviderQualified({ provider: "brave", available: true, blockers: [] })).toBe(
      true,
    );
  });
});

describe("retention provenance and eligibility", () => {
  it("records bounded excerpt provenance at admission", () => {
    expect(
      researchExcerptProvenanceSchema.parse({
        excerptText: "A public notice about weekend demand.",
        excerptDigest: "b".repeat(64),
        qualificationVersion: "BRAVE-ORDER-2026-09-08",
        retainUntil: "2027-09-01T00:00:00Z",
      }).qualificationVersion,
    ).toBe("BRAVE-ORDER-2026-09-08");
  });

  it("refuses an over-long excerpt and a malformed digest", () => {
    expect(() =>
      researchExcerptProvenanceSchema.parse({
        excerptText: "x".repeat(2_001),
        excerptDigest: "b".repeat(64),
        qualificationVersion: "v1",
        retainUntil: "2027-09-01T00:00:00Z",
      }),
    ).toThrow();
    expect(() =>
      researchExcerptProvenanceSchema.parse({
        excerptText: "A notice.",
        excerptDigest: "not-a-digest",
        qualificationVersion: "v1",
        retainUntil: "2027-09-01T00:00:00Z",
      }),
    ).toThrow();
  });

  it("records support-review provenance with verdict and time together", () => {
    expect(
      researchSupportReviewSchema.parse({
        supportVerdict: "supported",
        reviewedAt: "2026-09-08T10:00:00Z",
        reviewerRef: "support-review@1",
      }).supportVerdict,
    ).toBe("supported");
    expect(() =>
      researchSupportReviewSchema.parse({
        reviewedAt: "2026-09-08T10:00:00Z",
        reviewerRef: "support-review@1",
      }),
    ).toThrow();
  });

  it("withdraws synthesis eligibility for erased sources only", () => {
    expect(
      isResearchSourceEligibleForSynthesis({ availability: "available", erasedAt: null }),
    ).toBe(true);
    expect(
      isResearchSourceEligibleForSynthesis({
        availability: "available",
        erasedAt: "2026-09-08T10:00:00Z",
      }),
    ).toBe(false);
    expect(
      isResearchSourceEligibleForSynthesis({ availability: "unavailable", erasedAt: null }),
    ).toBe(false);
  });

  it("renders erased payloads as source-unavailable history", () => {
    expect(renderResearchSourceState({ availability: "available", erasedAt: null })).toEqual({
      state: "available",
    });
    expect(
      renderResearchSourceState({
        availability: "unavailable",
        erasedAt: "2026-09-08T10:00:00Z",
      }),
    ).toEqual({ state: "source_unavailable" });
  });
});
