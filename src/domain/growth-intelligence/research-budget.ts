import { z } from "zod";

import {
  RESEARCH_BUDGET_LIMITS,
  researchAttemptUsageSchema,
} from "@/domain/growth-intelligence/research-pipeline";

export { RESEARCH_BUDGET_LIMITS, researchAttemptUsageSchema };
export type {
  ResearchAttemptUsage,
  ResearchAttemptUsageSummary,
} from "@/domain/growth-intelligence/research-pipeline";

/**
 * One consistent typed boundary for paid research spend. A manual pipeline, a
 * weekly synthesis run and legacy paid research all draw from the same
 * organization-day allowance; the scope below is the single discriminated
 * pipeline-or-request key every reservation entry point accepts, so the three
 * callers cannot drift into incompatible interfaces.
 */
export const researchWorkScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("pipeline"), pipelineId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal("request"), requestId: z.string().uuid() }).strict(),
]);

export type ResearchWorkScope = z.infer<typeof researchWorkScopeSchema>;

export type ResearchWorkScopeKey = {
  kind: "pipeline" | "request";
  id: string;
};

/**
 * Maps the typed scope onto the ledger key the fenced RPCs accept. The
 * database resolves the allowance day itself from the organization's own
 * timezone, so callers never supply spend totals or calendar days.
 */
export function toResearchWorkScopeKey(scope: ResearchWorkScope): ResearchWorkScopeKey {
  const parsed = researchWorkScopeSchema.parse(scope);
  return parsed.kind === "pipeline"
    ? { kind: "pipeline", id: parsed.pipelineId }
    : { kind: "request", id: parsed.requestId };
}

/**
 * A bounded worst-case quote. The whole-pipeline ceiling (USD 1) caps every
 * scope, including standalone synthesis and legacy research: a bounded quote
 * is the price of admission, never a post-hoc clamp on actuals.
 */
export const researchQuoteSchema = z
  .object({
    quoteMicrosUsd: z
      .number()
      .int()
      .min(1)
      .max(RESEARCH_BUDGET_LIMITS.maxPipelineReservationMicrosUsd),
    priceVersion: z.string().trim().min(1).max(80),
  })
  .strict();

export type ResearchQuote = z.infer<typeof researchQuoteSchema>;

export function validateResearchQuote(quote: ResearchQuote): ResearchQuote {
  return researchQuoteSchema.parse(quote);
}

export const researchAttemptPhaseSchema = z.enum(["research", "synthesis"]);

export type ResearchAttemptPhase = z.infer<typeof researchAttemptPhaseSchema>;

/**
 * Per-attempt reservation before a paid call. The worst-case amount is
 * debited from the admitted quote first; replays reuse the same attempt key
 * and never debit twice.
 */
export const researchAttemptReservationSchema = z
  .object({
    scope: researchWorkScopeSchema,
    phase: researchAttemptPhaseSchema,
    slotKey: z.string().trim().min(1).max(160),
    attemptIndex: z.number().int().min(0).max(100),
    maximumMicrosUsd: z
      .number()
      .int()
      .min(1)
      .max(RESEARCH_BUDGET_LIMITS.maxPipelineReservationMicrosUsd),
    claimToken: z.string().uuid(),
  })
  .strict();

export type ResearchAttemptReservation = z.infer<typeof researchAttemptReservationSchema>;

/**
 * Explicit reconciliation of an issued attempt. Unknown cost stays reserved
 * under its full worst case until a later receipt reconciles it; nothing
 * expires it on a timer and nothing converts it to zero.
 */
export const settleResearchAttemptSchema = z
  .object({
    attemptId: z.string().uuid(),
    usage: researchAttemptUsageSchema,
  })
  .strict();

export type SettleResearchAttempt = z.infer<typeof settleResearchAttemptSchema>;

/**
 * Rights the provider agreement must grant before any paid call. Missing or
 * expired qualification disables Start with a safe explanation; the platform
 * never silently falls back to another provider.
 */
export const RESEARCH_PROVIDER_REQUIRED_USES = [
  "snippet_storage",
  "commercial_inference",
  "organization_display",
  "derived_claims",
  "synthesis_reuse",
  "agreed_retention",
] as const;

export type ResearchProviderRequiredUse = (typeof RESEARCH_PROVIDER_REQUIRED_USES)[number];

/**
 * Safe blocker codes the qualification check may report. These are stable
 * operator-facing codes, never credentials, contract text, or payload data.
 */
export const RESEARCH_PROVIDER_BLOCKER_CODES = [
  "qualification_missing",
  "agreement_missing",
  "agreement_expired",
  "required_rights_missing",
  "rates_missing",
  "credential_missing",
  "model_bounds_missing",
  "controlled_canary_missing",
] as const;

export type ResearchProviderBlockerCode = (typeof RESEARCH_PROVIDER_BLOCKER_CODES)[number];

export const researchProviderQualificationSchema = z
  .object({
    provider: z.literal("brave"),
    available: z.boolean(),
    blockers: z.array(z.string()),
  })
  .strict()
  .superRefine((qualification, context) => {
    if (qualification.available && qualification.blockers.length > 0) {
      context.addIssue({
        code: "custom",
        message: "An available provider must report no blockers.",
      });
    }
    if (!qualification.available && qualification.blockers.length === 0) {
      context.addIssue({
        code: "custom",
        message: "An unavailable provider must name at least one blocker.",
      });
    }
  });

export type ResearchProviderQualification = z.infer<typeof researchProviderQualificationSchema>;

