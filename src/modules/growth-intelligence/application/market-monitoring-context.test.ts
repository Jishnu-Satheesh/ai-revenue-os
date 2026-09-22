import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  assertMonitoringSnapshotScope,
  buildMonitoringQueryPlan,
  buildMonitoringSynthesisPack,
  createMonitoringResearchBriefBuilder,
  createMonitoringSynthesisContextBuilder,
  MONITORING_RESEARCH_QUERY_TEXT_MAX_LENGTH,
  monitoringCompetitorSlotKey,
} from "@/modules/growth-intelligence/application/market-monitoring-context";
import type { MonitoringSnapshot } from "@/modules/growth-intelligence/application/market-monitoring-context";
import { briefFixture } from "@/modules/growth-intelligence/application/market-monitoring-fixtures";
import { RESEARCH_BUDGET_LIMITS } from "@/domain/growth-intelligence/research-pipeline";
import { buildResearchQuerySlots } from "@/modules/growth-intelligence/infrastructure/research/query-plan";
import { researchRetrievalResultSchema } from "@/modules/growth-intelligence/infrastructure/research/ports";
import {
  marketResearchPayloadSchema,
  runMarketResearch,
} from "@/workflows/growth-intelligence/run-market-research";
import {
  runSynthesis,
  synthesisPayloadSchema,
} from "@/workflows/growth-intelligence/run-synthesis";

const organizationId = "10000000-0000-4000-8000-000000000001";
const otherOrganizationId = "10000000-0000-4000-8000-000000000009";
const branchId = "20000000-0000-4000-8000-000000000002";
const otherBranchId = "20000000-0000-4000-8000-000000000008";
const requestId = "30000000-0000-4000-8000-000000000003";
const correlationId = "40000000-0000-4000-8000-000000000004";
const profileVersionId = "50000000-0000-4000-8000-000000000005";
const sourcePolicyDigest = "c".repeat(64);

// A private business-context value that must never reach provider queries.
// Long enough to trip the byte-absence guard, shaped like internal context.
const CANARY = "canary-internal-margin-note";

const snapshotFixture: MonitoringSnapshot = {
  snapshotId: "60000000-0000-4000-8000-000000000006",
  organizationId,
  branchId,
  digest: "d".repeat(64),
  status: "ready",
  refs: [CANARY],
  degradedReasons: [],
};

const scopeFixture = {
  publicBusinessName: "Kerala Kitchen",
  approvedDomains: ["example.com"],
  niches: ["Kerala cuisine"],
  city: "Dubai",
  countryCode: "AE",
  topics: ["Local events"],
  competitors: [],
};

function profileReaderFixture() {
  return vi.fn(async () => ({
    profileVersionId,
    sourcePolicyDigest,
    scope: scopeFixture,
  }));
}

const documentFixture = {
  schemaVersion: 1,
  publicIdentity: {
    approvedName: "Kerala Kitchen",
    domains: ["example.com"],
    publicUrls: ["https://example.com/menu"],
  },
  nicheDescriptors: ["Kerala cuisine"],
  geographies: [{ layer: "city", locationRef: "ae:du", name: "Dubai", countryCode: "AE" }],
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
} as const;

