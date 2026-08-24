import { z } from "zod";

import {
  assetTagsSchema,
  namesByScriptSchema,
  subjectExclusionsSchema,
} from "@/domain/campaigns/asset-library";

/**
 * The Campaign Bundle manifest.
 *
 * This is the whole reviewable proposal, not a folder of assets: strategy,
 * three creative directions, the channel actions they produce, how the result
 * will be measured, and the exact spend it may consume. Approval binds to a
 * digest of this object, so anything that changes what an operator agreed to
 * must live inside it, and anything that does not — storage paths, timestamps,
 * provider responses, database identifiers used only for lookup — must not.
 */

const uuidSchema = z.string().uuid();
const sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, "A content hash must be SHA-256 hex.");
const currencySchema = z.string().regex(/^[A-Z]{3}$/, "Currency must be an ISO 4217 code.");
const isoTimestampSchema = z
  .string()
  .datetime({ offset: false })
  .describe("UTC instant. Rendered in the organization timezone, never stored in one.");

export const CAMPAIGN_GENERATION_PROFILES = [
  "brand_restricted",
  "brand_guided",
  "full_visual_freedom",
] as const;
export const campaignGenerationProfileSchema = z.enum(CAMPAIGN_GENERATION_PROFILES);

export const CREATIVE_DIRECTION_KINDS = ["control", "evidence_led", "experimental"] as const;
export const creativeDirectionKindSchema = z.enum(CREATIVE_DIRECTION_KINDS);

export const CAMPAIGN_CHANNELS = ["instagram", "facebook"] as const;
export const campaignChannelSchema = z.enum(CAMPAIGN_CHANNELS);

export const CAMPAIGN_PLACEMENTS = ["feed_image", "image_story"] as const;
export const campaignPlacementSchema = z.enum(CAMPAIGN_PLACEMENTS);

/**
 * What an asset actually is. Nothing generated may claim to be a photograph of
 * a real place, person, product state, or result, so the classification travels
 * with the asset into review, approval, and the audit record.
 */
export const ASSET_TRUTH_CLASSES = [
  "synthetic_generated",
  "synthetic_composite",
  "authentic_source",
] as const;
export const assetTruthClassSchema = z.enum(ASSET_TRUTH_CLASSES);

export const SUBJECT_PROFILE_STATES = ["draft", "confirmed"] as const;
export const subjectProfileStateSchema = z.enum(SUBJECT_PROFILE_STATES);

export const subjectProfileSchema = z
  .strictObject({
    id: uuidSchema,
    organizationId: uuidSchema,
    name: z.string().trim().min(1).max(160),
    slug: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2_000).nullable(),
    tags: assetTagsSchema,
    namesByScript: namesByScriptSchema,
    mustNotAppear: subjectExclusionsSchema,
    illustratedStyle: z.boolean(),
    state: subjectProfileStateSchema,
    confirmedBy: uuidSchema.nullable(),
    confirmedAt: isoTimestampSchema.nullable(),
    createdBy: uuidSchema,
    createdAt: isoTimestampSchema,
    updatedAt: isoTimestampSchema,
    archivedAt: isoTimestampSchema.nullable(),
  })
  .superRefine((profile, context) => {
    if (profile.state === "confirmed") {
      if (profile.description === null) {
        context.addIssue({
          code: "custom",
          path: ["description"],
          message: "A confirmed subject must carry the description a human approved.",
        });
      }
      if (profile.confirmedBy === null) {
        context.addIssue({
          code: "custom",
          path: ["confirmedBy"],
          message: "A confirmed subject must identify its confirmer.",
        });
      }
      if (profile.confirmedAt === null) {
        context.addIssue({
          code: "custom",
          path: ["confirmedAt"],
          message: "A confirmed subject must record when it was confirmed.",
        });
      }
      return;
    }

    if (profile.confirmedBy !== null || profile.confirmedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["state"],
        message: "A draft cannot carry confirmation evidence.",
      });
    }
  });

export const moneySchema = z
  .strictObject({
    amountMinor: z.number().int().nonnegative(),
    currency: currencySchema,
  })
  .describe("Integer minor units with an explicit currency. Never a float.");

