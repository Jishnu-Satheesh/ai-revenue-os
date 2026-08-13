import { z } from "zod";

import { decisionRecordSchema } from "@/domain/decisions/record";

export type OpportunityStatus =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "snoozed"
  | "expired";

/** Safe feed projection: evidence payloads and worker inputs stay server-side. */
export type OpportunityFeedItem = {
  id: string;
  organizationId: string;
  decisionRecordId: string;
  playbookVersionId: string;
  title: string;
  summary: string;
  evidenceTier: "computed" | "observed" | "prior";
  impactLowMinor: number;
  impactHighMinor: number;
  executionCostMinor: number;
  expectedContributionMinor: number;
  currency: string;
  timeToImpactDays: number;
  status: OpportunityStatus;
  expiresAt: string;
};

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const minorUnitSchema = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER);
const boundedJsonObjectSchema = z
  .object({})
  .catchall(z.json())
  .superRefine((value, context) => {
    if (Object.keys(value).length > 100 || JSON.stringify(value).length > 20_000) {
      context.addIssue({ code: "custom", message: "Structured decision data exceeds its bound." });
    }
  });
const nonEmptyBoundedJsonObjectSchema = boundedJsonObjectSchema.refine(
  (value) => Object.keys(value).length > 0,
  "Structured decision data must name its evidence or evaluation fields.",
);

export const decisionFeedbackInputSchema = z
  .strictObject({
    organizationId: z.string().uuid(),
    opportunityId: z.string().uuid(),
    feedbackKind: z.enum(["approved", "rejected", "snoozed", "edited", "more_evidence_requested"]),
    reason: z.string().trim().min(1).max(500).nullable(),
    editDiff: z
      .strictObject({
        title: z.string().max(240).optional(),
        summary: z.string().max(4000).optional(),
        assumptions: z.array(z.string().max(500)).max(50).optional(),
      })
      .nullable(),
    correlationId: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (value.feedbackKind === "edited" && value.editDiff === null) {
      context.addIssue({
        code: "custom",
        path: ["editDiff"],
        message: "An edit needs its bounded diff.",
      });
    }
  });
export type DecisionFeedbackInput = z.infer<typeof decisionFeedbackInputSchema>;

export const artifactPromotionInputSchema = z.strictObject({
  organizationId: z.string().uuid(),
  artifactKey: z.enum(["confidence_calibration", "ranking_weights", "prompt", "model", "judge"]),
  artifactVersionId: z.string().uuid(),
  expectedCurrentArtifactVersionId: z.string().uuid(),
  promotedBy: z.string().trim().min(1).max(160),
});
export type ArtifactPromotionInput = z.infer<typeof artifactPromotionInputSchema>;

/**
 * One cycle is deliberately bounded below the aggregate's 500-candidate cap:
 * at most 100 feed slots and at most 500 candidates may reach scoring.
 */
export const decisionCycleInputSchema = z.strictObject({
  id: z.string().uuid().optional(),
  organizationId: z.string().uuid(),
  triggerName: z.string().trim().min(1).max(160),
  correlationId: z.string().uuid(),
  slotBudget: z.number().int().min(0).max(100),
  maxScoredCandidates: z.number().int().min(0).max(500),
});
export type DecisionCycleInput = z.infer<typeof decisionCycleInputSchema>;

export const decisionCandidateSchema = z
  .strictObject({
    playbookVersionId: z.string().uuid(),
    candidateFingerprint: sha256HexSchema,
    subjectKind: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/),
    subjectRef: z.string().min(1).max(200),
    parameterDigest: sha256HexSchema,
    impactLowMinor: minorUnitSchema,
    impactHighMinor: minorUnitSchema,
    confidence: z.number().min(0).max(1),
    executionCostMinor: minorUnitSchema,
    expectedContributionMinor: minorUnitSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    evidenceTier: z.enum(["computed", "observed", "prior"]),
    eligibilityResult: boundedJsonObjectSchema,
    policyResult: boundedJsonObjectSchema,
    rejectionReason: z.string().min(1).max(240).nullable(),
    rank: z.number().int().positive(),
  })
  .refine((candidate) => candidate.impactHighMinor >= candidate.impactLowMinor, {
    path: ["impactHighMinor"],
    message: "The candidate impact range cannot be inverted.",
  });

