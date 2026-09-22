import "server-only";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import { RESEARCH_BUDGET_LIMITS } from "@/domain/growth-intelligence/research-budget";
import type {
  ResearchAdapter,
  ResearchAdapterAvailability,
} from "@/modules/growth-intelligence/infrastructure/research/ports";
import {
  createResearchBudgetRepository,
  type ResearchBudgetRepository,
} from "@/modules/growth-intelligence/infrastructure/research/budget-repository";
import { createResearchProviderQualification } from "@/modules/growth-intelligence/infrastructure/research/qualification";
import {
  getQualifiedMarketResearchAdapter,
  QUALIFIED_TINYFISH_RESEARCH_PROVIDER,
  resolveResearchAdapterAvailability,
} from "@/modules/growth-intelligence/infrastructure/research/qualified-provider";
import {
  createTinyfishSearchAdapter,
  type TinyfishSearchGate,
  type TinyfishSearchSpender,
} from "@/modules/growth-intelligence/infrastructure/research/tinyfish-search-adapter";
import { createTinyfishSearchTransport } from "@/modules/growth-intelligence/infrastructure/research/tinyfish-search-transport";
import { TinyFish } from "@tiny-fish/sdk";
import type { AgentClientSeam } from "@/modules/growth-intelligence/infrastructure/research/tinyfish-agent-adapter";

/**
 * Production TinyFish research assembly for the market-research worker's
 * durable research path (Task 5). This is the first production spender/gate
 * assembly: previously both trigger call sites used the blocked baseline
 * because only test fakes existed. The Slice-3 fail-closed monitoring path
 * is deliberately untouched and stays blocked by design.
 *
 * Every gate fails closed to the blocked baseline (safe codes, zero spend):
 * a missing/empty API key, a closed kill-switch, an unreachable or
 * unqualified tinyfish lane, or a lane mismatch all return
 * `getQualifiedMarketResearchAdapter()` with its defaults, exactly as
 * before. Only a present key, an open gate, and a staged tinyfish-lane
 * qualification together select the delegating adapter.
 */

export const TINYFISH_RESEARCH_PRICE_VERSION = "tinyfish-search-2026-09";

/** Whole-request worst-case quote: the pipeline ceiling caps every scope. */
export const TINYFISH_RESEARCH_QUOTE_MICROS_USD =
  RESEARCH_BUDGET_LIMITS.maxPipelineReservationMicrosUsd;

/**
 * Per-attempt worst case. Twenty-eight attempts (26 primaries + 2 retries)
 * at this maximum stay within the USD 1 quote (28 x 35,714 = 999,992), so
 * a full run can never breach its admitted reservation.
 */
export const TINYFISH_RESEARCH_MAXIMUM_MICROS_USD_PER_ATTEMPT = Math.floor(
  RESEARCH_BUDGET_LIMITS.maxPipelineReservationMicrosUsd /
    (RESEARCH_BUDGET_LIMITS.maxPrimarySearches + RESEARCH_BUDGET_LIMITS.maxRetryAttempts),
);

/** Minimal persistence seam: the fenced RPCs both repositories are built on. */
export type TinyfishResearchPersistence = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

/**
 * API key helper mirroring the trigger file's env pattern. An absent or
 * blank key reports unavailable: the transport is never constructed and the
 * key is never logged, persisted, or sent anywhere.
 */
export function readTinyfishSearchApiKey(): string {
  return process.env.TINYFISH_SEARCH_API_KEY?.trim() ?? "";
}

/**
 * Kill-switch gate mirroring the trigger file's `=== "true"` env pattern.
 * Closed by default: only an explicit "true" opens the paid path. Re-read
 * on every call so an operator can close it mid-run; the runner re-checks
 * the gate before every call including retries and pages.
 */
export function isTinyfishResearchGateOpen(): boolean {
  return process.env.TINYFISH_MARKET_RESEARCH_ENABLED === "true";
}

/**
 * Production spender over the budget-repository fenced wrappers.
 * Reserve-before-call: every provider call reserves its worst case first
 * through `reserve_research_attempt` (which re-asserts provider
 * qualification server-side) and settles explicitly afterwards. Unknown
 * cost stays reserved, never converts to zero: settlement failures
 * propagate so the runner keeps the attempt unknown, and reported /
 * estimated receipts forward untouched.
 *
 * The request-budget reservation is ensured lazily on the first reserve,
 * so blocked paths never touch the ledger. The claim token arrives from
 * the workflow after it claims the request (the trigger injects
 * `newClaimToken`, which records the token the RPC fences spend on); a
 * reserve before any claim fails closed with zero spend.
 */
export function createTinyfishResearchSpender(input: {
  budget: Pick<
    ResearchBudgetRepository,
    "reserveRequestBudget" | "reserveAttempt" | "settleAttempt"
  >;
  organizationId: string;
  requestId: string;
  claimToken: () => string | null;
}): TinyfishSearchSpender {
  let reservationEnsured = false;
  return {
    async reserve({ slotKey, attemptIndex }) {
      const token = input.claimToken();
      if (!token) {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_UNAVAILABLE",
          "Research spend could not be reserved.",
        );
      }
      if (!reservationEnsured) {
        await input.budget.reserveRequestBudget({
          organizationId: input.organizationId,
          requestId: input.requestId,
          quoteMicrosUsd: TINYFISH_RESEARCH_QUOTE_MICROS_USD,
          priceVersion: TINYFISH_RESEARCH_PRICE_VERSION,
        });
        reservationEnsured = true;
      }
      const debit = await input.budget.reserveAttempt({
        organizationId: input.organizationId,
        scope: { kind: "request", requestId: input.requestId },
        phase: "research",
        slotKey,
        attemptIndex,
        maximumMicrosUsd: TINYFISH_RESEARCH_MAXIMUM_MICROS_USD_PER_ATTEMPT,
        claimToken: token,
      });
      return { attemptId: debit.attemptId };
    },
    async settle({ attemptId, usage }) {
      await input.budget.settleAttempt({
        organizationId: input.organizationId,
        attemptId,
        usage,
      });
    },
  };
}

