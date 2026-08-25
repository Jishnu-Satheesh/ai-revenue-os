import "server-only";

import { randomUUID } from "node:crypto";

import { type ModelRouter } from "@/ai/model-router";
import type {
  CampaignGenerationProvider,
  CampaignGenerationTelemetrySink,
} from "@/ai/campaign-generation-provider";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type { GenerationContext } from "@/modules/campaigns/application/generation-context";
import type { EvaluationFailure } from "@/modules/campaigns/application/evaluation";
import type {
  CampaignImageGuidance,
  CampaignPlanner,
  GeneratedAssetUpload,
} from "@/workflows/campaigns/generate-bundle";
import type { RevisionPlanner } from "@/workflows/campaigns/revise-bundle";
import { DomainError } from "@/lib/errors";
import {
  campaignAssetPath,
  ingestCampaignImage,
} from "@/modules/campaigns/infrastructure/asset-intake";
import { buildBlueprintReferencePrompt } from "@/modules/campaigns/infrastructure/reference-prompt";

export const CAMPAIGN_IMAGE_PROMPT_VERSION = "campaign-image-prompt-v1";

/**
 * The planner: pinned evidence in, candidate creative out.
 *
 * Two boundaries are load-bearing here. The model's structured answer is never
 * trusted — it is returned as `unknown` and parsed by the caller. And every
 * generated image goes through the same intake as an operator upload: decoded,
 * re-encoded, stripped of metadata, and hashed. A model's claim about what it
 * produced is not evidence about the bytes; the bytes are.
 */

/**
 * The exact shape the manifest must have, field by field.
 *
 * An earlier version of this listed the field *names* and left their shapes to
 * the model. It failed every time in the same places — `copy`, `hashtagSets`,
 * `experiment`, `source` — because naming a field says nothing about whether it
 * is a string, an object, or an array of objects. Naming the nested shape is
 * the difference between a manifest that validates and one that does not.
 *
 * Every enum is spelled out. A model asked for "a channel" invents "Instagram"
 * or "ig"; a model given the two permitted values returns one of them.
 */
