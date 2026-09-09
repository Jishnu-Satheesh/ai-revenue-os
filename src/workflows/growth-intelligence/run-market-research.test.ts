import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  MarketProfileDocumentV1,
  MarketProfileDocumentV2,
} from "@/domain/growth-intelligence/types";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { DomainError } from "@/lib/errors";
import type { MarketEvidenceRepository } from "@/modules/growth-intelligence/infrastructure/evidence-repository";
import type {
  ResearchModelSpender,
  ResearchModelTransport,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import {
  digestClaimCandidate,
  extractResearchClaims,
  resolveClaimFreshnessWindow,
  resolveFreshnessClass,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import {
  buildCorroborationLinks,
  reviewResearchClaimSupport,
  selectAdmissibleClaims,
} from "@/modules/growth-intelligence/infrastructure/research/claim-support-review";
import { buildResearchQueryPlan } from "@/modules/growth-intelligence/infrastructure/research/query-plan";
import {
  researchRequestSchema,
  researchRetrievalResultSchema,
  type ResearchRequest,
  type ResearchRetrievedSource,
  type ResearchRetrievalResult,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import {
  createMarketResearchSpendLedger,
  marketResearchPayloadSchema,
  recordMarketResearchLatency,
  recordMarketResearchUsage,
  runMarketResearch,
  selectMaterialSources,
  type ApprovedMarketProfileView,
  type GrowthIntelligenceRequestView,
  type MarketResearchClaim,
  type MarketResearchExcerptProvenance,
  type MarketResearchModelPhase,
} from "@/workflows/growth-intelligence/run-market-research";

const organizationId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const claimToken = "30000000-0000-4000-8000-000000000003";
const runId = "40000000-0000-4000-8000-000000000004";
const correlationId = "60000000-0000-4000-8000-000000000006";
const profileVersionId = "70000000-0000-4000-8000-000000000007";
const sourcePolicyDigest = "c".repeat(64);
const digestA = "a".repeat(64);

const document: MarketProfileDocumentV1 = {
  schemaVersion: 1,
  publicIdentity: {
    approvedName: "Kerala Kitchen",
    domains: ["example.com"],
    publicUrls: ["https://example.com/menu"],
  },
  nicheDescriptors: ["Kerala cuisine"],
  geographies: [
    {
      layer: "city",
      locationRef: "ae:du",
      name: "Dubai",
      countryCode: "AE",
    },
  ],
  competitors: [],
  topics: [{ key: "local-events", label: "Local events", provenance: "core" }],
  sourcePolicy: {
    excludedDomains: ["blocked.example"],
    excludedPublishers: [],
    excludedCompetitorKeys: [],
    allowBoundedQuotes: false,
    maxQuotationCharacters: 0,
  },
  cadence: {
    timeZone: "Asia/Dubai",
    dailyLocalTime: "06:30",
    weeklyDay: "monday",
    weeklyLocalTime: "07:00",
  },
};

const requestView: GrowthIntelligenceRequestView = {
  id: requestId,
  organizationId,
  branchId: null,
  channelId: null,
  kind: "market_research",
  triggerReason: "daily_due",
  businessEvidenceDigest: null,
  marketProfileVersionId: profileVersionId,
  sourcePolicyDigest,
  researchRuleVersion: "market-research@1",
  localTimeBucket: "daily:2026-09-02",
  correlationId,
  pipelineId: null,
  phase: null,
};

const profileView: ApprovedMarketProfileView = {
  versionId: profileVersionId,
  digest: "d".repeat(64),
  document,
  sourcePolicyDigest,
  enabled: true,
};

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const EXCERPT_A = "Harbor Eats saw record weekend footfall near the marina promenade.";
const EXCERPT_B = "The city calendar lists a waterfront festival next weekend.";

function retrievedSource(
  overrides: Partial<ResearchRetrievedSource> = {},
): ResearchRetrievedSource {
  const excerptText = EXCERPT_A;
  return {
    sourceUrl: "https://tourism.example/dubai-notice",
    domain: "tourism.example",
    publisher: "Dubai Tourism",
    excerptText,
    excerptDigest: sha256(excerptText),
    retrievedAt: "2026-09-02T06:00:00Z",
    ...overrides,
  };
}

function retrievalResult(
  overrides: Partial<ResearchRetrievalResult> = {},
): ResearchRetrievalResult {
  const attemptId = "10000000-0000-4000-8000-000000000010";
  return {
    sources: [retrievedSource()],
    coverage: [
      {
        slotKey: "local_market",
        kind: "local_market",
        outcome: "supported",
        attemptIds: [attemptId],
        acceptedClaimIds: [],
      },
    ],
    attempts: [
      { attemptId, slotKey: "local_market", usage: { kind: "reported", microsUsd: 1_000 } },
    ],
    ...overrides,
  };
}

function scriptedExtractionTransport(
  candidates: (input: { sourceKey: string; excerptText: string }) => unknown[],
) {
  const transport: ResearchModelTransport = {
    complete: vi.fn(async (input) => {
      const prompt = JSON.parse(input.prompt) as {
        sources: Array<{ sourceKey: string; sourceUrl: string; excerptText: string }>;
      };
      const shaped = prompt.sources.flatMap((item) =>
        candidates({ sourceKey: item.sourceKey, excerptText: item.excerptText }),
      );
      return {
        text: JSON.stringify(shaped),
        usage: { kind: "reported" as const, microsUsd: 140 },
        latencyMs: 210,
      };
    }),
  };
  return transport;
}

function spanCandidate(
  sourceKey: string,
  excerptText: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    candidateKey: `candidate-${sourceKey.slice(4, 12)}`,
    subjectKind: "market",
    subjectRef: "dubai marina footfall",
    claimKind: "demand_signal",
    paraphrase: "Weekend footfall near the marina reached a record level.",
    quotation: null,
    claimCategory: "demand_trend",
    geographicLayer: "city",
    geographyRef: "ae:du",
    citations: [{ sourceKey, spanStart: 0, spanEnd: excerptText.length, quotedText: excerptText }],
    publishedAt: null,
    observedAt: "2026-09-01T09:00:00Z",
    limitations: [],
    ...overrides,
  };
}

function scriptedReviewTransport(
  verdict: "supported" | "unsupported" | "uncertain" = "supported",
  microsUsd = 90,
) {
  const transport: ResearchModelTransport = {
    complete: vi.fn(async (input) => {
      const prompt = JSON.parse(input.prompt) as {
        candidates: Array<{ candidateKey: string }>;
      };
      return {
        text: JSON.stringify(
          prompt.candidates.map((item) => ({
            candidateKey: item.candidateKey,
            verdict,
            limitations: [],
          })),
        ),
        usage: { kind: "reported" as const, microsUsd },
        latencyMs: 95,
      };
    }),
  };
  return transport;
}

function fakeSpender(): ResearchModelSpender {
  let count = 0;
  return {
    reserve: vi.fn(async () => {
      count += 1;
      return { attemptId: `20000000-0000-4000-8000-${String(count).padStart(12, "0")}` };
    }),
    settle: vi.fn(async () => {}),
  };
}

function modelPhase(overrides: Partial<MarketResearchModelPhase> = {}): MarketResearchModelPhase {
  return {
    transport: scriptedExtractionTransport(() => []),
    spender: fakeSpender(),
    budget: {
      phase: "extraction",
      maxCalls: 4,
      maxInputTokens: 12_000,
      maxOutputTokens: 4_000,
      maxSourcesPerBatch: 10,
    },
    modelId: "gemini-fixture-extraction",
    ...overrides,
  };
}

function provenance(
  overrides: Partial<MarketResearchExcerptProvenance> = {},
): MarketResearchExcerptProvenance {
  return {
    qualificationVersion: "BRAVE-ORDER-FIXTURE",
    retainUntilFor: () => "2027-09-01T00:00:00Z",
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  const requests = {
    claim: vi.fn(async () => ({ outcome: "acquired", replayed: false })),
    complete: vi.fn(async () => ({ outcome: "completed" })),
    fail: vi.fn(async () => ({ outcome: "failed" })),
    load: vi.fn(async () => requestView),
    enqueue: vi.fn(async (_input: Parameters<MarketResearchClaim["enqueue"]>[0]) => ({
      requestId: "80000000-0000-4000-8000-000000000008",
      replayed: false,
    })),
  };
  const profiles = { readCurrent: vi.fn(async () => profileView) };
  const evidence = {
    begin: vi.fn(async () => ({ runId, status: "running" as const, replayed: false })),
    record: vi.fn(async (_input: Parameters<MarketEvidenceRepository["record"]>[0]) => ({
      runId,
      claimCount: 0,
      replayed: false,
    })),
    complete: vi.fn(async () => ({ runId, status: "completed" as const, replayed: false })),
    fail: vi.fn(async () => ({ runId, status: "failed" as const, replayed: false })),
    completePipeline: vi.fn(async () => ({
      runId,
      pipelineStage: "preparing_insights" as const,
      synthesisRequestId: "80000000-0000-4000-8000-000000000008",
      eligibleClaimCount: 1,
      replayed: false,
    })),
    completeSynthesisPipeline: vi.fn(async () => ({
      runId,
      itemCount: 0,
      supersededItemIds: [],
      pipelineStage: "ready" as const,
      replayed: false,
    })),
    failSynthesisPipeline: vi.fn(async () => ({
      runId,
      pipelineStage: "synthesis_failed" as const,
      replayed: false,
    })),
    appendEvent: vi.fn(),
  };
  const currentSources = { load: vi.fn(async () => [] as string[]) };
  const adapter = {
    availability: { available: true, provider: "test-adapter" },
    searchAndFetch: vi.fn(async () => retrievalResult()),
  };
  const planQueries = vi.fn((request: ResearchRequest) =>
    buildResearchQueryPlan({
      scope: request.scope,
      maxQueries: request.maxQueries,
      maxResultsPerQuery: request.maxResultsPerQuery,
    }),
  );
  const buildScope = vi.fn(
    (doc: MarketProfileDocumentV1 | MarketProfileDocumentV2): ResearchRequest => {
      const city = doc.geographies.find((geography) => geography.layer === "city");
      const country = doc.geographies.find((geography) => geography.layer === "country");
      const location = city ?? country;
      if (!location || !("countryCode" in location)) {
        throw new DomainError(
          "DOMAIN_ERROR",
          "The approved profile has no usable city or country.",
        );
      }
      return researchRequestSchema.parse({
        scope: {
          publicBusinessName: doc.publicIdentity.approvedName,
          approvedDomains: doc.publicIdentity.domains,
          niches: doc.nicheDescriptors,
          city: location.name,
          countryCode: location.countryCode,
          topics: doc.topics.map((topic) => topic.label),
        },
        maxQueries: 3,
        maxResultsPerQuery: 10,
        maxResponseBytes: 512 * 1_024,
        maxRedirects: 3,
        timeoutMs: 20_000,
        maxCostMicrosUsd: 5_000_000,
      });
    },
  );
  const events = { publish: vi.fn(async () => {}) };
  return {
    requests,
    profiles,
    evidence,
    currentSources,
    adapter,
    extraction: modelPhase(),
    supportReview: modelPhase({
      transport: scriptedReviewTransport(),
      budget: {
        phase: "support_review" as const,
        maxCalls: 4,
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
        maxSourcesPerBatch: 10,
      },
      modelId: "gemini-fixture-review",
    }),
    excerptProvenance: provenance(),
    // Tests inject the real claim engines, exactly as Trigger does in
    // production: behavior coverage stays end-to-end through the same pure
    // functions the worker receives.
    engines: {
      parseRetrievalResult: (value: unknown) => researchRetrievalResultSchema.parse(value),
      extractClaims: extractResearchClaims,
      reviewClaimSupport: reviewResearchClaimSupport,
      selectAdmissible: selectAdmissibleClaims,
      buildLinks: buildCorroborationLinks,
      digestCandidate: digestClaimCandidate,
      freshnessWindow: resolveClaimFreshnessWindow,
      freshnessClass: resolveFreshnessClass,
    },
    planQueries,
    buildScope,
    events,
    ...overrides,
  };
}

const payload = { organizationId, requestId, correlationId };

describe("runMarketResearch payload", () => {
  it("rejects payloads that are not identifier-only UUIDs", () => {
    expect(() =>
      marketResearchPayloadSchema.parse({ ...payload, requestId: "not-a-uuid" }),
    ).toThrow();
    expect(() => marketResearchPayloadSchema.parse({ ...payload, channelId: requestId })).toThrow();
  });
});

describe("runMarketResearch claim fencing", () => {
  it("returns not_acquired without touching evidence when another worker holds the lease", async () => {
    const deps = dependencies();
    deps.requests.claim.mockResolvedValueOnce({ outcome: "in_progress", replayed: false });

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({ outcome: "not_acquired", claimOutcome: "in_progress" });
    expect(deps.evidence.begin).not.toHaveBeenCalled();
    expect(deps.events.publish).not.toHaveBeenCalled();
  });

  it("replays duplicate Trigger delivery through the same fenced path", async () => {
    const deps = dependencies();
    deps.requests.claim.mockResolvedValueOnce({ outcome: "acquired", replayed: true });

    const result = await runMarketResearch(payload, deps);

    expect(result.outcome).toBe("completed");
    expect(deps.evidence.begin).toHaveBeenCalledOnce();
  });

  it("returns claim_lost without throwing when the lease expires before completion", async () => {
    const deps = dependencies();
    deps.requests.complete.mockResolvedValueOnce({ outcome: "claim_lost" });

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({ outcome: "claim_lost" });
  });

  it("returns claim_lost without further mutations when recording loses the lease", async () => {
    const deps = dependencies();
    deps.evidence.record.mockRejectedValueOnce(
      new GrowthIntelligenceError(
        "RESEARCH_CLAIM_LOST",
        "The research lease is no longer current.",
      ),
    );

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({ outcome: "claim_lost" });
    expect(deps.evidence.complete).not.toHaveBeenCalled();
    expect(deps.evidence.fail).not.toHaveBeenCalled();
    expect(deps.requests.complete).not.toHaveBeenCalled();
    expect(deps.requests.fail).not.toHaveBeenCalled();
    expect(deps.events.publish).not.toHaveBeenCalled();
  });

  it("returns claim_lost without further mutations when completion loses the lease", async () => {
    const deps = dependencies();
    deps.evidence.complete.mockRejectedValueOnce(
      new GrowthIntelligenceError(
        "RESEARCH_CLAIM_LOST",
        "The research lease is no longer current.",
      ),
    );

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({ outcome: "claim_lost" });
    expect(deps.requests.complete).not.toHaveBeenCalled();
  });

  it("returns cancelled before claiming when the run signal is already aborted", async () => {
    const deps = dependencies();
    const controller = new AbortController();
    controller.abort();

    const result = await runMarketResearch(payload, { ...deps, signal: controller.signal });

    expect(result).toEqual({ outcome: "cancelled" });
    expect(deps.requests.claim).not.toHaveBeenCalled();
  });
});

describe("runMarketResearch profile and request reloading", () => {
  it("fails closed when the approved profile version moved under the claimed request", async () => {
    const deps = dependencies();
    deps.profiles.readCurrent.mockResolvedValueOnce({
      ...profileView,
      versionId: "90000000-0000-4000-8000-000000000009",
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({ outcome: "failed", code: "PROFILE_VERSION_CHANGED", runId: null });
    expect(deps.evidence.begin).not.toHaveBeenCalled();
    expect(deps.requests.fail).toHaveBeenCalledWith({
      organizationId,
      requestId,
      claimToken: expect.any(String),
      safeFailureCode: "PROFILE_VERSION_CHANGED",
    });
  });

  it("fails closed for request kinds the research worker does not own", async () => {
    const deps = dependencies();
    deps.requests.load.mockResolvedValueOnce({ ...requestView, kind: "weekly_synthesis" });

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({
      outcome: "failed",
      code: "REQUEST_KIND_UNSUPPORTED",
      runId: null,
    });
    expect(deps.adapter.searchAndFetch).not.toHaveBeenCalled();
  });

  it("fails closed before any run begins when the model phases are not wired", async () => {
    const deps = dependencies({ extraction: undefined });

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({ outcome: "failed", code: "EXTRACTION_UNAVAILABLE", runId: null });
    expect(deps.evidence.begin).not.toHaveBeenCalled();
    expect(deps.adapter.searchAndFetch).not.toHaveBeenCalled();
  });

  it("refuses business evidence changes because synthesis owns them now", async () => {
    const deps = dependencies();
    deps.requests.load.mockResolvedValueOnce({
      ...requestView,
      kind: "business_evidence_changed",
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({
      outcome: "failed",
      code: "REQUEST_KIND_UNSUPPORTED",
      runId: null,
    });
    expect(deps.adapter.searchAndFetch).not.toHaveBeenCalled();
    expect(deps.evidence.begin).not.toHaveBeenCalled();
  });
});

describe("runMarketResearch fail-closed adapter", () => {
  it("maps adapter refusal to fenced run and request failure without throwing", async () => {
    const deps = dependencies({
      adapter: {
        availability: { available: false, provider: "exa" },
        searchAndFetch: vi.fn(async () => {
          throw new Error("Market research is not enabled for this organization.");
        }),
      },
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({ outcome: "failed", code: "ADAPTER_UNAVAILABLE", runId });
    expect(deps.evidence.begin).toHaveBeenCalledOnce();
    expect(deps.evidence.fail).toHaveBeenCalledWith({
      organizationId,
      requestId,
      claimToken: expect.any(String),
      runId,
      failure: expect.objectContaining({ safeFailureCode: "ADAPTER_UNAVAILABLE" }),
    });
    expect(deps.requests.fail).toHaveBeenCalledWith({
      organizationId,
      requestId,
      claimToken: expect.any(String),
      safeFailureCode: "ADAPTER_UNAVAILABLE",
    });
    expect(deps.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        eventName: "market_research.failed",
        actorType: "system",
        correlationId,
        payload: expect.objectContaining({ requestId, runId, code: "ADAPTER_UNAVAILABLE" }),
      }),
    );
  });

  it("reports honest zero spend on a pre-retrieval failure because nothing was spent", async () => {
    const deps = dependencies({
      adapter: {
        availability: { available: false, provider: "exa" },
        searchAndFetch: vi.fn(async () => {
          throw new Error("Market research is not enabled for this organization.");
        }),
      },
    });

    await runMarketResearch(payload, deps);

    expect(deps.evidence.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        failure: {
          safeFailureCode: "ADAPTER_UNAVAILABLE",
          adapterCostMicrosUsd: 0,
          adapterLatencyMs: 0,
        },
      }),
    );
  });
});

describe("runMarketResearch extraction and admission", () => {
  it("records validated claims with excerpt provenance instead of the empty placeholder", async () => {
    const deps = dependencies({
      extraction: modelPhase({
        transport: scriptedExtractionTransport(({ sourceKey, excerptText }) => [
          spanCandidate(sourceKey, excerptText),
        ]),
      }),
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "completed", claimCount: 1, supportedCount: 1 });
    expect(deps.evidence.record).toHaveBeenCalledOnce();
    const recorded = deps.evidence.record.mock.calls[0]![0];
    expect(recorded.payload.claims).toHaveLength(1);
    const claim = recorded.payload.claims[0];
    expect(claim.key).toMatch(/^clm-[a-f0-9]{12}$/);
    expect(claim.claimDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(claim.sourceKeys).toHaveLength(1);
    expect(claim.staleAt).toBe("2026-09-15T09:00:00.000Z");
    expect(claim.expiresAt).toBe("2026-10-01T09:00:00.000Z");
    expect(claim.limitations).toEqual(
      expect.arrayContaining(["SNIPPET_EVIDENCE_ONLY", "ONE_SOURCE"]),
    );
    expect(claim.quotation).toBeNull();
    const source = recorded.payload.sources[0];
    expect(source.excerptText).toBe(EXCERPT_A);
    expect(source.excerptDigest).toBe(sha256(EXCERPT_A));
    expect(source.contentDigest).toBe(sha256(EXCERPT_A));
    expect(source.qualificationVersion).toBe("BRAVE-ORDER-FIXTURE");
    expect(source.retainUntil).toBe("2027-09-01T00:00:00Z");
    expect(recorded.payload.links).toEqual([]);
  });

  it("completes with recorded counts and unclamped actual spend", async () => {
    const deps = dependencies({
      adapter: {
        availability: { available: true, provider: "test-adapter" },
        searchAndFetch: vi.fn(async () =>
          retrievalResult({
            attempts: [
              {
                attemptId: "10000000-0000-4000-8000-000000000010",
                slotKey: "local_market",
                usage: { kind: "reported", microsUsd: 6_000_000 },
              },
            ],
          }),
        ),
      },
      extraction: modelPhase({
        transport: scriptedExtractionTransport(({ sourceKey, excerptText }) => [
          spanCandidate(sourceKey, excerptText),
        ]),
      }),
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({
      outcome: "completed",
      sourceAttemptCount: 1,
      sourceSuccessCount: 1,
    });
    expect(deps.evidence.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        result: expect.objectContaining({
          sourceAttemptCount: 1,
          sourceSuccessCount: 1,
          adapterCostMicrosUsd: 6_000_000 + 140 + 90,
          adapterLatencyMs: 210 + 95,
        }),
      }),
    );
  });

  it("carries unknown usage as a count in events instead of converting it to zero", async () => {
    const deps = dependencies({
      adapter: {
        availability: { available: true, provider: "test-adapter" },
        searchAndFetch: vi.fn(async () =>
          retrievalResult({
            attempts: [
              {
                attemptId: "10000000-0000-4000-8000-000000000010",
                slotKey: "local_market",
                usage: { kind: "unknown" },
              },
            ],
          }),
        ),
      },
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "completed", unknownUsageCount: 1 });
    expect(deps.evidence.complete).toHaveBeenCalledWith(
      expect.objectContaining({ result: expect.objectContaining({ adapterCostMicrosUsd: 140 }) }),
    );
    expect(deps.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "market_research.completed",
        payload: expect.objectContaining({ unknownUsageCount: 1 }),
      }),
    );
  });

  it("records sources alone with zero claims when extraction finds nothing supportable", async () => {
    const deps = dependencies({
      supportReview: modelPhase({
        transport: scriptedReviewTransport("unsupported"),
        budget: {
          phase: "support_review" as const,
          maxCalls: 4,
          maxInputTokens: 12_000,
          maxOutputTokens: 4_000,
          maxSourcesPerBatch: 10,
        },
        modelId: "gemini-fixture-review",
      }),
      extraction: modelPhase({
        transport: scriptedExtractionTransport(({ sourceKey, excerptText }) => [
          spanCandidate(sourceKey, excerptText),
        ]),
      }),
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "completed", claimCount: 0, unsupportedCount: 1 });
    expect(deps.evidence.record).toHaveBeenCalledOnce();
    expect(deps.evidence.record.mock.calls[0]![0].payload.claims).toEqual([]);
    expect(deps.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ claimCount: 0, unsupportedCount: 1 }),
      }),
    );
  });

  it("skips record when every digest is already current but still completes run lineage", async () => {
    const deps = dependencies();
    deps.currentSources.load.mockResolvedValueOnce([sha256(EXCERPT_A)]);

    const result = await runMarketResearch(payload, deps);

    expect(deps.evidence.record).not.toHaveBeenCalled();
    expect(deps.evidence.complete).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ outcome: "completed", claimCount: 0 });
  });

  it("drops policy-excluded sources before recording and completes partial", async () => {
    const deps = dependencies({
      adapter: {
        availability: { available: true, provider: "test-adapter" },
        searchAndFetch: vi.fn(async () =>
          retrievalResult({
            sources: [
              retrievedSource(),
              retrievedSource({
                sourceUrl: "https://blocked.example/closed",
                domain: "blocked.example",
                publisher: "Blocked Publisher",
                excerptText: EXCERPT_B,
                excerptDigest: sha256(EXCERPT_B),
              }),
            ],
          }),
        ),
      },
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "partial", sourceAttemptCount: 1 });
    const recorded = deps.evidence.record.mock.calls[0]![0];
    expect(recorded.payload.sources).toHaveLength(1);
    expect(deps.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "market_research.partially_completed",
        payload: expect.objectContaining({ excludedSourceCount: 1 }),
      }),
    );
  });

  it("links corroborating claims from independent publishers and nothing else", async () => {
    const deps = dependencies({
      adapter: {
        availability: { available: true, provider: "test-adapter" },
        searchAndFetch: vi.fn(async () =>
          retrievalResult({
            sources: [
              retrievedSource(),
              retrievedSource({
                sourceUrl: "https://calendar.example/dubai-events",
                domain: "calendar.example",
                publisher: "Dubai Calendar",
                excerptText: EXCERPT_B,
                excerptDigest: sha256(EXCERPT_B),
              }),
            ],
          }),
        ),
      },
      extraction: modelPhase({
        transport: scriptedExtractionTransport(({ sourceKey, excerptText }) => [
          spanCandidate(sourceKey, excerptText),
        ]),
      }),
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "completed", claimCount: 2 });
    const recorded = deps.evidence.record.mock.calls[0]![0];
    expect(recorded.payload.links).toHaveLength(1);
    expect(recorded.payload.links[0]).toMatchObject({ relation: "corroborates" });
    const [first, second] = recorded.payload.claims as Array<{ key: string }>;
    expect(
      [recorded.payload.links[0].fromClaimKey, recorded.payload.links[0].toClaimKey].sort(),
    ).toEqual([first!.key, second!.key].sort());
  });

  it("strips quotations when the confirmed policy forbids bounded quotes", async () => {
    const deps = dependencies({
      extraction: modelPhase({
        transport: scriptedExtractionTransport(({ sourceKey, excerptText }) => [
          spanCandidate(sourceKey, excerptText, { quotation: excerptText }),
        ]),
      }),
    });

    await runMarketResearch(payload, deps);

    const recorded = deps.evidence.record.mock.calls[0]![0];
    expect(recorded.payload.claims[0].quotation).toBeNull();
  });

  it("keeps quotations inside the aggregate cap when the confirmed policy allows them", async () => {
    const quotedDocument: MarketProfileDocumentV1 = {
      ...document,
      sourcePolicy: {
        ...document.sourcePolicy,
        allowBoundedQuotes: true,
        maxQuotationCharacters: 240,
      },
    };
    const deps = dependencies({
      profiles: { readCurrent: vi.fn(async () => ({ ...profileView, document: quotedDocument })) },
      extraction: modelPhase({
        transport: scriptedExtractionTransport(({ sourceKey, excerptText }) => [
          spanCandidate(sourceKey, excerptText, {
            quotation: excerptText.slice(0, 60),
            citations: [
              { sourceKey, spanStart: 0, spanEnd: 60, quotedText: excerptText.slice(0, 60) },
            ],
          }),
        ]),
      }),
    });

    await runMarketResearch(payload, deps);

    const recorded = deps.evidence.record.mock.calls[0]![0];
    expect(recorded.payload.claims[0].quotation).toBe(EXCERPT_A.slice(0, 60));
  });

  it("completes partial and emits partially_completed when a slot has no usable evidence", async () => {
    const deps = dependencies({
      adapter: {
        availability: { available: true, provider: "test-adapter" },
        searchAndFetch: vi.fn(async () =>
          retrievalResult({
            sources: [],
            coverage: [
              {
                slotKey: "local_market",
                kind: "local_market",
                outcome: "searched_no_usable_evidence",
                attemptIds: ["10000000-0000-4000-8000-000000000010"],
                acceptedClaimIds: [],
              },
            ],
            attempts: [
              {
                attemptId: "10000000-0000-4000-8000-000000000010",
                slotKey: "local_market",
                usage: { kind: "reported", microsUsd: 1_000 },
              },
            ],
          }),
        ),
      },
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "partial", sourceAttemptCount: 0 });
    expect(deps.evidence.record).not.toHaveBeenCalled();
    expect(deps.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "market_research.partially_completed" }),
    );
  });

  it("refuses unbounded retrieval results instead of truncating them silently", async () => {
    const deps = dependencies();
    deps.adapter.searchAndFetch.mockResolvedValueOnce(
      retrievalResult({
        sources: Array.from({ length: 41 }, (_, index) =>
          retrievedSource({
            sourceUrl: `https://tourism.example/notice-${index}`,
            excerptText: `${EXCERPT_A} ${index}`,
            excerptDigest: sha256(`${EXCERPT_A} ${index}`),
          }),
        ),
      }),
    );

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({ outcome: "failed", code: "EVIDENCE_RECORD_INVALID", runId });
    expect(deps.evidence.record).not.toHaveBeenCalled();
  });
});