/**
 * Returns true only when the qualification carries no blockers. Any unknown
 * shape fails closed: the caller must treat it as unqualified.
 */
export function isResearchProviderQualified(qualification: ResearchProviderQualification): boolean {
  const parsed = researchProviderQualificationSchema.parse(qualification);
  return parsed.available && parsed.blockers.length === 0;
}

/**
 * Bounded excerpt provenance recorded at admission. Every retained excerpt
 * carries the qualification version it was kept under and its retain-until
 * policy; payloads without provenance are legacy rows, not new admissions.
 */
export const researchExcerptProvenanceSchema = z
  .object({
    excerptText: z.string().min(1).max(RESEARCH_BUDGET_LIMITS.maxExcerptCharacters),
    excerptDigest: z.string().regex(/^[a-f0-9]{64}$/),
    qualificationVersion: z.string().trim().min(1).max(80),
    retainUntil: z.string().datetime({ offset: true }),
  })
  .strict();

export type ResearchExcerptProvenance = z.infer<typeof researchExcerptProvenanceSchema>;

export const researchSupportVerdictSchema = z.enum(["supported", "unsupported", "uncertain"]);

export type ResearchSupportVerdict = z.infer<typeof researchSupportVerdictSchema>;

/**
 * Support-review provenance: who judged a derived link, when, and how.
 * Verdict and review time travel together; the reviewer reference is the
 * only free text and never carries payload content.
 */
export const researchSupportReviewSchema = z
  .object({
    supportVerdict: researchSupportVerdictSchema,
    reviewedAt: z.string().datetime({ offset: true }),
    reviewerRef: z.string().trim().min(1).max(160).nullable(),
  })
  .strict();

export type ResearchSupportReview = z.infer<typeof researchSupportReviewSchema>;

/**
 * Bounded no-tool model budgets for the extraction and support-review
 * phases. Each phase may issue at most four calls (one bounded repair
 * included); every call stays within its input/output token bound and every
 * batch holds at most ten sources. Billable reasoning tokens ride inside the
 * same per-call output bound; hidden SDK retries stay disabled.
 */
export const RESEARCH_MODEL_PHASES = ["extraction", "support_review"] as const;

export type ResearchModelPhase = (typeof RESEARCH_MODEL_PHASES)[number];

export const RESEARCH_MODEL_CALL_LIMITS = {
  extraction: { maxCalls: 4, maxInputTokens: 12_000, maxOutputTokens: 4_000 },
  support_review: { maxCalls: 4, maxInputTokens: 12_000, maxOutputTokens: 4_000 },
} as const;

/** At most ten sources travel in one model batch (four batches cover forty). */
export const RESEARCH_MODEL_MAX_SOURCES_PER_BATCH = 10;

export const researchModelBudgetSchema = z
  .object({
    phase: z.enum(RESEARCH_MODEL_PHASES),
    maxCalls: z.number().int().min(1).max(4),
    maxInputTokens: z.number().int().min(1).max(12_000),
    maxOutputTokens: z.number().int().min(1).max(4_000),
    maxSourcesPerBatch: z.number().int().min(1).max(RESEARCH_MODEL_MAX_SOURCES_PER_BATCH),
  })
  .strict()
  .superRefine((budget, context) => {
    const ceiling = RESEARCH_MODEL_CALL_LIMITS[budget.phase];
    if (budget.maxCalls > ceiling.maxCalls) {
      context.addIssue({ code: "custom", message: "A model phase cannot exceed four calls." });
    }
    if (budget.maxInputTokens > ceiling.maxInputTokens) {
      context.addIssue({
        code: "custom",
        message: "A model call cannot exceed 12,000 input tokens.",
      });
    }
    if (budget.maxOutputTokens > ceiling.maxOutputTokens) {
      context.addIssue({
        code: "custom",
        message: "A model call cannot exceed 4,000 output tokens.",
      });
    }
  });

export type ResearchModelBudget = z.infer<typeof researchModelBudgetSchema>;

/**
 * Conservative token estimate for prompt bounding: four characters per
 * token. Real billable bounds are enforced by the staged model agreement;
 * this estimate only keeps prompts inside the call ceiling before issuing.
 */
export function estimateResearchPromptTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

export const researchErasureReasonSchema = z.string().regex(/^[A-Z][A-Z0-9_]{2,80}$/);

export type ResearchErasureReason = z.infer<typeof researchErasureReasonSchema>;

export type ResearchSourceAvailability = "available" | "unavailable" | "excluded";

export type ResearchSourceEligibilityInput = {
  availability: ResearchSourceAvailability;
  erasedAt: string | null;
};

/**
 * Eligibility withdrawal for synthesis. An erased source cannot support new
 * synthesis even if its row still renders for history; never-erased
 * unavailable or excluded rows keep their existing admission behavior and
 * are judged by their owning task.
 */
export function isResearchSourceEligibleForSynthesis(
  source: ResearchSourceEligibilityInput,
): boolean {
  if (source.erasedAt !== null) return false;
  return source.availability === "available";
}

/**
 * History rendering for a source row. Erased payloads render an explicit
 * source-unavailable state: safe IDs, digests, decisions and events survive,
 * content does not.
 */
export function renderResearchSourceState(source: ResearchSourceEligibilityInput): {
  state: "available" | "source_unavailable";
} {
  if (source.erasedAt !== null || source.availability !== "available") {
    return { state: "source_unavailable" };
  }
  return { state: "available" };
}
