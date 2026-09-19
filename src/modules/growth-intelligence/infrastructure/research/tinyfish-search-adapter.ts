import "server-only";

import { createHash } from "node:crypto";
import { parse as parseDomain } from "tldts";
import { z } from "zod";

import {
  GrowthIntelligenceError,
  type GrowthIntelligenceErrorCode,
} from "@/domain/growth-intelligence/errors";
import {
  RESEARCH_BUDGET_LIMITS,
  type ResearchAttemptUsage,
  type ResearchCoverageEntry,
  type ResearchCoverageOutcome,
} from "@/domain/growth-intelligence/research-pipeline";
import {
  researchRetrievalResultSchema,
  researchRequestSchema,
  type ResearchAdapter,
  type ResearchRetrievedSource,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import {
  buildResearchQuerySlots,
  type ResearchQuerySlot,
} from "@/modules/growth-intelligence/infrastructure/research/query-plan";
import { QUALIFIED_TINYFISH_RESEARCH_PROVIDER } from "@/modules/growth-intelligence/infrastructure/research/qualified-provider";
import {
  normalizePublicCitationUrl,
  PublicHttpError,
} from "@/modules/growth-intelligence/infrastructure/research/safe-public-http";
import {
  TINYFISH_SEARCH_ENDPOINT,
  type TinyfishSearchTransport,
} from "@/modules/growth-intelligence/infrastructure/research/tinyfish-search-transport";

/** API redirects are never followed: any 3xx fails its attempt outright. */
export const TINYFISH_SEARCH_MAX_REDIRECTS = 0;

/** Eight-minute research deadline inside the ten-minute lease. */
export const TINYFISH_SEARCH_DEADLINE_MS = 8 * 60_000;

const MAX_QUERY_CHARACTERS = 160;

const tinyfishSearchResultSchema = z
  .object({
    position: z.number().int().min(1).nullish(),
    site_name: z.string().max(253).nullish(),
    title: z.string().max(500).nullish(),
    snippet: z.string().max(8_000).nullish(),
    url: z.string().min(1).max(2_048),
    publisher: z.string().max(500).nullish(),
    date: z.string().max(64).nullish(),
  })
  .passthrough();

const tinyfishSearchResponseSchema = z
  .object({
    query: z.string().max(500).nullish(),
    results: z.array(tinyfishSearchResultSchema),
    total_results: z.number().int().min(0).nullish(),
    page: z.number().int().min(0).nullish(),
  })
  .passthrough();

/**
 * Spend seam over the Task 5 budget boundary. The fenced reserve RPC
 * re-asserts provider qualification server-side (fail-closed), so gating is
 * per-call rather than admission-only; the runner still stops on the first
 * refusal and treats it as revocation.
 */
export type TinyfishSearchSpender = {
  reserve(input: { slotKey: string; attemptIndex: number }): Promise<{ attemptId: string }>;
  settle(input: { attemptId: string; usage: ResearchAttemptUsage }): Promise<void>;
};

/** Kill-switch seam, re-checked before every call including retries and pages. */
export type TinyfishSearchGate = {
  isAvailable(): boolean;
};

const attemptIdSchema = z.string().uuid();

export type TinyfishSearchAttemptRecord = {
  attemptId: string;
  slotKey: string;
  usage: ResearchAttemptUsage;
};

/**
 * Durable run state. Everything the bounds depend on travels here, so a
 * restarted worker resumes within the same ceilings: attempt indexes continue
 * (replay-safe), consumed retries/bytes accumulate, the original start time
 * is inherited (no fresh deadline per resume), and completed observations
 * (supported / searched_no_usable_evidence) are never re-called. Only
 * incomplete slots (not_started, failed, skipped_*) run again.
 */
export type TinyfishSearchDurableState = {
  attempts: TinyfishSearchAttemptRecord[];
  coverage: ResearchCoverageEntry[];
  sources: ResearchRetrievedSource[];
  consumedResponseBytes: number;
  consumedRetries: number;
  sourceUrls: string[];
  startedAt: number;
};

export type TinyfishSearchStopReason =
  | "completed"
  | "attempt_ceiling"
  | "byte_budget"
  | "source_budget"
  | "deadline"
  | "budget_exhausted"
  | "reservation_failed"
  | "settlement_failed"
  | "policy_revoked"
  | "claim_lost"
  | "cancelled";

export type TinyfishSearchRunStats = {
  callsIssued: number;
  bytesReceived: number;
  resultsSeen: number;
  duplicatesDropped: number;
  unsafeDropped: number;
  emptyExcerptsDropped: number;
};

export type TinyfishSearchRunInput = {
  request: unknown;
  plan: ResearchQuerySlot[];
  transport: TinyfishSearchTransport;
  spender: TinyfishSearchSpender;
  gate: TinyfishSearchGate;
  resumeFrom?: TinyfishSearchDurableState;
  deadlineMs?: number;
  now?: () => Date;
  signal?: AbortSignal;
};

export type TinyfishSearchRunOutput = {
  result: z.infer<typeof researchRetrievalResultSchema>;
  stopReason: TinyfishSearchStopReason;
  claimLost: boolean;
  durableState: TinyfishSearchDurableState;
  stats: TinyfishSearchRunStats;
};

/**
 * Builds the fixed-endpoint request for one slot page against the real
 * TinyFish Search API contract (required `query`, 0-based `page` max 10,
 * no count/page-size parameter). Only the bounded public query text and
 * the page number travel as encoded params: no business reports, customer
 * data, credentials, or scope internals are ever sent. Location/language
 * stay omitted so the provider applies its US/en defaults (minimal
 * egress). maxResults is the caller's client-side slice cap — validated
 * here, never sent.
 */
export function buildTinyfishSearchRequestUrl(
  query: { text: string } | string,
  maxResults: number,
  page = 0,
): string {
  const text = typeof query === "string" ? query : query.text;
  if (text.length < 1 || text.length > MAX_QUERY_CHARACTERS) {
    throw new Error("Tinyfish search query text must stay within its bound.");
  }
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > RESEARCH_BUDGET_LIMITS.maxResultsPerQuery) {
    throw new Error("Tinyfish search result count must stay within its bound.");
  }
  if (!Number.isInteger(page) || page < 0 || page > 10) {
    throw new Error("Tinyfish search page must stay within its bound.");
  }
  // String-built so the serialized form keeps the bare `endpoint?...`
  // shape the transport allowlist asserts (new URL would insert a `/`
  // path before the query string and fail the prefix check).
  const params = new URLSearchParams();
  params.set("query", text);
  params.set("page", String(page));
  const built = `${TINYFISH_SEARCH_ENDPOINT}?${params.toString()}`;
  if (!built.startsWith(`${TINYFISH_SEARCH_ENDPOINT}?`)) {
    throw new Error("Tinyfish search requests must stay on the allowlisted endpoint.");
  }
  return built;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

const RESUMABLE_OUTCOMES: ReadonlySet<ResearchCoverageOutcome> = new Set([
  "not_started",
  "failed",
  "skipped_budget",
  "skipped_policy",
]);

const BUDGET_EXHAUSTED_CODES: ReadonlySet<GrowthIntelligenceErrorCode> = new Set([
  "RESEARCH_BUDGET_ALLOWANCE_EXCEEDED",
  "RESEARCH_BUDGET_RESERVATION_EXCEEDED",
  "RESEARCH_BUDGET_OVERRUN_BLOCKED",
]);

function emptyDurableState(startedAt: number): TinyfishSearchDurableState {
  return {
    attempts: [],
    coverage: [],
    sources: [],
    consumedResponseBytes: 0,
    consumedRetries: 0,
    sourceUrls: [],
    startedAt,
  };
}

function cloneDurableState(state: TinyfishSearchDurableState): TinyfishSearchDurableState {
  return {
    attempts: state.attempts.map((attempt) => ({ ...attempt })),
    coverage: state.coverage.map((entry) => ({
      ...entry,
      attemptIds: [...entry.attemptIds],
      acceptedClaimIds: [...entry.acceptedClaimIds],
    })),
    sources: state.sources.map((source) => ({ ...source })),
    consumedResponseBytes: state.consumedResponseBytes,
    consumedRetries: state.consumedRetries,
    sourceUrls: [...state.sourceUrls],
    startedAt: state.startedAt,
  };
}

/**
 * Resolves a coverage key against the run plan. Coverage always follows the
 * plan, so a miss is a programmer error that fails closed instead of
 * mislabeling a skipped slot.
 */
export function requirePlannedTinyfishSlot(
  plan: readonly ResearchQuerySlot[],
  slotKey: string,
): ResearchQuerySlot {
  const planned = plan.find((slot) => slot.slotKey === slotKey);
  if (!planned) throw new Error("Tinyfish search coverage must follow the run plan.");
  return planned;
}

function excerptTotalCharacters(sources: readonly ResearchRetrievedSource[]): number {
  return sources.reduce((total, source) => total + source.excerptText.length, 0);
}

function isGrowthIntelligenceError(error: unknown): error is GrowthIntelligenceError {
  return error instanceof GrowthIntelligenceError;
}

/**
 * Cross-checks a provider site_name against the registrable domain of the
 * normalized citation URL. Attribution is never trusted from the provider
 * payload: a blank site_name skips the check, otherwise the hostname must
 * equal the claimed site or sit under it. A mismatch fails the candidate
 * outright instead of laundering a spoofed attribution into evidence.
 */
function siteNameMatchesCitation(siteName: string, hostname: string, registrableDomain: string): boolean {
  const claimed = siteName.trim().toLowerCase().replace(/\.+$/, "");
  if (claimed.length === 0) return true;
  const host = hostname.toLowerCase();
  const site = claimed.startsWith("www.") ? claimed.slice(4) : claimed;
  if (site.length === 0) return true;
  return (
    host === site ||
    host.endsWith(`.${site}`) ||
    registrableDomain === site ||
    registrableDomain.endsWith(`.${site}`)
  );
}

/**
 * Runs the full-coverage plan with reservation-before-call: every provider
 * call reserves its worst case first and settles explicitly afterwards.
 * Unknown cost (timeout, transport failure, rejected response) stays reserved,
 * never converts to zero. Success settles the synthetic reported receipt.
 *
 * Snippet-only retrieval: citations are normalized, never fetched. Each slot
 * pages through `page` until it holds maxResultsPerQuery sources, the page
 * carries no further evidence, or an attempt/byte/source ceiling binds. Every
 * page is its own reserved attempt, so paging consumes the same 28-attempt
 * ceiling as retries.
 */
export async function runTinyfishSearchResearch(
  input: TinyfishSearchRunInput,
): Promise<TinyfishSearchRunOutput> {
  const request = researchRequestSchema.parse(input.request);
  // The run plan is authoritative for coverage: request.maxQueries is the
  // legacy trigger ceiling (1–3) and cannot bound this run's cost. The
  // 26-slot plan cap above is the enforced ceiling.
  if (input.plan.length < 1 || input.plan.length > RESEARCH_BUDGET_LIMITS.maxPrimarySearches) {
    throw new Error("Tinyfish search runs exactly the planned primary slots.");
  }
  const planKeys = input.plan.map((slot) => slot.slotKey);
  if (new Set(planKeys).size !== planKeys.length) {
    throw new Error("Tinyfish search slots must be keyed uniquely.");
  }

  const now = input.now ?? (() => new Date());
  const deadlineMs = input.deadlineMs ?? TINYFISH_SEARCH_DEADLINE_MS;
  const startedAt = input.resumeFrom ? input.resumeFrom.startedAt : now().getTime();
  const state = input.resumeFrom
    ? cloneDurableState(input.resumeFrom)
    : emptyDurableState(startedAt);
  const seenUrls = new Set(state.sourceUrls);
  const stats: TinyfishSearchRunStats = {
    callsIssued: 0,
    bytesReceived: 0,
    resultsSeen: 0,
    duplicatesDropped: 0,
    unsafeDropped: 0,
    emptyExcerptsDropped: 0,
  };

  const maxAttempts =
    RESEARCH_BUDGET_LIMITS.maxPrimarySearches + RESEARCH_BUDGET_LIMITS.maxRetryAttempts;
  let stopReason: TinyfishSearchStopReason = "completed";
  let claimLost = false;
  let stopped = false;

  const coverageBySlot = new Map(state.coverage.map((entry) => [entry.slotKey, entry]));
  const recordSlot = (
    slot: ResearchQuerySlot,
    outcome: ResearchCoverageOutcome,
    attemptIds: readonly string[],
  ) => {
    const entry: ResearchCoverageEntry = {
      slotKey: slot.slotKey,
      kind: slot.kind,
      outcome,
      attemptIds: [...attemptIds],
      acceptedClaimIds: [],
    };
    state.coverage.push(entry);
    coverageBySlot.set(slot.slotKey, entry);
  };
  const markRemaining = (slotKeys: readonly string[], outcome: ResearchCoverageOutcome) => {
    for (const slotKey of slotKeys) {
      if (!coverageBySlot.has(slotKey)) {
        recordSlot(requirePlannedTinyfishSlot(input.plan, slotKey), outcome, []);
      }
    }
  };

  const settleUnknown = async (attemptId: string): Promise<boolean> => {
    try {
      await input.spender.settle({ attemptId, usage: { kind: "unknown" } });
      return true;
    } catch {
      return false;
    }
  };

  const settleReported = async (attemptId: string): Promise<boolean> => {
    try {
      await input.spender.settle({ attemptId, usage: { kind: "reported", microsUsd: 0 } });
      return true;
    } catch {
      return false;
    }
  };

  /** Fail-closed stop on a settlement refusal: the attempt stays unknown. */
  const stopOnSettlementFailure = (
    slot: ResearchQuerySlot,
    slotAttemptIds: readonly string[],
    remainingKeys: readonly string[],
  ) => {
    recordSlot(slot, "failed", slotAttemptIds);
    stopReason = "settlement_failed";
    stopped = true;
    markRemaining(remainingKeys, "not_started");
  };

  /**
   * Fail-closed stop inside a slot: the current slot keeps its attempt links
   * (failed unless policy/budget decides its code), untouched slots keep the
   * matching skipped/not-started code.
   */
  const stopMidSlot = (
    reason: TinyfishSearchStopReason,
    slot: ResearchQuerySlot,
    slotAttemptIds: readonly string[],
    remainingKeys: readonly string[],
    currentOutcome: ResearchCoverageOutcome,
  ) => {
    recordSlot(slot, currentOutcome, slotAttemptIds);
    stopReason = reason;
    stopped = true;
    markRemaining(
      remainingKeys,
      reason === "policy_revoked"
        ? "skipped_policy"
        : reason === "budget_exhausted"
          ? "skipped_budget"
          : "not_started",
    );
  };

  for (const slot of input.plan) {
    if (stopped) break;
    const existing = coverageBySlot.get(slot.slotKey);
    if (existing && !RESUMABLE_OUTCOMES.has(existing.outcome)) continue;
    if (existing) {
      coverageBySlot.delete(slot.slotKey);
      state.coverage = state.coverage.filter((entry) => entry.slotKey !== slot.slotKey);
    }

    const remainingKeys = input.plan
      .slice(input.plan.indexOf(slot) + 1)
      .map((later) => later.slotKey);

    const slotAttemptIds: string[] = [];
    let slotDone = false;
    let slotSupported = 0;
    let slotExhausted = false;
    let page = 0;
    let resultsSeenThisSlot = 0;

    while (!slotDone && !stopped) {
      if (input.signal?.aborted) {
        stopMidSlot("cancelled", slot, slotAttemptIds, remainingKeys, "failed");
        break;
      }
      if (now().getTime() - startedAt > deadlineMs) {
        stopMidSlot(
          "deadline",
          slot,
          slotAttemptIds,
          remainingKeys,
          slotAttemptIds.length > 0 ? "failed" : "not_started",
        );
        break;
      }
      if (state.attempts.length >= maxAttempts) {
        stopMidSlot(
          "attempt_ceiling",
          slot,
          slotAttemptIds,
          remainingKeys,
          slotAttemptIds.length > 0 ? "failed" : "not_started",
        );
        break;
      }
      if (state.consumedResponseBytes >= RESEARCH_BUDGET_LIMITS.maxStreamedBytesTotal) {
        stopMidSlot(
          "byte_budget",
          slot,
          slotAttemptIds,
          remainingKeys,
          slotAttemptIds.length > 0 ? "failed" : "not_started",
        );
        break;
      }
      if (
        state.sources.length >= RESEARCH_BUDGET_LIMITS.maxRetainedSources ||
        excerptTotalCharacters(state.sources) >= RESEARCH_BUDGET_LIMITS.maxTotalExcerptCharacters
      ) {
        stopMidSlot(
          "source_budget",
          slot,
          slotAttemptIds,
          remainingKeys,
          slotAttemptIds.length > 0 ? "failed" : "not_started",
        );
        break;
      }
      if (!input.gate.isAvailable()) {
        stopMidSlot("policy_revoked", slot, slotAttemptIds, remainingKeys, "skipped_policy");
        break;
      }

      const attemptIndex = state.attempts.length;
      let attemptId: string;
      try {
        const reserved = await input.spender.reserve({ slotKey: slot.slotKey, attemptIndex });
        attemptId = attemptIdSchema.parse(reserved.attemptId);
      } catch (error) {
        if (isGrowthIntelligenceError(error)) {
          if (BUDGET_EXHAUSTED_CODES.has(error.code)) {
            stopMidSlot("budget_exhausted", slot, slotAttemptIds, remainingKeys, "skipped_budget");
            break;
          }
          if (error.code === "RESEARCH_PROVIDER_NOT_QUALIFIED") {
            stopMidSlot("policy_revoked", slot, slotAttemptIds, remainingKeys, "skipped_policy");
            break;
          }
          if (error.code === "RESEARCH_BUDGET_LEASE_STALE") {
            claimLost = true;
            stopMidSlot(
              "claim_lost",
              slot,
              slotAttemptIds,
              remainingKeys,
              slotAttemptIds.length > 0 ? "failed" : "not_started",
            );
            break;
          }
        }
        stopMidSlot(
          "reservation_failed",
          slot,
          slotAttemptIds,
          remainingKeys,
          slotAttemptIds.length > 0 ? "failed" : "not_started",
        );
        break;
      }
      slotAttemptIds.push(attemptId);
      state.attempts.push({ attemptId, slotKey: slot.slotKey, usage: { kind: "unknown" } });
      const record = state.attempts[state.attempts.length - 1]!;

      const timeoutMs = Math.min(request.timeoutMs, 20_000);
      const remainingStreamBudget =
        RESEARCH_BUDGET_LIMITS.maxStreamedBytesTotal - state.consumedResponseBytes;
      const maxResponseBytes = Math.min(request.maxResponseBytes, remainingStreamBudget);
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const abortSignal = input.signal
        ? AbortSignal.any([input.signal, timeoutSignal])
        : timeoutSignal;

      const remainingForSlot = Math.min(
        slot.maxResults,
        RESEARCH_BUDGET_LIMITS.maxResultsPerQuery,
      ) - slotSupported;

      let response: { status: number; headers: Record<string, string>; body: Uint8Array };
      try {
        const url = buildTinyfishSearchRequestUrl(slot, remainingForSlot, page);
        stats.callsIssued += 1;
        response = await input.transport.search({
          url,
          timeoutMs,
          maxResponseBytes,
          abortSignal,
        });
      } catch {
        // The TinyFish transport throws on timeout and over-byte-bound
        // bodies instead of returning: a throw is a failed attempt like any
        // other — settle unknown, consume the attempt, never crash the run.
        record.usage = { kind: "unknown" };
        if (!(await settleUnknown(attemptId))) {
          stopOnSettlementFailure(slot, slotAttemptIds, remainingKeys);
          break;
        }
        if (input.signal?.aborted) {
          stopMidSlot("cancelled", slot, slotAttemptIds, remainingKeys, "failed");
          break;
        }
        slotDone = true;
        break;
      }

      state.consumedResponseBytes += response.body.byteLength;
      stats.bytesReceived += response.body.byteLength;

      const retryable =
        response.status === 429 || (response.status >= 500 && response.status <= 599);
      if (retryable) {
        record.usage = { kind: "unknown" };
        if (!(await settleUnknown(attemptId))) {
          stopOnSettlementFailure(slot, slotAttemptIds, remainingKeys);
          break;
        }
        if (state.consumedRetries < RESEARCH_BUDGET_LIMITS.maxRetryAttempts) {
          state.consumedRetries += 1;
          continue;
        }
        slotDone = true;
        break;
      }

      if (response.status !== 200) {
        record.usage = { kind: "unknown" };
        if (!(await settleUnknown(attemptId))) {
          stopOnSettlementFailure(slot, slotAttemptIds, remainingKeys);
          break;
        }
        slotDone = true;
        break;
      }

      if (response.body.byteLength > maxResponseBytes) {
        record.usage = { kind: "unknown" };
        if (!(await settleUnknown(attemptId))) {
          stopOnSettlementFailure(slot, slotAttemptIds, remainingKeys);
          break;
        }
        slotDone = true;
        break;
      }

      let parsed: z.infer<typeof tinyfishSearchResponseSchema>;
      try {
        const text = new TextDecoder().decode(response.body);
        parsed = tinyfishSearchResponseSchema.parse(JSON.parse(text));
      } catch {
        record.usage = { kind: "unknown" };
        if (!(await settleUnknown(attemptId))) {
          stopOnSettlementFailure(slot, slotAttemptIds, remainingKeys);
          break;
        }
        slotDone = true;
        break;
      }

      // The attempt stays unknown until its settlement is confirmed: only a
      // confirmed receipt may record reported usage, so a refused settlement
      // keeps the full worst case reserved instead of understating liability.
      if (!(await settleReported(attemptId))) {
        stopOnSettlementFailure(slot, slotAttemptIds, remainingKeys);
        break;
      }
      record.usage = { kind: "reported", microsUsd: 0 };

      const candidates = parsed.results.slice(0, remainingForSlot);
      resultsSeenThisSlot += parsed.results.length;
      stats.resultsSeen += candidates.length;
      let admittedThisPage = 0;
      for (const candidate of candidates) {
        if (
          state.sources.length >= RESEARCH_BUDGET_LIMITS.maxRetainedSources ||
          excerptTotalCharacters(state.sources) >= RESEARCH_BUDGET_LIMITS.maxTotalExcerptCharacters
        ) {
          slotExhausted = true;
          break;
        }
        let citationUrl: string;
        try {
          citationUrl = normalizePublicCitationUrl(candidate.url);
        } catch (error) {
          if (error instanceof PublicHttpError) {
            stats.unsafeDropped += 1;
            continue;
          }
          throw error;
        }
        if (seenUrls.has(citationUrl)) {
          stats.duplicatesDropped += 1;
          continue;
        }
        const excerptText = (candidate.snippet ?? "").trim().slice(0, 2_000);
        if (excerptText.length === 0) {
          stats.emptyExcerptsDropped += 1;
          continue;
        }
        if (
          excerptTotalCharacters(state.sources) + excerptText.length >
          RESEARCH_BUDGET_LIMITS.maxTotalExcerptCharacters
        ) {
          slotExhausted = true;
          break;
        }
        const hostname = new URL(citationUrl).hostname.toLowerCase();
        const registrableDomain = parseDomain(hostname, {
          allowPrivateDomains: false,
          detectIp: true,
        }).domain;
        if (!registrableDomain) {
          stats.unsafeDropped += 1;
          continue;
        }
        if (
          typeof candidate.site_name === "string" &&
          candidate.site_name.trim().length > 0 &&
          !siteNameMatchesCitation(candidate.site_name, hostname, registrableDomain)
        ) {
          stats.unsafeDropped += 1;
          continue;
        }
        const publisher =
          typeof candidate.publisher === "string" && candidate.publisher.trim().length > 0
            ? candidate.publisher.trim().slice(0, 200)
            : typeof candidate.title === "string" && candidate.title.trim().length > 0
              ? candidate.title.trim().slice(0, 200)
              : undefined;
        state.sources.push({
          sourceUrl: citationUrl,
          domain: registrableDomain,
          publisher,
          excerptText,
          excerptDigest: sha256Hex(excerptText),
          retrievedAt: now().toISOString(),
        });
        seenUrls.add(citationUrl);
        slotSupported += 1;
        admittedThisPage += 1;
      }
      if (slotExhausted) {
        // Retention budget ran out mid-slot: truncation never implies
        // supported coverage, even when this slot already admitted sources.
        recordSlot(slot, "failed", slotAttemptIds);
        stopReason = "source_budget";
        stopped = true;
        markRemaining(remainingKeys, "not_started");
      }
      if (stopped) break;
      if (slotSupported >= Math.min(slot.maxResults, RESEARCH_BUDGET_LIMITS.maxResultsPerQuery)) {
        slotDone = true;
        break;
      }
      // Page on only while the provider signals further evidence: an
      // explicit total beyond what this slot has seen, or — when the total
      // is absent — a full page. A page that admits nothing new ends the
      // slot so dupe streams cannot burn the shared attempt ceiling.
      const totalSignalsMore =
        parsed.total_results == null
          ? parsed.results.length >= remainingForSlot
          : parsed.total_results > resultsSeenThisSlot;
      if (parsed.results.length === 0 || admittedThisPage === 0 || !totalSignalsMore) {
        slotDone = true;
        break;
      }
      page += 1;
    }

    if (stopped) break;
    const reportedClean = state.attempts.some(
      (attempt) => attempt.slotKey === slot.slotKey && attempt.usage.kind === "reported",
    );
    if (slotSupported > 0) {
      // A slot that filled mid-page keeps its admissions, but truncation
      // above already recorded failed: never overwrite a recorded outcome.
      if (!coverageBySlot.has(slot.slotKey)) {
        recordSlot(slot, "supported", slotAttemptIds);
      }
    } else if (reportedClean) {
      recordSlot(slot, "searched_no_usable_evidence", slotAttemptIds);
    } else if (slotAttemptIds.length > 0) {
      recordSlot(slot, "failed", slotAttemptIds);
    } else {
      recordSlot(slot, "not_started", slotAttemptIds);
    }
  }

  if (!stopped) {
    const missing = planKeys.filter((slotKey) => !coverageBySlot.has(slotKey));
    markRemaining(missing, "not_started");
  }

  const orderedCoverage = input.plan.map((slot) => coverageBySlot.get(slot.slotKey)!);
  state.coverage = orderedCoverage;
  state.sourceUrls = [...seenUrls];

  const result = researchRetrievalResultSchema.parse({
    sources: state.sources,
    coverage: orderedCoverage,
    attempts: state.attempts,
  });

  return { result, stopReason, claimLost, durableState: state, stats };
}

/**
 * Wraps a full-coverage run as the legacy adapter surface (the method name
 * predates snippet-only retrieval; no page fetch happens). The plan derives
 * from the request scope, so every topic and competitor is covered.
 */
export function createTinyfishSearchAdapter(input: {
  transport: TinyfishSearchTransport;
  spender: TinyfishSearchSpender;
  gate: TinyfishSearchGate;
  availability?: { available: boolean; provider: string };
  resumeFrom?: TinyfishSearchDurableState;
  deadlineMs?: number;
  now?: () => Date;
  signal?: AbortSignal;
}): ResearchAdapter {
  const availability = input.availability ?? {
    available: input.gate.isAvailable(),
    provider: QUALIFIED_TINYFISH_RESEARCH_PROVIDER,
  };
  return {
    availability,
    async searchAndFetch(request) {
      const parsed = researchRequestSchema.parse(request);
      const plan = buildResearchQuerySlots({
        scope: parsed.scope,
        maxResultsPerQuery: parsed.maxResultsPerQuery,
      });
      const output = await runTinyfishSearchResearch({
        request: parsed,
        plan,
        transport: input.transport,
        spender: input.spender,
        gate: input.gate,
        resumeFrom: input.resumeFrom,
        deadlineMs: input.deadlineMs,
        now: input.now,
        signal: input.signal,
      });
      return output.result;
    },
  };
}