describe("runMarketResearch reassessment", () => {
  it("enqueues evidence reassessment for observed domains outside the approved policy", async () => {
    const deps = dependencies({
      adapter: {
        availability: { available: true, provider: "test-adapter" },
        searchAndFetch: vi.fn(async () =>
          retrievalResult({
            sources: [
              retrievedSource({
                sourceUrl: "https://new-competitor.example/launch",
                domain: "new-competitor.example",
                publisher: "New Competitor",
                excerptText: EXCERPT_B,
                excerptDigest: sha256(EXCERPT_B),
              }),
            ],
          }),
        ),
      },
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "completed", reassessmentEnqueued: true });
    expect(deps.requests.enqueue).toHaveBeenCalledOnce();
    const enqueued = deps.requests.enqueue.mock.calls[0]![0];
    expect(Object.keys(enqueued.request).sort()).toEqual(
      [
        "organizationId",
        "branchId",
        "channelId",
        "kind",
        "triggerReason",
        "businessEvidenceDigest",
        "marketProfileVersionId",
        "sourcePolicyDigest",
        "researchRuleVersion",
        "localTimeBucket",
        "synthesisVersionTuple",
        "playbookVersionTuple",
        "requestFingerprint",
        "dueAt",
        "correlationId",
        "requestedBy",
      ].sort(),
    );
    expect(enqueued.request.kind).toBe("evidence_reassessment");
  });

  it("writes no profile proposal from inferred domains; the approved profile stays untouched", async () => {
    const deps = dependencies({
      adapter: {
        availability: { available: true, provider: "test-adapter" },
        searchAndFetch: vi.fn(async () =>
          retrievalResult({
            sources: [
              retrievedSource({
                sourceUrl: "https://new-competitor.example/launch",
                domain: "new-competitor.example",
                publisher: "New Competitor",
                excerptText: EXCERPT_B,
                excerptDigest: sha256(EXCERPT_B),
              }),
            ],
          }),
        ),
      },
    });

    await runMarketResearch(payload, deps);

    // T7-I1b: the inferred-change path may only enqueue identifier-only
    // reassessment. It must never author a Market Profile document from
    // untrusted adapter domains, so no proposal RPC or document payload may
    // appear in any worker write. The approved profile is re-read, never
    // rewritten: the dependency surface exposes no profile-write seam.
    const serialized = JSON.stringify([
      deps.events.publish.mock.calls,
      deps.requests.enqueue.mock.calls,
      deps.evidence.record.mock.calls,
      deps.evidence.complete.mock.calls,
    ]);
    expect(serialized).not.toContain("propose_market_profile_version");
    expect(serialized).not.toContain("profile_document");
    expect(serialized).not.toContain("proposalContext");
    expect(deps.profiles.readCurrent).toHaveBeenCalled();
  });

  it("never lets raw source content reach events", async () => {
    const deps = dependencies({
      extraction: modelPhase({
        transport: scriptedExtractionTransport(({ sourceKey, excerptText }) => [
          spanCandidate(sourceKey, excerptText),
        ]),
      }),
    });

    await runMarketResearch(payload, deps);

    const serialized = JSON.stringify([
      deps.events.publish.mock.calls,
      deps.requests.enqueue.mock.calls,
    ]);
    expect(serialized).not.toContain(EXCERPT_A);
    expect(serialized).not.toContain("Weekend footfall near the marina reached a record level.");
  });
});

