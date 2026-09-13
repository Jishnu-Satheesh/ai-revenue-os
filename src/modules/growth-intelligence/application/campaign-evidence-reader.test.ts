import { describe, expect, it } from "vitest";

import {
  createCampaignEvidenceReader,
  type CampaignEvidenceSource,
} from "@/modules/growth-intelligence/application/campaign-evidence-reader";

const ORGANIZATION_ID = "fb430000-0000-4000-8000-000000000201";
const PROFILE_VERSION_ID = "fb430000-0000-4000-8000-000000000202";
const REQUEST_ID = "fb430000-0000-4000-8000-000000000203";
const NOW = new Date("2026-09-13T12:00:00.000Z");

function request(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    kind: "market_research",
    triggerReason: "daily_due",
    status: "succeeded",
    dueAt: "2026-09-12T12:00:00.000Z",
    safeFailureCode: null,
    correlationId: "corr",
    attemptCount: 1,
    maxAttempts: 3,
    ...overrides,
  };
}

function claim(overrides: Record<string, unknown> = {}) {
  return {
    id: "fb430000-0000-4000-8000-000000000204",
    runId: "fb430000-0000-4000-8000-000000000205",
    profileVersionId: PROFILE_VERSION_ID,
    key: "talabat-fee-change",
    digest: "d".repeat(64),
    subjectKind: "market",
    subjectRef: "talabat",
    claimKind: "fee",
    paraphrase: "The aggregator raised its commission band.",
    quotation: null,
    geographicLayer: "national",
    geographyRef: "ae",
    claimCategory: "cost",
    freshnessClass: "fresh",
    publishedAt: "2026-09-10T00:00:00.000Z",
    observedAt: "2026-09-12T00:00:00.000Z",
    staleAt: "2026-10-12T00:00:00.000Z",
    expiresAt: "2026-12-12T00:00:00.000Z",
    limitations: [],
    ...overrides,
  };
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: "fb430000-0000-4000-8000-000000000206",
    runId: "fb430000-0000-4000-8000-000000000205",
    profileVersionId: PROFILE_VERSION_ID,
    key: "source-1",
    url: "https://example.com/fees",
    domain: "example.com",
    publisher: "Example",
    sourceClass: "industry_research",
    availability: "available",
    contentDigest: "e".repeat(64),
    safeFailureCode: null,
    retrievedAt: "2026-09-12T00:00:00.000Z",
    publishedAt: "2026-09-10T00:00:00.000Z",
    observedAt: "2026-09-12T00:00:00.000Z",
    ...overrides,
  };
}

function evidenceSource(
  overrides: Partial<CampaignEvidenceSource> = {},
): CampaignEvidenceSource {
  return {
    listRequests: async () => [request()],
    listClaimPage: async () => ({ claims: [claim()], nextCursor: null }),
    listSourcesByRuns: async () => [source()],
    listEventsByClaims: async () => [],
    ...overrides,
  } as CampaignEvidenceSource;
}

function read(
  source: CampaignEvidenceSource,
  overrides: Record<string, unknown> = {},
) {
  return createCampaignEvidenceReader(source).read({
    organizationId: ORGANIZATION_ID,
    evidenceMaxAgeDays: 30,
    profileVersionId: PROFILE_VERSION_ID,
    now: NOW,
    ...overrides,
  });
}

