import "server-only";

import { z } from "zod";

import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";
import {
  isResearchSourceEligibleForSynthesis,
  renderResearchSourceState,
  researchErasureReasonSchema,
  type ResearchSourceAvailability,
} from "@/domain/growth-intelligence/research-budget";

export type ResearchRetentionPersistence = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

const identifierSchema = z.string().uuid();

const erasureRequestSchema = z
  .object({
    organizationId: identifierSchema,
    sourceId: identifierSchema,
    reasonCode: researchErasureReasonSchema,
    includeDerivedText: z.boolean(),
  })
  .strict();

export type EraseResearchSourcePayload = z.infer<typeof erasureRequestSchema>;

const erasureResponseSchema = z
  .object({
    sourceId: identifierSchema,
    erasedClaims: z.number().int().min(0),
    erasedAt: z.string().datetime({ offset: true }),
    replayed: z.boolean(),
  })
  .strict();

export type ResearchSourceErasure = z.infer<typeof erasureResponseSchema>;

export type ResearchSourceHistoryView = {
  sourceId: string;
  state: "available" | "source_unavailable";
  eligibleForSynthesis: boolean;
};

/**
 * Renders the history state for a retained source row. Erased payloads show
 * an explicit source-unavailable state; safe IDs, digests, decisions and
 * events survive, content does not.
 */
export function toResearchSourceHistoryView(input: {
  sourceId: string;
  availability: ResearchSourceAvailability;
  erasedAt: string | null;
}): ResearchSourceHistoryView {
  const parsedId = identifierSchema.parse(input.sourceId);
  const source = { availability: input.availability, erasedAt: input.erasedAt };
  return {
    sourceId: parsedId,
    state: renderResearchSourceState(source).state,
    eligibleForSynthesis: isResearchSourceEligibleForSynthesis(source),
  };
}

/**
 * Privileged audited erasure. Service-role only: there is no user-facing
 * route. Payloads are nulled, the source renders unavailable, derived claims
 * lose eligibility (and derived text where the obligation covers it), and
 * every affected claim keeps an explicit erased audit event.
 */
export function createResearchRetentionRepository(persistence: ResearchRetentionPersistence) {
  return {
    async eraseSourcePayload(input: EraseResearchSourcePayload): Promise<ResearchSourceErasure> {
      const request = erasureRequestSchema.parse(input);
      let result: { data: unknown; error: unknown };
      try {
        result = await persistence.rpc("erase_research_source_payload", {
          p_organization_id: request.organizationId,
          p_source_id: request.sourceId,
          p_reason_code: request.reasonCode,
          p_include_derived_text: request.includeDerivedText,
        });
      } catch {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_UNAVAILABLE",
          "Evidence could not be erased.",
        );
      }
      if (result.error) {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_UNAVAILABLE",
          "Evidence could not be erased.",
        );
      }
      const parsed = erasureResponseSchema.safeParse(result.data);
      if (!parsed.success) {
        throw new GrowthIntelligenceError(
          "RESEARCH_BUDGET_UNAVAILABLE",
          "Evidence could not be erased.",
        );
      }
      return parsed.data;
    },
  };
}
