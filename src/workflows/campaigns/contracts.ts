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
