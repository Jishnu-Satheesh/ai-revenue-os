import "server-only";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import type { ResearchBudgetRepository } from "@/modules/growth-intelligence/infrastructure/research/budget-repository";
import type {
  ResearchModelSpender,
  ResearchModelTransport,
} from "@/modules/growth-intelligence/infrastructure/research/claim-extraction";
import { createResearchModelTransport } from "@/modules/growth-intelligence/infrastructure/research/research-model-transport";
import {
  isTinyfishResearchGateOpen,
  TINYFISH_RESEARCH_MAXIMUM_MICROS_USD_PER_ATTEMPT,
  TINYFISH_RESEARCH_PRICE_VERSION,
  TINYFISH_RESEARCH_QUOTE_MICROS_USD,
} from "@/trigger/growth-intelligence-tinyfish";

/**
 * Research model wiring for the extraction and support-review phases
 * (Task 2). The single TinyFish lane kill-switch governs model transports
 * too; model ids and credentials are Trigger env values the user stages.
 *
 * Every refusal stays fail-closed with the current safe codes: when any
 * gate is shut the caller keeps the unconfigured transport/spender pair,
 * so extraction and support review fail their batches with honest
 * unknown-cost accounting — never a worker throw.
 *
 * Model spend maps to the fenced attempt ledger with phase "research" and
 * the model-phase-namespaced slot keys the runners already emit
 * (extraction:batch-N, support-review:batch-N). No schema or migration
 * change: the request quote, price version, and per-attempt maximum are
 * the staged TinyFish values, so model calls share the same USD 1
 * pipeline fence the search path reserves under.
 */

/** Single lane kill-switch: the same gate that governs TinyFish search. */
export function isResearchModelGateOpen(): boolean {
  return isTinyfishResearchGateOpen();
}

/** Google credential behind the existing environment name. Never logged. */
export function readResearchModelApiKey(): string {
  return process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ?? "";
}

/** Model id behind the existing per-phase environment name. Empty when unstaged. */
export function readResearchModelId(envName: string): string {
  return process.env[envName]?.trim() ?? "";
}

/**
 * Pure wiring predicate so every refusal is unit-testable: an open gate, a
 * qualified TinyFish lane, a present credential, and a present model id
 * together authorize a wired phase. Anything else keeps the fail-closed
 * pair with zero spend.
 */
export function shouldWireResearchModelPhase(input: {
  gateOpen: boolean;
  laneQualified: boolean;
  apiKey: string;
  modelId: string;
}): boolean {
  return (
    input.gateOpen &&
    input.laneQualified &&
    input.apiKey.trim().length > 0 &&
    input.modelId.trim().length > 0
  );
}

/** Wired Google transport behind the lane gate (re-checked on every call). */
export function createWiredResearchModelTransport(input: {
  modelId: string;
  apiKey: string;
}): ResearchModelTransport {
  return createResearchModelTransport({
    modelId: input.modelId,
    apiKey: input.apiKey,
    gate: { isAvailable: () => isResearchModelGateOpen() },
  });
}

/**
 * Fenced model spender over the budget-repository wrappers. Reserve-before-
 * call: every model call reserves its worst case first through
 * `reserve_research_attempt` (which re-asserts provider qualification
 * server-side) and settles explicitly afterwards. Unknown cost stays
 * reserved, never converts to zero.
 *
 * The request-budget reservation is ensured lazily on the first reserve,
 * so blocked paths never touch the ledger. The claim token arrives from
 * the workflow after it claims the request; a reserve before any claim
 * fails closed with zero spend. The phase column stays "research" while
 * the slot key carries the model-phase namespace, so attribution is exact
 * without a schema change.
 */
export function createFencedResearchModelSpender(input: {
  budget: Pick<
    ResearchBudgetRepository,
    "reserveRequestBudget" | "reserveAttempt" | "settleAttempt"
  >;
  organizationId: string;
  requestId: string;
  claimToken: () => string | null;
}): ResearchModelSpender {
  let reservationEnsured = false;
  return {
    async reserve({ phase, slotKey, attemptIndex }) {
      if (phase !== "extraction" && phase !== "support_review") {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_UNAVAILABLE",
          "Research spend could not be reserved.",
        );
      }
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
