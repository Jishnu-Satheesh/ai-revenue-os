import { z } from "zod";

export const CONDITIONING_ROLES = [
  "subject",
  "brand_mark",
  "setting",
  "style_exemplar",
  "palette",
  "typography",
  "avoid",
] as const;
export const conditioningRoleSchema = z.enum(CONDITIONING_ROLES);

export const ISO_15924_SCRIPT_CODE_PATTERN = /^[A-Z][a-z]{3}$/;
export const scriptCodeSchema = z
  .string()
  .regex(ISO_15924_SCRIPT_CODE_PATTERN, "A script must be an ISO 15924 code such as Latn.");

export const ASSET_OWNERSHIPS = ["owned", "third_party"] as const;
export const assetOwnershipSchema = z.enum(ASSET_OWNERSHIPS);

export const REFERENCE_MODES = ["inspiration", "exact_match"] as const;
export const referenceModeSchema = z.enum(REFERENCE_MODES);

export const CREATIVE_REVIEW_VERDICTS = ["approved", "rejected"] as const;
export const creativeReviewVerdictSchema = z.enum(CREATIVE_REVIEW_VERDICTS);

export const CORE_CREATIVE_REVIEW_REASON_CODES = [
  "wrong_subject",
  "wrong_style",
  "text_unreadable",
  "text_incorrect",
  "brand_mark_distorted",
  "people_shown",
  "prohibited_content",
  "low_quality",
  "off_palette",
  "not_localised",
  "other",
] as const;

export const RESTAURANT_CREATIVE_REVIEW_REASON_CODES = [
  "wrong_cuisine",
  "alcohol_visible",
  "unappetising",
  "not_our_plating",
] as const;

export const CREATIVE_REVIEW_REASON_CODES = [
  ...CORE_CREATIVE_REVIEW_REASON_CODES,
  ...RESTAURANT_CREATIVE_REVIEW_REASON_CODES,
] as const;
export const creativeReviewReasonCodeSchema = z.enum(CREATIVE_REVIEW_REASON_CODES);

export const REFERENCE_RESOLUTION_OUTCOMES = [
  "resolved",
  "synthesis_permitted",
  "insufficient",
] as const;
export const referenceResolutionOutcomeSchema = z.enum(REFERENCE_RESOLUTION_OUTCOMES);

export const REFERENCE_RESOLUTION_REFUSAL_CODES = ["no_declared_subject"] as const;
export const referenceResolutionRefusalCodeSchema = z.enum(REFERENCE_RESOLUTION_REFUSAL_CODES);

export const CREATIVE_REVIEW_SUBJECT_KINDS = ["brand_asset_version", "campaign_asset"] as const;
export const creativeReviewSubjectKindSchema = z.enum(CREATIVE_REVIEW_SUBJECT_KINDS);

export const creativeAssetReviewSchema = z
  .strictObject({
    subjectKind: creativeReviewSubjectKindSchema,
    subjectId: z.string().uuid(),
    verdict: creativeReviewVerdictSchema,
    reasonCodes: z.array(creativeReviewReasonCodeSchema).max(15),
    note: z.string().trim().min(1).max(500).nullable(),
  })
  .superRefine((review, context) => {
    if (new Set(review.reasonCodes).size !== review.reasonCodes.length) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "Review reason codes must be unique.",
      });
    }

    if (review.verdict === "rejected" && review.reasonCodes.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "A rejected asset must carry at least one governed reason code.",
      });
    }

    if (review.verdict === "approved" && review.reasonCodes.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["reasonCodes"],
        message: "An approved asset cannot carry rejection reasons.",
      });
    }
  });

/** Normalize once at write boundaries without transliterating or dropping scripts. */
export function normalizeAssetTag(value: string): string {
  return value.trim().normalize("NFC");
}

/** Stable comparison key shared by routes, repositories, and the resolver. */
export function assetTagComparisonKey(value: string): string {
  return normalizeAssetTag(value).toLocaleLowerCase("und");
}

export function assetTagsMatch(left: string, right: string): boolean {
  return assetTagComparisonKey(left) === assetTagComparisonKey(right);
}

function unicodeLength(value: string): number {
  return Array.from(value).length;
}

function normalizedBoundedString(maximumLength: number) {
  return z
    .string()
    .transform(normalizeAssetTag)
    .pipe(
      z
        .string()
        .refine(
          (value) => unicodeLength(value) >= 1 && unicodeLength(value) <= maximumLength,
          `Must contain between 1 and ${maximumLength} Unicode characters.`,
        ),
    );
}

export const assetTagSchema = normalizedBoundedString(60);
export const assetTagsSchema = z
  .array(assetTagSchema)
  .max(24)
  .superRefine((tags, context) => {
    const seen = new Set<string>();
    tags.forEach((tag, index) => {
      const comparisonKey = assetTagComparisonKey(tag);
      if (seen.has(comparisonKey)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "Tags must be unique after Unicode normalization and case folding.",
        });
      }
      seen.add(comparisonKey);
    });
  });

export const subjectExclusionsSchema = z.array(normalizedBoundedString(240)).max(24);
export const namesByScriptSchema = z
  .record(scriptCodeSchema, normalizedBoundedString(160))
  .refine(
    (names) => Object.keys(names).length <= 16,
    "At most 16 script-specific names are allowed.",
  );

export type ConditioningRole = z.infer<typeof conditioningRoleSchema>;
export type ScriptCode = z.infer<typeof scriptCodeSchema>;
export type AssetOwnership = z.infer<typeof assetOwnershipSchema>;
export type ReferenceMode = z.infer<typeof referenceModeSchema>;
export type CreativeReviewVerdict = z.infer<typeof creativeReviewVerdictSchema>;
export type CreativeReviewReasonCode = z.infer<typeof creativeReviewReasonCodeSchema>;
export type CreativeAssetReview = z.infer<typeof creativeAssetReviewSchema>;
export type ReferenceResolutionOutcome = z.infer<typeof referenceResolutionOutcomeSchema>;
export type ReferenceResolutionRefusalCode = z.infer<typeof referenceResolutionRefusalCodeSchema>;
