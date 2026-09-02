import { z } from "zod";

/**
 * The exact request shapes the campaign API accepts.
 *
 * Every one is strict: an unknown field is a rejected request, not an ignored
 * one. A caller sending `spendCeiling` to an endpoint that does not read it
 * should be told, rather than have the value silently dropped and the campaign
 * approved on terms nobody set.
 *
 * The organization is never in a body. It comes from the route, which the
 * membership check already validated, so a request cannot redirect a write to
 * another tenant by adding a field.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/);
const idempotencyKeySchema = z.string().trim().min(8).max(200);

export const createCampaignRequestSchema = z
  .strictObject({
    source: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("manual_brief") }),
      z.strictObject({ kind: z.literal("decision_opportunity"), opportunityId: uuidSchema }),
    ]),
    title: z.string().trim().min(1).max(240),
    brief: z
      .strictObject({
        objective: z.string().trim().min(1).max(600),
        audience: z.string().trim().min(1).max(600),
        offer: z.string().trim().min(1).max(600).nullable(),
        requestedChannels: z.array(z.enum(["instagram", "facebook"])).max(2),
      })
      .optional(),
    generationProfile: z.enum(["brand_restricted", "brand_guided", "full_visual_freedom"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .superRefine((value, context) => {
    // A manual campaign without a brief has nothing to generate from, and an
    // opportunity campaign with one would have two competing sources of intent.
    if (value.source.kind === "manual_brief" && !value.brief) {
      context.addIssue({
        code: "custom",
        path: ["brief"],
        message: "A manual campaign needs its brief.",
      });
    }
    if (value.source.kind === "decision_opportunity" && value.brief) {
      context.addIssue({
        code: "custom",
        path: ["brief"],
        message: "An opportunity campaign takes its intent from the opportunity, not a brief.",
      });
    }
  });
export type CreateCampaignRequest = z.infer<typeof createCampaignRequestSchema>;

/**
 * A variant run names the exact version it was requested against.
 *
 * Without the digest, an operator working in a tab left open since yesterday
 * would queue creative under a proposal that has since changed — and variants
 * are precisely the creative nobody reviews one by one.
 */
export const variantsRequestSchema = z.strictObject({
  bundleVersionId: z.string().uuid(),
  bundleDigest: z.string().regex(/^[0-9a-f]{64}$/),
  perDirection: z.number().int().positive().max(50),
  idempotencyKey: idempotencyKeySchema,
});
export type VariantsRequest = z.infer<typeof variantsRequestSchema>;

export const generateRequestSchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});
export type GenerateRequest = z.infer<typeof generateRequestSchema>;

/**
 * A revision names the version it was written against.
 *
 * Without that, an operator editing a stale tab would silently revise whatever
 * happened to be latest by the time the request landed.
 */
export const revisionRequestSchema = z.strictObject({
  baseVersionId: uuidSchema,
  baseDigest: sha256HexSchema,
  prompt: z.string().trim().min(1).max(2_000),
  scope: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("bundle") }),
    z.strictObject({ kind: z.literal("direction"), directionId: uuidSchema }),
    z.strictObject({ kind: z.literal("copy"), directionId: uuidSchema }),
    z.strictObject({ kind: z.literal("hashtags"), directionId: uuidSchema }),
    z.strictObject({ kind: z.literal("schedule") }),
    z.strictObject({ kind: z.literal("generation_profile") }),
  ]),
  idempotencyKey: idempotencyKeySchema,
});
export type RevisionRequest = z.infer<typeof revisionRequestSchema>;

export const attestRequestSchema = z.strictObject({
  bundleVersionId: uuidSchema,
  bundleDigest: sha256HexSchema,
  statement: z.string().trim().min(1).max(1_000),
});
export type AttestRequest = z.infer<typeof attestRequestSchema>;

export const approveRequestSchema = z.strictObject({
  bundleVersionId: uuidSchema,
  bundleDigest: sha256HexSchema,
  attestationId: uuidSchema,
  expiresAt: z.string().datetime({ offset: false }),
  actionKeys: z.array(uuidSchema).min(1).max(40),
});
export type ApproveRequest = z.infer<typeof approveRequestSchema>;

export const scheduleRequestSchema = z.strictObject({
  bundleVersionId: uuidSchema,
  bundleDigest: sha256HexSchema,
  idempotencyKey: idempotencyKeySchema,
});
export type ScheduleRequest = z.infer<typeof scheduleRequestSchema>;

export const cancelRequestSchema = z.strictObject({
  reason: z.string().trim().min(1).max(500),
});
export type CancelRequest = z.infer<typeof cancelRequestSchema>;

export const brandAssetUploadRequestSchema = z.strictObject({
  label: z.string().trim().min(1).max(160),
  assetRole: z.enum(["logo", "product", "venue", "team", "other"]),
});
export type BrandAssetUploadRequest = z.infer<typeof brandAssetUploadRequestSchema>;

/**
 * Finalization deliberately carries no MIME type or dimensions.
 *
 * Those are read from the bytes the server fetched back out of storage. A
 * browser-declared type is a claim by whoever made the request, and accepting
 * it here would undo the whole point of validating the upload.
 */
export const brandAssetCompleteRequestSchema = z.strictObject({
  brandAssetId: uuidSchema,
  versionId: uuidSchema,
});
export type BrandAssetCompleteRequest = z.infer<typeof brandAssetCompleteRequestSchema>;
