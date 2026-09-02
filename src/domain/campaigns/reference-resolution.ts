import { z } from "zod";

import {
  assetOwnershipSchema,
  assetTagsSchema,
  assetTagComparisonKey,
  conditioningRoleSchema,
  creativeReviewReasonCodeSchema,
  creativeReviewVerdictSchema,
  referenceModeSchema,
  referenceResolutionOutcomeSchema,
  referenceResolutionRefusalCodeSchema,
  scriptCodeSchema,
} from "@/domain/campaigns/asset-library";

export const RESOLVER_VERSION = 1 as const;
export const POSITIVE_REFERENCE_LIMIT = 7 as const;
export const AVOID_REFERENCE_LIMIT = 2 as const;
export const NEGATIVE_RULE_LIMIT = 12 as const;
export const TYPOGRAPHY_SCRIPT_LIMIT = 3 as const;

export const REFERENCE_SLOT_CAPS = {
  brand_mark: 1,
  subject: 3,
  setting: 1,
  style_exemplar: 2,
  palette: 1,
  typography: 3,
} as const;

const uuidSchema = z.string().uuid();
const utcTimestampSchema = z.string().datetime({ offset: false });
const positiveConditioningRoleSchema = z.enum([
  "subject",
  "brand_mark",
  "setting",
  "style_exemplar",
  "palette",
  "typography",
]);

function uniqueArraySchema<T extends z.ZodType>(itemSchema: T, maximumItems: number) {
  return z
    .array(itemSchema)
    .max(maximumItems)
    .superRefine((items, context) => {
      if (new Set(items).size !== items.length) {
        context.addIssue({ code: "custom", message: "Values must be unique." });
      }
    });
}

export const referenceCandidateSchema = z
  .strictObject({
    brandAssetId: uuidSchema,
    brandAssetVersionId: uuidSchema,
    conditioningRoles: uniqueArraySchema(conditioningRoleSchema, 7),
    tags: assetTagsSchema,
    scripts: uniqueArraySchema(scriptCodeSchema, 16),
    ownership: assetOwnershipSchema,
    version: z.number().int().positive(),
    currentVerdict: creativeReviewVerdictSchema.nullable(),
    currentReasonCodes: uniqueArraySchema(creativeReviewReasonCodeSchema, 15),
    currentReviewedAt: utcTimestampSchema.nullable(),
    archivedAt: utcTimestampSchema.nullable().default(null),
    requestedReferenceMode: referenceModeSchema.default("inspiration"),
  })
  .superRefine((candidate, context) => {
    const isTypography = candidate.conditioningRoles.includes("typography");
    if (
      (isTypography && candidate.scripts.length === 0) ||
      (!isTypography && candidate.scripts.length > 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["scripts"],
        message: "Scripts are required only for typography references.",
      });
    }

    if (candidate.currentVerdict === "rejected") {
      if (candidate.currentReasonCodes.length === 0) {
        context.addIssue({
          code: "custom",
          path: ["currentReasonCodes"],
          message: "A rejected candidate must carry its current reason codes.",
        });
      }
      if (candidate.currentReviewedAt === null) {
        context.addIssue({
          code: "custom",
          path: ["currentReviewedAt"],
          message: "A rejected candidate must carry its review time.",
        });
      }
      return;
    }

    if (candidate.currentReasonCodes.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["currentReasonCodes"],
        message: "Only a rejected candidate may carry rejection reasons.",
      });
    }
    if (
      (candidate.currentVerdict === "approved" && candidate.currentReviewedAt === null) ||
      (candidate.currentVerdict === null && candidate.currentReviewedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["currentReviewedAt"],
        message: "Review evidence must agree with the current verdict.",
      });
    }
  });

export const referenceResolutionRequestSchema = z.strictObject({
  subjectTags: assetTagsSchema,
  subjectDescription: z.string().trim().min(1).max(2_000).nullable(),
  settingTags: assetTagsSchema,
  occasionTags: assetTagsSchema,
  styleTags: assetTagsSchema,
  scripts: uniqueArraySchema(scriptCodeSchema, 16),
});

export const reviewReasonRegistryEntrySchema = z.strictObject({
  code: creativeReviewReasonCodeSchema,
  description: z.string().trim().min(3).max(300),
});

export const referenceResolutionInputSchema = z
  .strictObject({
    candidates: z.array(referenceCandidateSchema).max(500),
    reasonRegistry: z.array(reviewReasonRegistryEntrySchema).max(200),
    request: referenceResolutionRequestSchema,
  })
  .superRefine((input, context) => {
    const codes = input.reasonRegistry.map((entry) => entry.code);
    if (new Set(codes).size !== codes.length) {
      context.addIssue({
        code: "custom",
        path: ["reasonRegistry"],
        message: "The reason registry cannot define one code twice.",
      });
    }
  });

