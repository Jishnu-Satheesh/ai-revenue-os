import { randomUUID } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const generateText = vi.fn();

vi.mock("ai", () => ({ generateText: (...args: unknown[]) => generateText(...args) }));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => (id: string) => ({ id }),
}));

import { extractResearchClaims } from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import { reviewResearchClaimSupport } from "@/modules/growth-intelligence/infrastructure/research/claim-support-review";
import {
  createFencedResearchModelSpender,
  createWiredResearchModelTransport,
  isResearchModelGateOpen,
  readResearchModelApiKey,
  readResearchModelId,
  shouldWireResearchModelPhase,
} from "@/trigger/growth-intelligence-research-models";
import {
  TINYFISH_RESEARCH_MAXIMUM_MICROS_USD_PER_ATTEMPT,
  TINYFISH_RESEARCH_PRICE_VERSION,
  TINYFISH_RESEARCH_QUOTE_MICROS_USD,
} from "@/trigger/growth-intelligence-tinyfish";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const REQUEST_ID = "22222222-2222-4222-8222-222222222222";
const CLAIM_TOKEN = "33333333-3333-4333-8333-333333333333";

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  for (const name of [
    "TINYFISH_MARKET_RESEARCH_ENABLED",
    "GOOGLE_GENERATIVE_AI_API_KEY",
    "RESEARCH_EXTRACTION_MODEL",
    "RESEARCH_SUPPORT_REVIEW_MODEL",
  ]) {
    savedEnv[name] = process.env[name];
    delete process.env[name];
  }
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function budgetFakes() {
  const reserveRequestBudget = vi.fn(async () => ({ replayed: false }));
  const reserveAttempt = vi.fn(async () => ({ attemptId: randomUUID() }));
  const settleAttempt = vi.fn(async () => undefined);
  return { reserveRequestBudget, reserveAttempt, settleAttempt };
}

describe("research model wiring predicate", () => {
  it("wires only when gate, lane, credential, and model id are all present", () => {
    expect(
      shouldWireResearchModelPhase({
        gateOpen: true,
        laneQualified: true,
        apiKey: "key",
        modelId: "gemini-research",
      }),
    ).toBe(true);
  });

  it("keeps fail-closed for a missing model id", () => {
    expect(
      shouldWireResearchModelPhase({
        gateOpen: true,
        laneQualified: true,
        apiKey: "key",
        modelId: "   ",
      }),
    ).toBe(false);
  });

  it("keeps fail-closed for a missing credential", () => {
    expect(
      shouldWireResearchModelPhase({
        gateOpen: true,
        laneQualified: true,
        apiKey: "",
        modelId: "gemini-research",
      }),
    ).toBe(false);
  });

  it("keeps fail-closed for a closed kill-switch", () => {
    expect(
      shouldWireResearchModelPhase({
        gateOpen: false,
        laneQualified: true,
        apiKey: "key",
        modelId: "gemini-research",
      }),
    ).toBe(false);
  });

  it("keeps fail-closed for an unqualified lane", () => {
    expect(
      shouldWireResearchModelPhase({
        gateOpen: true,
        laneQualified: false,
        apiKey: "key",
        modelId: "gemini-research",
      }),
    ).toBe(false);
  });
});

describe("research model env wiring", () => {
  it("reads the existing environment names behind one kill-switch", () => {
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = "  test-key  ";
    process.env.RESEARCH_EXTRACTION_MODEL = "  gemini-extraction  ";

    expect(isResearchModelGateOpen()).toBe(true);
    expect(readResearchModelApiKey()).toBe("test-key");
    expect(readResearchModelId("RESEARCH_EXTRACTION_MODEL")).toBe("gemini-extraction");
    expect(readResearchModelId("RESEARCH_SUPPORT_REVIEW_MODEL")).toBe("");
  });

  it("keeps the gate closed by default", () => {
    expect(isResearchModelGateOpen()).toBe(false);
  });
});

