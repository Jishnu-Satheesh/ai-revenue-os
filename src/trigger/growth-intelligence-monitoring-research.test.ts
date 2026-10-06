import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { BriefRevision } from "@/domain/growth-intelligence/brief";
import { MONITORING_UPDATE_RESEARCH_DEADLINE_MS } from "@/modules/growth-intelligence/application/market-monitoring-update";
import {
  briefFixture,
  createFakeDispatch,
  createFakeEvents,
  createFakePersister,
  createFakeProjects,
  createFakeStore,
  createFixtureDb,
  FIXTURE_IDS,
} from "@/modules/growth-intelligence/application/market-monitoring-fixtures";
import {
  buildMonitoringQueryPlan,
  type MonitoringResearchQuery,
} from "@/modules/growth-intelligence/application/market-monitoring-context";
import type { ResearchModelTransport } from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import type { TinyfishSearchTransport } from "@/modules/growth-intelligence/infrastructure/research/tinyfish-search-transport";
import {
  marketMonitoringUpdatePayloadSchema,
  runMarketMonitoringUpdate,
} from "@/workflows/growth-intelligence/run-market-monitoring-update";
import { startMonitoringUpdate } from "@/modules/growth-intelligence/application/market-monitoring-update";

import {
  AGENT_LANE_MAX_COMPETITOR_SLOTS,
  buildMonitoringModelScope,
  createFencedMonitoringUpdateModelSpender,
  createFencedMonitoringUpdateSearchSpender,
  createMonitoringResearchExecutor,
  createQualifiedMonitoringResearcher,
  createSharedMonitoringUpdateBudget,
  deriveMonitoringClaimId,
  MONITORING_UPDATE_MAXIMUM_MICROS_USD_PER_ATTEMPT,
  MONITORING_UPDATE_QUOTE_MICROS_USD,
  type MonitoringAgentLane,
  type MonitoringResearchExecutorDependencies,
  type MonitoringUpdateBudget,
} from "@/trigger/growth-intelligence-monitoring-research";
import type { AgentSlotOutcome } from "@/modules/growth-intelligence/infrastructure/research/tinyfish-agent-adapter";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";

const FIXED_NOW = new Date("2026-09-14T06:00:00.000Z");

const ENV_NAMES = [
  "TINYFISH_SEARCH_API_KEY",
  "TINYFISH_MARKET_RESEARCH_ENABLED",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "RESEARCH_EXTRACTION_MODEL",
  "RESEARCH_SUPPORT_REVIEW_MODEL",
] as const;

let savedEnv: Record<string, string | undefined> = {};

function setEnv(values: Partial<Record<(typeof ENV_NAMES)[number], string | undefined>>): void {
  for (const name of ENV_NAMES) {
    if (!(name in savedEnv)) savedEnv[name] = process.env[name];
    const value = values[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

beforeEach(() => {
  savedEnv = {};
});

function restoreEnv(): void {
  for (const name of ENV_NAMES) {
    const value = savedEnv[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv = {};
}

function qualifiedPersistence(rpcCalls: Array<{ name: string; args: Record<string, unknown> }>) {
  return {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args });
      return {
        data: { provider: "tinyfish", available: true, blockers: [] },
        error: null,
      };
    },
  };
}

function unqualifiedPersistence() {
  return {
    async rpc() {
      return {
        data: { provider: "tinyfish", available: false, blockers: ["controlled_canary_missing"] },
        error: null,
      };
    },
  };
}

function encodeSearchBody(results: Array<Record<string, unknown>>, total?: number): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      query: "q",
      results,
      total_results: total ?? results.length,
      page: 0,
    }),
  );
}

function scriptedSearchTransport(
  handler: (url: string) => { status: number; results: Array<Record<string, unknown>> },
  calls: string[] = [],
): TinyfishSearchTransport {
  return {
    async search(input) {
      calls.push(input.url);
      const response = handler(input.url);
      return { status: response.status, headers: {}, body: encodeSearchBody(response.results) };
    },
  };
}

function twoResults(tag: string): Array<Record<string, unknown>> {
  return [0, 1].map((index) => ({
    url: `https://example.com/${tag}/${index}`,
    title: `Deira tailoring roundup ${tag} ${index}`,
    snippet: `Tailors in Deira stay open past 10pm during Ramadan (${tag}-${index}).`,
  }));
}

function scriptedExtractionTransport(calls: unknown[] = []): ResearchModelTransport {
  return {
    async complete(input) {
      calls.push(input.prompt);
      const prompt = JSON.parse(input.prompt) as {
        sources: Array<{ sourceKey: string; excerptText: string }>;
      };
      // One candidate per cited source would over-claim; the fixture cites
      // the slot-leading sources only so coverage resolves per slot below.
      const sources = prompt.sources;
      const picked = [sources[0], sources[2], sources[4]].filter(
        (source): source is { sourceKey: string; excerptText: string } => !!source,
      );
      const candidates = (picked.length > 0 ? picked : sources.slice(0, 1)).map((source, index) => ({
        candidateKey: `late-night-demand-${index}`,
        subjectKind: "market",
        subjectRef: "Deira late-night tailoring",
        claimKind: "demand_observation",
        paraphrase: `Tailors in Deira stay open past 10pm during Ramadan (${source.sourceKey}).`,
        quotation: null,
        claimCategory: "demand_trend",
        geographicLayer: "city",
        geographyRef: "Deira",
        citations: [
          {
            sourceKey: source.sourceKey,
            spanStart: 0,
            spanEnd: source.excerptText.length,
            quotedText: null,
          },
        ],
        publishedAt: null,
        observedAt: null,
        limitations: [],
      }));
      return { text: JSON.stringify(candidates), usage: { kind: "unknown" }, latencyMs: 5 };
    },
  };
}

