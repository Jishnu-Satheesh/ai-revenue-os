import { z } from "zod";

/**
 * What a governed draft freezes at creation (spec 022 section 10.2): the
 * exact evidence, estimate, and assertions the operator saw, plus the
 * identity chain that produced them. Strict: anything that changes what was
 * agreed to must live inside this object, and a field nobody declared is a
 * defect rather than a silent extra.
 */

const uuidSchema = z.string().uuid();

const estimateSchema = z
  .strictObject({
    impactLowMinor: z.number().int(),
    impactHighMinor: z.number().int(),
    expectedContributionMinor: z.number().int(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    assumptions: z.array(z.string().trim().min(1).max(500)).min(1).max(50),
  })
  .refine((estimate) => estimate.impactHighMinor >= estimate.impactLowMinor, {
    message: "The frozen estimate range cannot be inverted.",
  });

const assertionSchema = z.strictObject({
  key: z.string().trim().min(1).max(200),
  expectedOutcome: z.string().trim().min(1).max(200),
});

export const opportunitySnapshotContentSchema = z.strictObject({
  decisionRecordId: uuidSchema,
  playbookVersionId: uuidSchema,
  opportunityId: uuidSchema,
  opportunityVersion: z.number().int().positive(),
  actionKey: z.literal("campaign.governed_draft_v1"),
  objective: z.string().trim().min(1).max(500),
  audience: z.string().trim().min(1).max(500),
  goalMetricKey: z.string().trim().min(1).max(200),
  /**
   * The evidence bundle verbatim as the Opportunity carried it, plus resolved
   * references where the chain links them. Market claim linkage is not
   * persisted anywhere in the V1 chain, so resolved ids may be empty while
   * the bundle itself always freezes — a future slice links market claims
   * without rewriting this contract.
   */
  evidenceBundle: z.object({}).catchall(z.unknown()),
  marketClaimIds: z.array(uuidSchema).max(100),
  marketProfileVersionId: uuidSchema.nullable(),
  estimate: estimateSchema,
  assertions: z.array(assertionSchema).min(1).max(50),
  evaluationPlan: z.strictObject({
    primaryMetricKey: z.string().trim().min(1).max(200),
  }),
  /** Null until asset-library readiness versions link drafts. */
  brandReadiness: z
    .strictObject({
      guidanceVersion: z.number().int().nonnegative(),
      assetVersionIds: z.array(uuidSchema).max(200),
    })
    .nullable(),
});

export type OpportunitySnapshotContent = z.infer<typeof opportunitySnapshotContentSchema>;