export const resolvedReferenceSlotSchema = z.strictObject({
  role: positiveConditioningRoleSchema,
  ordinal: z.number().int().nonnegative(),
  brandAssetId: uuidSchema,
  brandAssetVersionId: uuidSchema,
  referenceMode: referenceModeSchema,
  script: scriptCodeSchema.nullable(),
});

export const avoidReferenceSchema = z.strictObject({
  role: z.literal("avoid"),
  brandAssetId: uuidSchema,
  brandAssetVersionId: uuidSchema,
  reasonCodes: uniqueArraySchema(creativeReviewReasonCodeSchema, 15).min(1),
});

export const negativeRuleSchema = z.strictObject({
  code: creativeReviewReasonCodeSchema,
  description: z.string().trim().min(3).max(300),
});

export const referenceResolutionSchema = z
  .strictObject({
    resolverVersion: z.literal(RESOLVER_VERSION),
    outcome: referenceResolutionOutcomeSchema,
    refusalCode: referenceResolutionRefusalCodeSchema.nullable(),
    referenceSlots: z.array(resolvedReferenceSlotSchema).max(POSITIVE_REFERENCE_LIMIT),
    avoidReferences: z.array(avoidReferenceSchema).max(AVOID_REFERENCE_LIMIT),
    negativeRules: z.array(negativeRuleSchema).max(NEGATIVE_RULE_LIMIT),
  })
  .superRefine((resolution, context) => {
    const hasSubject = resolution.referenceSlots.some((slot) => slot.role === "subject");
    if (resolution.outcome === "resolved" && !hasSubject) {
      context.addIssue({
        code: "custom",
        path: ["referenceSlots"],
        message: "A resolved result must carry a subject reference.",
      });
    }
    if (
      (resolution.outcome === "insufficient") !==
      (resolution.refusalCode === "no_declared_subject")
    ) {
      context.addIssue({
        code: "custom",
        path: ["refusalCode"],
        message: "Only an insufficient result carries the no-declared-subject refusal.",
      });
    }

    for (const [role, cap] of Object.entries(REFERENCE_SLOT_CAPS)) {
      if (resolution.referenceSlots.filter((slot) => slot.role === role).length > cap) {
        context.addIssue({
          code: "custom",
          path: ["referenceSlots"],
          message: `The ${role} slot cap is ${cap}.`,
        });
      }
    }

    const positiveAssetIds = resolution.referenceSlots.map((slot) => slot.brandAssetId);
    if (new Set(positiveAssetIds).size !== positiveAssetIds.length) {
      context.addIssue({
        code: "custom",
        path: ["referenceSlots"],
        message: "One asset may occupy only one positive slot.",
      });
    }

    const typographyScripts = resolution.referenceSlots
      .filter((slot) => slot.role === "typography")
      .map((slot) => slot.script);
    if (
      typographyScripts.some((script) => script === null) ||
      new Set(typographyScripts).size !== typographyScripts.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["referenceSlots"],
        message: "Typography slots require one distinct requested script each.",
      });
    }
    if (
      resolution.referenceSlots.some((slot) => slot.role !== "typography" && slot.script !== null)
    ) {
      context.addIssue({
        code: "custom",
        path: ["referenceSlots"],
        message: "Only typography slots may carry a script.",
      });
    }

    const avoidAssetIds = resolution.avoidReferences.map((reference) => reference.brandAssetId);
    if (
      new Set(avoidAssetIds).size !== avoidAssetIds.length ||
      avoidAssetIds.some((assetId) => positiveAssetIds.includes(assetId))
    ) {
      context.addIssue({
        code: "custom",
        path: ["avoidReferences"],
        message: "Avoid references must be unique and separate from positive slots.",
      });
    }
  });

export type ReferenceCandidate = z.infer<typeof referenceCandidateSchema>;
export type ReferenceResolutionRequest = z.infer<typeof referenceResolutionRequestSchema>;
export type ResolvedReferenceSlot = z.infer<typeof resolvedReferenceSlotSchema>;
export type AvoidReference = z.infer<typeof avoidReferenceSchema>;
export type NegativeRule = z.infer<typeof negativeRuleSchema>;
export type ReferenceResolution = z.infer<typeof referenceResolutionSchema>;
export type ReferenceResolutionInput = z.input<typeof referenceResolutionInputSchema>;