function scriptedReviewTransport(): ResearchModelTransport {
  return {
    async complete(input) {
      const prompt = JSON.parse(input.prompt) as { candidates: Array<{ candidateKey: string }> };
      const answers = prompt.candidates.map((candidate) => ({
        candidateKey: candidate.candidateKey,
        verdict: "supported",
        limitations: [],
      }));
      return { text: JSON.stringify(answers), usage: { kind: "unknown" }, latencyMs: 5 };
    },
  };
}

function refusingTransport(): ResearchModelTransport {
  return {
    async complete() {
      throw new Error("Market research model call is not configured.");
    },
  };
}

function executorInput(brief: BriefRevision, queries: MonitoringResearchQuery[]) {
  return {
    organizationId: brief.organizationId,
    projectId: brief.projectId,
    updateId: brief.pinnedToUpdateId ?? FIXTURE_IDS.correlationId,
    briefRevisionId: "71000000-0000-4000-8000-000000000001",
    queries,
    briefIdentity: null,
    deadlineMs: MONITORING_UPDATE_RESEARCH_DEADLINE_MS,
  };
}

function wiredDependencies(
  brief: BriefRevision,
  search: TinyfishSearchTransport,
  options: {
    extraction?: ResearchModelTransport;
    review?: ResearchModelTransport;
    budget?: MonitoringUpdateBudget;
    now?: () => Date;
  } = {},
): MonitoringResearchExecutorDependencies {
  return {
    availability: { available: true, provider: "tinyfish" },
    brief,
    scope: buildMonitoringModelScope({ brief, countryCode: "AE" }),
    budget: options.budget ?? createFakeMonitoringBudget(),
    search: {
      transport: search,
      gate: { isAvailable: () => true },
    },
    extraction: {
      transport: options.extraction ?? scriptedExtractionTransport(),
      budget: {
        phase: "extraction",
        maxCalls: 4,
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
        maxSourcesPerBatch: 10,
      },
      modelId: "test-extraction-model",
    },
    supportReview: {
      transport: options.review ?? scriptedReviewTransport(),
      budget: {
        phase: "support_review",
        maxCalls: 4,
        maxInputTokens: 12_000,
        maxOutputTokens: 4_000,
        maxSourcesPerBatch: 10,
      },
      modelId: "test-review-model",
    },
    now: options.now ?? (() => FIXED_NOW),
  };
}

/**
 * In-memory fenced budget: one reservation per update, replay-safe attempt
 * rows, liability enforced against the admitted quote. Mirrors the SQL
 * contract (replay returns the kept row, over-cap refuses) so wiring tests
 * prove the spend path without a database.
 */
function createFakeMonitoringBudget(
  options: { refuse?: "budget" | "attempt"; spendLimitMicrosUsd?: number } = {},
): MonitoringUpdateBudget & {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  reservations: Map<string, { quoteMicrosUsd: number }>;
  attempts: Map<string, string>;
  liabilityMicrosUsd: number;
} {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const reservations = new Map<string, { quoteMicrosUsd: number }>();
  const attempts = new Map<string, string>();
  const ledger = { liabilityMicrosUsd: 0 };
  let attemptCounter = 0;
  const nextAttemptId = () => {
    attemptCounter += 1;
    return `11111111-1111-4111-8111-1111111111${String(attemptCounter).padStart(2, "0").slice(-2)}`;
  };
  const limit = options.spendLimitMicrosUsd ?? Number.POSITIVE_INFINITY;
  return {
    calls,
    reservations,
    attempts,
    get liabilityMicrosUsd() {
      return ledger.liabilityMicrosUsd;
    },
    async reserveUpdateBudget(input) {
      calls.push({ name: "reserveUpdateBudget", args: { ...input } });
      if (options.refuse === "budget") {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_ALLOWANCE_EXCEEDED",
          "The organization research allowance for today is fully reserved.",
        );
      }
      const existing = reservations.get(input.updateId);
      if (existing) {
        if (existing.quoteMicrosUsd !== input.quoteMicrosUsd) {
          throw new GrowthIntelligenceError(
            "RESEARCH_BUDGET_CONFLICT",
            "This reservation was replayed with different terms.",
          );
        }
        return {
          reservationId: "40000000-0000-4000-8000-000000000004",
          organizationId: input.organizationId,
          updateId: input.updateId,
          allowanceDay: "2026-09-14",
          quoteMicrosUsd: existing.quoteMicrosUsd,
          priceVersion: input.priceVersion,
          replayed: true,
        };
      }
      reservations.set(input.updateId, { quoteMicrosUsd: input.quoteMicrosUsd });
      return {
        reservationId: "40000000-0000-4000-8000-000000000004",
        organizationId: input.organizationId,
        updateId: input.updateId,
        allowanceDay: "2026-09-14",
        quoteMicrosUsd: input.quoteMicrosUsd,
        priceVersion: input.priceVersion,
        replayed: false,
      };
    },
    async reserveUpdateAttempt(input) {
      calls.push({ name: "reserveUpdateAttempt", args: { ...input } });
      if (options.refuse === "attempt") {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_RESERVATION_EXCEEDED",
          "This attempt would exceed the admitted research quote.",
        );
      }
      if (!reservations.has(input.updateId)) {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_UNAVAILABLE",
          "Research spend could not be reserved.",
        );
      }
      const key = `${input.phase}|${input.slotKey}|${input.attemptIndex}`;
      const replayed = attempts.get(key);
      if (replayed) {
        return {
          attemptId: replayed,
          reservationId: "40000000-0000-4000-8000-000000000004",
          allowanceDay: "2026-09-14",
          maximumMicrosUsd: input.maximumMicrosUsd,
          replayed: true,
        };
      }
      if (ledger.liabilityMicrosUsd + input.maximumMicrosUsd > limit) {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_RESERVATION_EXCEEDED",
          "This attempt would exceed the admitted research quote.",
        );
      }
      ledger.liabilityMicrosUsd += input.maximumMicrosUsd;
      const attemptId = nextAttemptId();
      attempts.set(key, attemptId);
      return {
        attemptId,
        reservationId: "40000000-0000-4000-8000-000000000004",
        allowanceDay: "2026-09-14",
        maximumMicrosUsd: input.maximumMicrosUsd,
        replayed: false,
      };
    },
    async settleAttempt(input) {
      calls.push({ name: "settleAttempt", args: { ...input } });
      return {
        attemptId: input.attemptId,
        settlementKind: "unknown" as const,
        actualMicrosUsd: null,
        overrunBlocked: false,
        replayed: false,
      };
    },
  };
}

