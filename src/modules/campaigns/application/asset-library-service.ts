import { z } from "zod";

import {
  assetOwnershipSchema,
  assetTagsMatch,
  assetTagsSchema,
  conditioningRoleSchema,
  creativeAssetReviewSchema,
  creativeReviewReasonCodeSchema,
  creativeReviewVerdictSchema,
  scriptCodeSchema,
} from "@/domain/campaigns/asset-library";

const uuidSchema = z.string().uuid();
const utcTimestampSchema = z.string().datetime({ offset: false });

function uniqueArraySchema<T extends z.ZodType>(item: T, maximum: number) {
  return z
    .array(item)
    .max(maximum)
    .superRefine((values, context) => {
      if (new Set(values).size !== values.length) {
        context.addIssue({ code: "custom", message: "Values must be unique." });
      }
    });
}

const brandAssetClassificationShape = {
  conditioningRoles: uniqueArraySchema(conditioningRoleSchema, 7).min(1),
  tags: assetTagsSchema,
  scripts: uniqueArraySchema(scriptCodeSchema, 16),
};

function requireTypographyScripts(
  classification: { conditioningRoles: readonly string[]; scripts: readonly string[] },
  context: z.RefinementCtx,
) {
  const typography = classification.conditioningRoles.includes("typography");
  if (typography !== classification.scripts.length > 0) {
    context.addIssue({
      code: "custom",
      path: ["scripts"],
      message: "Scripts are required only for typography references.",
    });
  }
}

export const brandAssetClassificationSchema = z
  .strictObject(brandAssetClassificationShape)
  .superRefine(requireTypographyScripts);

export const brandAssetClassificationWithOwnershipSchema = z
  .strictObject({ ...brandAssetClassificationShape, ownership: assetOwnershipSchema })
  .superRefine(requireTypographyScripts);

export const assetLibraryReferenceSchema = z.strictObject({
  organizationId: uuidSchema,
  brandAssetId: uuidSchema,
  brandAssetVersionId: uuidSchema,
  label: z.string().trim().min(1).max(160),
  assetRole: z.enum(["logo", "product", "venue", "team", "other"]),
  conditioningRoles: uniqueArraySchema(conditioningRoleSchema, 7),
  tags: assetTagsSchema,
  scripts: uniqueArraySchema(scriptCodeSchema, 16),
  ownership: assetOwnershipSchema,
  archivedAt: utcTimestampSchema.nullable(),
  version: z.number().int().positive(),
  storagePath: z.string().min(1).max(1_024),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  byteSize: z.number().int().positive(),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  currentVerdict: creativeReviewVerdictSchema.nullable(),
  currentReasonCodes: uniqueArraySchema(creativeReviewReasonCodeSchema, 15),
  currentReviewedAt: utcTimestampSchema.nullable(),
});

export const assetMetadataMutationResultSchema = z.strictObject({
  brandAssetId: uuidSchema,
  archivedAt: utcTimestampSchema.nullable(),
});

export const creativeReviewMutationResultSchema = z.strictObject({
  reviewId: uuidSchema,
  verdict: creativeReviewVerdictSchema,
  reviewedAt: utcTimestampSchema,
});

export const creativeReviewReasonEntrySchema = z.strictObject({
  code: creativeReviewReasonCodeSchema,
  description: z.string().trim().min(3).max(300),
  ownerScope: z.enum(["core", "pack"]),
  packSlug: z.string().trim().min(1).max(80).nullable(),
});

const assetLibraryFilterSchema = z.strictObject({
  organizationId: uuidSchema,
  role: conditioningRoleSchema.optional(),
  verdict: z.enum(["approved", "rejected", "unreviewed"]).optional(),
  tag: z.string().trim().min(1).max(60).optional(),
  includeArchived: z.boolean().default(false),
});

const assetMetadataUpdateSchema = z
  .strictObject({
    organizationId: uuidSchema,
    brandAssetId: uuidSchema,
    conditioningRoles: brandAssetClassificationShape.conditioningRoles.optional(),
    tags: assetTagsSchema.optional(),
    scripts: brandAssetClassificationShape.scripts.optional(),
    archived: z.boolean().optional(),
  })
  .superRefine((input, context) => {
    const suppliedClassification =
      input.conditioningRoles !== undefined ||
      input.tags !== undefined ||
      input.scripts !== undefined;
    if (suppliedClassification) {
      const classification = brandAssetClassificationSchema.safeParse({
        conditioningRoles: input.conditioningRoles,
        tags: input.tags,
        scripts: input.scripts,
      });
      if (!classification.success) {
        for (const issue of classification.error.issues) {
          context.addIssue({ ...issue, path: issue.path });
        }
      }
    }
    if (!suppliedClassification && input.archived === undefined) {
      context.addIssue({ code: "custom", message: "At least one metadata change is required." });
    }
  });

export type AssetLibraryReference = z.infer<typeof assetLibraryReferenceSchema>;
export type AssetMetadataUpdate = z.infer<typeof assetMetadataUpdateSchema>;
export type AssetMetadataMutationResult = z.infer<typeof assetMetadataMutationResultSchema>;
export type CreativeReviewMutationResult = z.infer<typeof creativeReviewMutationResultSchema>;
export type CreativeReviewReasonEntry = z.infer<typeof creativeReviewReasonEntrySchema>;

export type AssetLibraryStore = {
  listReferences(organizationId: string): Promise<readonly AssetLibraryReference[]>;
  updateMetadata(input: AssetMetadataUpdate): Promise<AssetMetadataMutationResult>;
  recordReview(
    input: z.infer<typeof creativeAssetReviewSchema> & { organizationId: string },
  ): Promise<CreativeReviewMutationResult>;
  listReviewReasons(): Promise<readonly CreativeReviewReasonEntry[]>;
};

export function createAssetLibraryService(dependencies: { store: AssetLibraryStore }) {
  return {
    async list(input: z.input<typeof assetLibraryFilterSchema>) {
      const filter = assetLibraryFilterSchema.parse(input);
      const references = await dependencies.store.listReferences(filter.organizationId);

      return references.filter((reference) => {
        if (!filter.includeArchived && reference.archivedAt !== null) return false;
        if (filter.role && !reference.conditioningRoles.includes(filter.role)) return false;
        if (filter.tag && !reference.tags.some((tag) => assetTagsMatch(tag, filter.tag!))) {
          return false;
        }
        if (filter.verdict === "unreviewed") return reference.currentVerdict === null;
        if (filter.verdict && reference.currentVerdict !== filter.verdict) return false;
        return true;
      });
    },

    async updateMetadata(input: z.input<typeof assetMetadataUpdateSchema>) {
      return dependencies.store.updateMetadata(assetMetadataUpdateSchema.parse(input));
    },

    archive(input: { organizationId: string; brandAssetId: string }) {
      return dependencies.store.updateMetadata({
        organizationId: uuidSchema.parse(input.organizationId),
        brandAssetId: uuidSchema.parse(input.brandAssetId),
        archived: true,
      });
    },

    async recordReview(
      input: z.input<typeof creativeAssetReviewSchema> & { organizationId: string },
    ) {
      const organizationId = uuidSchema.parse(input.organizationId);
      const review = creativeAssetReviewSchema.parse({
        subjectKind: input.subjectKind,
        subjectId: input.subjectId,
        verdict: input.verdict,
        reasonCodes: input.reasonCodes,
        note: input.note,
      });
      return dependencies.store.recordReview({ organizationId, ...review });
    },

    reviewReasons() {
      return dependencies.store.listReviewReasons();
    },
  };
}