export const decisionOpportunitySchema = z
  .strictObject({
    id: z.string().uuid(),
    playbookVersionId: z.string().uuid(),
    candidateFingerprint: sha256HexSchema,
    title: z.string().min(1).max(240),
    summary: z.string().min(1).max(4000),
    hypothesis: z.string().min(1).max(4000),
    subjectKind: z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/),
    subjectRef: z.string().min(1).max(200),
    evidenceBundle: nonEmptyBoundedJsonObjectSchema,
    assumptions: z.array(z.string().min(1).max(500)).max(50),
    impactLowMinor: minorUnitSchema,
    impactHighMinor: minorUnitSchema,
    confidence: z.number().min(0).max(1),
    confidenceRationale: z.string().min(1).max(2000),
    evidenceTier: z.enum(["computed", "observed", "prior"]),
    executionCostMinor: minorUnitSchema,
    expectedContributionMinor: minorUnitSchema,
    currency: z.string().regex(/^[A-Z]{3}$/),
    timeToImpactDays: z.number().int().nonnegative(),
    riskTier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    approvalPath: z.enum(["automatic", "human_approval"]),
    guardrails: z.array(boundedJsonObjectSchema).max(50),
    assertions: z
      .array(
        z.strictObject({
          key: z.string().min(1).max(120),
          expectedOutcome: z.string().min(1).max(200),
        }),
      )
      .min(1)
      .max(50),
    evaluationPlan: nonEmptyBoundedJsonObjectSchema,
    expiresAt: z.string().datetime({ offset: true }),
    status: z.enum(["proposed", "awaiting_approval", "approved", "rejected", "snoozed", "expired"]),
  })
  .refine((opportunity) => opportunity.impactHighMinor >= opportunity.impactLowMinor, {
    path: ["impactHighMinor"],
    message: "The opportunity impact range cannot be inverted.",
  });

export const decisionAggregateSchema = z
  .strictObject({
    record: decisionRecordSchema,
    candidates: z.array(decisionCandidateSchema).max(500),
    opportunity: decisionOpportunitySchema.nullable(),
  })
  .superRefine((aggregate, context) => {
    const { candidates, opportunity, record } = aggregate;
    if (record.scoredCount !== candidates.length) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "The persisted candidate set must equal scoredCount.",
      });
    }

    const fingerprints = new Set(
      candidates.map(({ candidateFingerprint }) => candidateFingerprint),
    );
    if (fingerprints.size !== candidates.length) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "A decision cannot persist the same scored candidate twice.",
      });
    }

    const playbookVersionId = record.versionTuple.playbookVersionId;
    if (candidates.length > 0 && playbookVersionId === undefined) {
      context.addIssue({
        code: "custom",
        path: ["record", "versionTuple", "playbookVersionId"],
        message: "A scored candidate means a playbook applied.",
      });
    }
    if (
      playbookVersionId !== undefined &&
      candidates.some((candidate) => candidate.playbookVersionId !== playbookVersionId)
    ) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Every scored candidate must use the recorded playbook version.",
      });
    }

    if (record.outcome !== "action_selected") {
      if (opportunity !== null) {
        context.addIssue({
          code: "custom",
          path: ["opportunity"],
          message: "Only a selected action carries an opportunity.",
        });
      }
      return;
    }

    if (opportunity === null) {
      context.addIssue({
        code: "custom",
        path: ["opportunity"],
        message: "A selected action carries exactly one opportunity.",
      });
      return;
    }

    const selected = candidates.filter(
      ({ candidateFingerprint }) => candidateFingerprint === record.selectedCandidateFingerprint,
    );
    if (selected.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Exactly one scored candidate must match the selected fingerprint.",
      });
      return;
    }

    if (opportunity.id !== record.opportunityId) {
      context.addIssue({
        code: "custom",
        path: ["opportunity", "id"],
        message: "The opportunity id must match the decision record.",
      });
    }

    const candidate = selected[0]!;
    const sharedFields = [
      "playbookVersionId",
      "candidateFingerprint",
      "subjectKind",
      "subjectRef",
      "impactLowMinor",
      "impactHighMinor",
      "confidence",
      "evidenceTier",
      "executionCostMinor",
      "expectedContributionMinor",
      "currency",
    ] as const;
    for (const field of sharedFields) {
      if (opportunity[field] !== candidate[field]) {
        context.addIssue({
          code: "custom",
          path: ["opportunity", field],
          message: `The opportunity ${field} must match its selected candidate.`,
        });
      }
    }
  });
export type DecisionAggregate = z.infer<typeof decisionAggregateSchema>;

export type DecisionReadPort = {
  listOpportunities(organizationId: string): Promise<readonly OpportunityFeedItem[]>;
};

export type DecisionFeedbackPort = {
  appendFeedback(input: DecisionFeedbackInput): Promise<string>;
};

/** Worker-only boundary. Browser repositories never expose this capability. */
export type DecisionWorkerStore = {
  persist(aggregate: DecisionAggregate): Promise<void>;
  promoteArtifact(input: ArtifactPromotionInput): Promise<string>;
  startCycle(input: DecisionCycleInput): Promise<string>;
};
