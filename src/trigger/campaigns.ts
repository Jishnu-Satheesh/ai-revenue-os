import { logger, queue, schemaTask, tasks } from "@trigger.dev/sdk";

import { createModelRouter } from "@/ai/model-router";
import { env } from "@/lib/env";
import { createCampaignWorkerServiceClient } from "@/lib/supabase/service";
import {
  campaignGenerationPayloadSchema,
  campaignRevisionPayloadSchema,
  parseCampaignGenerationPayload,
  parseCampaignRevisionPayload,
} from "@/workflows/campaigns/contracts";
import {
  GENERATE_BUNDLE_MAX_DURATION_SECONDS,
  REVISE_BUNDLE_MAX_DURATION_SECONDS,
} from "@/workflows/campaigns/durations";
import { generateCampaignBundle } from "@/workflows/campaigns/generate-bundle";
import { reviseCampaignBundle } from "@/workflows/campaigns/revise-bundle";
import {
  createCampaignRunStore,
  type CampaignRunPersistence,
} from "@/modules/campaigns/infrastructure/run-repository";
import {
  createGenerationContextLoader,
  type GenerationContextPersistence,
} from "@/modules/campaigns/infrastructure/generation-readers";
import {
  createCampaignPlanner,
  createRevisionPlanner,
  createSupabaseCampaignAssetStorage,
} from "@/modules/campaigns/infrastructure/campaign-planner";
import { createGeminiCampaignGenerationProvider } from "@/modules/campaigns/infrastructure/gemini-campaign-generation-provider";
import { createConsoleCampaignGenerationSink } from "@/ai/campaign-generation-provider";
import { createCampaignVersionWriter } from "@/modules/campaigns/infrastructure/repository";
import { verifiedChannelLimits } from "@/modules/campaigns/application/verified-limits";
import type { CampaignPersistence } from "@/modules/campaigns/infrastructure/repository";

/**
 * Campaign generation as durable work.
 *
 * Trigger runs the code; Postgres decides what happened. The run row is claimed
 * with a lease and a token, so a duplicate delivery stands down, a dead worker
 * is taken over once its lease lapses, and a worker that wakes up late cannot
 * publish over the result of the one that replaced it.
 */

const retry = {
  // Generation is expensive. Two attempts survives a transient provider fault;
  // more just multiplies the bill for a real failure.
  maxAttempts: 2,
  minTimeoutInMs: 2_000,
  maxTimeoutInMs: 30_000,
  factor: 2,
} as const;

/**
 * One generation at a time across the platform.
 *
 * Deliberately conservative for the first release: image generation is the
 * slowest and most expensive thing this system does, and a burst of parallel
 * runs would hit provider rate limits and spend before anyone noticed.
 */
export const campaignGenerationQueue = queue({
  name: "campaign-generation",
  concurrencyLimit: 1,
});

tasks.onCancel(async ({ task: taskId, payload }) => {
  if (taskId !== "campaign.generate-bundle" && taskId !== "campaign.revise-bundle") return;
  // Parsed before a service-role client exists, exactly as in the run path.
  const parsed =
    taskId === "campaign.revise-bundle"
      ? parseCampaignRevisionPayload(payload)
      : parseCampaignGenerationPayload(payload);
  const supabase = createCampaignWorkerServiceClient();
  await createCampaignRunStore(supabase as unknown as CampaignRunPersistence).cancel({
    organizationId: parsed.organizationId,
    runId: parsed.runId,
  });
});