/**
 * Where an asset came from. A generated asset names the model and prompt
 * version that produced it; a supplied asset names the brand asset version it
 * was derived from. Neither may be empty, because an asset with no provenance
 * cannot be defended after it is public.
 */
export const assetProvenanceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("generated"),
    modelId: z.string().trim().min(1).max(160),
    promptVersionId: z.string().trim().min(1).max(160),
    generationProfile: campaignGenerationProfileSchema,
    /** The brand asset versions used as visual reference, if any. */
    derivedFromBrandAssetVersionIds: z.array(uuidSchema).max(20),
  }),
  z.strictObject({
    kind: z.literal("brand_supplied"),
    brandAssetVersionId: uuidSchema,
  }),
]);

export const campaignAssetSchema = z.strictObject({
  id: uuidSchema,
  /** Included in the digest: a swapped image is a different proposal. */
  contentHash: sha256HexSchema,
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  widthPx: z.number().int().positive().max(20_000),
  heightPx: z.number().int().positive().max(20_000),
  truthClass: assetTruthClassSchema,
  provenance: assetProvenanceSchema,
  /** Required so a screen reader is never handed an unlabelled campaign image. */
  altText: z.string().trim().min(1).max(420),
});

/** Model output omits truth classification; deterministic code derives it later. */
export const campaignModelAssetSchema = campaignAssetSchema.omit({ truthClass: true });

/**
 * A public hashtag set for one channel.
 *
 * Hashtags are a discoverability treatment to test, not a reach promise, so the
 * set carries the short reason it was chosen. Display text is preserved exactly
 * as authored; only duplicate detection is case-insensitive.
 */