/**
 * Resolves the production adapter for one research run. Server-side only.
 */
export async function createQualifiedTinyfishResearchAdapter(input: {
  persistence: TinyfishResearchPersistence;
  organizationId: string;
  requestId: string;
  claimToken: () => string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof globalThis.fetch;
}): Promise<ResearchAdapter> {
  const blocked = () => getQualifiedMarketResearchAdapter();
  const apiKey = readTinyfishSearchApiKey();
  if (apiKey.length === 0 || !isTinyfishResearchGateOpen()) return blocked();

  let qualification;
  try {
    ({ qualification } = await createResearchProviderQualification(
      input.persistence,
      "tinyfish",
    ).check());
  } catch {
    return blocked();
  }

  // resolveResearchAdapterAvailability hardcodes the legacy provider id, so
  // pin the lane explicitly: a staged qualification for any other provider
  // must never authorize TinyFish spend.
  const staged = resolveResearchAdapterAvailability(qualification);
  const availability: ResearchAdapterAvailability = {
    available: staged.available && qualification.provider === QUALIFIED_TINYFISH_RESEARCH_PROVIDER,
    provider: QUALIFIED_TINYFISH_RESEARCH_PROVIDER,
  };
  if (!availability.available) return blocked();

  const budget = createResearchBudgetRepository(input.persistence);
  const transport = createTinyfishSearchTransport({
    apiKey,
    fetchImpl: input.fetchImpl,
  });
  const gate: TinyfishSearchGate = {
    isAvailable: () => isTinyfishResearchGateOpen(),
  };
  const spender = createTinyfishResearchSpender({
    budget,
    organizationId: input.organizationId,
    requestId: input.requestId,
    claimToken: input.claimToken,
  });
  const candidate = createTinyfishSearchAdapter({
    transport,
    spender,
    gate,
    availability,
    signal: input.signal,
  });
  return getQualifiedMarketResearchAdapter(
    availability,
    candidate,
    QUALIFIED_TINYFISH_RESEARCH_PROVIDER,
  );
}

/**
 * Agent fallback lane client seam (Task 3 of 2026-09-21-agent-fallback-lane).
 *
 * SDK verification (binding, installed @tiny-fish/sdk 0.7.0): `queue()` accepts
 * an `agent_config` passthrough (`AgentRunParams.agent_config` with
 * `max_duration_seconds`), so start carries `{ max_duration_seconds: 120 }`
 * through the SDK. The SDK exposes no cancel-run method (`RunsResource` has
 * only `get`/`list`), so `cancelRun` is a raw
 * `POST https://agent.tinyfish.ai/v1/runs/{runId}/cancel` with the `X-API-Key`
 * header. The key comes from `readTinyfishSearchApiKey()` and is never logged.
 * The cancel fetch uses `redirect: "error"` on the allowlisted host only, so a
 * redirect can never carry the key elsewhere.
 */
export const TINYFISH_AGENT_API_BASE_URL = "https://agent.tinyfish.ai";

/** Server-side bound for every agent run (AGENT_SLOT_TIMEOUT_MS / 1000). */
export const TINYFISH_AGENT_MAX_DURATION_SECONDS = 120;

export function createTinyfishAgentClientSeam(input?: {
  apiKey?: string;
  client?: TinyFish;
  fetchImpl?: typeof globalThis.fetch;
}): AgentClientSeam {
  const apiKey = input?.apiKey ?? readTinyfishSearchApiKey();
  if (apiKey.length === 0) {
    throw new Error("TinyFish Agent lane requires an API key.");
  }
  // `new TinyFish({ apiKey })` is explicit so the lane works with the existing
  // `TINYFISH_SEARCH_API_KEY` env (the SDK default reads `TINYFISH_API_KEY`).
  const resolvedClient: TinyFish = input?.client ?? new TinyFish({ apiKey });
  const fetchImpl = input?.fetchImpl ?? globalThis.fetch;
  return {
    async startRun(runInput) {
      const response = await resolvedClient.agent.queue({
        url: runInput.url,
        goal: runInput.goal,
        browser_profile: runInput.browserProfile,
        agent_config: { max_duration_seconds: runInput.maxDurationSeconds },
      });
      if (response.run_id === null) {
        throw new Error("TinyFish agent queue refused the run.");
      }
      return { runId: response.run_id };
    },
    async getRun(runId) {
      const run = await resolvedClient.runs.get(runId);
      return { status: run.status, result: run.result ?? null };
    },
    async cancelRun(runId) {
      if (runId.length === 0) return;
      const encoded = encodeURIComponent(runId);
      const url = `${TINYFISH_AGENT_API_BASE_URL}/v1/runs/${encoded}/cancel`;
      if (!url.startsWith(`${TINYFISH_AGENT_API_BASE_URL}/`)) {
        throw new Error("TinyFish Agent cancel refused an unexpected host.");
      }
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
        redirect: "error",
      });
      if (!response.ok) {
        throw new Error(`TinyFish Agent cancel failed with status ${response.status}.`);
      }
    },
  };
}