describe("campaign evidence reader", () => {
  it("qualifies fresh evidence with exact claim citations", async () => {
    await expect(read(evidenceSource())).resolves.toEqual({
      status: "qualified",
      requestId: REQUEST_ID,
      claimScope: true,
      citations: [
        {
          researchRequestId: REQUEST_ID,
          claimId: "fb430000-0000-4000-8000-000000000204",
          claimDigest: "d".repeat(64),
          sourceRevision: 0,
          observedFrom: "2026-09-10T00:00:00.000Z",
          observedTo: "2026-09-12T00:00:00.000Z",
          sourceDomains: ["example.com"],
        },
      ],
    });
  });

  it("reports no requests as unavailable, not as disproof", async () => {
    const result = await read(evidenceSource({ listRequests: async () => [] }));
    expect(result).toEqual({
      status: "unavailable",
      requestId: null,
      reason: "no_requests",
      failureCode: null,
    });
  });

  it("waits for in-flight research instead of citing it", async () => {
    const result = await read(
      evidenceSource({ listRequests: async () => [request({ status: "claimed" })] }),
    );
    expect(result).toMatchObject({ status: "unavailable", reason: "in_flight" });
  });

  it("carries the failure code when research failed", async () => {
    const result = await read(
      evidenceSource({
        listRequests: async () => [request({ status: "failed", safeFailureCode: "SOURCE_DOWN" })],
      }),
    );
    expect(result).toMatchObject({ status: "unavailable", reason: "request_failed" });
  });

  it("expires a request older than the configured evidence age", async () => {
    const result = await read(
      evidenceSource({
        listRequests: async () => [request({ dueAt: "2026-07-01T00:00:00.000Z" })],
      }),
    );
    expect(result).toEqual({ status: "expired", requestId: REQUEST_ID, reason: "request_stale" });
  });

  it("qualifies the request but cites nothing without a profile scope", async () => {
    const result = await read(evidenceSource(), { profileVersionId: null });
    expect(result).toEqual({
      status: "qualified",
      requestId: REQUEST_ID,
      claimScope: false,
      citations: [],
    });
  });

  it("treats fully withdrawn evidence as withheld, never as missing", async () => {
    const result = await read(
      evidenceSource({
        listEventsByClaims: async () => [
          {
            claimId: "fb430000-0000-4000-8000-000000000204",
            eventType: "withdrawn",
            occurredAt: "2026-09-12T06:00:00.000Z",
          },
        ],
      }),
    );
    expect(result).toEqual({ status: "private_excluded", requestId: REQUEST_ID });
  });

  it("treats erased sources as withheld content", async () => {
    const result = await read(
      evidenceSource({ listSourcesByRuns: async () => [source({ availability: "erased" })] }),
    );
    expect(result).toEqual({ status: "private_excluded", requestId: REQUEST_ID });
  });

  it("expires claims past their own expiry even under a fresh request", async () => {
    const result = await read(
      evidenceSource({
        listClaimPage: async () => ({
          claims: [claim({ expiresAt: "2026-09-01T00:00:00.000Z" })],
          nextCursor: null,
        }),
      }),
    );
    expect(result).toEqual({ status: "expired", requestId: REQUEST_ID, reason: "claims_lapsed" });
  });

  it("excludes corrected claims but still cites what stayed clean", async () => {
    const clean = claim();
    const corrected = claim({
      id: "fb430000-0000-4000-8000-000000000207",
      digest: "f".repeat(64),
    });
    const result = await read(
      evidenceSource({
        listClaimPage: async () => ({ claims: [clean, corrected], nextCursor: null }),
        listEventsByClaims: async () => [
          {
            claimId: "fb430000-0000-4000-8000-000000000207",
            eventType: "corrected",
            occurredAt: "2026-09-12T06:00:00.000Z",
          },
        ],
      }),
    );
    expect(result).toMatchObject({ status: "qualified", claimScope: true });
    if (result.status === "qualified") {
      expect(result.citations.map((citation) => citation.claimId)).toEqual([
        "fb430000-0000-4000-8000-000000000204",
      ]);
    }
  });

  it("calls the whole set conflicted when every claim was corrected", async () => {
    const result = await read(
      evidenceSource({
        listEventsByClaims: async () => [
          {
            claimId: "fb430000-0000-4000-8000-000000000204",
            eventType: "superseded",
            occurredAt: "2026-09-12T06:00:00.000Z",
          },
        ],
      }),
    );
    expect(result).toEqual({
      status: "conflicted",
      requestId: REQUEST_ID,
      claimIds: ["fb430000-0000-4000-8000-000000000204"],
    });
  });
});