describe("buildMonitoringModelScope", () => {
  it("builds a valid model scope from approved public brief fields", () => {
    const scope = buildMonitoringModelScope({ brief: briefFixture(), countryCode: "AE" });
    expect(scope.city).toBe("Deira");
    expect(scope.countryCode).toBe("AE");
    expect(scope.publicBusinessName).toBe("Ramadan evening demand");
    expect(scope.topics).toEqual(["demand", "reviews"]);
    expect(scope.competitors.map((competitor) => competitor.name)).toEqual(["Stitch House"]);
    expect(scope.approvedDomains).toEqual([]);
  });

  it("maps competitor websites to public lead urls", () => {
    const scope = buildMonitoringModelScope({
      brief: briefFixture({
        competitors: [
          { name: "Stitch House", website: "https://stitch-house.example.com", source: "suggestion" },
        ],
      }),
      countryCode: "AE",
    });
    expect(scope.competitors[0]).toMatchObject({
      name: "Stitch House",
      publicUrl: "https://stitch-house.example.com/",
    });
  });

  it("refuses a missing or malformed country instead of inventing geography", () => {
    for (const countryCode of [null, "", "USA", "A1"]) {
      expect(() =>
        buildMonitoringModelScope({ brief: briefFixture(), countryCode: countryCode as string | null }),
      ).toThrow();
    }
    expect(
      buildMonitoringModelScope({ brief: briefFixture(), countryCode: " ae " }).countryCode,
    ).toBe("AE");
  });
});

describe("deriveMonitoringClaimId", () => {
  it("derives a stable uuid claim identity from claim content", () => {
    const candidate = {
      subjectKind: "market",
      subjectRef: "Deira late-night tailoring",
      claimKind: "demand_observation",
      paraphrase: "Tailors stay open late.",
      quotation: null,
      claimCategory: "demand_trend",
      geographicLayer: "city",
      geographyRef: "Deira",
      sourceKeys: ["src-0-abcdef123456"],
    };
    const first = deriveMonitoringClaimId(candidate);
    const second = deriveMonitoringClaimId(candidate);
    expect(first).toBe(second);
    expect(first).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const changed = deriveMonitoringClaimId({ ...candidate, paraphrase: "Tailors close early." });
    expect(changed).not.toBe(first);
  });
});