function researchDepsFixture(overrides: Record<string, unknown> = {}) {
  const requestView = {
    id: requestId,
    organizationId,
    branchId,
    channelId: null,
    kind: "market_research",
    triggerReason: "daily_due",
    businessEvidenceDigest: null,
    marketProfileVersionId: profileVersionId,
    sourcePolicyDigest,
    researchRuleVersion: "market-research@1",
    localTimeBucket: "daily:2026-09-14",
    correlationId,
    pipelineId: null,
    phase: null,
  };
  const profileView = {
    versionId: profileVersionId,
    digest: "e".repeat(64),
    document: documentFixture,
    sourcePolicyDigest,
    enabled: true,
  };
  const attemptId = "70000000-0000-4000-8000-000000000007";
  const retrieval = {
    sources: [],
    coverage: [{ slotKey: "local_market", kind: "local_market", outcome: "supported" }],
    attempts: [{ attemptId, slotKey: "local_market", usage: { kind: "reported", microsUsd: 500 } }],
  };
  const extractCalls: unknown[] = [];
  const reviewCalls: unknown[] = [];
  return {
    extractCalls,
    reviewCalls,
    deps: {
      requests: {
        claim: vi.fn(async () => ({ outcome: "acquired", replayed: false })),
        complete: vi.fn(async () => ({ outcome: "completed" })),
        fail: vi.fn(async () => ({ outcome: "failed" })),
        load: vi.fn(async () => requestView),
        enqueue: vi.fn(async () => ({ requestId, replayed: false })),
      },
      profiles: { readCurrent: vi.fn(async () => profileView) },
      evidence: {
        begin: vi.fn(async () => ({
          runId: "80000000-0000-4000-8000-000000000008",
          status: "running" as const,
          replayed: false,
        })),
        record: vi.fn(async () => ({
          runId: "80000000-0000-4000-8000-000000000008",
          claimCount: 0,
          replayed: false,
        })),
        complete: vi.fn(async () => ({
          runId: "80000000-0000-4000-8000-000000000008",
          status: "completed" as const,
          replayed: false,
        })),
        fail: vi.fn(async () => ({
          runId: "80000000-0000-4000-8000-000000000008",
          status: "failed" as const,
          replayed: false,
        })),
      },
      currentSources: { load: vi.fn(async () => [] as string[]) },
      adapter: {
        availability: { available: true, provider: "test-adapter" },
        searchAndFetch: vi.fn(async () => retrieval),
      },
      extraction: {
        transport: { complete: vi.fn(async () => ({ text: "[]", usage: { kind: "reported", microsUsd: 1 }, latencyMs: 1 })) },
        spender: { reserve: vi.fn(async () => ({ attemptId })), settle: vi.fn(async () => {}) },
        budget: { phase: "extraction" as const, maxCalls: 4, maxInputTokens: 12_000, maxOutputTokens: 4_000, maxSourcesPerBatch: 10 },
        modelId: "fixture-extraction",
      },
      supportReview: {
        transport: { complete: vi.fn(async () => ({ text: "[]", usage: { kind: "reported", microsUsd: 1 }, latencyMs: 1 })) },
        spender: { reserve: vi.fn(async () => ({ attemptId })), settle: vi.fn(async () => {}) },
        budget: { phase: "support_review" as const, maxCalls: 4, maxInputTokens: 12_000, maxOutputTokens: 4_000, maxSourcesPerBatch: 10 },
        modelId: "fixture-review",
      },
      excerptProvenance: {
        qualificationVersion: "FIXTURE",
        retainUntilFor: () => "2027-09-14T00:00:00.000Z",
      },
      engines: {
        parseRetrievalResult: (value: unknown) => researchRetrievalResultSchema.parse(value),
        extractClaims: vi.fn(async (input: Record<string, unknown>) => {
          extractCalls.push(input);
          return {
            candidates: [],
            batchesProcessed: 0,
            batchesFailed: 0,
            unprocessedSourceCount: 0,
            callsIssued: 0,
            usages: [],
            totalLatencyMs: 0,
          };
        }),
        reviewClaimSupport: vi.fn(async (input: Record<string, unknown>) => {
          reviewCalls.push(input);
          return {
            reviews: [],
            supportedCount: 0,
            unsupportedCount: 0,
            uncertainCount: 0,
            callsIssued: 0,
            usages: [],
            totalLatencyMs: 0,
          };
        }),
        selectAdmissible: vi.fn(() => ({ admitted: [], rejectedCount: 0, uncertainCount: 0 })),
        buildLinks: vi.fn(() => []),
        digestCandidate: vi.fn(() => "f".repeat(64)),
        freshnessWindow: vi.fn(() => ({
          staleAt: "2026-10-14T00:00:00.000Z",
          expiresAt: "2027-09-14T00:00:00.000Z",
        })),
        freshnessClass: vi.fn(() => "standard" as const),
      },
      planQueries: vi.fn(() => [{ kind: "official_identity" as const, text: "fixture", maxResults: 5 }]),
      buildScope: vi.fn(() => ({
        scope: scopeFixture,
        maxQueries: 2,
        maxResultsPerQuery: 5,
        maxResponseBytes: 524_288,
        maxRedirects: 0,
        timeoutMs: 20_000,
        maxCostMicrosUsd: 1_000_000,
      })),
      events: { publish: vi.fn(async () => {}) },
      ...overrides,
    },
  };
}