const OUTPUT_CONTRACT = [
  "Return ONE JSON object, no prose and no code fence, with exactly these fields:",
  "",
  "Every field described as a UUID must be a real RFC 4122 v4 UUID in the form",
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx, for example",
  '3f2504e0-4f89-41d3-9a0c-0305e82c3301. Slugs such as "dir-control" are rejected.',
  "Ids must be internally consistent: an action's directionId and a direction's",
  "assetIds must exactly match ids you used in directions[] and assets[].",
  "",
  "schemaVersion: 2",
  "campaignId: any UUID; it is overwritten with the real campaign id",
  "generationPolicy: OMIT this field entirely. It bounds how many variants may",
  "  later be generated and until when, so it is derived from your schedule and",
  "  the pinned evidence rather than proposed. Anything you supply is replaced.",
  "version: 1",
  'source: { "kind": "manual_brief" | "decision_opportunity", "sourceId": UUID }',
  "objective: string (<=600 chars)",
  "rationale: string (<=4000 chars)",
  'generationProfile: "brand_restricted" | "brand_guided" | "full_visual_freedom"',
  'executionMode: "best_effort" | "all_channels_required"',
  "totalSpendCeiling: null, or { amountMinor: integer, currency: 3-letter code }",
  "",
  "directions: array of EXACTLY 3 objects, one per kind, each:",
  "  id: UUID (unique)",
  '  kind: "control" | "evidence_led" | "experimental"',
  "  name: string (<=120)",
  "  rationale: string (<=1200)",
  "  generationProfileOverride: null or a generationProfile value",
  "  assetIds: array of UUIDs, each also present in assets[]",
  "  copy: ARRAY of objects, at least one, each:",
  '    { channel: "instagram"|"facebook", placement: "feed_image"|"image_story",',
  "      hook: string(<=200), caption: string(<=2200), callToAction: string(<=120),",
  "      timingRationale: string(<=600) }",
  "  hashtagSets: ARRAY of objects, at least one, each:",
  '    { channel: "instagram"|"facebook", tags: [], rationale: string(<=400) }',
  "    tags MUST be an empty array. No verified provider contract states a",
  "    hashtag limit for these channels yet, so proposing hashtags would be",
  "    proposing something nobody can check. Say so in the rationale.",
  "  internalContentTags: array of strings that must NOT start with #",
  "  softConventionDepartures: array of strings (<=200 each). MUST be empty on",
  "    the control and evidence_led directions. On the experimental direction,",
  "    each departure must be named in that direction's experiment.stretchedConvention",
  "    verbatim, so review shows exactly what the bundle stretches.",
  "  experiment: null on control and evidence_led. On experimental ONLY, an object:",
  "    { challengedAssumption: string(<=600), differenceFromControl: string(<=600),",
  "      whyItCouldWin: string(<=600), stretchedConvention: string(<=300),",
  "      decidingEvidence: string(<=600) }",
  "",
  "actions: array of at least 1 object, each:",
  "  { id: UUID, directionId: UUID of a direction above,",
  '    channel: "instagram"|"facebook", placement: "feed_image"|"image_story",',
  "    scheduledFor: ISO 8601 UTC timestamp ending in Z, at or after the",
  "      earliest_scheduled_for value in <scheduling_window>. Never a past date.",
  '    requirement: "required"|"optional",',
  "    spendCeiling: null for organic, else { amountMinor, currency } }",
  "  Each action needs matching copy AND a hashtag set on its direction for its channel.",
  "",
  "assets: array of at least 1 object, each:",
  "  { id: UUID referenced by a direction's assetIds,",
  "    contentHash: EXACTLY 64 lowercase hex characters [0-9a-f]. This is a",
  "      placeholder; the real hash is computed from the image after it is drawn,",
  "      so any 64-character hex string is acceptable here, but the length and",
  "      alphabet are not negotiable.",
  '    mimeType: "image/jpeg"|"image/png"|"image/webp", widthPx, heightPx: integers,',
  "    provenance: an object with EXACTLY these five keys and no others:",
  '      { kind: "generated", modelId: string, promptVersionId: string,',
  "        generationProfile: one of the three profile values,",
  "        derivedFromBrandAssetVersionIds: [] }",
  "    altText: string(<=420) describing the image to draw }",
  "  Add no key that is not listed here. Unknown keys are rejected.",
  "",
  "measurementPlan: {",
  "  primaryMetricKey: copy the registered metric key you were given, verbatim,",
  "  guardrailMetricKeys: array of strings,",
  "  baselineSource: copy the baseline source string you were given, verbatim,",
  "  baselineLookbackDays: positive integer, ",
  '  attributionMethod: "observational_prepost"|"provider_randomized_experiment",',
  "  outcomeWindowDays: positive integer, settlementDelayDays: integer >= 0,",
  '  minimumEvidenceTier: "computed"|"observed",',
  '  insufficientEvidenceConclusion: "inconclusive" }',
].join("\n");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Replaces the model's identifiers with real UUIDs, keeping references intact.
 *
 * Identifiers are structural, not creative. Asking a model for a v4 UUID and
 * hoping is a losing game — it returns slugs, truncated hex, or a UUID with the
 * wrong version nibble, and each one fails validation for a reason that has
 * nothing to do with the quality of the campaign it proposed.
 *
 * So the model is allowed to use whatever handles it likes, and this maps them
 * onto real UUIDs. Only ids the model actually declared are mapped: a reference
 * to a direction or asset that does not exist stays untouched and is still
 * rejected downstream. Fixing the format must not repair a broken reference,
 * because a dangling reference means the proposal does not hang together.
 */
