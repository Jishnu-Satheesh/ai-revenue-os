import { z } from "zod";

import { validateOutcomeWording } from "@/domain/campaigns/measurement";
import type { CampaignVerdict } from "@/domain/campaigns/measurement";
import { DomainError, type DomainErrorCode } from "@/lib/errors";

/**
 * The public source contract for campaign Business Memory capture.
 *
 * Like a packing list taped to a box: it names exactly what may leave the
 * campaign and what must stay behind. Lifecycle carries version and schedule,
 * never the words, the money, or the artwork. Outcomes carry the settled
 * verdict with its method and limits, never a win invented from a shrug.
 * Lessons leave only when a person submits them, and only once.
 *
 * Memory never overrides the campaign's own truth. Assertions, spend, legal,
 * brand, credentials, asset bytes, and policy stay authoritative where they
 * were written; captured text is planning context only.
 */

export const CAMPAIGN_SAFE_VERDICTS = [
  "validated_outcome",
  "inconclusive",
  "guardrail_breach",
  "execution_only",
] as const;
export type CampaignSafeVerdict = (typeof CAMPAIGN_SAFE_VERDICTS)[number];

const uuidSchema = z.string().uuid();
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Fields that memory must never overwrite. Kept beside the code that enforces it. */
export const MEMORY_NEVER_OVERRIDES = [
  "assertions",
  "spend",
  "legal",
  "brand",
  "credentials",
  "asset_truth",
  "policy",
] as const;

/** Lifecycle projection: version, branch, scope, schedule, status. Nothing else. */
export const campaignStateProjectionSchema = z.strictObject({
  organizationId: uuidSchema,
  campaignId: uuidSchema,
  bundleVersionId: uuidSchema,
  version: z.number().int().positive(),
  digest: digestSchema,
  branchId: uuidSchema.nullable(),
  scope: z.enum(["organization", "branch"]),
  scheduledFor: z.array(z.string().datetime({ offset: false })).max(50),
  status: z.enum([
    "draft",
    "needs_data",
    "ready_for_review",
    "approved",
    "scheduled",
    "executing",
    "measuring",
    "completed",
    "partially_completed",
    "blocked",
    "cancelled",
    "failed",
  ]),
});
export type CampaignStateProjection = z.infer<typeof campaignStateProjectionSchema>;

/** Settled verdict projection: baseline, metric, method, window, limits. */
export const campaignOutcomeProjectionSchema = z.strictObject({
  organizationId: uuidSchema,
  campaignId: uuidSchema,
  outcomeId: uuidSchema,
  bundleVersionId: uuidSchema,
  planDigest: digestSchema,
  verdict: z.enum(CAMPAIGN_SAFE_VERDICTS),
  primaryMetricKey: z.string().trim().min(1).max(160),
  baselineSource: z.string().trim().min(1).max(240),
  attributionMethod: z.enum(["observational_prepost", "provider_randomized_experiment"]),
  outcomeWindowDays: z.number().int().min(1).max(365),
  settlementDelayDays: z.number().int().min(0).max(90),
  limitations: z.array(z.string().trim().min(1).max(300)).max(20),
  evidenceTier: z.enum(["computed", "observed"]).nullable(),
});
export type CampaignOutcomeProjection = z.infer<typeof campaignOutcomeProjectionSchema>;

/** Lesson projection: exactly one proposed lesson per submitted promotion. */
export const campaignLessonProjectionSchema = z.strictObject({
  organizationId: uuidSchema,
  campaignId: uuidSchema,
  proposalId: uuidSchema,
  outcomeId: uuidSchema,
  status: z.enum(["proposed", "dismissed", "campaign_only", "submitted_for_promotion"]),
  proposedLesson: z.string().trim().min(1).max(4000),
  verdict: z.enum(CAMPAIGN_SAFE_VERDICTS),
  citedEvidenceIds: z.array(uuidSchema).max(50),
});
export type CampaignLessonProjection = z.infer<typeof campaignLessonProjectionSchema>;

/** Review extension for captured lessons only. */
export const lessonReviewExtensionSchema = z.strictObject({
  proposalId: uuidSchema,
  expectedRevision: z.number().int().positive(),
  validRoots: z.array(uuidSchema).max(100),
  applicability: z.string().trim().min(1).max(2000),
  reviewDate: z.string().datetime({ offset: false }),
});
export type LessonReviewExtension = z.infer<typeof lessonReviewExtensionSchema>;

function fail(code: DomainErrorCode, message: string): never {
  throw new DomainError(code, message);
}

/**
 * Projects safe lifecycle state. Strips everything the brief forbids.
 *
 * The input may carry the whole campaign row; the output carries only the
 * envelope an operator could read from a schedule board. Assertions, spend
 * ceilings, asset bytes, and policy documents are dropped here, not downstream.
 */
export function projectCampaignState(input: {
  organizationId: string;
  campaignId: string;
  bundleVersionId: string;
  version: number;
  digest: string;
  branchId?: string | null;
  scheduledFor: readonly string[];
  status: CampaignStateProjection["status"];
}): CampaignStateProjection {
  const parsed = campaignStateProjectionSchema.safeParse({
    organizationId: input.organizationId,
    campaignId: input.campaignId,
    bundleVersionId: input.bundleVersionId,
    version: input.version,
    digest: input.digest,
    branchId: input.branchId ?? null,
    scope: input.branchId ? "branch" : "organization",
    scheduledFor: [...input.scheduledFor],
    status: input.status,
  });
  if (!parsed.success) fail("VALIDATION_ERROR", "The campaign lifecycle could not be projected.");
  return parsed.data;
}

