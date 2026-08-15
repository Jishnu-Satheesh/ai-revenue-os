import "server-only";

import { refineImagePrompt, type ModelRouter } from "@/ai/model-router";
import type {
  CampaignGenerationProvider,
  CampaignGenerationTelemetrySink,
} from "@/ai/campaign-generation-provider";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type { GenerationContext } from "@/modules/campaigns/application/generation-context";
import type { EvaluationFailure } from "@/modules/campaigns/application/evaluation";
import type { CampaignPlanner, GeneratedAssetUpload } from "@/workflows/campaigns/generate-bundle";
import type { RevisionPlanner } from "@/workflows/campaigns/revise-bundle";
import {
  campaignAssetPath,
  ingestCampaignImage,
} from "@/modules/campaigns/infrastructure/asset-intake";

/**
 * The planner: pinned evidence in, candidate creative out.
 *
 * Two boundaries are load-bearing here. The model's structured answer is never
 * trusted — it is returned as `unknown` and parsed by the caller. And every
 * generated image goes through the same intake as an operator upload: decoded,
 * re-encoded, stripped of metadata, and hashed. A model's claim about what it
 * produced is not evidence about the bytes; the bytes are.
 */

const OUTPUT_CONTRACT = [
  "A complete campaign bundle manifest object with these fields:",
  "schemaVersion (always 1), campaignId, version (always 1), source, objective,",
  "rationale, generationProfile, directions (exactly one each of control,",
  "evidence_led, experimental), actions, assets, measurementPlan, executionMode,",
  "totalSpendCeiling.",
  "Every direction carries id, kind, name, rationale, generationProfileOverride,",
  "assetIds, copy, hashtagSets, internalContentTags, softConventionDepartures,",
  "and experiment (non-null only on the experimental direction).",
  "Every asset carries id, contentHash (64 hex characters), mimeType, widthPx,",
  "heightPx, truthClass, provenance, and altText describing the image to draw.",
].join("\n");

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

        return { candidate: result.output, costMinor: result.usage.estimatedCostMinor };
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
    }) {
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

        const generated = await dependencies.provider.generateImage({
          context: {
            organizationId: context.organizationId,
            campaignId: context.campaignId,
            correlationId: context.correlationId,
          },
          prompt: refineImagePrompt({
            route: imageRoute,
            // The alt text is the description of the image, so it is also the
            // most honest thing to draw from: the picture and its description
            // cannot drift apart if one produced the other.
            subject: asset.altText,
            brandDirection: direction?.rationale ?? input.context.objective,
            negativeConstraints: input.context.hardConstraints,
          }),
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