describe("fenced monitoring update spenders", () => {
  const ORGANIZATION_ID = FIXTURE_IDS.organizationId;
  const UPDATE_ID = "91000000-0000-4000-8000-000000000001";

  it("sizes the worst-case call plan inside the admitted quote", () => {
    // 28 search attempts plus 4 extraction plus 4 review calls must fit.
    expect(MONITORING_UPDATE_MAXIMUM_MICROS_USD_PER_ATTEMPT * 36).toBeLessThanOrEqual(
      MONITORING_UPDATE_QUOTE_MICROS_USD,
    );
  });

  it("ensures the update reservation once across all three phases", async () => {
    const budget = createFakeMonitoringBudget();
    const shared = createSharedMonitoringUpdateBudget({
      budget,
      organizationId: ORGANIZATION_ID,
      updateId: UPDATE_ID,
    });
    const ensure = () => shared.ensure();
    const search = createFencedMonitoringUpdateSearchSpender({
      budget,
      organizationId: ORGANIZATION_ID,
      updateId: UPDATE_ID,
      ensureReservation: ensure,
    });
    const extraction = createFencedMonitoringUpdateModelSpender({
      budget,
      organizationId: ORGANIZATION_ID,
      updateId: UPDATE_ID,
      ensureReservation: ensure,
    });
    const review = createFencedMonitoringUpdateModelSpender({
      budget,
      organizationId: ORGANIZATION_ID,
      updateId: UPDATE_ID,
      ensureReservation: ensure,
    });

    const first = await search.reserve({ slotKey: "area:demand", attemptIndex: 0 });
    const second = await extraction.reserve({
      phase: "extraction",
      slotKey: "extraction:batch-0",
      attemptIndex: 0,
    });
    const third = await review.reserve({
      phase: "support_review",
      slotKey: "support-review:batch-0",
      attemptIndex: 0,
    });
    await search.settle({ attemptId: first.attemptId, usage: { kind: "reported", microsUsd: 0 } });

    expect(budget.calls.filter((call) => call.name === "reserveUpdateBudget")).toHaveLength(1);
    expect(budget.calls.filter((call) => call.name === "reserveUpdateBudget")[0]?.args).toMatchObject({
      organizationId: ORGANIZATION_ID,
      updateId: UPDATE_ID,
      quoteMicrosUsd: MONITORING_UPDATE_QUOTE_MICROS_USD,
    });
    const attempts = budget.calls.filter((call) => call.name === "reserveUpdateAttempt");
    expect(attempts).toHaveLength(3);
    for (const attempt of attempts) {
      expect(attempt.args).toMatchObject({
        organizationId: ORGANIZATION_ID,
        updateId: UPDATE_ID,
        phase: "research",
        maximumMicrosUsd: MONITORING_UPDATE_MAXIMUM_MICROS_USD_PER_ATTEMPT,
      });
    }
    expect(new Set([first.attemptId, second.attemptId, third.attemptId]).size).toBe(3);
    expect(budget.calls.filter((call) => call.name === "settleAttempt")).toHaveLength(1);
  });

  it("replays an identical reserve without double booking", async () => {
    const budget = createFakeMonitoringBudget();
    const search = createFencedMonitoringUpdateSearchSpender({
      budget,
      organizationId: ORGANIZATION_ID,
      updateId: UPDATE_ID,
    });

    const first = await search.reserve({ slotKey: "area:demand", attemptIndex: 0 });
    const second = await search.reserve({ slotKey: "area:demand", attemptIndex: 0 });

    // A redelivered run re-books the same attempt rows: two reserve calls,
    // one ledger row, one liability charge.
    expect(second.attemptId).toBe(first.attemptId);
    expect(budget.attempts.size).toBe(1);
    expect(budget.liabilityMicrosUsd).toBe(MONITORING_UPDATE_MAXIMUM_MICROS_USD_PER_ATTEMPT);
  });

  it("refuses spend when the quote is exhausted before any call", async () => {
    const budget = createFakeMonitoringBudget({ refuse: "attempt" });
    const search = createFencedMonitoringUpdateSearchSpender({
      budget,
      organizationId: ORGANIZATION_ID,
      updateId: UPDATE_ID,
    });

    await expect(search.reserve({ slotKey: "area:demand", attemptIndex: 0 })).rejects.toBeInstanceOf(
      GrowthIntelligenceError,
    );
  });

  it("refuses unknown model phases exactly like the fenced spender", async () => {
    const budget = createFakeMonitoringBudget();
    const extraction = createFencedMonitoringUpdateModelSpender({
      budget,
      organizationId: ORGANIZATION_ID,
      updateId: UPDATE_ID,
    });

    await expect(
      extraction.reserve({
        phase: "synthesis" as never,
        slotKey: "synthesis:batch-0",
        attemptIndex: 0,
      }),
    ).rejects.toMatchObject({ code: "RESEARCH_BUDGET_UNAVAILABLE" });
    expect(budget.calls).toEqual([]);
  });
});

describe("createQualifiedMonitoringResearcher", () => {
  it("stays fail-closed with ADAPTER_UNAVAILABLE while the lane is unqualified", async () => {
    setEnv({
      TINYFISH_SEARCH_API_KEY: "test-key",
      TINYFISH_MARKET_RESEARCH_ENABLED: "true",
    });
    try {
      const brief = briefFixture();
      const research = await createQualifiedMonitoringResearcher({
        persistence: unqualifiedPersistence(),
        budget: createFakeMonitoringBudget(),
        organizationId: brief.organizationId,
        brief,
        organizationCountryCode: "AE",
      });
      const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
      expect(outcome).toMatchObject({ status: "failed", code: "ADAPTER_UNAVAILABLE" });
    } finally {
      restoreEnv();
    }
  });

  it("stays fail-closed with ADAPTER_UNAVAILABLE while the kill-switch is closed", async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    setEnv({
      TINYFISH_SEARCH_API_KEY: "test-key",
      TINYFISH_MARKET_RESEARCH_ENABLED: "false",
    });
    try {
      const brief = briefFixture();
      const research = await createQualifiedMonitoringResearcher({
        persistence: qualifiedPersistence(rpcCalls),
        budget: createFakeMonitoringBudget(),
        organizationId: brief.organizationId,
        brief,
        organizationCountryCode: "AE",
      });
      const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
      expect(outcome).toMatchObject({ status: "failed", code: "ADAPTER_UNAVAILABLE" });
    } finally {
      restoreEnv();
    }
  });

  it("checks the tinyfish lane qualification through the fenced RPC", async () => {
    const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
    setEnv({
      TINYFISH_SEARCH_API_KEY: "test-key",
      TINYFISH_MARKET_RESEARCH_ENABLED: "true",
    });
    try {
      const brief = briefFixture();
      await createQualifiedMonitoringResearcher({
        persistence: qualifiedPersistence(rpcCalls),
        budget: createFakeMonitoringBudget(),
        organizationId: brief.organizationId,
        brief,
        organizationCountryCode: "AE",
      });
      expect(rpcCalls[0]).toMatchObject({
        name: "check_research_provider_qualification_for",
        args: { p_provider: "tinyfish" },
      });
    } finally {
      restoreEnv();
    }
  });

  it("fails closed with the staged code when the organization country is missing", async () => {
    const searchCalls: string[] = [];
    setEnv({
      TINYFISH_SEARCH_API_KEY: "test-key",
      TINYFISH_MARKET_RESEARCH_ENABLED: "true",
    });
    try {
      const brief = briefFixture();
      const research = await createQualifiedMonitoringResearcher({
        persistence: qualifiedPersistence([]),
        budget: createFakeMonitoringBudget(),
        organizationId: brief.organizationId,
        brief,
        organizationCountryCode: null,
      });
      const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
      expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
      expect(searchCalls).toEqual([]);
    } finally {
      restoreEnv();
    }
  });
});

