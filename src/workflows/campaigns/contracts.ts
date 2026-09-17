import { createHash } from "node:crypto";

import { z } from "zod";

/**
 * What a campaign generation task is allowed to carry.
 *
 * Identifiers and nothing else. Not the operator's prompt, not the brief, not
 * the pinned evidence, not a credential. A task payload is stored by the queue,
 * shown in a run dashboard, and kept in logs, so anything business-sensitive
 * put here leaks by design rather than by accident. The worker reads what it
 * needs from the database under the claim it holds.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);

export const campaignGenerationPayloadSchema = z.strictObject({
  organizationId: uuidSchema,
  campaignId: uuidSchema,
  runId: uuidSchema,
  correlationId: uuidSchema,
  /** Bounds one attempt's model spend. Exceeding it stops the run. */
  costCeilingMinor: z.number().int().positive().max(10_000_000),
});
export type CampaignGenerationPayload = z.infer<typeof campaignGenerationPayloadSchema>;

export const campaignRevisionPayloadSchema = campaignGenerationPayloadSchema.extend({
  /**
   * The version the operator was looking at. If the campaign has moved on, this
   * revision was written against something that no longer exists and must not
   * be applied to whatever happens to be latest now.
   */
  baseVersionId: uuidSchema,
  baseDigest: sha256HexSchema,
});
export type CampaignRevisionPayload = z.infer<typeof campaignRevisionPayloadSchema>;

/**
 * Parsed before anything else happens, and specifically before a service-role
 * client is constructed.
 *
 * A malformed payload that reached client construction would hand a
 * tenant-bypassing credential to a request nobody validated.
 */
export function parseCampaignGenerationPayload(payload: unknown): CampaignGenerationPayload {
  return campaignGenerationPayloadSchema.parse(payload);
}

export function parseCampaignRevisionPayload(payload: unknown): CampaignRevisionPayload {
  return campaignRevisionPayloadSchema.parse(payload);
}

/**
 * What a campaign research task is allowed to carry.
 *
 * Identifiers only, like generation — and pointedly not the staged question.
 * The question is the requester's business intent in their own words, so it
 * lives on the admitted run row and reaches the worker through the
 * claim-bound loader, never through queue storage, dashboards, or logs.
 */
/**
 * What preparing the approved creative may spend, carried to the worker.
 *
 * The amount is the platform-configured dispatch figure
 * (`generationCostCeilingMinor()`); the currency is the admitting policy's
 * own (`campaign_research_policies.allowance_currency` for the run's bound
 * version). The planner must copy it exactly into
 * `document.generationCostCeiling` — a post-parse equality check refuses any
 * drift, so a proposal-born campaign never reaches generation with a purse
 * the dispatch will not honour.
 */