export type ReferenceResolutionErrorCode =
  | "exact_match_requires_owned_reference"
  | "missing_review_reason_description";

export class ReferenceResolutionError extends Error {
  constructor(
    readonly code: ReferenceResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReferenceResolutionError";
  }
}

const OUTPUT_ROLE_ORDER: Record<ResolvedReferenceSlot["role"], number> = {
  subject: 0,
  brand_mark: 1,
  setting: 2,
  style_exemplar: 3,
  palette: 4,
  typography: 5,
};

export function resolveReferences(input: ReferenceResolutionInput): ReferenceResolution {
  const parsed = referenceResolutionInputSchema.parse(input);
  const active = parsed.candidates.filter((candidate) => candidate.archivedAt === null);
  const rejected = active.filter((candidate) => candidate.currentVerdict === "rejected");
  const positive = active.filter((candidate) => candidate.currentVerdict !== "rejected");

  for (const candidate of positive) {
    if (candidate.requestedReferenceMode === "exact_match" && candidate.ownership !== "owned") {
      throw new ReferenceResolutionError(
        "exact_match_requires_owned_reference",
        `Reference ${candidate.brandAssetVersionId} is third-party and cannot be exact-matched.`,
      );
    }
  }

  const ordered = [...positive].sort(candidateComparator(parsed.request));
  const slots = selectPositiveSlots(ordered, parsed.request);
  const avoidReferences = selectAvoidReferences(rejected);
  const negativeRules = deriveNegativeRules(rejected, parsed.reasonRegistry);
  const hasSubject = slots.some((slot) => slot.role === "subject");
  const outcome = hasSubject
    ? "resolved"
    : parsed.request.subjectDescription !== null
      ? "synthesis_permitted"
      : "insufficient";

  return referenceResolutionSchema.parse({
    resolverVersion: RESOLVER_VERSION,
    outcome,
    refusalCode: outcome === "insufficient" ? "no_declared_subject" : null,
    referenceSlots: slots,
    avoidReferences,
    negativeRules,
  });
}

function candidateComparator(request: ReferenceResolutionRequest) {
  const requestedTags = comparisonSet([
    ...request.subjectTags,
    ...request.settingTags,
    ...request.occasionTags,
    ...request.styleTags,
  ]);

  return (left: ReferenceCandidate, right: ReferenceCandidate): number => {
    const verdictDifference = verdictRank(left.currentVerdict) - verdictRank(right.currentVerdict);
    if (verdictDifference !== 0) return verdictDifference;

    const overlapDifference =
      tagOverlap(right.tags, requestedTags) - tagOverlap(left.tags, requestedTags);
    if (overlapDifference !== 0) return overlapDifference;

    const versionDifference = right.version - left.version;
    if (versionDifference !== 0) return versionDifference;

    return left.brandAssetId.localeCompare(right.brandAssetId);
  };
}

function verdictRank(verdict: ReferenceCandidate["currentVerdict"]): number {
  return verdict === "approved" ? 0 : 1;
}

function comparisonSet(tags: string[]): Set<string> {
  return new Set(tags.map(assetTagComparisonKey));
}

function tagOverlap(tags: string[], requested: Set<string>): number {
  return new Set(tags.map(assetTagComparisonKey).filter((tag) => requested.has(tag))).size;
}

function selectPositiveSlots(
  ordered: ReferenceCandidate[],
  request: ReferenceResolutionRequest,
): ResolvedReferenceSlot[] {
  const selected: ResolvedReferenceSlot[] = [];
  const usedAssetIds = new Set<string>();
  const subjectTags = comparisonSet(request.subjectTags);

  for (const candidate of ordered) {
    if (selected.length >= REFERENCE_SLOT_CAPS.subject) break;
    if (
      candidate.conditioningRoles.includes("subject") &&
      tagOverlap(candidate.tags, subjectTags) > 0
    ) {
      addSlot(selected, usedAssetIds, candidate, "subject", null);
    }
  }

  fillRole(selected, usedAssetIds, ordered, "brand_mark", () => true);
  const settingTags = comparisonSet([...request.settingTags, ...request.occasionTags]);
  fillRole(
    selected,
    usedAssetIds,
    ordered,
    "setting",
    (candidate) => settingTags.size > 0 && tagOverlap(candidate.tags, settingTags) > 0,
  );
  const styleTags = comparisonSet([...request.styleTags, ...request.occasionTags]);
  fillRole(
    selected,
    usedAssetIds,
    ordered,
    "style_exemplar",
    (candidate) => styleTags.size > 0 && tagOverlap(candidate.tags, styleTags) > 0,
  );
  fillRole(selected, usedAssetIds, ordered, "palette", () => true);

  const requestedScripts = [...request.scripts].sort().slice(0, TYPOGRAPHY_SCRIPT_LIMIT);
  for (const script of requestedScripts) {
    if (selected.length >= POSITIVE_REFERENCE_LIMIT) break;
    const candidate = ordered.find(
      (entry) =>
        !usedAssetIds.has(entry.brandAssetId) &&
        entry.conditioningRoles.includes("typography") &&
        entry.scripts.includes(script),
    );
    if (candidate) addSlot(selected, usedAssetIds, candidate, "typography", script);
  }

  return selected
    .sort((left, right) => {
      const roleDifference = OUTPUT_ROLE_ORDER[left.role] - OUTPUT_ROLE_ORDER[right.role];
      if (roleDifference !== 0) return roleDifference;
      if (left.script !== null || right.script !== null) {
        return (left.script ?? "").localeCompare(right.script ?? "");
      }
      return left.ordinal - right.ordinal;
    })
    .map((slot, index, all) => ({
      ...slot,
      ordinal: all.slice(0, index).filter((other) => other.role === slot.role).length,
    }));
}

