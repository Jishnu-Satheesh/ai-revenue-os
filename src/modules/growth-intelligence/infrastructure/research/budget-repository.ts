import "server-only";

import { z } from "zod";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  researchAttemptReservationSchema,
  researchQuoteSchema,
  researchWorkScopeSchema,
  settleResearchAttemptSchema,
  toResearchWorkScopeKey,
  type ResearchWorkScope,
} from "@/domain/growth-intelligence/research-budget";

export type ResearchBudgetPersistence = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

const identifierSchema = z.string().uuid();
const allowanceDaySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const pipelineReservationResponseSchema = z
  .object({
    reservationId: identifierSchema,
    organizationId: identifierSchema,
    pipelineId: identifierSchema,
    allowanceDay: allowanceDaySchema,
    quoteMicrosUsd: z.number().int().min(1),
    priceVersion: z.string().min(1).max(80),
    replayed: z.boolean(),
  })
  .strict();

const requestReservationResponseSchema = z
  .object({
    reservationId: identifierSchema,
    organizationId: identifierSchema,
    requestId: identifierSchema,
    allowanceDay: allowanceDaySchema,
    quoteMicrosUsd: z.number().int().min(1),
    priceVersion: z.string().min(1).max(80),
    replayed: z.boolean(),
  })
  .strict();

const attemptResponseSchema = z
  .object({
    attemptId: identifierSchema,
    reservationId: identifierSchema,
    allowanceDay: allowanceDaySchema,
    maximumMicrosUsd: z.number().int().min(1),
    replayed: z.boolean(),
  })
  .strict();

const settleResponseSchema = z
  .object({
    attemptId: identifierSchema,
    settlementKind: z.enum(["reported", "estimated", "unknown"]),
    actualMicrosUsd: z.number().int().min(0).nullable(),
    overrunBlocked: z.boolean(),
    replayed: z.boolean(),
  })
  .strict();

const releaseResponseSchema = z
  .object({
    reservationId: identifierSchema,
    released: z.boolean(),
    replayed: z.boolean(),
  })
  .strict();

export type PipelineBudgetReservation = z.infer<typeof pipelineReservationResponseSchema>;
export type RequestBudgetReservation = z.infer<typeof requestReservationResponseSchema>;
export type ResearchAttemptDebit = z.infer<typeof attemptResponseSchema>;
export type ResearchAttemptSettlement = z.infer<typeof settleResponseSchema>;
export type ResearchBudgetRelease = z.infer<typeof releaseResponseSchema>;

/**
 * Maps a fenced-RPC refusal onto a typed domain error. Only the exception
 * message (a stable safe code from the migration) is inspected; provider
 * payloads never travel this path, so there is nothing secret to leak.
 */
export function toResearchBudgetError(error: unknown): GrowthIntelligenceError {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "";
  if (message.includes("research_provider_not_qualified")) {
    return new GrowthIntelligenceError(
      "RESEARCH_PROVIDER_NOT_QUALIFIED",
      "Market research is not enabled for this organization.",
    );
  }
  if (message.includes("research_budget_allowance_exceeded")) {
    return new GrowthIntelligenceError(
      "RESEARCH_BUDGET_ALLOWANCE_EXCEEDED",
      "The organization research allowance for today is fully reserved.",
    );
  }
  if (message.includes("research_budget_reservation_exceeded")) {
    return new GrowthIntelligenceError(
      "RESEARCH_BUDGET_RESERVATION_EXCEEDED",
      "This attempt would exceed the admitted research quote.",
    );
  }
  if (message.includes("research_budget_overrun_blocked")) {
    return new GrowthIntelligenceError(
      "RESEARCH_BUDGET_OVERRUN_BLOCKED",
      "A recorded actual exceeded its worst case; further calls are blocked.",
    );
  }
  if (message.includes("research_budget_lease_stale")) {
    return new GrowthIntelligenceError(
      "RESEARCH_BUDGET_LEASE_STALE",
      "The worker lease is no longer current; no new call was issued.",
    );
  }
  if (
    message.includes("research_budget_pipeline_closed") ||
    message.includes("research_budget_request_closed") ||
    message.includes("research_budget_reservation_released")
  ) {
    return new GrowthIntelligenceError(
      "RESEARCH_BUDGET_SCOPE_CLOSED",
      "This research scope is closed; it admits no new spend.",
    );
  }
  if (
    message.includes("research_budget_reservation_conflict") ||
    message.includes("research_budget_attempt_conflict") ||
    message.includes("research_budget_receipt_conflict")
  ) {
    return new GrowthIntelligenceError(
      "RESEARCH_BUDGET_CONFLICT",
      "This reservation was replayed with different terms.",
    );
  }
  return new GrowthIntelligenceError(
    "RESEARCH_BUDGET_UNAVAILABLE",
    "Research spend could not be reserved.",
  );
}

