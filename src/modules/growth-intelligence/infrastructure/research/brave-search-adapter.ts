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
import { QUALIFIED_RESEARCH_PROVIDER } from "@/modules/growth-intelligence/infrastructure/research/qualified-provider";
import {
  normalizePublicCitationUrl,
  PublicHttpError,
} from "@/modules/growth-intelligence/infrastructure/research/safe-public-http";

/**
 * Fixed Brave Web Search endpoint. Only this base ever receives a request:
 * the builder asserts the allowlist prefix after encoding, so query text can
 * never redirect construction at another host. No page crawl exists in this
 * implementation: citations are normalized, never fetched.
 */
export const BRAVE_WEB_SEARCH_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

/** API redirects are never followed: any 3xx fails its attempt outright. */
export const BRAVE_SEARCH_MAX_REDIRECTS = 0;

/** Eight-minute research deadline inside the ten-minute lease. */
export const BRAVE_SEARCH_DEADLINE_MS = 8 * 60_000;

const MAX_QUERY_CHARACTERS = 160;

const braveSearchResultSchema = z
  .object({
    url: z.string().min(1).max(2_048),
    title: z.string().max(500).nullish(),
    description: z.string().max(8_000).nullish(),
  })
  .passthrough();

const braveSearchResponseSchema = z
  .object({ results: z.array(braveSearchResultSchema) })
  .passthrough();

/**
 * Single-shot provider transport. Implementations must not retry, follow
 * redirects, or widen bounds: every retry is explicit in the runner below and
 * accounted against the two-call allowance. No live transport ships in this
 * task (synthetic fixtures only); the live transport arrives with Task 8.
 */
export type BraveSearchTransport = {
  search(input: {
    url: string;
    timeoutMs: number;
    maxResponseBytes: number;
    abortSignal: AbortSignal;
  }): Promise<{ status: number; headers: Record<string, string>; body: Uint8Array }>;
};

/**
 * Spend seam over the Task 5 budget boundary. The fenced reserve RPC
 * re-asserts provider qualification server-side (fail-closed), so gating is
 * per-call rather than admission-only; the runner still stops on the first
 * refusal and treats it as revocation.
 */
export type BraveSearchSpender = {
  reserve(input: { slotKey: string; attemptIndex: number }): Promise<{ attemptId: string }>;
  settle(input: { attemptId: string; usage: ResearchAttemptUsage }): Promise<void>;
};

/** Kill-switch seam, re-checked before every call including retries. */
export type BraveSearchGate = {
  isAvailable(): boolean;
};

const attemptIdSchema = z.string().uuid();