function fillRole(
  selected: ResolvedReferenceSlot[],
  usedAssetIds: Set<string>,
  ordered: ReferenceCandidate[],
  role: Exclude<ResolvedReferenceSlot["role"], "subject" | "typography">,
  matches: (candidate: ReferenceCandidate) => boolean,
): void {
  for (const candidate of ordered) {
    if (
      selected.length >= POSITIVE_REFERENCE_LIMIT ||
      selected.filter((slot) => slot.role === role).length >= REFERENCE_SLOT_CAPS[role]
    ) {
      return;
    }
    if (
      !usedAssetIds.has(candidate.brandAssetId) &&
      candidate.conditioningRoles.includes(role) &&
      matches(candidate)
    ) {
      addSlot(selected, usedAssetIds, candidate, role, null);
    }
  }
}

function addSlot(
  selected: ResolvedReferenceSlot[],
  usedAssetIds: Set<string>,
  candidate: ReferenceCandidate,
  role: ResolvedReferenceSlot["role"],
  script: ResolvedReferenceSlot["script"],
): void {
  if (selected.length >= POSITIVE_REFERENCE_LIMIT || usedAssetIds.has(candidate.brandAssetId)) {
    return;
  }
  selected.push({
    role,
    ordinal: selected.filter((slot) => slot.role === role).length,
    brandAssetId: candidate.brandAssetId,
    brandAssetVersionId: candidate.brandAssetVersionId,
    referenceMode: candidate.requestedReferenceMode,
    script,
  });
  usedAssetIds.add(candidate.brandAssetId);
}

function selectAvoidReferences(rejected: ReferenceCandidate[]): AvoidReference[] {
  const usedAssetIds = new Set<string>();
  const selected: AvoidReference[] = [];
  const ordered = [...rejected].sort((left, right) => {
    const timeDifference =
      Date.parse(right.currentReviewedAt!) - Date.parse(left.currentReviewedAt!);
    if (timeDifference !== 0) return timeDifference;
    const assetDifference = left.brandAssetId.localeCompare(right.brandAssetId);
    if (assetDifference !== 0) return assetDifference;
    return right.version - left.version;
  });

  for (const candidate of ordered) {
    if (selected.length >= AVOID_REFERENCE_LIMIT) break;
    if (usedAssetIds.has(candidate.brandAssetId)) continue;
    selected.push({
      role: "avoid",
      brandAssetId: candidate.brandAssetId,
      brandAssetVersionId: candidate.brandAssetVersionId,
      reasonCodes: candidate.currentReasonCodes,
    });
    usedAssetIds.add(candidate.brandAssetId);
  }
  return selected;
}

function deriveNegativeRules(
  rejected: ReferenceCandidate[],
  reasonRegistry: Array<z.infer<typeof reviewReasonRegistryEntrySchema>>,
): NegativeRule[] {
  const descriptions = new Map(reasonRegistry.map((entry) => [entry.code, entry.description]));
  const codes = [...new Set(rejected.flatMap((candidate) => candidate.currentReasonCodes))].sort();

  for (const code of codes) {
    if (!descriptions.has(code)) {
      throw new ReferenceResolutionError(
        "missing_review_reason_description",
        `Rejected reason ${code} has no governed registry description.`,
      );
    }
  }

  return codes.slice(0, NEGATIVE_RULE_LIMIT).map((code) => {
    const description = descriptions.get(code)!;
    return { code, description };
  });
}