export const hashtagSetSchema = z.strictObject({
  channel: campaignChannelSchema,
  tags: z.array(
    z
      .string()
      .trim()
      .regex(/^#[^\s#]+$/, "A hashtag is # followed by no spaces."),
  ),
  rationale: z.string().trim().min(1).max(400),
});

export const campaignCopySchema = z.strictObject({
  channel: campaignChannelSchema,
  placement: campaignPlacementSchema,
  hook: z.string().trim().min(1).max(200),
  caption: z.string().trim().min(1).max(2_200),
  callToAction: z.string().trim().min(1).max(120),
  /** Why this moment, in the operator's words. Not a schedule; a reason. */
  timingRationale: z.string().trim().min(1).max(600),
});

/**
 * Internal content tags, kept deliberately separate from public hashtags.
 *
 * These never reach a provider. Merging the two lists once would publish an
 * internal label to customers, which is exactly the mistake the separation
 * exists to prevent.
 */
export const internalContentTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(60)
  .regex(/^[^#]/, "An internal tag is not a hashtag and must not start with #.");

export const creativeDirectionSchema = z.strictObject({
  id: uuidSchema,
  kind: creativeDirectionKindSchema,
  name: z.string().trim().min(1).max(120),
  /** Why this treatment could move the registered outcome. */
  rationale: z.string().trim().min(1).max(1_200),
  /** Set only when this direction departs from the bundle profile. */
  generationProfileOverride: campaignGenerationProfileSchema.nullable(),
  assetIds: z.array(uuidSchema).min(1).max(12),
  copy: z.array(campaignCopySchema).min(1),
  hashtagSets: z.array(hashtagSetSchema).min(1),
  internalContentTags: z.array(internalContentTagSchema).max(30),
  /**
   * Soft brand conventions this direction knowingly departs from, named one by
   * one. Declaring them is what makes the generation profile enforceable: a
   * departure nobody wrote down is a departure nobody reviewed.
   */
  softConventionDepartures: z.array(z.string().trim().min(1).max(200)).max(12),
  /**
   * Present only on the experimental direction, and required there. A variant
   * that cannot say what it challenges is decoration, not an experiment.
   */
  experiment: z
    .strictObject({
      challengedAssumption: z.string().trim().min(1).max(600),
      differenceFromControl: z.string().trim().min(1).max(600),
      whyItCouldWin: z.string().trim().min(1).max(600),
      stretchedConvention: z.string().trim().min(1).max(300),
      decidingEvidence: z.string().trim().min(1).max(600),
    })
    .nullable(),
});

export const campaignChannelActionSchema = z.strictObject({
  id: uuidSchema,
  directionId: uuidSchema,
  channel: campaignChannelSchema,
  placement: campaignPlacementSchema,
  scheduledFor: isoTimestampSchema,
  /**
   * Whether the bundle may proceed without it. `all_channels_required` ignores
   * this and blocks on any blocked action; `best_effort` uses it to decide what
   * a partial run may still do.
   */
  requirement: z.enum(["required", "optional"]),
  /** Paid actions only. Organic actions carry null, never a zero ceiling. */
  spendCeiling: moneySchema.nullable(),
});

/**
 * What would count as proof, decided before anything runs.
 *
 * Registering the metric, baseline, method, and window up front is what makes
 * a later result evidence rather than a story told about whatever happened.
 */
export const campaignMeasurementPlanSchema = z.strictObject({
  primaryMetricKey: z.string().trim().min(1).max(160),
  guardrailMetricKeys: z.array(z.string().trim().min(1).max(160)).max(20),
  baselineSource: z.string().trim().min(1).max(240),
  baselineLookbackDays: z.number().int().positive().max(730),
  attributionMethod: z.enum(["observational_prepost", "provider_randomized_experiment"]),
  outcomeWindowDays: z.number().int().positive().max(365),
  settlementDelayDays: z.number().int().nonnegative().max(90),
  minimumEvidenceTier: z.enum(["computed", "observed"]),
  /** What is reported when the evidence bar is not met. Never "assume success". */
  insufficientEvidenceConclusion: z.literal("inconclusive"),
});

/**
 * The bound an approval actually authorizes.
 *
 * Approving a campaign is approving a promise: an offer, a set of claims, and a
 * limit. Approving an image is approving a pitch: how that promise is phrased
 * and shown. Separating the two is what lets one human decision authorize many
 * creative variants without any of them saying something nobody agreed to.
 *
 * The policy lives inside the manifest, so it is inside the digest and inside
 * the approval binding. Widening it is therefore a material change like any
 * other: it creates a new version and invalidates the old approval.
 */
export const campaignGenerationPolicySchema = z.strictObject({
  maxVariantsPerDirection: z.number().int().positive().max(50),
  maxVariantsTotal: z.number().int().positive().max(300),
  /**
   * When the licence to generate ends. Deliberately *not* validated as a future
   * instant: whether the window is still open is a question with a clock, asked
   * at generation time. A schema that refused a lapsed policy would make an
   * approved campaign unparseable the moment it ended, destroying the record of
   * what was approved along with it.
   */
  policyExpiresAt: isoTimestampSchema,
  /** The offer every variant must sell. Null for a campaign that sells none. */
  lockedOfferRef: z.string().trim().min(1).max(240).nullable(),
  /** Claims a variant may repeat and may never add to. Order is incidental. */
  lockedAssertionKeys: z.array(z.string().trim().min(1).max(160)).max(120),
});

export const campaignSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("manual_brief"), sourceId: uuidSchema }),
  z.strictObject({ kind: z.literal("decision_opportunity"), sourceId: uuidSchema }),
]);

export const campaignBundleManifestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  campaignId: uuidSchema,
  version: z.number().int().positive(),
  source: campaignSourceSchema,
  objective: z.string().trim().min(1).max(600),
  rationale: z.string().trim().min(1).max(4_000),
  generationProfile: campaignGenerationProfileSchema,
  generationPolicy: campaignGenerationPolicySchema,
  directions: z.array(creativeDirectionSchema).min(3).max(6),
  actions: z.array(campaignChannelActionSchema).min(1).max(40),
  assets: z.array(campaignAssetSchema).min(1).max(60),
  measurementPlan: campaignMeasurementPlanSchema,
  executionMode: z.enum(["best_effort", "all_channels_required"]),
  totalSpendCeiling: moneySchema.nullable(),
});