describe("wired research model transport", () => {
  it("calls the model backend through the established pattern", async () => {
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    generateText.mockResolvedValueOnce({ text: "[]" });

    const transport = createWiredResearchModelTransport({
      modelId: "gemini-research",
      apiKey: "test-key",
    });
    const result = await transport.complete({
      phase: "extraction",
      prompt: '{"phase":"extraction"}',
      maxInputTokens: 12_000,
      maxOutputTokens: 4_000,
    });

    expect(generateText).toHaveBeenCalledTimes(1);
    const call = generateText.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).toMatchObject({
      model: { id: "gemini-research" },
      temperature: 0.1,
      maxOutputTokens: 4_000,
    });
    expect(result.usage).toEqual({ kind: "unknown" });
  });

  it("fails the extraction batch closed with unknown cost when the gate shuts mid-run", async () => {
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    const transport = createWiredResearchModelTransport({
      modelId: "gemini-research",
      apiKey: "test-key",
    });
    delete process.env.TINYFISH_MARKET_RESEARCH_ENABLED;

    const reserve = vi.fn(async () => ({
      attemptId: "10000000-0000-4000-8000-000000000001",
    }));
    const settle = vi.fn(async () => {});
    const result = await extractResearchClaims({
      scope: {
        publicBusinessName: "Harbor Eats",
        approvedDomains: ["harboreats.example"],
        niches: ["Seafood"],
        city: "Dubai",
        countryCode: "AE",
        topics: ["weekend footfall"],
        competitors: [],
      },
      sources: [
        {
          sourceKey: "src-0-aabbccddeeff",
          sourceUrl: "https://tourism.example/dubai-notice",
          excerptText: "Harbor Eats saw record weekend footfall near the marina promenade.",
          excerptDigest: "a".repeat(64),
          retrievedAt: "2026-09-01T10:00:00Z",
        },
      ],
      budget: {
        phase: "extraction",
        maxCalls: 4,
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
        maxSourcesPerBatch: 10,
      },
      transport,
      spender: { reserve, settle },
      modelId: "gemini-research",
    });

    expect(result.candidates).toEqual([]);
    expect(result.batchesFailed).toBeGreaterThan(0);
    expect(result.usages).toEqual([{ kind: "unknown" }]);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("fails the support-review batch closed when the gate shuts mid-run", async () => {
    process.env.TINYFISH_MARKET_RESEARCH_ENABLED = "true";
    const transport = createWiredResearchModelTransport({
      modelId: "gemini-research",
      apiKey: "test-key",
    });
    delete process.env.TINYFISH_MARKET_RESEARCH_ENABLED;

    const excerptText = "Harbor Eats saw record weekend footfall near the marina promenade.";
    const reserve = vi.fn(async () => ({
      attemptId: "10000000-0000-4000-8000-000000000002",
    }));
    const settle = vi.fn(async () => {});
    const result = await reviewResearchClaimSupport({
      candidates: [
        {
          candidateKey: "marina-footfall",
          subjectKind: "market",
          subjectRef: "dubai marina footfall",
          claimKind: "demand_signal",
          paraphrase: "Weekend footfall near the marina promenade reached a record level.",
          quotation: null,
          claimCategory: "demand_trend",
          geographicLayer: "city",
          geographyRef: "ae:du",
          citations: [
            {
              sourceKey: "src-0-aabbccddeeff",
              spanStart: 0,
              spanEnd: excerptText.length,
              quotedText: excerptText,
            },
          ],
          sourceKeys: ["src-0-aabbccddeeff"],
          publishedAt: null,
          observedAt: "2026-09-01T09:00:00Z",
          limitations: [],
        },
      ],
      sources: [
        {
          sourceKey: "src-0-aabbccddeeff",
          sourceUrl: "https://tourism.example/dubai-notice",
          excerptText,
          excerptDigest: "a".repeat(64),
          retrievedAt: "2026-09-01T10:00:00Z",
        },
      ],
      scope: {
        publicBusinessName: "Harbor Eats",
        approvedDomains: ["harboreats.example"],
        niches: ["Seafood"],
        city: "Dubai",
        countryCode: "AE",
        topics: ["weekend footfall"],
        competitors: [],
      },
      eligibleSourceKeys: ["src-0-aabbccddeeff"],
      budget: {
        phase: "support_review",
        maxCalls: 4,
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
        maxSourcesPerBatch: 10,
      },
      transport,
      spender: { reserve, settle },
      modelId: "gemini-research",
    });

    expect(result.supportedCount).toBe(0);
    expect(result.callsIssued).toBe(1);
    expect(result.usages).toEqual([{ kind: "unknown" }]);
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("missing excerpt qualification version", () => {
  it("fails the worker closed with EXTRACTION_UNAVAILABLE and zero spend", async () => {
    const { runMarketResearch } = await import(
      "@/workflows/growth-intelligence/run-market-research"
    );
    const organizationId = "10000000-0000-4000-8000-000000000001";
    const requestId = "20000000-0000-4000-8000-000000000002";
    const correlationId = "60000000-0000-4000-8000-000000000006";
    const profileVersionId = "70000000-0000-4000-8000-000000000007";
    const sourcePolicyDigest = "c".repeat(64);
    const document = {
      schemaVersion: 1,
      publicIdentity: {
        approvedName: "Kerala Kitchen",
        domains: ["example.com"],
        publicUrls: ["https://example.com/menu"],
      },
      nicheDescriptors: ["Kerala cuisine"],
      geographies: [
        { layer: "city", locationRef: "ae:du", name: "Dubai", countryCode: "AE" },
      ],
      competitors: [],
      topics: [{ key: "local-events", label: "Local events", provenance: "core" }],
      sourcePolicy: {
        excludedDomains: [],
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
    const fail = vi.fn(async () => ({ outcome: "failed" }));
    const evidenceBegin = vi.fn(async () => {
      throw new Error("must not begin a run without excerpt provenance");
    });
    const searchAndFetch = vi.fn(async () => {
      throw new Error("must not retrieve without excerpt provenance");
    });
    const quietTransport = {
      complete: vi.fn(async () => ({
        text: "[]",
        usage: { kind: "unknown" as const },
        latencyMs: 1,
      })),
    };
    const quietSpender = {
      reserve: vi.fn(async () => ({
        attemptId: "10000000-0000-4000-8000-000000000001",
      })),
      settle: vi.fn(async () => {}),
    };

    const result = await runMarketResearch(
      { organizationId, requestId, correlationId },
      {
        requests: {
          claim: vi.fn(async () => ({ outcome: "acquired", replayed: false })),
          complete: vi.fn(async () => ({ outcome: "completed" })),
          fail,
          load: vi.fn(async () => ({
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
          })),
          enqueue: vi.fn(async () => ({
            requestId: "80000000-0000-4000-8000-000000000008",
            replayed: false,
          })),
        },
        profiles: {
          readCurrent: vi.fn(async () => ({
            versionId: profileVersionId,
            digest: "d".repeat(64),
            document,
            sourcePolicyDigest,
            enabled: true,
          })),
        },
        evidence: {
          begin: evidenceBegin,
          record: vi.fn(),
          complete: vi.fn(),
          fail: vi.fn(),
          completePipeline: vi.fn(),
          failPipeline: vi.fn(),
        } as never,
        currentSources: { load: vi.fn(async () => []) },
        adapter: {
          availability: { available: true, provider: "tinyfish" },
          searchAndFetch,
        },
        extraction: {
          transport: quietTransport,
          spender: quietSpender,
          budget: {
            phase: "extraction" as const,
            maxCalls: 4,
            maxInputTokens: 12_000,
            maxOutputTokens: 4_000,
            maxSourcesPerBatch: 10,
          },
          modelId: "gemini-research",
        },
        supportReview: {
          transport: quietTransport,
          spender: quietSpender,
          budget: {
            phase: "support_review" as const,
            maxCalls: 4,
            maxInputTokens: 12_000,
            maxOutputTokens: 4_000,
            maxSourcesPerBatch: 10,
          },
          modelId: "gemini-research",
        },
        excerptProvenance: {
          qualificationVersion: "   ",
          retainUntilFor: () => "2027-09-01T00:00:00Z",
        },
        engines: {
          parseRetrievalResult: (value: unknown) => value as never,
          extractClaims: vi.fn(),
          reviewClaimSupport: vi.fn(),
          selectAdmissible: vi.fn(),
          buildLinks: vi.fn(),
          digestCandidate: vi.fn(),
          freshnessWindow: vi.fn(),
          freshnessClass: vi.fn(),
        } as never,
        planQueries: vi.fn(),
        buildScope: vi.fn(),
        events: { publish: vi.fn(async () => {}) },
      } as never,
    );

    expect(result).toEqual({ outcome: "failed", code: "EXTRACTION_UNAVAILABLE", runId: null });
    expect(fail).toHaveBeenCalledWith({
      organizationId,
      requestId,
      claimToken: expect.any(String),
      safeFailureCode: "EXTRACTION_UNAVAILABLE",
    });
    expect(evidenceBegin).not.toHaveBeenCalled();
    expect(searchAndFetch).not.toHaveBeenCalled();
    expect(quietTransport.complete).not.toHaveBeenCalled();
    expect(quietSpender.reserve).not.toHaveBeenCalled();
  });
});

describe("fenced research model spender", () => {
  it("reserves under phase research with namespaced slot keys inside the staged quote", async () => {
    const fakes = budgetFakes();
    const spender = createFencedResearchModelSpender({
      budget: fakes as never,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => CLAIM_TOKEN,
    });

    const first = await spender.reserve({
      phase: "extraction",
      slotKey: "extraction:batch-0",
      attemptIndex: 0,
    });
    expect(first.attemptId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    await spender.reserve({
      phase: "support_review",
      slotKey: "support-review:batch-0",
      attemptIndex: 0,
    });

    expect(fakes.reserveRequestBudget).toHaveBeenCalledTimes(1);
    expect(fakes.reserveRequestBudget).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      quoteMicrosUsd: TINYFISH_RESEARCH_QUOTE_MICROS_USD,
      priceVersion: TINYFISH_RESEARCH_PRICE_VERSION,
    });
    expect(fakes.reserveAttempt).toHaveBeenNthCalledWith(1, {
      organizationId: ORGANIZATION_ID,
      scope: { kind: "request", requestId: REQUEST_ID },
      phase: "research",
      slotKey: "extraction:batch-0",
      attemptIndex: 0,
      maximumMicrosUsd: TINYFISH_RESEARCH_MAXIMUM_MICROS_USD_PER_ATTEMPT,
      claimToken: CLAIM_TOKEN,
    });
    expect(fakes.reserveAttempt).toHaveBeenNthCalledWith(2, {
      organizationId: ORGANIZATION_ID,
      scope: { kind: "request", requestId: REQUEST_ID },
      phase: "research",
      slotKey: "support-review:batch-0",
      attemptIndex: 0,
      maximumMicrosUsd: TINYFISH_RESEARCH_MAXIMUM_MICROS_USD_PER_ATTEMPT,
      claimToken: CLAIM_TOKEN,
    });

    await spender.settle({ attemptId: first.attemptId, usage: { kind: "unknown" } });
    expect(fakes.settleAttempt).toHaveBeenCalledWith({
      organizationId: ORGANIZATION_ID,
      attemptId: first.attemptId,
      usage: { kind: "unknown" },
    });
  });

  it("refuses to reserve before the workflow claim with zero spend", async () => {
    const fakes = budgetFakes();
    const spender = createFencedResearchModelSpender({
      budget: fakes as never,
      organizationId: ORGANIZATION_ID,
      requestId: REQUEST_ID,
      claimToken: () => null,
    });

    await expect(
      spender.reserve({ phase: "extraction", slotKey: "extraction:batch-0", attemptIndex: 0 }),
    ).rejects.toEqual(expect.objectContaining({ code: "RESEARCH_BUDGET_UNAVAILABLE" }));
    expect(fakes.reserveRequestBudget).not.toHaveBeenCalled();
    expect(fakes.reserveAttempt).not.toHaveBeenCalled();
  });

  it("fails an extraction batch closed with zero spend when the reserve is refused", async () => {
    const refusing = {
      reserve: vi.fn(async () => {
        throw Object.assign(new Error("Market research is not enabled."), {
          code: "RESEARCH_PROVIDER_NOT_QUALIFIED",
        });
      }),
      settle: vi.fn(async () => {}),
    };
    const quietTransport = {
      complete: vi.fn(async () => ({
        text: "[]",
        usage: { kind: "unknown" as const },
        latencyMs: 1,
      })),
    };

    const result = await extractResearchClaims({
      scope: {
        publicBusinessName: "Harbor Eats",
        approvedDomains: ["harboreats.example"],
        niches: ["Seafood"],
        city: "Dubai",
        countryCode: "AE",
        topics: ["weekend footfall"],
        competitors: [],
      },
      sources: [
        {
          sourceKey: "src-0-aabbccddeeff",
          sourceUrl: "https://tourism.example/dubai-notice",
          excerptText: "Harbor Eats saw record weekend footfall near the marina promenade.",
          excerptDigest: "a".repeat(64),
          retrievedAt: "2026-09-01T10:00:00Z",
        },
      ],
      budget: {
        phase: "extraction",
        maxCalls: 4,
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
        maxSourcesPerBatch: 10,
      },
      transport: quietTransport,
      spender: refusing,
      modelId: "gemini-research",
    });

    expect(result.candidates).toEqual([]);
    expect(result.batchesFailed).toBeGreaterThan(0);
    expect(result.callsIssued).toBe(0);
    expect(result.usages).toEqual([]);
    expect(quietTransport.complete).not.toHaveBeenCalled();
  });
});