export function normalizeManifestIds(
  candidate: unknown,
  authoritative: { campaignId: string; policy: AuthoritativePolicyInput },
): unknown {
  if (typeof candidate !== "object" || candidate === null) return candidate;
  const manifest = candidate as Record<string, unknown>;

  // Which campaign this is is a fact, not a proposal. The database checks the
  // manifest's campaignId against the row it is being written to, so a model
  // that guessed one fails the write after every image has been paid for.
  manifest.campaignId = authoritative.campaignId;

  // The policy is the bound on this model's own future authority: how many
  // variants it may produce and until when. Asking it to propose that would be
  // asking it how much rope it would like. It is derived here instead, from
  // the pinned evidence and the schedule the bundle already declares.
  manifest.generationPolicy = derivePolicy(manifest, authoritative.policy);

  const declared = new Map<string, string>();
  const declare = (value: unknown) => {
    if (typeof value !== "string" || value.length === 0 || declared.has(value)) return;
    // A well-formed UUID is kept as-is, so a good answer stays byte-identical.
    declared.set(value, UUID_PATTERN.test(value) ? value : randomUUID());
  };

  const rows = (key: string): Record<string, unknown>[] => {
    const value = manifest[key];
    return Array.isArray(value)
      ? value.filter(
          (row): row is Record<string, unknown> => typeof row === "object" && row !== null,
        )
      : [];
  };

  for (const key of ["directions", "assets", "actions"]) {
    for (const row of rows(key)) declare(row.id);
  }

  const mapped = (value: unknown) =>
    typeof value === "string" && declared.has(value) ? declared.get(value) : value;

  for (const key of ["directions", "assets", "actions"]) {
    for (const row of rows(key)) {
      row.id = mapped(row.id);
      if ("directionId" in row) row.directionId = mapped(row.directionId);
      if (Array.isArray(row.assetIds)) row.assetIds = row.assetIds.map(mapped);
    }
  }

  return manifest;
}

/**
 * How many variants one direction may produce under a single approval.
 *
 * Four is enough for the delivery system to tell creatives apart and small
 * enough that an operator can still scan the fleet. It stays a constant until
 * an operator has a reason to change it, because a default nobody chose is
 * safer than a number a model picked.
 */
export const DEFAULT_MAX_VARIANTS_PER_DIRECTION = 4;

export type AuthoritativePolicyInput = {
  /** The offer the campaign actually recorded. Null when it sells none. */
  offer: string | null;
  /** Keys of the pinned evidence. A variant may repeat these and add none. */
  factKeys: readonly string[];
  maxVariantsPerDirection?: number;
};

/**
 * The licence to generate ends when the campaign's last send does.
 *
 * Derived from the schedule rather than configured, because new creative after
 * the final action has nothing left to run on. Taking the latest action keeps
 * the window exactly as long as the bundle an operator is about to read.
 */
function derivePolicy(
  manifest: Record<string, unknown>,
  input: AuthoritativePolicyInput,
): Record<string, unknown> {
  const perDirection = input.maxVariantsPerDirection ?? DEFAULT_MAX_VARIANTS_PER_DIRECTION;
  const directionCount = Array.isArray(manifest.directions) ? manifest.directions.length : 0;

  const scheduled = (Array.isArray(manifest.actions) ? manifest.actions : [])
    .map((action) =>
      typeof action === "object" && action !== null
        ? (action as Record<string, unknown>).scheduledFor
        : undefined,
    )
    .filter((value): value is string => typeof value === "string")
    .sort();
  const latest = scheduled.at(-1);

  return {
    maxVariantsPerDirection: perDirection,
    // Never able to starve a direction; see checkGenerationPolicy.
    maxVariantsTotal: perDirection * Math.max(directionCount, 1),
    // A malformed or absent schedule leaves the field as the model's problem to
    // fail on, rather than inventing a window the bundle does not support.
    policyExpiresAt: latest ?? "",
    lockedOfferRef: input.offer,
    lockedAssertionKeys: [...input.factKeys],
  };
}

const PLACEMENT_SIZES = {
  feed_image: { widthPx: 1024, heightPx: 1024 },
  image_story: { widthPx: 1024, heightPx: 1792 },
} as const;

