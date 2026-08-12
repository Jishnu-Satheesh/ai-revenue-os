import { z } from "zod";

/**
 * Every decision writes exactly one record, including `no_action` and
 * `needs_data`. They are the majority class early, and their absence would bias
 * every later estimate toward the actions the system happened to be able to
 * evaluate. See `specs/005` sections 5.8 and 13.
 */
export const decisionOutcomeSchema = z.enum(["action_selected", "no_action", "needs_data"]);

export type DecisionOutcome = z.infer<typeof decisionOutcomeSchema>;

const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * `strict` matters here. The decision path is where a model output would do the
 * most damage, so an unrecognised field fails rather than riding along.
 */
export const decisionRecordSchema = z
  .strictObject({
    decisionCycleId: z.string().uuid(),
    organizationId: z.string().uuid(),
    correlationId: z.string().uuid(),
    outcome: decisionOutcomeSchema,
    reason: z.string().min(1).max(200).nullable(),
    selectedCandidateFingerprint: sha256HexSchema.nullable(),
    opportunityId: z.string().uuid().nullable(),
    rejectionHistogram: z.record(z.string(), z.number().int().nonnegative()),
    screenedCount: z.number().int().nonnegative(),
    scoredCount: z.number().int().nonnegative(),
    inputsDigest: sha256HexSchema,
    // A version tuple with nulls is indistinguishable from an unknown, and the
    // ledger depends on that distinction.
    artifactVersions: z.record(z.string(), z.string().min(1)),
    // Selection is deterministic in V1. Both are recorded rather than omitted,
    // so later causal work reads an observed value instead of an assumption.
    propensity: z.literal(1),
    isExploration: z.literal(false),
  })
  .superRefine((record, context) => {
    if (Object.keys(record.artifactVersions).length === 0) {
      context.addIssue({
        code: "custom",
        path: ["artifactVersions"],
        message: "A decision record needs a complete version tuple.",
      });
    }

    if (record.scoredCount > record.screenedCount) {
      context.addIssue({
        code: "custom",
        path: ["scoredCount"],
        message: "Scored candidates cannot exceed the screened set.",
      });
    }

    if (record.outcome === "action_selected") {
      if (record.selectedCandidateFingerprint === null) {
        context.addIssue({
          code: "custom",
          path: ["selectedCandidateFingerprint"],
          message: "A selected action must name its candidate.",
        });
      }
      if (record.opportunityId === null) {
        context.addIssue({
          code: "custom",
          path: ["opportunityId"],
          message: "A selected action must produce an opportunity.",
        });
      }
      return;
    }

    if (record.reason === null) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "A no_action or needs_data decision must record why.",
      });
    }

    if (record.selectedCandidateFingerprint !== null) {
      context.addIssue({
        code: "custom",
        path: ["selectedCandidateFingerprint"],
        message: "Only a selected action names a candidate.",
      });
    }

    // `needs_data` never creates an opportunity and never appears in the feed.
    if (record.opportunityId !== null) {
      context.addIssue({
        code: "custom",
        path: ["opportunityId"],
        message: "Only a selected action creates an opportunity.",
      });
    }
  });

export type DecisionRecord = z.infer<typeof decisionRecordSchema>;
