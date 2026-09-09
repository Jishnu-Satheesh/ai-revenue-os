import { z } from "zod";

import { assetTagsSchema, creativeReviewReasonCodeSchema } from "@/domain/campaigns/asset-library";

const uuidSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: false });
const contentHashSchema = z.string().regex(/^[a-f0-9]{64}$/i, "Expected a SHA-256 hash.");

export const CREATIVE_HISTORY_SELECTOR_VERSION = 1 as const;
export const CREATIVE_HISTORY_APPROVED_FINAL_LIMIT = 3 as const;
export const CREATIVE_HISTORY_REJECTED_BLUEPRINT_LIMIT = 5 as const;
export const BLUEPRINT_NEGATIVE_RULE_LIMIT = 12 as const;

export const creativeHistoryMetadataSchema = z.strictObject({
  subjectTags: assetTagsSchema,
  occasionTags: assetTagsSchema,
  channels: assetTagsSchema,
  formats: assetTagsSchema,
  markets: assetTagsSchema,
  languages: assetTagsSchema,
  objectives: assetTagsSchema,
  styleTags: assetTagsSchema,
});

export const creativeHistorySourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("stored_file"),
    storagePath: z.string().trim().min(1).max(500),
  }),
  z.strictObject({ kind: z.literal("studio_render"), posterRenderId: uuidSchema }),
]);

export const creativeHistoryVersionSchema = z.strictObject({
  organizationId: uuidSchema,
  id: uuidSchema,
  itemId: uuidSchema,
  source: creativeHistorySourceSchema,
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  byteSize: z.number().int().positive(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  contentHash: contentHashSchema,
  createdAt: timestampSchema,
});

export const creativeReviewSchema = z
  .strictObject({
    creativeItemVersionId: uuidSchema,
    verdict: z.enum(["approved", "rejected"]),
    reasonCodes: z.array(creativeReviewReasonCodeSchema).max(15),
    note: z.string().trim().min(1).max(500).nullable(),
    reviewedAt: timestampSchema,
    reviewedBy: uuidSchema,
  })
  .superRefine((review, context) => {
    if (new Set(review.reasonCodes).size !== review.reasonCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "Reasons must be unique.",
      });
    }
    if (review.verdict === "rejected" && review.reasonCodes.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "A rejected design requires at least one human reason.",
      });
    }
    if (review.verdict === "approved" && review.reasonCodes.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "An approved design cannot carry rejection reasons.",
      });
    }
  });

export const creativeHistoryCurrentReviewSchema = z
  .strictObject({
    verdict: z.enum(["approved", "rejected"]),
    reasonCodes: z.array(creativeReviewReasonCodeSchema).max(15),
    reviewedAt: timestampSchema,
    reviewedBy: uuidSchema,
  })
  .superRefine((review, context) => {
    if (new Set(review.reasonCodes).size !== review.reasonCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "Reasons must be unique.",
      });
    }
    if (review.verdict === "rejected" && review.reasonCodes.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "Rejected needs a reason.",
      });
    }
    if (review.verdict === "approved" && review.reasonCodes.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "Approved has no rejection reason.",
      });
    }
  });

export const creativeItemSchema = z.strictObject({
  organizationId: uuidSchema,
  id: uuidSchema,
  folderId: uuidSchema.nullable(),
  label: z.string().trim().min(1).max(160),
  creativeType: z.enum(["poster", "flyer", "social_post", "story", "carousel", "banner"]),
  sourceKind: z.enum(["historical_upload", "studio_render", "qualified_legacy_delivered_creative"]),
  rights: z.strictObject({
    status: z.enum(["owned", "licensed", "permission_confirmed"]),
    confirmedAt: timestampSchema,
  }),
  confirmedMetadata: creativeHistoryMetadataSchema.nullable(),
  proposedMetadata: creativeHistoryMetadataSchema.nullable(),
  currentVersion: creativeHistoryVersionSchema,
  currentReview: creativeHistoryCurrentReviewSchema.nullable(),
  archivedAt: timestampSchema.nullable(),
});

export type CreativeHistoryMetadata = z.infer<typeof creativeHistoryMetadataSchema>;
export type CreativeHistoryVersion = z.infer<typeof creativeHistoryVersionSchema>;
export type CreativeHistoryReview = z.infer<typeof creativeReviewSchema>;
export type CreativeHistoryCurrentReview = z.infer<typeof creativeHistoryCurrentReviewSchema>;
export type CreativeHistoryItem = z.infer<typeof creativeItemSchema>;
export type CreativeHistoryEligibility =
  | "eligible_approved"
  | "eligible_rejected"
  | "archived"
  | "metadata_unconfirmed"
  | "unreviewed";

export function creativeEligibility(item: CreativeHistoryItem): CreativeHistoryEligibility {
  if (item.archivedAt !== null) return "archived";
  if (item.confirmedMetadata === null) return "metadata_unconfirmed";
  if (item.currentReview === null) return "unreviewed";
  return item.currentReview.verdict === "approved" ? "eligible_approved" : "eligible_rejected";
}