describe("createMonitoringResearchExecutor", () => {
  it("refuses a non-null brief identity without spending", async () => {
    const searchCalls: string[] = [];
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport(() => ({ status: 200, results: twoResults("a") }), searchCalls),
      ),
    );
    const outcome = await research({
      ...executorInput(brief, buildMonitoringQueryPlan(brief)),
      briefIdentity: {
        manifestId: null,
        contextDigest: null,
        briefFingerprint: "abc",
      },
    });
    expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
    expect(searchCalls).toEqual([]);
  });

  it("refuses another organization's update without spending", async () => {
    const searchCalls: string[] = [];
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport(() => ({ status: 200, results: twoResults("a") }), searchCalls),
      ),
    );
    const outcome = await research({
      ...executorInput(brief, buildMonitoringQueryPlan(brief)),
      organizationId: FIXTURE_IDS.otherOrganizationId,
    });
    expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
    expect(searchCalls).toEqual([]);
  });

  it("still refuses an over-length query text without spending", async () => {
    const searchCalls: string[] = [];
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport(() => ({ status: 200, results: twoResults("a") }), searchCalls),
      ),
    );
    const queries = buildMonitoringQueryPlan(brief).map((query, index) =>
      index === 0 ? { ...query, text: `${"q".repeat(160)}!` } : query,
    );
    const outcome = await research(executorInput(brief, queries));
    expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
    expect(searchCalls).toEqual([]);
  });

  it("returns succeeded findings with per-slot provenance on a qualified run", async () => {
    const brief = briefFixture();
    const queries = buildMonitoringQueryPlan(brief);
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport((url) => {
          const tag = createHash("sha256").update(url, "utf8").digest("hex").slice(0, 8);
          return { status: 200, results: twoResults(tag) };
        }),
      ),
    );
    const outcome = await research(executorInput(brief, queries));
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(outcome.findings).toHaveLength(3);
    expect(new Set(outcome.findings.map((finding) => finding.slotKey))).toEqual(
      new Set(["area:demand", "area:reviews", "competitor:stitch-house"]),
    );
    expect(outcome.retrievalCoverage).toHaveLength(3);
    expect(
      outcome.retrievalCoverage.every((entry) => entry.outcome === "supported"),
    ).toBe(true);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const claimIds = new Set<string>();
    for (const finding of outcome.findings) {
      expect(finding.citations.length).toBeGreaterThan(0);
      const findingClaimIds = new Set(finding.citations.map((citation) => citation.claimId));
      // One finding carries one derived claim identity across its citations.
      expect(findingClaimIds.size).toBe(1);
      const claimId = finding.citations[0]?.claimId ?? "";
      expect(claimId).toMatch(uuidPattern);
      claimIds.add(claimId);
    }
    expect(claimIds.size).toBe(outcome.findings.length);
    expect(outcome.draftAdvice).toEqual([]);
    expect(outcome.speculativeEstimate).toBeUndefined();
    // Three search attempts plus one extraction and one review call.
    expect(outcome.usages.filter((usage) => usage.kind === "reported")).toHaveLength(3);
    expect(outcome.usages.filter((usage) => usage.kind === "unknown")).toHaveLength(2);
  });

  it("fails closed with the staged code when every slot transport-fails", async () => {
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport(() => ({ status: 500, results: [] })),
      ),
    );
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
    if (outcome.status !== "failed") return;
    expect(outcome.retrievalCoverage).toHaveLength(3);
    expect(outcome.usages.length).toBeGreaterThan(0);
    expect(outcome.usages.every((usage) => usage.kind === "unknown")).toBe(true);
  });

  it("lands healthy-empty when the provider answers with no usable evidence", async () => {
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport(() => ({ status: 200, results: [] })),
      ),
    );
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(outcome.findings).toEqual([]);
    expect(outcome.sources).toEqual([]);
    expect(
      outcome.retrievalCoverage.every((entry) => entry.outcome === "searched_no_usable_evidence"),
    ).toBe(true);
  });

  it("fails closed when the model phases refuse while evidence exists", async () => {
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor(
      wiredDependencies(brief, scriptedSearchTransport(() => ({ status: 200, results: twoResults("a") })), {
        extraction: refusingTransport(),
        review: refusingTransport(),
      }),
    );
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
    if (outcome.status !== "failed") return;
    expect(outcome).not.toHaveProperty("findings");
  });

  it("fails closed when support review refuses while candidates exist", async () => {
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor(
      wiredDependencies(brief, scriptedSearchTransport(() => ({ status: 200, results: twoResults("a") })), {
        review: refusingTransport(),
      }),
    );
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
    expect(outcome).not.toHaveProperty("findings");
  });

  it("lands healthy-empty when review judges every candidate unsupported", async () => {
    const brief = briefFixture();
    const unsupportedReview: ResearchModelTransport = {
      async complete(input) {
        const prompt = JSON.parse(input.prompt) as { candidates: Array<{ candidateKey: string }> };
        return {
          text: JSON.stringify(
            prompt.candidates.map((candidate) => ({
              candidateKey: candidate.candidateKey,
              verdict: "unsupported",
              limitations: [],
            })),
          ),
          usage: { kind: "unknown" },
          latencyMs: 5,
        };
      },
    };
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport((url) => {
          const tag = createHash("sha256").update(url, "utf8").digest("hex").slice(0, 8);
          return { status: 200, results: twoResults(tag) };
        }),
        { review: unsupportedReview },
      ),
    );
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(outcome.findings).toEqual([]);
    expect(
      outcome.retrievalCoverage.every((entry) => entry.outcome === "supported"),
    ).toBe(true);
  });

  it("fails closed with precise coverage when one slot dies and nothing is admitted", async () => {
    const brief = briefFixture();
    let searchCalls = 0;
    const emptyExtraction: ResearchModelTransport = {
      async complete() {
        return { text: "[]", usage: { kind: "unknown" }, latencyMs: 1 };
      },
    };
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport(() => {
          searchCalls += 1;
          // The first slot retrieves evidence; the rest transport-fail, so a
          // partial outage with zero admitted findings must stay retryable.
          return searchCalls === 1
            ? { status: 200, results: twoResults("mix") }
            : { status: 500, results: [] };
        }),
        { extraction: emptyExtraction },
      ),
    );
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
    if (outcome.status !== "failed") return;
    expect(outcome.retrievalCoverage.map((entry) => entry.outcome)).toEqual([
      "supported",
      "failed",
      "failed",
    ]);
  });

  it("refuses paid calls once the admitted quote is exhausted", async () => {
    const searchCalls: string[] = [];
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport(() => ({ status: 200, results: twoResults("a") }), searchCalls),
        { budget: createFakeMonitoringBudget({ spendLimitMicrosUsd: 0 }) },
      ),
    );
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
    // The first reserve exceeds the quote, so no provider call is ever made.
    expect(searchCalls).toEqual([]);
  });

  it("aborts hanging model calls at the research deadline instead of the task timeout", async () => {
    const brief = briefFixture();
    const hangingTransport: ResearchModelTransport = {
      async complete(call: { signal?: AbortSignal }): Promise<never> {
        await new Promise<never>((_, reject) => {
          const timer = setTimeout(() => reject(new Error("model too slow")), 30_000);
          call.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(new Error("model call aborted at the research deadline"));
            },
            { once: true },
          );
          if (call.signal?.aborted) {
            clearTimeout(timer);
            reject(new Error("model call aborted at the research deadline"));
          }
        });
        throw new Error("unreachable: the research deadline always aborts first");
      },
    };
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport((url) => {
          const tag = createHash("sha256").update(url, "utf8").digest("hex").slice(0, 8);
          return { status: 200, results: twoResults(tag) };
        }),
        { extraction: hangingTransport, now: () => new Date() },
      ),
    );
    const startedAt = Date.now();
    const outcome = await research({
      ...executorInput(brief, buildMonitoringQueryPlan(brief)),
      deadlineMs: 1_000,
    });
    const elapsedMs = Date.now() - startedAt;
    // Failed closed at the ~1s research deadline, not the 30s model hang and
    // far inside the 300s task envelope.
    expect(outcome).toMatchObject({ status: "failed", code: "RESEARCH_EXECUTION_UNAVAILABLE" });
    expect(elapsedMs).toBeLessThan(15_000);
  });

  it("answers cancelled when the run signal is already aborted", async () => {
    const searchCalls: string[] = [];
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        brief,
        scriptedSearchTransport(() => ({ status: 200, results: twoResults("a") }), searchCalls),
      ),
    );
    const controller = new AbortController();
    controller.abort();
    const outcome = await research({
      ...executorInput(brief, buildMonitoringQueryPlan(brief)),
      signal: controller.signal,
    });
    expect(outcome).toEqual({ status: "cancelled" });
    expect(searchCalls).toEqual([]);
  });
});