/**
 * Projects a settled verdict. Approval, publication, exposure, and success are
 * four different facts and stay four different fields upstream; this record
 * carries only the settled verdict with its method and limits.
 */
export function projectCampaignOutcome(
  input: z.input<typeof campaignOutcomeProjectionSchema>,
): CampaignOutcomeProjection {
  const parsed = campaignOutcomeProjectionSchema.safeParse(input);
  if (!parsed.success) fail("VALIDATION_ERROR", "The campaign outcome could not be projected.");
  return parsed.data;
}

/**
 * Whether an inconclusive or execution-only result is being dressed as a win.
 *
 * Delegates to the same deterministic wording gate the learning service uses,
 * so memory and the evidence loop can never disagree about what counts as
 * winning language.
 */
export function isWinningTacticLanguage(lesson: string, verdict: CampaignVerdict): boolean {
  const violations = validateOutcomeWording({ text: lesson, verdict });
  return violations.length > 0;
}

export function assertVerdictSafeLesson(lesson: string, verdict: CampaignVerdict): void {
  if (
    (verdict === "inconclusive" || verdict === "execution_only") &&
    isWinningTacticLanguage(lesson, verdict)
  ) {
    fail(
      "VALIDATION_ERROR",
      "An inconclusive result cannot be recorded as a winning tactic.",
    );
  }
  if (isWinningTacticLanguage(lesson, verdict)) {
    fail("VALIDATION_ERROR", "The lesson wording overclaims against its verdict.");
  }
}

/**
 * Whether a lesson may enter shared retrieval.
 *
 * Only `submitted_for_promotion` leaves the campaign. Proposed, campaign-only,
 * and dismissed lessons stay local: a draft is not evidence and a refusal is
 * not a recommendation.
 */
export function isSharedRetrievableLesson(status: CampaignLessonProjection["status"]): boolean {
  return status === "submitted_for_promotion";
}

export function projectCampaignLesson(
  input: z.input<typeof campaignLessonProjectionSchema>,
): CampaignLessonProjection | null {
  const parsed = campaignLessonProjectionSchema.safeParse(input);
  if (!parsed.success) fail("VALIDATION_ERROR", "The campaign lesson could not be projected.");
  const lesson = parsed.data;
  assertVerdictSafeLesson(lesson.proposedLesson, lesson.verdict);
  if (!isSharedRetrievableLesson(lesson.status)) return null;
  return lesson;
}

/** Duplicate submit: the same proposal submitted twice replays, never duplicates. */
export function isDuplicateLessonSubmit(previous: { proposalId: string }, next: {
  proposalId: string;
}): boolean {
  return previous.proposalId === next.proposalId;
}

/** Concurrent reviewers: the first decision wins; a second decision is refused. */
export function assertLessonStillProposed(status: string): void {
  if (status !== "proposed") {
    fail("WORKFLOW_ERROR", "This lesson was already decided by another reviewer.");
  }
}

/** Cross-tenant evidence is refused, never filtered silently. */
export function assertSameTenant(organizationId: string, evidenceOrganizationId: string): void {
  if (organizationId !== evidenceOrganizationId) {
    fail("TENANT_SCOPE_ERROR", "That evidence belongs to another organization.");
  }
}

/** Withdrawn roots invalidate the lesson that cites them. */
export function assertRootsLive(input: {
  citedEvidenceIds: readonly string[];
  withdrawnIds: readonly string[];
}): void {
  const withdrawn = new Set(input.withdrawnIds.map((id) => id.toLowerCase()));
  const hit = input.citedEvidenceIds.find((id) => withdrawn.has(id.toLowerCase()));
  if (hit) fail("DOMAIN_ERROR", "A cited source was corrected and this lesson no longer stands.");
}

/** Source correction invalidates reviewed lessons, whatever the review said. */
export function isLessonInvalidatedByCorrection(input: {
  citedEvidenceIds: readonly string[];
  correctedIds: readonly string[];
}): boolean {
  const corrected = new Set(input.correctedIds.map((id) => id.toLowerCase()));
  return input.citedEvidenceIds.some((id) => corrected.has(id.toLowerCase()));
}

/** Direct verification of captured recommendations and decisions stays forbidden. */
export function assertLessonReviewable(input: {
  memoryType: string;
  origin: string;
  knowledgeKind?: string | null;
}): void {
  if (input.memoryType === "decision" || input.knowledgeKind === "operator_decision") {
    fail("AUTHORIZATION_ERROR", "Captured decisions are reviewed, never verified.");
  }
  if (input.knowledgeKind === "recommendation") {
    fail("AUTHORIZATION_ERROR", "Captured recommendations are reviewed, never verified.");
  }
}

export function validateLessonReviewExtension(
  input: z.input<typeof lessonReviewExtensionSchema>,
): LessonReviewExtension {
  const parsed = lessonReviewExtensionSchema.safeParse(input);
  if (!parsed.success) fail("VALIDATION_ERROR", "The lesson review could not be recorded.");
  return parsed.data;
}