export const preparationAllowanceSchema = z.strictObject({
  amountMinor: z.number().int().nonnegative().max(10_000_000),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export type PreparationAllowance = z.infer<typeof preparationAllowanceSchema>;

export const campaignResearchPayloadSchema = z.strictObject({
  organizationId: uuidSchema,
  runId: uuidSchema,
  correlationId: uuidSchema,
  /**
   * Resolved from the binding policy by the scheduler or route that admitted
   * the run. Required here so the worker never falls back to a default for
   * what counts as a numeric operating limit (D06).
   */
  evidenceMaxAgeDays: z.number().int().positive().max(365),
  preparationAllowance: preparationAllowanceSchema,
});
export type CampaignResearchPayload = z.infer<typeof campaignResearchPayloadSchema>;

export function parseCampaignResearchPayload(payload: unknown): CampaignResearchPayload {
  return campaignResearchPayloadSchema.parse(payload);
}

/**
 * The fingerprint of what was asked for.
 *
 * Two enqueues sharing an idempotency key must describe the same work. This is
 * what lets the database tell a genuine retry from a caller that reused a key
 * for something different.
 */
export function campaignGenerationRequestDigest(input: {
  organizationId: string;
  campaignId: string;
  sourceSnapshotId: string;
  kind: "generate" | "revise" | "variants";
  baseVersionId?: string | null;
  baseDigest?: string | null;
}): string {
  const parts = [
    input.organizationId,
    input.campaignId,
    input.sourceSnapshotId,
    input.kind,
    input.baseVersionId ?? "",
    input.baseDigest ?? "",
  ];
  // Length-prefixed, so no arrangement of ids can collide with another.
  return createHash("sha256")
    .update(parts.map((part) => `${part.length}:${part}`).join("|"), "utf8")
    .digest("hex");
}

/**
 * What a variant run carries between the queue and the worker.
 *
 * Identifiers and a persisted run key, and nothing else. The prompt, the model
 * credentials and the campaign's business context are all read by the worker
 * under its own credentials — a payload that carried them would put business
 * text into a queue, a log line and a retry record.
 *
 * `perDirection` is the one number here, and it is read back from the run row
 * rather than trusted from the payload, so a redelivery cannot quietly ask for
 * a different amount of creative than the attempt it replaces.
 */
export const campaignVariantPayloadSchema = z.strictObject({
  organizationId: z.string().uuid(),
  campaignId: z.string().uuid(),
  bundleVersionId: z.string().uuid(),
  runId: z.string().uuid(),
  correlationId: z.string().uuid(),
  costCeilingMinor: z.number().int().nonnegative(),
});

export type CampaignVariantPayload = z.infer<typeof campaignVariantPayloadSchema>;

export function parseCampaignVariantPayload(payload: unknown): CampaignVariantPayload {
  return campaignVariantPayloadSchema.parse(payload);
}

/**
 * What a poster render carries between the queue and the worker.
 *
 * This payload deviates from the identifiers-only rule above in exactly one
 * field, `extra`, and the deviation is deliberate rather than overlooked.
 *
 * `extra` is the operator's own text for the one free box on a poster. Unlike a
 * prompt or a brief, it is written to be printed on a public advertisement, so
 * queue storage is not where it becomes exposed. There is no request table for
 * a render to read it from -- the render tables are outputs, content-addressed
 * and append-only -- and adding one to keep a string out of a payload would be
 * a schema change to avoid an exposure that does not exist.
 *
 * It is bounded here and refused by `checkOperatorSlotText` before it is drawn.
 * Everything else the worker needs, it reads from the database under its own
 * credentials.
 *
 * `placement`, `language`, `format` and `ordinal` are the deliverable identity
 * the finished output is recorded under. They are resolved by the renders route
 * from the approved poster plan -- never guessed by the worker, which records
 * them verbatim -- so a retry of the same request files under the same slot
 * and the database reuses rather than duplicating.
 */
export const campaignPosterRenderPayloadSchema = z.strictObject({
  organizationId: uuidSchema,
  campaignId: uuidSchema,
  bundleVersionId: uuidSchema,
  plateAssetId: uuidSchema,
  correlationId: uuidSchema,
  templateKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .max(120),
  templateVersion: z.number().int().positive(),
  script: z.enum(["Latn", "Mlym", "Arab"]),
  directionId: z.string().min(1).max(120),
  channel: z.enum(["instagram", "facebook"]),
  placement: z.string().trim().min(1).max(60),
  language: z.string().trim().min(1).max(40),
  format: z.string().trim().min(1).max(60),
  ordinal: z.number().int().positive(),
  extra: z.string().max(200).nullable(),
});

export type CampaignPosterRenderPayload = z.infer<typeof campaignPosterRenderPayloadSchema>;

export function parseCampaignPosterRenderPayload(payload: unknown): CampaignPosterRenderPayload {
  return campaignPosterRenderPayloadSchema.parse(payload);
}

/**
 * What a plate edit carries between the queue and the worker.
 *
 * This payload carries the operator's marked regions and their instructions,
 * for the same reason `extra` is carried above and with the same discomfort:
 * there is no request table for the worker to read them from, and the tables
 * this feature does own are outputs -- `campaign_plate_edits` records an edit
 * that already happened.
 *
 * What makes it acceptable rather than merely convenient is that the
 * instruction is not a credential and not a secret. It is a sentence about a
 * picture, destined for a public advertisement, and it is bounded here at the
 * same 500 characters the database enforces. It is also, deliberately, the one
 * thing in this payload the worker treats as untrusted data.
 */
export const campaignPlateEditPayloadSchema = z.strictObject({
  organizationId: uuidSchema,
  campaignId: uuidSchema,
  bundleVersionId: uuidSchema,
  parentPlateAssetId: uuidSchema,
  correlationId: uuidSchema,
  /** The member who marked the regions. Recorded as the editor. */
  editedBy: uuidSchema,
  /** One edit per key per organization, enforced by the database. */
  idempotencyKey: z.string().min(8).max(200),
  annotations: z
    .array(
      z.strictObject({
        ordinal: z.number().int().positive().max(8),
        bounds: z.strictObject({
          xPx: z.number().int().nonnegative().max(20_000),
          yPx: z.number().int().nonnegative().max(20_000),
          widthPx: z.number().int().positive().max(20_000),
          heightPx: z.number().int().positive().max(20_000),
        }),
        instruction: z.string().trim().min(1).max(500),
      }),
    )
    .min(1)
    .max(8),
});

export type CampaignPlateEditPayload = z.infer<typeof campaignPlateEditPayloadSchema>;

export function parseCampaignPlateEditPayload(payload: unknown): CampaignPlateEditPayload {
  return campaignPlateEditPayloadSchema.parse(payload);
}

/**
 * The execution loop's payloads.
 *
 * Identifiers and bounds only, in keeping with the rule the generation payloads
 * follow: nothing here carries business text, so a replayed message cannot
 * smuggle different work than the run was authorized for. Every one of these
 * workers reads what it needs from storage.
 */
export const campaignSweepPayloadSchema = z.strictObject({
  /** How many rows one sweep may take. Bounded by the database function too. */
  limit: z.number().int().positive().max(500).optional(),
});
export type CampaignSweepPayload = z.infer<typeof campaignSweepPayloadSchema>;

/**
 * One organization per run, deliberately.
 *
 * The allocation, settlement and learning workers each state that they carry no
 * state from one campaign into the next. Running them per organization keeps
 * that true at the next level up: one tenant's slow settlement cannot delay
 * another's, and a failure is scoped to the tenant it happened in.
 */
export const campaignCyclePayloadSchema = z.strictObject({
  organizationId: uuidSchema,
  /** Present only to make a cycle reproducible; generated otherwise. */
  cycleId: uuidSchema.optional(),
});
export type CampaignCyclePayload = z.infer<typeof campaignCyclePayloadSchema>;