describe("createMonitoringResearchBriefBuilder", () => {
  const request = {
    organizationId,
    requestId,
    branchId,
    profileVersionId,
    sourcePolicyDigest,
    attemptKey: "attempt-1",
    correlationId,
  };

  it("threads snapshot identity without raw customer payloads", async () => {
    const builder = createMonitoringResearchBriefBuilder({
      readProfile: profileReaderFixture(),
      loadSnapshot: async () => snapshotFixture,
      qualified: true,
      planSlots: (scope) =>
        buildResearchQuerySlots({
          scope,
          maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
        }),
    });
    const brief = await builder(request);
    expect(brief.manifestId).toBe(snapshotFixture.snapshotId);
    expect(brief.contextDigest).toBe(snapshotFixture.digest);
    expect([...brief.contextRefs]).toEqual([CANARY]);
    expect(brief.evidenceOnly).toBe(false);
    expect(brief.briefFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("stays evidence-only without qualification", async () => {
    const builder = createMonitoringResearchBriefBuilder({
      readProfile: profileReaderFixture(),
      loadSnapshot: async () => snapshotFixture,
      qualified: false,
      planSlots: (scope) =>
        buildResearchQuerySlots({
          scope,
          maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
        }),
    });
    const brief = await builder(request);
    expect(brief.evidenceOnly).toBe(true);
    expect(brief.manifestId).toBeNull();
    expect(brief.contextDigest).toBeNull();
    expect([...brief.contextRefs]).toEqual([]);
    expect(brief.status).toBe("unavailable");
  });

  it("refuses cross-org and wrong-branch snapshots", async () => {
    const crossOrg = createMonitoringResearchBriefBuilder({
      readProfile: profileReaderFixture(),
      loadSnapshot: async () => ({ ...snapshotFixture, organizationId: otherOrganizationId }),
      qualified: true,
      planSlots: (scope) =>
        buildResearchQuerySlots({
          scope,
          maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
        }),
    });
    await expect(crossOrg(request)).rejects.toBeInstanceOf(GrowthIntelligenceError);

    const wrongBranch = createMonitoringResearchBriefBuilder({
      readProfile: profileReaderFixture(),
      loadSnapshot: async () => ({ ...snapshotFixture, branchId: otherBranchId }),
      qualified: true,
      planSlots: (scope) =>
        buildResearchQuerySlots({
          scope,
          maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
        }),
    });
    await expect(wrongBranch(request)).rejects.toBeInstanceOf(GrowthIntelligenceError);
  });

  it("fails closed on missing scope and version drift", async () => {
    const missing = createMonitoringResearchBriefBuilder({
      readProfile: async () => null,
      loadSnapshot: async () => null,
      qualified: false,
      planSlots: (scope) =>
        buildResearchQuerySlots({
          scope,
          maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
        }),
    });
    await expect(missing(request)).rejects.toBeInstanceOf(GrowthIntelligenceError);

    const drifted = createMonitoringResearchBriefBuilder({
      readProfile: async () => ({
        profileVersionId: "90000000-0000-4000-8000-000000000009",
        sourcePolicyDigest,
        scope: scopeFixture,
      }),
      loadSnapshot: async () => null,
      qualified: false,
      planSlots: (scope) =>
        buildResearchQuerySlots({
          scope,
          maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
        }),
    });
    await expect(drifted(request)).rejects.toBeInstanceOf(GrowthIntelligenceError);
  });

  it("proves which context reaches each model phase with a canary", async () => {
    const builder = createMonitoringResearchBriefBuilder({
      readProfile: profileReaderFixture(),
      loadSnapshot: async () => snapshotFixture,
      qualified: true,
      planSlots: (scope) =>
        buildResearchQuerySlots({
          scope,
          maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
        }),
    });
    const { deps, extractCalls, reviewCalls } = researchDepsFixture({ researchBrief: builder });
    const adapter = deps.adapter as { searchAndFetch: ReturnType<typeof vi.fn> };

    const result = await runMarketResearch(
      marketResearchPayloadSchema.parse({ organizationId, requestId, correlationId }),
      deps as never,
    );
    expect(["completed", "partial"]).toContain(result.outcome);

    // The canary ref id reaches extraction for relevance only.
    expect(extractCalls).toHaveLength(1);
    expect(extractCalls[0]).toMatchObject({ briefRefs: [CANARY] });
    // Support review receives source/candidate context only: no brief field,
    // and the canary appears nowhere in its input.
    expect(reviewCalls).toHaveLength(1);
    expect(reviewCalls[0]).not.toHaveProperty("briefRefs");
    expect(JSON.stringify(reviewCalls[0])).not.toContain(CANARY);
    // Provider queries stay a deterministic public function: the snapshot
    // manifest and the canary appear nowhere in the adapter input.
    expect(adapter.searchAndFetch).toHaveBeenCalledOnce();
    const adapterInput = JSON.stringify(adapter.searchAndFetch.mock.calls[0]?.[0]);
    expect(adapterInput).not.toContain(CANARY);
    expect(adapterInput).not.toContain(snapshotFixture.snapshotId);
    expect(adapterInput).not.toContain(snapshotFixture.digest);
  });

  it("passes no brief refs to extraction when evidence-only", async () => {
    const builder = createMonitoringResearchBriefBuilder({
      readProfile: profileReaderFixture(),
      loadSnapshot: async () => snapshotFixture,
      qualified: false,
      planSlots: (scope) =>
        buildResearchQuerySlots({
          scope,
          maxResultsPerQuery: RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
        }),
    });
    const { deps, extractCalls } = researchDepsFixture({ researchBrief: builder });
    await runMarketResearch(
      marketResearchPayloadSchema.parse({ organizationId, requestId, correlationId }),
      deps as never,
    );
    expect(extractCalls).toHaveLength(1);
    expect(extractCalls[0]).not.toHaveProperty("briefRefs");
  });
});

describe("monitoring synthesis context", () => {
  it("packs permitted context by reference and refuses foreign material", () => {
    const pack = buildMonitoringSynthesisPack({
      snapshot: snapshotFixture,
      scope: { organizationId, branchId },
      parentBriefManifestId: null,
    });
    expect(pack).toMatchObject({
      manifestId: snapshotFixture.snapshotId,
      contextDigest: snapshotFixture.digest,
      contextRefs: [CANARY],
      parentBriefManifestId: null,
    });
    expect(
      buildMonitoringSynthesisPack({
        snapshot: null,
        scope: { organizationId, branchId },
        parentBriefManifestId: null,
      }),
    ).toBeNull();
    expect(() =>
      buildMonitoringSynthesisPack({
        snapshot: { ...snapshotFixture, organizationId: otherOrganizationId },
        scope: { organizationId, branchId },
        parentBriefManifestId: null,
      }),
    ).toThrow(GrowthIntelligenceError);
  });

  it("threads the pack into synthesis and fails closed when missing", async () => {
    const builder = createMonitoringSynthesisContextBuilder({
      loadSnapshot: async () => snapshotFixture,
    });
    const synthesize = vi.fn(async (_input: Record<string, unknown>) => ({
      outcome: "completed" as const,
      runId: "80000000-0000-4000-8000-000000000008",
      itemCount: 1,
      createdFingerprints: [],
      supersededItemIds: [],
    }));
    const requestView = {
      id: requestId,
      organizationId,
      branchId,
      channelId: null,
      kind: "business_evidence_changed",
      triggerReason: "report_current",
      businessEvidenceDigest: null,
      marketProfileVersionId: profileVersionId,
      sourcePolicyDigest,
      researchRuleVersion: "market-research@1",
      localTimeBucket: "daily:2026-09-14",
      correlationId,
      pipelineId: null,
      phase: null,
    };
    const deps = {
      requests: {
        claim: vi.fn(async () => ({ outcome: "acquired", replayed: false })),
        complete: vi.fn(async () => ({ outcome: "completed" })),
        fail: vi.fn(async () => ({ outcome: "failed" })),
        load: vi.fn(async () => requestView),
      },
      profiles: {
        readCurrent: vi.fn(async () => ({
          versionId: profileVersionId,
          digest: "e".repeat(64),
          document: documentFixture,
          sourcePolicyDigest,
          enabled: true,
        })),
      },
      synthesize,
      synthesisContext: builder,
    };
    const result = await runSynthesis(
      synthesisPayloadSchema.parse({ organizationId, requestId, correlationId }),
      deps as never,
    );
    expect(result).toMatchObject({ outcome: "synthesized" });
    expect(synthesize).toHaveBeenCalledOnce();
    expect(synthesize.mock.calls[0]?.[0]).toMatchObject({
      context: {
        manifestId: snapshotFixture.snapshotId,
        contextDigest: snapshotFixture.digest,
        contextRefs: [CANARY],
      },
    });

    const missing = createMonitoringSynthesisContextBuilder({ loadSnapshot: async () => null });
    const failed = await runSynthesis(
      synthesisPayloadSchema.parse({ organizationId, requestId, correlationId }),
      { ...deps, synthesisContext: missing } as never,
    );
    expect(failed).toMatchObject({ outcome: "failed", code: "SYNTHESIS_CONTEXT_UNAVAILABLE" });
  });
});

describe("assertMonitoringSnapshotScope", () => {
  it("accepts exact scope and refuses drift", () => {
    expect(() =>
      assertMonitoringSnapshotScope(snapshotFixture, { organizationId, branchId }),
    ).not.toThrow();
    expect(() =>
      assertMonitoringSnapshotScope(snapshotFixture, { organizationId: otherOrganizationId, branchId }),
    ).toThrow(GrowthIntelligenceError);
    expect(() =>
      assertMonitoringSnapshotScope(snapshotFixture, { organizationId, branchId: otherBranchId }),
    ).toThrow(GrowthIntelligenceError);
    // Organization-wide snapshots never serve a branch request and vice versa.
    expect(() =>
      assertMonitoringSnapshotScope(
        { ...snapshotFixture, branchId: null },
        { organizationId, branchId },
      ),
    ).toThrow(GrowthIntelligenceError);
  });
});

describe("buildMonitoringQueryPlan", () => {
  it("covers every area and competitor with public text only", () => {
    const brief = briefFixture();
    const queries = buildMonitoringQueryPlan(brief);
    expect(queries.map((query) => query.slotKey).sort()).toEqual(
      ["area:demand", "area:reviews", "competitor:stitch-house"].sort(),
    );
    const serialized = JSON.stringify(queries);
    expect(serialized).not.toContain(CANARY);
    expect(serialized).not.toContain(snapshotFixture.snapshotId);
    expect(serialized).not.toContain(snapshotFixture.digest);
    expect(serialized).toContain("Deira");
    expect(serialized).toContain("Stitch House");
  });

  it("keeps distinct non-Latin competitor keys distinct", () => {
    expect(monitoringCompetitorSlotKey("مطعم الديوان")).not.toBe(
      monitoringCompetitorSlotKey("مطعم البراحة"),
    );
  });

  it("bounds every query text to the executor contract, however long the hint", () => {
    const brief = briefFixture({
      researchArea: "Jumeirah, Dubai",
      investigationAreas: ["demand", "observable_performance", "offers", "presence", "reviews"],
      competitors: [
        {
          name: "Bombay Borough",
          website: "https://www.bombayborough.com/dubai.html",
          locationHint:
            "Bombay Borough, Gate Village, Building 3 - towards DIFC Parking - opposite Gate District 2 Valet Parking Desk at Gate - Zaa'beel Second - District 2 - Dubai - United Arab Emirates",
          source: "operator_lead",
        },
      ],
    });
    const queries = buildMonitoringQueryPlan(brief);
    expect(queries).toHaveLength(6);
    for (const query of queries) {
      expect(query.text.length).toBeLessThanOrEqual(MONITORING_RESEARCH_QUERY_TEXT_MAX_LENGTH);
      expect(query.text.length).toBeGreaterThan(0);
    }
  });

  it("bounds area texts when the research area itself runs to its cap", () => {
    const brief = briefFixture({
      researchArea: "Jumeirah, Dubai ".repeat(10).slice(0, 160),
      competitors: [],
    });
    const queries = buildMonitoringQueryPlan(brief);
    expect(queries.length).toBeGreaterThan(0);
    for (const query of queries) {
      expect(query.text.length).toBeLessThanOrEqual(MONITORING_RESEARCH_QUERY_TEXT_MAX_LENGTH);
      expect(query.text.length).toBeGreaterThan(0);
    }
  });
});