export type BraveSearchAttemptRecord = {
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
export type BraveSearchDurableState = {
  attempts: BraveSearchAttemptRecord[];
  coverage: ResearchCoverageEntry[];
  sources: ResearchRetrievedSource[];
  consumedResponseBytes: number;
  consumedRetries: number;
  sourceUrls: string[];
  startedAt: number;
};

export type BraveSearchStopReason =
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

export type BraveSearchRunStats = {
  callsIssued: number;
  bytesReceived: number;
  resultsSeen: number;
  duplicatesDropped: number;
  unsafeDropped: number;
  emptyExcerptsDropped: number;
};

export type BraveSearchRunInput = {
  request: unknown;
  plan: ResearchQuerySlot[];
  transport: BraveSearchTransport;
  spender: BraveSearchSpender;
  gate: BraveSearchGate;
  resumeFrom?: BraveSearchDurableState;
  deadlineMs?: number;
  now?: () => Date;
  signal?: AbortSignal;
};

export type BraveSearchRunOutput = {
  result: z.infer<typeof researchRetrievalResultSchema>;
  stopReason: BraveSearchStopReason;
  claimLost: boolean;
  durableState: BraveSearchDurableState;
  stats: BraveSearchRunStats;
};

/**
 * Builds the fixed-endpoint request for one slot. Only the bounded public
 * query text and the result count travel as encoded params: no business
 * reports, customer data, credentials, or scope internals are ever sent.
 */
export function buildBraveSearchRequestUrl(slot: { text: string }, count: number): string {
  if (slot.text.length < 1 || slot.text.length > MAX_QUERY_CHARACTERS) {
    throw new Error("Brave search query text must stay within its bound.");
  }
  if (!Number.isInteger(count) || count < 1 || count > RESEARCH_BUDGET_LIMITS.maxResultsPerQuery) {
    throw new Error("Brave search result count must stay within its bound.");
  }
  const url = new URL(BRAVE_WEB_SEARCH_ENDPOINT);
  url.searchParams.set("q", slot.text);
  url.searchParams.set("count", String(count));
  const built = url.toString();
  if (!built.startsWith(`${BRAVE_WEB_SEARCH_ENDPOINT}?`)) {
    throw new Error("Brave search requests must stay on the allowlisted endpoint.");
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

function emptyDurableState(startedAt: number): BraveSearchDurableState {
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

function cloneDurableState(state: BraveSearchDurableState): BraveSearchDurableState {
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
export function requirePlannedSlot(
  plan: readonly ResearchQuerySlot[],
  slotKey: string,
): ResearchQuerySlot {
  const planned = plan.find((slot) => slot.slotKey === slotKey);
  if (!planned) throw new Error("Brave search coverage must follow the run plan.");
  return planned;
}

function excerptTotalCharacters(sources: readonly ResearchRetrievedSource[]): number {
  return sources.reduce((total, source) => total + source.excerptText.length, 0);
}

function isGrowthIntelligenceError(error: unknown): error is GrowthIntelligenceError {
  return error instanceof GrowthIntelligenceError;
}

/**
 * Runs the full-coverage plan with reservation-before-call: every provider
 * call reserves its worst case first and settles explicitly afterwards.
 * Unknown cost (timeout, transport failure, rejected response) stays reserved,
 * never converts to zero. Success settles the synthetic reported receipt.
 */
export async function runBraveSearchResearch(
  input: BraveSearchRunInput,
): Promise<BraveSearchRunOutput> {
  const request = researchRequestSchema.parse(input.request);
  // The run plan is authoritative for coverage: request.maxQueries is the
  // legacy trigger ceiling (1–3) and cannot bound this run's cost. Reconciling
  // the request shape belongs to Task 8's rewiring alongside the trigger
  // marker; until then the 26-slot plan cap above is the enforced ceiling.
  if (input.plan.length < 1 || input.plan.length > RESEARCH_BUDGET_LIMITS.maxPrimarySearches) {
    throw new Error("Brave search runs exactly the planned primary slots.");
  }
  const planKeys = input.plan.map((slot) => slot.slotKey);
  if (new Set(planKeys).size !== planKeys.length) {
    throw new Error("Brave search slots must be keyed uniquely.");
  }

  const now = input.now ?? (() => new Date());
  const deadlineMs = input.deadlineMs ?? BRAVE_SEARCH_DEADLINE_MS;
  const startedAt = input.resumeFrom ? input.resumeFrom.startedAt : now().getTime();
  const state = input.resumeFrom
    ? cloneDurableState(input.resumeFrom)
    : emptyDurableState(startedAt);
  const seenUrls = new Set(state.sourceUrls);
  const stats: BraveSearchRunStats = {
    callsIssued: 0,
    bytesReceived: 0,
    resultsSeen: 0,
    duplicatesDropped: 0,
    unsafeDropped: 0,
    emptyExcerptsDropped: 0,
  };

  const maxAttempts =
    RESEARCH_BUDGET_LIMITS.maxPrimarySearches + RESEARCH_BUDGET_LIMITS.maxRetryAttempts;
  let stopReason: BraveSearchStopReason = "completed";
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
        recordSlot(requirePlannedSlot(input.plan, slotKey), outcome, []);
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
    reason: BraveSearchStopReason,
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
    const stopBeforeCall = (reason: BraveSearchStopReason): void => {
      stopReason = reason;
      stopped = true;
      if (reason === "policy_revoked") {
        markRemaining([slot.slotKey, ...remainingKeys], "skipped_policy");
      } else if (reason === "budget_exhausted") {
        markRemaining([slot.slotKey, ...remainingKeys], "skipped_budget");
      } else {
        markRemaining([slot.slotKey, ...remainingKeys], "not_started");
      }
    };

    if (input.signal?.aborted) {
      stopBeforeCall("cancelled");
      break;
    }
    if (now().getTime() - startedAt > deadlineMs) {
      stopBeforeCall("deadline");
      break;
    }
    if (state.attempts.length >= maxAttempts) {
      stopBeforeCall("attempt_ceiling");
      break;
    }
    if (state.consumedResponseBytes >= RESEARCH_BUDGET_LIMITS.maxStreamedBytesTotal) {
      stopBeforeCall("byte_budget");
      break;
    }
    if (
      state.sources.length >= RESEARCH_BUDGET_LIMITS.maxRetainedSources ||
      excerptTotalCharacters(state.sources) >= RESEARCH_BUDGET_LIMITS.maxTotalExcerptCharacters
    ) {
      stopBeforeCall("source_budget");
      break;
    }
    if (!input.gate.isAvailable()) {
      stopBeforeCall("policy_revoked");
      break;
    }

    const slotAttemptIds: string[] = [];
    let slotDone = false;
    let slotSupported = 0;
    let slotExhausted = false;

    while (!slotDone && !stopped) {
      if (!input.gate.isAvailable()) {
        stopMidSlot("policy_revoked", slot, slotAttemptIds, remainingKeys, "skipped_policy");
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

      let response: { status: number; headers: Record<string, string>; body: Uint8Array };
      try {
        const url = buildBraveSearchRequestUrl(slot, Math.min(slot.maxResults, 5));
        stats.callsIssued += 1;
        response = await input.transport.search({
          url,
          timeoutMs,
          maxResponseBytes,
          abortSignal,
        });
      } catch {
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

      let parsed: z.infer<typeof braveSearchResponseSchema>;
      try {
        const text = new TextDecoder().decode(response.body);
        parsed = braveSearchResponseSchema.parse(JSON.parse(text));
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

      const candidates = parsed.results.slice(
        0,
        Math.min(slot.maxResults, RESEARCH_BUDGET_LIMITS.maxResultsPerQuery),
      );
      stats.resultsSeen += candidates.length;
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
        const excerptText = (candidate.description ?? "").trim().slice(0, 2_000);
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
        state.sources.push({
          sourceUrl: citationUrl,
          domain: registrableDomain,
          publisher:
            typeof candidate.title === "string" && candidate.title.trim().length > 0
              ? candidate.title.trim().slice(0, 200)
              : undefined,
          excerptText,
          excerptDigest: sha256Hex(excerptText),
          retrievedAt: now().toISOString(),
        });
        seenUrls.add(citationUrl);
        slotSupported += 1;
      }
      if (slotExhausted) {
        // Retention budget ran out mid-slot: truncation never implies
        // supported coverage, even when this slot already admitted sources.
        recordSlot(slot, "failed", slotAttemptIds);
        stopReason = "source_budget";
        stopped = true;
        markRemaining(remainingKeys, "not_started");
      }
      slotDone = true;
    }

    if (stopped) break;
    const reportedClean = state.attempts.some(
      (attempt) => attempt.slotKey === slot.slotKey && attempt.usage.kind === "reported",
    );
    if (slotSupported > 0) {
      recordSlot(slot, "supported", slotAttemptIds);
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
export function createBraveSearchAdapter(input: {
  transport: BraveSearchTransport;
  spender: BraveSearchSpender;
  gate: BraveSearchGate;
  availability?: { available: boolean; provider: string };
  resumeFrom?: BraveSearchDurableState;
  deadlineMs?: number;
  now?: () => Date;
  signal?: AbortSignal;
}): ResearchAdapter {
  const availability = input.availability ?? {
    available: input.gate.isAvailable(),
    provider: QUALIFIED_RESEARCH_PROVIDER,
  };
  return {
    availability,
    async searchAndFetch(request) {
      const parsed = researchRequestSchema.parse(request);
      const plan = buildResearchQuerySlots({
        scope: parsed.scope,
        maxResultsPerQuery: parsed.maxResultsPerQuery,
      });
      const output = await runBraveSearchResearch({
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