export type CampaignPlannerDependencies = {
  provider: CampaignGenerationProvider;
  router: ModelRouter;
  storage: CampaignAssetStorage;
  telemetry?: CampaignGenerationTelemetrySink;
};

export type CampaignAssetStorage = {
  upload(input: {
    path: string;
    bytes: Buffer;
    contentType: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
};

export function createCampaignPlanner(
  dependencies: CampaignPlannerDependencies,
  context: { organizationId: string; campaignId: string; correlationId: string },
): CampaignPlanner {
  const emit = (
    kind: "plan" | "image",
    outcome: "succeeded" | "failed",
    extra: { modelId: string; imageCount: number; attempt: number; durationMs: number },
  ) => {
    dependencies.telemetry?.record({
      kind,
      organizationId: context.organizationId,
      campaignId: context.campaignId,
      correlationId: context.correlationId,
      outcome,
      // Whether the output survives validation is decided by the caller, so
      // this boundary reports only that the call itself returned.
      validationOutcome: "not_applicable",
      inputTokens: null,
      outputTokens: null,
      estimatedCostMinor: null,
      ...extra,
    });
  };

  return {
    async plan(input: {
      context: GenerationContext;
      prompt: string;
      signal: AbortSignal;
      repairFailures?: readonly EvaluationFailure[];
    }) {
      const startedAt = Date.now();
      const attempt = input.repairFailures?.length ? 2 : 1;

      // A repair is told exactly what failed, by stable code and short detail.
      // The provider message is never included: it can echo the prompt.
      const body = input.repairFailures?.length
        ? [
            input.prompt,
            "",
            "<validation_failures>",
            ...input.repairFailures.map((failure) => `- ${failure.code}: ${failure.detail}`),
            "</validation_failures>",
          ].join("\n")
        : input.prompt;

      try {
        const result = await dependencies.provider.generatePlan({
          context: {
            organizationId: context.organizationId,
            campaignId: context.campaignId,
            correlationId: context.correlationId,
          },
          system: "You plan a governed marketing campaign from verified evidence.",
          prompt: body,
          outputContract: OUTPUT_CONTRACT,
        });

        emit("plan", "succeeded", {
          modelId: result.modelId,
          imageCount: 0,
          attempt,
          durationMs: Date.now() - startedAt,
        });

        return {
          candidate: normalizeManifestIds(result.output, {
            campaignId: context.campaignId,
            policy: {
              offer: input.context.offer,
              factKeys: input.context.facts.map((fact) => fact.key),
            },
          }),
          costMinor: result.usage.estimatedCostMinor,
        };
      } catch (error) {
        emit("plan", "failed", {
          modelId: dependencies.router.resolve("plan").modelId,
          imageCount: 0,
          attempt,
          durationMs: Date.now() - startedAt,
        });
        throw error;
      }
    },

    async materializeAssets(input: {
      context: GenerationContext;
      manifest: CampaignBundleManifest;
      signal: AbortSignal;
      imageGuidance?: CampaignImageGuidance;
    }) {
      if (!input.imageGuidance) {
        throw new DomainError(
          "VALIDATION_ERROR",
          "No governed image reference context is available for this generation.",
        );
      }

      const startedAt = Date.now();
      const uploads: GeneratedAssetUpload[] = [];
      const imageRoute = dependencies.router.resolve("image");
      let costMinor = 0;

      for (const asset of input.manifest.assets) {
        // Checked per asset, not once. Images are the slow, expensive part, and
        // a cancelled campaign should stop at the next one rather than finish
        // the set.
        if (input.signal.aborted) break;

        const direction = input.manifest.directions.find((entry) =>
          entry.assetIds.includes(asset.id),
        );
        const placement =
          input.manifest.actions.find((action) => action.directionId === direction?.id)
            ?.placement ?? "feed_image";
        const size = PLACEMENT_SIZES[placement];
        const blueprint = input.imageGuidance.blueprintsByAssetId[asset.id];
        if (!blueprint) {
          throw new DomainError(
            "VALIDATION_ERROR",
            "No governed art-direction blueprint is available for this image.",
          );
        }

        const generated = await dependencies.provider.generateImage({
          context: {
            organizationId: context.organizationId,
            campaignId: context.campaignId,
            correlationId: context.correlationId,
          },
          prompt: buildBlueprintReferencePrompt({
            operatorCreativeDirection: direction?.rationale ?? input.context.objective,
            subjectDescription: input.imageGuidance.subjectDescription,
            resolution: input.imageGuidance.resolution,
            hardConstraints: input.context.hardConstraints,
            blueprint,
          }),
          references: input.imageGuidance.references,
          widthPx: size.widthPx,
          heightPx: size.heightPx,
        });
        costMinor += generated.usage.estimatedCostMinor ?? 0;

        // The same gate an operator upload passes. A model is not a trusted
        // source of image bytes any more than a browser is.
        const ingested = await ingestCampaignImage({
          bytes: Buffer.from(generated.image.bytes),
        });
        if (ingested.outcome !== "accepted") {
          emit("image", "failed", {
            modelId: imageRoute.modelId,
            imageCount: uploads.length,
            attempt: 1,
            durationMs: Date.now() - startedAt,
          });
          // Returning short rather than throwing: the workflow treats a missing
          // asset as an incomplete run and publishes nothing.
          break;
        }

        const path = campaignAssetPath({
          organizationId: context.organizationId,
          campaignId: context.campaignId,
          // Assets are written under the run's correlation id until the version
          // exists, because the version id is only assigned at publish time.
          bundleVersionId: context.correlationId,
          assetId: asset.id,
          mimeType: ingested.mimeType,
        });

        const stored = await dependencies.storage.upload({
          path,
          bytes: ingested.bytes,
          contentType: ingested.mimeType,
        });
        if (!stored.ok) break;

        uploads.push({
          assetId: asset.id,
          storagePath: path,
          // The hash of what was stored, not what the model said it made.
          contentHash: ingested.contentHash,
          modelId: generated.image.modelId,
          promptVersionId: CAMPAIGN_IMAGE_PROMPT_VERSION,
        });
      }

      emit("image", "succeeded", {
        modelId: imageRoute.modelId,
        imageCount: uploads.length,
        attempt: 1,
        durationMs: Date.now() - startedAt,
      });

      return { uploads, costMinor: costMinor > 0 ? costMinor : null };
    },
  };
}

/** The revision planner. Words only: a revision never generates an image. */
export function createRevisionPlanner(
  dependencies: Pick<CampaignPlannerDependencies, "provider">,
): RevisionPlanner {
  return {
    async proposePatch(input) {
      const result = await dependencies.provider.generatePatch({
        context: {
          organizationId: input.organizationId,
          campaignId: input.campaignId,
          correlationId: input.correlationId,
        },
        operatorPrompt: input.operatorPrompt,
        allowedPaths: input.allowedPaths,
        currentSummary: input.currentSummary,
      });

      return { proposal: result.output, costMinor: result.usage.estimatedCostMinor };
    },
  };
}

/** Supabase Storage, narrowed to the one operation the planner performs. */
export function createSupabaseCampaignAssetStorage(client: {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean },
      ): Promise<{ error: { message?: string } | null }>;
    };
  };
}): CampaignAssetStorage {
  return {
    async upload(input) {
      const { error } = await client.storage
        .from("campaign-assets")
        .upload(input.path, input.bytes, {
          contentType: input.contentType,
          // A retried attempt rewrites its own object rather than failing on a
          // path it already created.
          upsert: true,
        });
      // The provider message is not surfaced: storage errors can echo the path,
      // which carries tenant and campaign identifiers.
      return error ? { ok: false, reason: "upload_failed" } : { ok: true };
    },
  };
}