describe("runMarketResearch pipeline handoff", () => {
  const pipelineId = "50000000-0000-4000-8000-000000000005";
  const pipelineRequestView = {
    ...requestView,
    branchId: "30000000-0000-4000-8000-000000000030",
    pipelineId,
    phase: "research",
  };

  function pipelineDependencies(overrides = {}) {
    const deps = dependencies(overrides);
    deps.requests.load.mockResolvedValue(pipelineRequestView);
    deps.evidence.completePipeline = vi.fn(async () => ({
      runId,
      pipelineStage: "preparing_insights",
      synthesisRequestId: "80000000-0000-4000-8000-000000000008",
      eligibleClaimCount: 1,
      replayed: false,
    }));
    return deps;
  }

  it("completes pipeline-bound runs through the fenced pipeline RPC, not the legacy path", async () => {
    const deps = pipelineDependencies({
      extraction: modelPhase({
        transport: scriptedExtractionTransport(({ sourceKey, excerptText }) => [
          spanCandidate(sourceKey, excerptText),
        ]),
      }),
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "completed" });
    expect(deps.evidence.completePipeline).toHaveBeenCalledOnce();
    expect(deps.evidence.completePipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        pipelineId,
        requestId,
        claimToken: expect.any(String),
        runId,
        result: expect.objectContaining({ outcome: "completed" }),
        coverage: expect.arrayContaining([
          expect.objectContaining({ slotKey: "local_market", outcome: "supported" }),
        ]),
      }),
    );
    expect(deps.evidence.complete).not.toHaveBeenCalled();
    expect(deps.requests.complete).not.toHaveBeenCalled();
  });

  it("threads the request branch into the approved-profile read", async () => {
    const deps = pipelineDependencies();

    await runMarketResearch(payload, deps);

    expect(deps.profiles.readCurrent).toHaveBeenCalledWith({
      organizationId,
      branchId: pipelineRequestView.branchId,
    });
  });

  it("treats an idempotent legacy completion as success instead of claim_lost", async () => {
    const deps = dependencies();
    deps.requests.complete.mockResolvedValueOnce({ outcome: "already_finished" });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "completed" });
    expect(deps.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "market_research.completed" }),
    );
  });

  it("returns claim_lost when the run failure loses the lease instead of throwing", async () => {
    const deps = dependencies();
    deps.evidence.fail.mockRejectedValueOnce(
      new GrowthIntelligenceError("RESEARCH_CLAIM_LOST", "The research lease is gone."),
    );

    const result = await runMarketResearch(payload, {
      ...deps,
      adapter: {
        availability: { available: false, provider: "test-adapter" },
        searchAndFetch: vi.fn(),
      },
    });

    expect(result).toEqual({ outcome: "claim_lost" });
    expect(deps.requests.fail).not.toHaveBeenCalled();
    expect(deps.events.publish).not.toHaveBeenCalled();
  });

  it("refuses business_evidence_changed: synthesis owns that kind now", async () => {
    const deps = dependencies();
    deps.requests.load.mockResolvedValueOnce({ ...requestView, kind: "business_evidence_changed" });

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({
      outcome: "failed",
      code: "REQUEST_KIND_UNSUPPORTED",
      runId: null,
    });
    expect(deps.evidence.begin).not.toHaveBeenCalled();
  });
});