type ManifestShape = z.infer<typeof campaignBundleManifestSchema>;
const campaignBundleModelManifestShapeSchema = campaignBundleManifestSchema.extend({
  assets: z.array(campaignModelAssetSchema).min(1).max(60),
});
type ModelManifestShape = z.infer<typeof campaignBundleModelManifestShapeSchema>;
type ReviewableManifestShape = ManifestShape | ModelManifestShape;

/**
 * The complete-proposal contract.
 *
 * `campaignBundleManifestSchema` describes the shape. These rules describe
 * whether the shape is a proposal a human could actually approve: three real
 * alternatives, every action backed by a direction, every asset reviewed,
 * copy and hashtags present for what will actually publish, and spend that
 * cannot exceed what the approval says.
 */
function checkStructure(manifest: ReviewableManifestShape, context: z.RefinementCtx): void {
  checkDirections(manifest, context);
  checkAssetGraph(manifest, context);
  checkActionCoverage(manifest, context);
  checkSpend(manifest, context);
  checkGenerationPolicy(manifest, context);
}

/**
 * The total cap may never be able to starve a direction.
 *
 * With five per direction and three directions, a total of twelve looks like a
 * reasonable budget and is really a race: whichever directions generate first
 * consume it. The loser is usually the experimental direction, which is the one
 * whose data the campaign most needs. Requiring the total to cover every
 * direction at its own cap makes the per-direction number the operative limit
 * and leaves the total as an honest backstop.
 */
function checkGenerationPolicy(manifest: ReviewableManifestShape, context: z.RefinementCtx): void {
  const policy = manifest.generationPolicy;
  const required = policy.maxVariantsPerDirection * manifest.directions.length;

  if (policy.maxVariantsTotal < required) {
    context.addIssue({
      code: "custom",
      path: ["generationPolicy", "maxVariantsTotal"],
      message: `A total cap of ${policy.maxVariantsTotal} cannot cover ${manifest.directions.length} directions at ${policy.maxVariantsPerDirection} each; it needs at least ${required}.`,
    });
  }
}

function checkDirections(manifest: ReviewableManifestShape, context: z.RefinementCtx): void {
  for (const kind of CREATIVE_DIRECTION_KINDS) {
    const matching = manifest.directions.filter((direction) => direction.kind === kind);
    if (matching.length !== 1) {
      context.addIssue({
        code: "custom",
        path: ["directions"],
        message: `A reviewable bundle needs exactly one ${kind.replace("_", "-")} direction; found ${matching.length}.`,
      });
    }
  }

  manifest.directions.forEach((direction, index) => {
    // Only the experimental direction may carry an experiment, and it must.
    // A "variant" that cannot name what it challenges is decoration, and one
    // attached to the control would quietly make the reference a treatment.
    if (direction.kind === "experimental" && direction.experiment === null) {
      context.addIssue({
        code: "custom",
        path: ["directions", index, "experiment"],
        message:
          "The experimental direction must state the assumption it challenges and the evidence that would settle it.",
      });
    }
    if (direction.kind !== "experimental" && direction.experiment !== null) {
      context.addIssue({
        code: "custom",
        path: ["directions", index, "experiment"],
        message: "Only the experimental direction may declare an experiment.",
      });
    }
  });
}

function checkAssetGraph(manifest: ReviewableManifestShape, context: z.RefinementCtx): void {
  const declared = new Set(manifest.assets.map((asset) => asset.id));
  const used = new Set<string>();

  manifest.directions.forEach((direction, index) => {
    direction.assetIds.forEach((assetId, assetIndex) => {
      used.add(assetId);
      if (!declared.has(assetId)) {
        context.addIssue({
          code: "custom",
          path: ["directions", index, "assetIds", assetIndex],
          message: "This direction references an asset the bundle does not carry.",
        });
      }
    });
  });

  // An asset nobody reviews is an asset nobody approved. Storage may hold
  // discarded generations; the approved manifest may not.
  manifest.assets.forEach((asset, index) => {
    if (!used.has(asset.id)) {
      context.addIssue({
        code: "custom",
        path: ["assets", index],
        message: "Every asset must belong to a direction, so nothing unreviewed can publish.",
      });
    }
  });
}