describe("agent fallback lane (Task 3)", () => {
  function briefWithWebsites(names: string[]) {
    return briefFixture({
      competitors: names.map((name) => ({
        name,
        website: `https://${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.example.com`,
        source: "suggestion" as const,
      })),
    });
  }

  function fakeAgentLane(
    calls: Array<{ url: string; competitorName: string; fields: string[] }>,
    handler: (input: { url: string; competitorName: string; fields: string[] }) => AgentSlotOutcome,
    enabled = true,
  ): MonitoringAgentLane {
    return {
      enabled,
      runner: {
        async runCompetitorSlot(input) {
          calls.push({ url: input.url, competitorName: input.competitorName, fields: input.fields });
          return handler(input);
        },
      },
    };
  }

  it("stays search-only when the lane is disabled (opt-out bit-for-bit)", async () => {
    const searchCalls: string[] = [];
    const agentCalls: Array<{ url: string; competitorName: string; fields: string[] }> = [];
    const brief = briefWithWebsites(["Stitch House"]);
    const research = createMonitoringResearchExecutor({
      ...wiredDependencies(
        brief,
        scriptedSearchTransport(() => ({ status: 200, results: twoResults("a") }), searchCalls),
      ),
      agentLane: fakeAgentLane(agentCalls, () => ({
        status: "ok",
        data: { demand: "late" },
        runId: "run-should-not-happen",
      }), false),
    });
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(outcome.status).toBe("succeeded");
    expect(agentCalls).toEqual([]);
    // 2 areas + 1 competitor, all on search.
    expect(searchCalls).toHaveLength(3);
  });

  it("routes opted-in competitor slots through the seam and keeps topics on search", async () => {
    const searchCalls: string[] = [];
    const agentCalls: Array<{ url: string; competitorName: string; fields: string[] }> = [];
    const brief = briefWithWebsites(["Stitch House"]);
    const research = createMonitoringResearchExecutor({
      ...wiredDependencies(
        brief,
        scriptedSearchTransport((url) => {
          const tag = createHash("sha256").update(url, "utf8").digest("hex").slice(0, 8);
          return { status: 200, results: twoResults(tag) };
        }, searchCalls),
      ),
      agentLane: fakeAgentLane(agentCalls, (input) => ({
        status: "ok",
        data: { demand: `agent evidence for ${input.competitorName}`, reviews: "4.8 stars" },
        runId: "run-agent-1",
      })),
    });
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(AGENT_LANE_MAX_COMPETITOR_SLOTS).toBe(2);
    expect(agentCalls).toHaveLength(1);
    expect(agentCalls[0]?.competitorName).toBe("Stitch House");
    expect(agentCalls[0]?.url).toBe("https://stitch-house.example.com/");
    expect(agentCalls[0]?.fields).toEqual(["demand", "reviews"]);
    // Topics stay on search; the competitor slot skips search.
    expect(searchCalls).toHaveLength(2);
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    const competitorCoverage = outcome.retrievalCoverage.find((entry) => entry.slotKey.startsWith("competitor:"));
    expect(competitorCoverage?.outcome).toBe("supported");
  });

  it("falls back to search-only when the gate is closed even when opted in", async () => {
    const agentCalls: Array<{ url: string; competitorName: string; fields: string[] }> = [];
    setEnv({
      TINYFISH_SEARCH_API_KEY: "test-key",
      TINYFISH_MARKET_RESEARCH_ENABLED: "false",
    });
    try {
      const brief = briefWithWebsites(["Stitch House"]);
      const research = await createQualifiedMonitoringResearcher({
        persistence: qualifiedPersistence([]),
        budget: createFakeMonitoringBudget(),
        organizationId: brief.organizationId,
        brief,
        organizationCountryCode: "AE",
        agentLaneOptIn: true,
        agentLane: fakeAgentLane(agentCalls, () => ({
          status: "ok",
          data: { demand: "late" },
          runId: "run-agent-1",
        })),
      });
      const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
      expect(outcome).toMatchObject({ status: "failed", code: "ADAPTER_UNAVAILABLE" });
      expect(agentCalls).toEqual([]);
    } finally {
      restoreEnv();
    }
  });

  it("settles blocked agent outcomes to the no-evidence path with the runId kept", async () => {
    const searchCalls: string[] = [];
    const agentCalls: Array<{ url: string; competitorName: string; fields: string[] }> = [];
    const brief = briefWithWebsites(["Stitch House"]);
    const research = createMonitoringResearchExecutor({
      ...wiredDependencies(
        brief,
        scriptedSearchTransport((url) => {
          const tag = createHash("sha256").update(url, "utf8").digest("hex").slice(0, 8);
          return { status: 200, results: twoResults(tag) };
        }, searchCalls),
      ),
      agentLane: fakeAgentLane(agentCalls, () => ({
        status: "blocked",
        data: { blocked: true },
        runId: "run-blocked-1",
      })),
    });
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(agentCalls).toHaveLength(1);
    expect(searchCalls).toHaveLength(2);
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    const competitorCoverage = outcome.retrievalCoverage.find((entry) => entry.slotKey.startsWith("competitor:"));
    expect(competitorCoverage?.outcome).toBe("searched_no_usable_evidence");
    // Blocked agent evidence never invents a finding: every finding traces to a
    // searched topic slot, never to the blocked competitor slot.
    for (const finding of outcome.findings) {
      expect(finding.slotKey.startsWith("area:")).toBe(true);
    }
  });

  it("keeps the third competitor slot on search (R4 cap at 2)", async () => {
    const searchCalls: string[] = [];
    const agentCalls: Array<{ url: string; competitorName: string; fields: string[] }> = [];
    const brief = briefWithWebsites(["Alpha Tailors", "Beta Stitch", "Gamma Sew"]);
    const research = createMonitoringResearchExecutor({
      ...wiredDependencies(
        brief,
        scriptedSearchTransport((url) => {
          const tag = createHash("sha256").update(url, "utf8").digest("hex").slice(0, 8);
          return { status: 200, results: twoResults(tag) };
        }, searchCalls),
      ),
      agentLane: fakeAgentLane(agentCalls, (input) => ({
        status: "ok",
        data: { demand: `agent evidence for ${input.competitorName}` },
        runId: `run-${input.competitorName}`,
      })),
    });
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    // First 2 competitor slots go to the agent; the 3rd stays on search.
    expect(agentCalls.map((call) => call.competitorName)).toEqual(["Alpha Tailors", "Beta Stitch"]);
    // 2 areas + 3rd competitor on search.
    expect(searchCalls).toHaveLength(3);
    expect(outcome.status).toBe("succeeded");
    if (outcome.status !== "succeeded") return;
    expect(outcome.retrievalCoverage).toHaveLength(5);
    expect(
      outcome.retrievalCoverage.filter((entry) => entry.outcome === "supported"),
    ).toHaveLength(5);
  });

  it("falls back to search when the competitor has no public URL", async () => {
    const searchCalls: string[] = [];
    const agentCalls: Array<{ url: string; competitorName: string; fields: string[] }> = [];
    // Default fixture competitor carries no website, so the lane cannot run it.
    const brief = briefFixture();
    const research = createMonitoringResearchExecutor({
      ...wiredDependencies(
        brief,
        scriptedSearchTransport(() => ({ status: 200, results: twoResults("a") }), searchCalls),
      ),
      agentLane: fakeAgentLane(agentCalls, () => ({
        status: "ok",
        data: { demand: "late" },
        runId: "run-agent-1",
      })),
    });
    const outcome = await research(executorInput(brief, buildMonitoringQueryPlan(brief)));
    expect(agentCalls).toEqual([]);
    expect(searchCalls).toHaveLength(3);
    expect(outcome.status).toBe("succeeded");
  });
});