export const generateCampaignBundleTask = schemaTask({
  id: "campaign.generate-bundle",
  schema: campaignGenerationPayloadSchema,
  queue: campaignGenerationQueue,
  retry,
  maxDuration: GENERATE_BUNDLE_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    // Re-parsed rather than trusted. `schemaTask` already validated it; this
    // proves the worker's own contract before a tenant-bypassing client exists.
    const parsed = parseCampaignGenerationPayload(payload);
    const supabase = createCampaignWorkerServiceClient();
    const runs = createCampaignRunStore(supabase as unknown as CampaignRunPersistence);
    // One loader per run. The claim token arrives with each read, so nothing
    // here needs to claim a second time.
    const context = createGenerationContextLoader(
      supabase as unknown as GenerationContextPersistence,
      { organizationId: parsed.organizationId, runId: parsed.runId },
    );

    const result = await generateCampaignBundle(
      parsed,
      {
        runs,
        snapshots: context.snapshots,
        planner: createCampaignPlanner(
          {
            provider: createGeminiCampaignGenerationProvider(),
            router: campaignRouter(),
            storage: createSupabaseCampaignAssetStorage(supabase),
            telemetry: createConsoleCampaignGenerationSink(),
          },
          {
            organizationId: parsed.organizationId,
            campaignId: parsed.campaignId,
            correlationId: parsed.correlationId,
          },
        ),
        publisher: {
          publish: (input) =>
            createCampaignVersionWriter(supabase as unknown as CampaignPersistence).createVersion(
              input,
            ),
        },
        limitsByChannel: verifiedChannelLimits(),
        isCancelled: () => signal.aborted,
      },
      signal,
    );

    logger.info("campaign.generation_finished", {
      organizationId: parsed.organizationId,
      campaignId: parsed.campaignId,
      runId: parsed.runId,
      correlationId: parsed.correlationId,
      status: result.status,
      ...(result.status === "published"
        ? { bundleVersionId: result.bundleVersionId, version: result.version }
        : {}),
      ...(result.status === "failed" ? { failureCode: result.failureCode } : {}),
      ...(result.status === "needs_data" ? { missingCount: result.missing.length } : {}),
    });

    return result;
  },
});

export const reviseCampaignBundleTask = schemaTask({
  id: "campaign.revise-bundle",
  schema: campaignRevisionPayloadSchema,
  queue: campaignGenerationQueue,
  retry,
  maxDuration: REVISE_BUNDLE_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    const parsed = parseCampaignRevisionPayload(payload);
    const supabase = createCampaignWorkerServiceClient();
    const runs = createCampaignRunStore(supabase as unknown as CampaignRunPersistence);
    const context = createGenerationContextLoader(
      supabase as unknown as GenerationContextPersistence,
      { organizationId: parsed.organizationId, runId: parsed.runId },
    );

    const result = await reviseCampaignBundle(
      parsed,
      {
        runs,
        source: context.revisionSource,
        prompts: context.revisionPrompts,
        planner: createRevisionPlanner({ provider: createGeminiCampaignGenerationProvider() }),
        publisher: {
          publish: (input) =>
            createCampaignVersionWriter(supabase as unknown as CampaignPersistence).createVersion(
              input,
            ),
        },
        isCancelled: () => signal.aborted,
      },
      signal,
    );

    logger.info("campaign.revision_finished", {
      organizationId: parsed.organizationId,
      campaignId: parsed.campaignId,
      runId: parsed.runId,
      correlationId: parsed.correlationId,
      baseVersionId: parsed.baseVersionId,
      status: result.status,
      ...(result.status === "published"
        ? { bundleVersionId: result.bundleVersionId, version: result.version }
        : {}),
      ...(result.status === "rejected" ? { rejectionReason: result.reason } : {}),
      ...(result.status === "failed" ? { failureCode: result.failureCode } : {}),
    });

    return result;
  },
});

function campaignRouter() {
  return createModelRouter({
    textModel: env.CAMPAIGN_TEXT_MODEL,
    planModel: env.CAMPAIGN_PLAN_MODEL,
    patchModel: env.CAMPAIGN_PATCH_MODEL,
    repairModel: env.CAMPAIGN_REPAIR_MODEL,
    imageModel: env.CAMPAIGN_IMAGE_MODEL,
  });
}
