import { z } from "zod";

/**
 * Durable research-to-synthesis lifecycle. A successful research request is not
 * a successful pipeline: evidence still has to reach synthesis before the
 * product may show anything past "Preparing insights".
 */
export const RESEARCH_PIPELINE_STAGES = [
  "queued",
  "researching",
  "preparing_insights",
  "ready",
  "partial",
  "no_findings",
  "research_failed",
  "synthesis_failed",
  "cancelled",
] as const;

export type ResearchPipelineStage = (typeof RESEARCH_PIPELINE_STAGES)[number];

export const RESEARCH_PIPELINE_STAGE_DISPLAY: Record<ResearchPipelineStage, string> = {
  queued: "Queued",
  researching: "Researching",
  preparing_insights: "Preparing insights",
  ready: "Ready",
  partial: "Ready with limitations",
  no_findings: "No usable findings",
  research_failed: "Research could not finish",
  synthesis_failed: "Research saved; insights could not finish",
  cancelled: "Replaced or cancelled",
};

export const TERMINAL_RESEARCH_PIPELINE_STAGES: readonly ResearchPipelineStage[] = [
  "ready",
  "partial",
  "no_findings",
  "research_failed",
  "synthesis_failed",
  "cancelled",
];

export function isTerminalPipelineStage(stage: ResearchPipelineStage): boolean {
  return TERMINAL_RESEARCH_PIPELINE_STAGES.includes(stage);
}

export const RESEARCH_COVERAGE_SLOT_KINDS = ["local_market", "topic", "competitor"] as const;

export type ResearchCoverageSlotKind = (typeof RESEARCH_COVERAGE_SLOT_KINDS)[number];

export const RESEARCH_COVERAGE_OUTCOMES = [
  "not_started",
  "searched_no_usable_evidence",
  "supported",
  "failed",
  "skipped_budget",
  "skipped_policy",
] as const;

export type ResearchCoverageOutcome = (typeof RESEARCH_COVERAGE_OUTCOMES)[number];

export const researchCoverageEntrySchema = z
  .object({
    slotKey: z.string().trim().min(1).max(160),
    kind: z.enum(RESEARCH_COVERAGE_SLOT_KINDS),
    outcome: z.enum(RESEARCH_COVERAGE_OUTCOMES),
    attemptIds: z.array(z.string().uuid()).max(28).optional().default([]),
    acceptedClaimIds: z.array(z.string().uuid()).optional().default([]),
  })
  .strict();

export type ResearchCoverageEntry = z.infer<typeof researchCoverageEntrySchema>;

const researchCompletionInputSchema = z.object({
  rootOutcome: z.enum(["succeeded", "failed"]),
  eligibleClaimCount: z.number().int().min(0),
});

/**
 * Maps a finished research root onto the pipeline envelope. Root success with
 * eligible claims only reaches preparing_insights; an empty but healthy run is
 * no_findings, never a failure.
 */
export function resolvePipelineStageAfterResearch(input: {
  rootOutcome: "succeeded" | "failed";
  eligibleClaimCount: number;
}): Extract<ResearchPipelineStage, "preparing_insights" | "no_findings" | "research_failed"> {
  const completion = researchCompletionInputSchema.parse(input);
  if (completion.rootOutcome === "failed") return "research_failed";
  return completion.eligibleClaimCount > 0 ? "preparing_insights" : "no_findings";
}

/** Conservative launch ceilings from the approved market-monitoring plan. */
export const RESEARCH_BUDGET_LIMITS = {
  maxPrimarySearches: 26,
  maxRetryAttempts: 2,
  maxResultsPerQuery: 5,
  maxResponseBytes: 524_288,
  maxStreamedBytesTotal: 8_388_608,
  maxRetainedSources: 40,
  maxExcerptCharacters: 2_000,
  maxTotalExcerptCharacters: 65_536,
  maxPipelineReservationMicrosUsd: 1_000_000,
  maxOrganizationDayAllowanceMicrosUsd: 5_000_000,
} as const;

/**
 * Spend observed for one call attempt. Unknown cost is a first-class outcome:
 * it stays reserved until explicit reconciliation, never silently zero.
 */
export const researchAttemptUsageSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("reported"), microsUsd: z.number().int().min(0) }).strict(),
  z.object({ kind: z.literal("estimated"), microsUsd: z.number().int().min(0) }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);

export type ResearchAttemptUsage = z.infer<typeof researchAttemptUsageSchema>;

export type ResearchAttemptUsageSummary = {
  knownMicrosUsd: number;
  unknownCount: number;
};

/**
 * Adds reported and estimated spend. Unknown cost is counted, never converted
 * to zero: callers must keep its reservation until explicit reconciliation.
 */
export function sumKnownAttemptCost(
  attempts: readonly ResearchAttemptUsage[],
): ResearchAttemptUsageSummary {
  let knownMicrosUsd = 0;
  let unknownCount = 0;

  for (const attempt of attempts) {
    const parsed = researchAttemptUsageSchema.parse(attempt);
    if (parsed.kind === "unknown") {
      unknownCount += 1;
    } else {
      knownMicrosUsd += parsed.microsUsd;
    }
  }

  return { knownMicrosUsd, unknownCount };
}

const consumedRetryAttemptsSchema = z.number().int().min(0);

/**
 * Retry allowance left for a run. Consumed attempts stay consumed across
 * replays and lease retries, so the same evidence never widens the ceiling.
 */
export function remainingRetryAttempts(consumedRetryAttempts: number): number {
  const consumed = consumedRetryAttemptsSchema.parse(consumedRetryAttempts);
  return Math.max(0, RESEARCH_BUDGET_LIMITS.maxRetryAttempts - consumed);
}