describe("selectMaterialSources", () => {
  it("keeps only sources whose excerpt digest is outside the current set", () => {
    const current = retrievedSource();
    const novel = retrievedSource({
      sourceUrl: "https://calendar.example/dubai-events",
      domain: "calendar.example",
      excerptText: EXCERPT_B,
      excerptDigest: sha256(EXCERPT_B),
    });

    expect(selectMaterialSources([current, novel], [current.excerptDigest])).toEqual([novel]);
  });
});

describe("market research spend ledger", () => {
  it("sums known usage without clamping and counts unknowns separately", () => {
    const ledger = createMarketResearchSpendLedger();
    recordMarketResearchUsage(ledger, { kind: "reported", microsUsd: 6_000_000 });
    recordMarketResearchUsage(ledger, { kind: "estimated", microsUsd: 250 });
    recordMarketResearchUsage(ledger, { kind: "unknown" });
    recordMarketResearchLatency(ledger, 210);
    recordMarketResearchLatency(ledger, -5);

    expect(ledger).toEqual({ knownMicrosUsd: 6_000_250, unknownCount: 1, latencyMs: 210 });
  });

  it("treats malformed model usage as unknown liability rather than trusting it", () => {
    const ledger = createMarketResearchSpendLedger();
    recordMarketResearchUsage(ledger, { kind: "reported", microsUsd: -40 } as unknown as {
      kind: "reported";
      microsUsd: number;
    });

    expect(ledger).toEqual({ knownMicrosUsd: 0, unknownCount: 1, latencyMs: 0 });
  });
});
