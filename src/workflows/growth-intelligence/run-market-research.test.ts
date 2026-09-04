import { describe, expect, it, vi } from "vitest";

import type { MarketProfileDocumentV1 } from "@/domain/growth-intelligence/types";
import { DomainError } from "@/lib/errors";
import type { MarketEvidenceRepository } from "@/modules/growth-intelligence/infrastructure/evidence-repository";
import { buildResearchQueryPlan } from "@/modules/growth-intelligence/infrastructure/research/query-plan";
import {
  researchRequestSchema,
  type ResearchRequest,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import {
  marketResearchPayloadSchema,
  runMarketResearch,
  selectMaterialAttempts,
  type AdapterSourceAttempt,
  type ApprovedMarketProfileView,
  type GrowthIntelligenceRequestView,
  type MarketResearchClaim,
} from "@/workflows/growth-intelligence/run-market-research";

const organizationId = "10000000-0000-4000-8000-000000000001";
const requestId = "20000000-0000-4000-8000-000000000002";
const claimToken = "30000000-0000-4000-8000-000000000003";
const runId = "40000000-0000-4000-8000-000000000004";
const correlationId = "60000000-0000-4000-8000-000000000006";
const profileVersionId = "70000000-0000-4000-8000-000000000007";
const sourcePolicyDigest = "c".repeat(64);
const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

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
};

const profileView: ApprovedMarketProfileView = {
  versionId: profileVersionId,
  digest: "d".repeat(64),
  document,
  sourcePolicyDigest,
  enabled: true,
};

function attempt(overrides: Partial<AdapterSourceAttempt> = {}): AdapterSourceAttempt {
  return {
    queryKind: "market_context",
    sourceUrl: "https://tourism.example/dubai-notice",
    sourceDomain: "tourism.example",
    publisher: "Dubai Tourism",
    sourceClass: "official",
    availability: "available",
    contentDigest: digestA,
    safeFailureCode: null,
    retrievedAt: "2026-09-02T06:00:00Z",
    publishedAt: null,
    observedAt: "2026-09-02T05:00:00Z",
    adapterCostMicrosUsd: 1_000,
    adapterLatencyMs: 500,
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
    appendEvent: vi.fn(),
  };
  const currentSources = { load: vi.fn(async () => [] as string[]) };
  const adapter = {
    availability: { available: true, provider: "test-adapter" },
    searchAndFetch: vi.fn(async () => [attempt()] as AdapterSourceAttempt[]),
  };
  const planQueries = vi.fn((request: ResearchRequest) =>
    buildResearchQueryPlan({
      scope: request.scope,
      maxQueries: request.maxQueries,
      maxResultsPerQuery: request.maxResultsPerQuery,
    }),
  );
  const buildScope = vi.fn((doc: MarketProfileDocumentV1): ResearchRequest => {
    const city = doc.geographies.find((geography) => geography.layer === "city");
    const country = doc.geographies.find((geography) => geography.layer === "country");
    const location = city ?? country;
    if (!location || !("countryCode" in location)) {
      throw new DomainError("DOMAIN_ERROR", "The approved profile has no usable city or country.");
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
  });
  const events = { publish: vi.fn(async () => {}) };
  return {
    requests,
    profiles,
    evidence,
    currentSources,
    adapter,
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

  it("treats business evidence changes as research until synthesis owns them", async () => {
    const deps = dependencies();
    deps.requests.load.mockResolvedValueOnce({
      ...requestView,
      kind: "business_evidence_changed",
    });

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "completed" });
    expect(deps.adapter.searchAndFetch).toHaveBeenCalledOnce();
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
});

describe("runMarketResearch grading and completion", () => {
  it("skips record when every digest is already current but still completes run lineage", async () => {
    const deps = dependencies();
    deps.currentSources.load.mockResolvedValueOnce([digestA]);

    const result = await runMarketResearch(payload, deps);

    expect(deps.evidence.record).not.toHaveBeenCalled();
    expect(deps.evidence.complete).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ outcome: "completed", claimCount: 0 });
  });

  it("records compact sources with no claim content when digests are new", async () => {
    const deps = dependencies();

    const result = await runMarketResearch(payload, deps);

    expect(deps.evidence.record).toHaveBeenCalledOnce();
    const recorded = deps.evidence.record.mock.calls[0]![0];
    expect(recorded.payload.claims).toEqual([]);
    expect(recorded.payload.links).toEqual([]);
    expect(recorded.payload.sources).toHaveLength(1);
    expect(result).toMatchObject({ outcome: "completed", sourceAttemptCount: 1 });
  });

  it("completes partial and emits partially_completed when a source fetch fails safely", async () => {
    const deps = dependencies();
    deps.adapter.searchAndFetch.mockResolvedValueOnce([
      attempt(),
      attempt({
        sourceUrl: "https://paywalled.example/closed",
        sourceDomain: "paywalled.example",
        publisher: null,
        sourceClass: "public_signal",
        availability: "unavailable",
        contentDigest: null,
        safeFailureCode: "SOURCE_ACCESS_REFUSED",
      }),
    ]);

    const result = await runMarketResearch(payload, deps);

    expect(result).toMatchObject({ outcome: "partial", sourceAttemptCount: 2 });
    expect(deps.events.publish).toHaveBeenCalledWith(
      expect.objectContaining({ eventName: "market_research.partially_completed" }),
    );
  });

  it("refuses unbounded adapter results instead of truncating them silently", async () => {
    const deps = dependencies();
    deps.adapter.searchAndFetch.mockResolvedValueOnce(
      Array.from({ length: 201 }, (_, index) =>
        attempt({ sourceUrl: `https://tourism.example/notice-${index}` }),
      ),
    );

    const result = await runMarketResearch(payload, deps);

    expect(result).toEqual({ outcome: "failed", code: "ADAPTER_RESULT_UNBOUNDED", runId });
    expect(deps.evidence.record).not.toHaveBeenCalled();
  });
});

describe("runMarketResearch reassessment", () => {
  it("enqueues evidence reassessment for observed domains outside the approved policy", async () => {
    const deps = dependencies();
    deps.adapter.searchAndFetch.mockResolvedValueOnce([
      attempt({
        sourceUrl: "https://new-competitor.example/launch",
        sourceDomain: "new-competitor.example",
      }),
    ]);

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
    const deps = dependencies();
    deps.adapter.searchAndFetch.mockResolvedValueOnce([
      attempt({
        sourceUrl: "https://new-competitor.example/launch",
        sourceDomain: "new-competitor.example",
      }),
    ]);

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

  it("never lets raw source content reach events, logs, or RPC payloads", async () => {
    const deps = dependencies();

    await runMarketResearch(payload, deps);

    const serialized = JSON.stringify([
      deps.events.publish.mock.calls,
      deps.requests.enqueue.mock.calls,
      deps.evidence.record.mock.calls,
      deps.evidence.complete.mock.calls,
    ]);
    expect(serialized).not.toContain("paraphrase");
    expect(serialized).not.toContain("quotation");
  });
});

describe("selectMaterialAttempts", () => {
  it("keeps only available attempts with digests outside the current set", () => {
    const available = attempt();
    const unavailable = attempt({
      availability: "unavailable",
      contentDigest: null,
      safeFailureCode: "SOURCE_ACCESS_REFUSED",
    });
    const stale = attempt({ contentDigest: digestB });

    expect(selectMaterialAttempts([available, unavailable, stale], [digestB])).toEqual([available]);
  });
});
