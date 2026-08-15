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
  kind: "generate" | "revise";
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