function boundaryError(): GrowthIntelligenceError {
  return new GrowthIntelligenceError(
    "RESEARCH_BUDGET_UNAVAILABLE",
    "Research spend could not be reserved.",
  );
}

async function invoke<T>(
  persistence: ResearchBudgetPersistence,
  name: string,
  args: Record<string, unknown>,
  outputSchema: z.ZodType<T>,
): Promise<T> {
  let result: { data: unknown; error: unknown };
  try {
    result = await persistence.rpc(name, args);
  } catch (error: unknown) {
    throw toResearchBudgetError(error);
  }
  if (result.error) throw toResearchBudgetError(result.error);
  const parsed = outputSchema.safeParse(result.data);
  if (!parsed.success) throw boundaryError();
  return parsed.data;
}

function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw boundaryError();
  return parsed.data;
}

export type ResearchBudgetRepository = {
  reservePipelineBudget(input: {
    organizationId: string;
    pipelineId: string;
    quoteMicrosUsd: number;
    priceVersion: string;
  }): Promise<PipelineBudgetReservation>;
  reserveRequestBudget(input: {
    organizationId: string;
    requestId: string;
    quoteMicrosUsd: number;
    priceVersion: string;
  }): Promise<RequestBudgetReservation>;
  reserveAttempt(input: {
    organizationId: string;
    scope: ResearchWorkScope;
    phase: "research" | "synthesis";
    slotKey: string;
    attemptIndex: number;
    maximumMicrosUsd: number;
    claimToken: string;
  }): Promise<ResearchAttemptDebit>;
  settleAttempt(input: {
    organizationId: string;
    attemptId: string;
    usage:
      | { kind: "reported"; microsUsd: number }
      | { kind: "estimated"; microsUsd: number }
      | { kind: "unknown" };
  }): Promise<ResearchAttemptSettlement>;
  releaseReservation(input: {
    organizationId: string;
    reservationId: string;
  }): Promise<ResearchBudgetRelease>;
};

/**
 * Typed client for the private spend ledgers. Every amount is validated
 * against the USD 1 quote ceiling before the call; the database locks the
 * organization-day row, so concurrent reservations cannot overspend USD 5.
 * Actuals are recorded, never clamped: an overrun blocks further calls.
 */
export function createResearchBudgetRepository(
  persistence: ResearchBudgetPersistence,
): ResearchBudgetRepository {
  return {
    async reservePipelineBudget(input) {
      const quote = parseOrThrow(researchQuoteSchema, {
        quoteMicrosUsd: input.quoteMicrosUsd,
        priceVersion: input.priceVersion,
      });
      return invoke(
        persistence,
        "reserve_research_pipeline_budget",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_pipeline_id: parseOrThrow(identifierSchema, input.pipelineId),
          p_quote_micros_usd: quote.quoteMicrosUsd,
          p_price_version: quote.priceVersion,
        },
        pipelineReservationResponseSchema,
      );
    },

    async reserveRequestBudget(input) {
      const quote = parseOrThrow(researchQuoteSchema, {
        quoteMicrosUsd: input.quoteMicrosUsd,
        priceVersion: input.priceVersion,
      });
      return invoke(
        persistence,
        "reserve_research_request_budget",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_request_id: parseOrThrow(identifierSchema, input.requestId),
          p_quote_micros_usd: quote.quoteMicrosUsd,
          p_price_version: quote.priceVersion,
        },
        requestReservationResponseSchema,
      );
    },

    async reserveAttempt(input) {
      const reservation = parseOrThrow(researchAttemptReservationSchema, {
        scope: parseOrThrow(researchWorkScopeSchema, input.scope),
        phase: input.phase,
        slotKey: input.slotKey,
        attemptIndex: input.attemptIndex,
        maximumMicrosUsd: input.maximumMicrosUsd,
        claimToken: input.claimToken,
      });
      const scopeKey = toResearchWorkScopeKey(reservation.scope);
      return invoke(
        persistence,
        "reserve_research_attempt",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_work_scope: { kind: scopeKey.kind, id: scopeKey.id },
          p_phase: reservation.phase,
          p_slot_key: reservation.slotKey,
          p_attempt_index: reservation.attemptIndex,
          p_maximum_micros_usd: reservation.maximumMicrosUsd,
          p_claim_token: reservation.claimToken,
        },
        attemptResponseSchema,
      );
    },

    async settleAttempt(input) {
      const settlement = parseOrThrow(settleResearchAttemptSchema, {
        attemptId: input.attemptId,
        usage: input.usage,
      });
      return invoke(
        persistence,
        "settle_research_attempt",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_attempt_id: settlement.attemptId,
          p_usage: settlement.usage,
        },
        settleResponseSchema,
      );
    },

    async releaseReservation(input) {
      return invoke(
        persistence,
        "release_research_budget_reservation",
        {
          p_organization_id: parseOrThrow(identifierSchema, input.organizationId),
          p_reservation_id: parseOrThrow(identifierSchema, input.reservationId),
        },
        releaseResponseSchema,
      );
    },
  };
}