function checkActionCoverage(manifest: ReviewableManifestShape, context: z.RefinementCtx): void {
  const directions = new Map(manifest.directions.map((direction) => [direction.id, direction]));

  manifest.actions.forEach((action, index) => {
    const direction = directions.get(action.directionId);
    if (!direction) {
      context.addIssue({
        code: "custom",
        path: ["actions", index, "directionId"],
        message: "This action references a direction the bundle does not contain.",
      });
      return;
    }

    const hasCopy = direction.copy.some(
      (entry) => entry.channel === action.channel && entry.placement === action.placement,
    );
    if (!hasCopy) {
      context.addIssue({
        code: "custom",
        path: ["actions", index],
        message: `The ${direction.kind} direction has no ${action.channel} ${action.placement} copy for this action.`,
      });
    }

    const hasHashtags = direction.hashtagSets.some((set) => set.channel === action.channel);
    if (!hasHashtags) {
      context.addIssue({
        code: "custom",
        path: ["actions", index],
        message: `The ${direction.kind} direction has no ${action.channel} hashtag set for this action.`,
      });
    }
  });
}

function checkSpend(manifest: ReviewableManifestShape, context: z.RefinementCtx): void {
  const paid = manifest.actions
    .map((action, index) => ({ action, index }))
    .filter((entry) => entry.action.spendCeiling !== null);

  if (paid.length === 0) return;

  const ceiling = manifest.totalSpendCeiling;
  if (!ceiling) {
    context.addIssue({
      code: "custom",
      path: ["totalSpendCeiling"],
      message: "A bundle with a paid action must declare the total spend it may consume.",
    });
    return;
  }

  let total = 0;
  for (const { action, index } of paid) {
    const spend = action.spendCeiling!;
    // Money never crosses currencies silently. A converted ceiling would be a
    // number nobody approved, computed at a rate nobody recorded.
    if (spend.currency !== ceiling.currency) {
      context.addIssue({
        code: "custom",
        path: ["actions", index, "spendCeiling"],
        message: `This action is capped in ${spend.currency} while the bundle is capped in ${ceiling.currency}.`,
      });
      continue;
    }
    total += spend.amountMinor;
  }

  if (total > ceiling.amountMinor) {
    context.addIssue({
      code: "custom",
      path: ["totalSpendCeiling"],
      message: "The action ceilings together exceed the bundle ceiling an operator would approve.",
    });
  }
}

/** The contract every reviewable, approvable bundle must satisfy. */
export const campaignBundleSchema = campaignBundleManifestSchema.superRefine(checkStructure);
/** The equally strict shape accepted from the model before truth class derivation. */
export const campaignBundleModelManifestSchema =
  campaignBundleModelManifestShapeSchema.superRefine(checkStructure);

export type CampaignBundleManifest = z.infer<typeof campaignBundleManifestSchema>;
export type CampaignBundleModelManifest = z.infer<typeof campaignBundleModelManifestSchema>;
export type CampaignCreativeDirection = z.infer<typeof creativeDirectionSchema>;
export type CampaignChannelAction = z.infer<typeof campaignChannelActionSchema>;
export type CampaignAsset = z.infer<typeof campaignAssetSchema>;
export type CampaignCopy = z.infer<typeof campaignCopySchema>;
export type CampaignHashtagSet = z.infer<typeof hashtagSetSchema>;
export type CampaignMeasurementPlan = z.infer<typeof campaignMeasurementPlanSchema>;
export type CampaignGenerationProfile = z.infer<typeof campaignGenerationProfileSchema>;
export type CreativeDirectionKind = z.infer<typeof creativeDirectionKindSchema>;
export type CampaignChannel = z.infer<typeof campaignChannelSchema>;
export type CampaignPlacement = z.infer<typeof campaignPlacementSchema>;
export type CampaignMoney = z.infer<typeof moneySchema>;
export type CampaignAssetTruthClass = z.infer<typeof assetTruthClassSchema>;
export type SubjectProfile = z.infer<typeof subjectProfileSchema>;
export type SubjectProfileState = z.infer<typeof subjectProfileStateSchema>;