async function startedUpdate() {
  const db = createFixtureDb();
  const events = createFakeEvents();
  const dispatch = createFakeDispatch();
  const projects = createFakeProjects(db);
  const updates = createFakeStore(db);
  const started = await startMonitoringUpdate(
    {
      organizationId: FIXTURE_IDS.organizationId,
      branchId: FIXTURE_IDS.branchId,
      title: "Ramadan evening demand",
      question: "How does demand for late-night tailoring change during Ramadan?",
      mode: "one-time",
      researchArea: "Deira",
      competitors: [{ name: "Stitch House", source: "suggestion" }],
      investigationAreas: ["demand", "reviews"],
      businessContextSnapshotId: FIXTURE_IDS.snapshotId,
      actorId: FIXTURE_IDS.actorId,
      idempotencyKey: "worker-start-1",
      correlationId: FIXTURE_IDS.correlationId,
    },
    {
      projects,
      updates,
      dispatch,
      events,
      now: () => FIXED_NOW,
      newUpdateId: () => "91000000-0000-4000-8000-000000000001",
      newRevisionId: () => "71000000-0000-4000-8000-000000000001",
    },
  );
  if (started.outcome !== "started") throw new Error("fixture start failed");
  const nudge = dispatch.nudges[0];
  if (!nudge) throw new Error("fixture nudge missing");
  const payload = marketMonitoringUpdatePayloadSchema.parse({
    organizationId: nudge.organizationId,
    projectId: nudge.projectId,
    updateId: nudge.updateId,
    briefRevisionId: nudge.briefRevisionId,
    brief: nudge.brief,
    actorId: nudge.actorId,
    correlationId: nudge.correlationId,
  });
  return { db, events, updates, payload };
}

