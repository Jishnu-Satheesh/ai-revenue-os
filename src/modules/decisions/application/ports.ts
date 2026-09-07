import { z } from "zod";

import { decisionRecordSchema } from "@/domain/decisions/record";

export type OpportunityStatus =
  | "proposed"
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "snoozed"
  | "expired"
  | "draft_requested"
  | "draft_created";

/** Safe feed projection: evidence payloads and worker inputs stay server-side. */
export type OpportunityFeedItem = {
  id: string;
  organizationId: string;
  decisionRecordId: string;
  playbookVersionId: string;
  /**
   * The action key stored on the playbook definition, read through the
   * version join. Callers must never substitute a code default: the stored
   * value is what the Decision Engine actually selected.
   */
  actionKey: string;
  createdAt: string;
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
  /** Exact version the draft request must name back. */
  version: number;
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

const registeredKeySchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,119}$/);
const utcTimestampSchema = z.string().datetime({ offset: true });

export const decisionOperationInputSchema = z.strictObject({
  organizationId: z.string().uuid(),
  correlationId: z.string().uuid(),
  idempotencyKey: z
    .string()
    .trim()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/),
  requestDigest: sha256HexSchema,
  triggerType: z.enum(["manual", "scheduled", "integration_sync_completed"]),
});
export type DecisionOperationInput = z.infer<typeof decisionOperationInputSchema>;

const liveClaimShape = {
  decisionCycleId: z.string().uuid(),
  claimToken: z.string().uuid(),
  leaseExpiresAt: utcTimestampSchema,
};

export const decisionClaimResultSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("acquired"), ...liveClaimShape }),
  z.strictObject({ status: z.literal("reclaimed"), ...liveClaimShape }),
  z.strictObject({
    status: z.literal("in_progress"),
    decisionCycleId: z.string().uuid(),
    leaseExpiresAt: utcTimestampSchema,
  }),
  z.strictObject({
    status: z.literal("completed"),
    decisionCycleId: z.string().uuid(),
    decisionRecordId: z.string().uuid(),
    opportunityId: z.string().uuid().nullable(),
  }),
  z.strictObject({ status: z.literal("cancelled"), decisionCycleId: z.string().uuid() }),
]);
export type DecisionClaimResult = z.infer<typeof decisionClaimResultSchema>;

export const decisionLiveClaimSchema = decisionOperationInputSchema.extend(liveClaimShape);
export type DecisionLiveClaim = z.infer<typeof decisionLiveClaimSchema>;

export const decisionEvidenceContextSchema = z.strictObject({
  organizationProfileCurrent: z.boolean(),
  brandConstraintsVerified: z.boolean(),
  brandAssetsUsable: z.boolean(),
  syntheticAssetsAllowed: z.boolean(),
  economics: z
    .strictObject({
      currency: z.string().regex(/^[A-Z]{3}$/),
      completenessGrade: z.enum(["complete", "partial", "indicative"]),
    })
    .nullable(),
  activeGoalMetricKeys: z.array(registeredKeySchema).max(100),
  metaAccountMapped: z.boolean(),
  grantedCapabilityKeys: z.array(registeredKeySchema).max(100),
  trackingReady: z.boolean(),
  measurementPlanRegistered: z.boolean(),
  marginFirewallResult: z.enum(["pass", "breach", "unknown"]),
  inputsObservedAt: utcTimestampSchema.nullable(),
  observedVolume: z.number().int().nonnegative(),
});

export const decisionCycleContextSchema = z.strictObject({
  organizationId: z.string().uuid(),
  organizationCurrency: z.string().regex(/^[A-Z]{3}$/),
  accessPolicy: z.strictObject({
    id: z.string().uuid(),
    maxActiveRecommendations: z.number().int().min(0).max(100),
  }),
  activeOpportunityCount: z.number().int().nonnegative(),
  spendPolicy: z
    .strictObject({
      id: z.string().uuid(),
      monthlyBudgetMinor: z.number().int().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .nullable(),
  playbook: z
    .strictObject({
      definitionId: z.string().uuid(),
      versionId: z.string().uuid(),
      semanticVersion: z.string().regex(/^[0-9]+\.[0-9]+\.[0-9]+$/),
      actionKey: z.union([
        z.literal("campaign.meta_bundle_v1"),
        z.literal("campaign.governed_draft_v1"),
      ]),
      requiredCapabilityKeys: z.array(registeredKeySchema).max(50),
      requiredEvidenceKeys: z.array(registeredKeySchema).max(50),
      riskClass: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
      primaryMetricKey: registeredKeySchema,
      guardrailMetricKeys: z.array(registeredKeySchema).max(50),
      freshnessBoundMinutes: z.number().int().positive().max(525_600),
      measurementWindowDays: z.number().int().positive().max(730),
    })
    .nullable(),
  rankingArtifact: z.strictObject({
    id: z.string().uuid(),
    implementationKey: registeredKeySchema,
  }),
  confidenceArtifact: z.strictObject({
    id: z.string().uuid(),
    implementationKey: registeredKeySchema,
  }),
  suppressions: z
    .array(
      z.strictObject({
        candidateFingerprint: sha256HexSchema,
        suppressedUntil: utcTimestampSchema.nullable(),
      }),
    )
    .max(500),
  evidence: decisionEvidenceContextSchema,
});
export type DecisionCycleContext = z.infer<typeof decisionCycleContextSchema>;

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
    /**
     * Stamped by the worker from the selected playbook version's stored
     * action definition and persisted on the opportunity row, so reads
     * return the stored identity instead of a code default.
     */
    actionKey: registeredKeySchema,
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
    status: z.enum([
      "proposed",
      "awaiting_approval",
      "approved",
      "rejected",
      "snoozed",
      "expired",
      "draft_requested",
      "draft_created",
    ]),
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
  promoteArtifact(input: ArtifactPromotionInput): Promise<string>;
};

export type DecisionCyclePort = {
  claim(input: DecisionOperationInput): Promise<DecisionClaimResult>;
  renew(input: DecisionLiveClaim): Promise<{ leaseExpiresAt: string }>;
  loadContext(input: DecisionLiveClaim): Promise<DecisionCycleContext>;
  complete(
    input: DecisionLiveClaim & { aggregate: DecisionAggregate },
  ): Promise<{ decisionRecordId: string; opportunityId: string | null }>;
  fail(input: DecisionLiveClaim & { failureCode: string }): Promise<void>;
  cancel(input: DecisionOperationInput): Promise<void>;
};