describe("monitoring executor through runMarketMonitoringUpdate", () => {
  it("persists evidence and lands ready on a qualified run", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    const persister = createFakePersister(db);
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        payload.brief,
        scriptedSearchTransport((url) => {
          const tag = createHash("sha256").update(url, "utf8").digest("hex").slice(0, 8);
          return { status: 200, results: twoResults(tag) };
        }),
      ),
    );

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research,
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: () => ({
        reportId: "a0000000-0000-4000-8000-00000000000a",
        reportVersionId: "b0000000-0000-4000-8000-00000000000b",
      }),
    });

    expect(result).toMatchObject({
      outcome: "ready",
      reportVersionId: "b0000000-0000-4000-8000-00000000000b",
    });
    expect(persister.persistCalls).toBe(1);
    const row = db.reports.get("b0000000-0000-4000-8000-00000000000b");
    expect(row).toBeDefined();
    const content = row?.content as {
      findings: Array<{ statement: string }>;
      briefRevisionId: string;
      evidenceDigest: string;
    };
    expect(content.findings).toHaveLength(3);
    expect(content.briefRevisionId).toBe(payload.briefRevisionId);
    expect(row?.evidenceDigest).toBe(content.evidenceDigest);
    const record = await updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: payload.updateId,
    });
    expect(record?.status).toBe("ready");
    expect(record?.reportVersionId).toBe("b0000000-0000-4000-8000-00000000000b");
    const names = events.events.map((event) => event.eventName);
    expect(names).toContain("market_research.completed");
    expect(names).toContain("growth_intelligence.synthesized");
  });

  it("lands research_failed with the staged code and keeps the prior report on outage", async () => {
    const { db, events, updates, payload } = await startedUpdate();
    db.reports.set("c0000000-0000-4000-8000-00000000000c", {
      reportVersionId: "c0000000-0000-4000-8000-00000000000c",
      content: { reportVersionId: "c0000000-0000-4000-8000-00000000000c" },
      evidenceDigest: "prior-digest",
    });
    const persister = createFakePersister(db);
    const research = createMonitoringResearchExecutor(
      wiredDependencies(
        payload.brief,
        scriptedSearchTransport(() => ({ status: 500, results: [] })),
      ),
    );

    const result = await runMarketMonitoringUpdate(payload, {
      updates,
      research,
      reports: persister,
      events,
      now: () => FIXED_NOW,
      newReportIds: () => ({
        reportId: "a0000000-0000-4000-8000-00000000000a",
        reportVersionId: "b0000000-0000-4000-8000-00000000000b",
      }),
    });

    expect(result).toMatchObject({ outcome: "research_failed", reportVersionId: null });
    expect(persister.persistCalls).toBe(0);
    // The prior successful report stands untouched; nothing invented.
    expect(db.reports.get("c0000000-0000-4000-8000-00000000000c")).toBeDefined();
    expect(db.reports.has("b0000000-0000-4000-8000-00000000000b")).toBe(false);
    const record = await updates.get({
      organizationId: FIXTURE_IDS.organizationId,
      updateId: payload.updateId,
    });
    expect(record?.status).toBe("research_failed");
    expect(record?.reportVersionId).toBeNull();
    const failed = events.events.find((event) => event.eventName === "market_research.failed");
    expect(failed?.payload).toMatchObject({
      phase: "research",
      code: "RESEARCH_EXECUTION_UNAVAILABLE",
      reportVersionId: null,
    });
  });
});
