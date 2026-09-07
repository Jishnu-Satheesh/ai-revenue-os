import { logger, queue, schemaTask, tasks } from "@trigger.dev/sdk";

import { createModelRouter } from "@/ai/model-router";
import { env } from "@/lib/env";
import { createCampaignWorkerServiceClient } from "@/lib/supabase/service";
import {
  campaignCyclePayloadSchema,
  campaignGenerationPayloadSchema,
  campaignPlateEditPayloadSchema,
  campaignPosterRenderPayloadSchema,
  campaignSweepPayloadSchema,
  campaignRevisionPayloadSchema,
  campaignVariantPayloadSchema,
  parseCampaignGenerationPayload,
  parseCampaignRevisionPayload,
  parseCampaignVariantPayload,
} from "@/workflows/campaigns/contracts";
import { renderCampaignPoster } from "@/workflows/campaigns/render-poster";
import { editCampaignPlate } from "@/workflows/campaigns/edit-plate";
import { dispatchDueActions } from "@/workflows/campaigns/dispatch-due-actions";
import {
  collectCampaignMetrics,
  collectMetricsPayloadSchema,
} from "@/workflows/campaigns/collect-metrics";
import { runAllocationCycle } from "@/workflows/campaigns/allocation-cycle";
import { runSettleOutcome } from "@/workflows/campaigns/settle-outcome";
import { runProposeLearning } from "@/workflows/campaigns/propose-learning";
import {
  createCampaignCycleReader,
  createDueActionReader,
  createExposureRecorder,
  createMetricsGrantReader,
  createMetricSubjectReader,
  createUnavailableInsightsReader,
} from "@/modules/campaigns/infrastructure/execution-readers";
import { createCampaignCycleEvents } from "@/modules/campaigns/infrastructure/execution-events";
import { allocationThresholds } from "@/modules/campaigns/infrastructure/allocation-policy";
import { createDispatchPlanner } from "@/modules/campaigns/infrastructure/dispatch-planner";
import { createAllocationRepository } from "@/modules/campaigns/infrastructure/allocation-repository";
import { createMeasurementRepository } from "@/modules/campaigns/infrastructure/measurement-repository";
import { createLearningRepository } from "@/modules/campaigns/infrastructure/learning-repository";
import { createGeminiLearningDrafter } from "@/modules/campaigns/infrastructure/learning-drafter";
import { createCampaignMetricIngest } from "@/modules/campaigns/infrastructure/metric-ingest";
import { evaluateCampaign } from "@/modules/campaigns/application/allocation-service";
import { settleCampaign } from "@/modules/campaigns/application/measurement-service";
import { proposeLearning } from "@/modules/campaigns/application/learning-service";
import { createToolGateway } from "@/modules/tool-gateway/application/service";
import { createToolGatewayStore } from "@/modules/tool-gateway/infrastructure/repository";
import {
  compositeMaskedEdit,
  measureImage,
} from "@/modules/campaigns/infrastructure/plate-compositor";
import { buildPlateEditPrompt } from "@/modules/campaigns/infrastructure/plate-edit-prompt";
import { createPlateEditContextLoader } from "@/modules/campaigns/infrastructure/plate-edit-context-reader";
import { createGeminiPlateEditPlanner } from "@/modules/campaigns/infrastructure/plate-edit-planner";
import { createPlateEditStore } from "@/modules/campaigns/infrastructure/plate-edit-repository";
import { createEditedVersionWriter } from "@/modules/campaigns/infrastructure/edited-version-writer";
import {
  createPosterRenderContextLoader,
  createSupabaseCampaignObjectReader,
} from "@/modules/campaigns/infrastructure/poster-context-reader";
import { createPosterRenderStore } from "@/modules/campaigns/infrastructure/poster-render-repository";
import { compositePoster } from "@/modules/campaigns/infrastructure/poster-compositor";
import {
  createFromOpportunity,
  createFromOpportunityPayloadSchema,
} from "@/workflows/campaigns/create-from-opportunity";
import {
  GENERATE_BUNDLE_MAX_DURATION_SECONDS,
  GENERATE_VARIANTS_MAX_DURATION_SECONDS,
  ALLOCATION_CYCLE_MAX_DURATION_SECONDS,
  COLLECT_METRICS_MAX_DURATION_SECONDS,
  DISPATCH_DUE_ACTIONS_MAX_DURATION_SECONDS,
  EDIT_PLATE_MAX_DURATION_SECONDS,
  PROPOSE_LEARNING_MAX_DURATION_SECONDS,
  RENDER_POSTER_MAX_DURATION_SECONDS,
  SETTLE_OUTCOME_MAX_DURATION_SECONDS,
  REVISE_BUNDLE_MAX_DURATION_SECONDS,
} from "@/workflows/campaigns/durations";
import { generateCampaignBundle } from "@/workflows/campaigns/generate-bundle";
import { generateCampaignVariants } from "@/workflows/campaigns/generate-variants";
import { reviseCampaignBundle } from "@/workflows/campaigns/revise-bundle";
import {
  createCampaignRunStore,
  type CampaignRunPersistence,
} from "@/modules/campaigns/infrastructure/run-repository";
import {
  createGenerationContextLoader,
  createReferenceCandidateReader,
  createSupabaseReferenceObjectReader,
  type GenerationContextPersistence,
} from "@/modules/campaigns/infrastructure/generation-readers";
import {
  createCampaignPlanner,
  createRevisionPlanner,
  createSupabaseCampaignAssetStorage,
} from "@/modules/campaigns/infrastructure/campaign-planner";
import {
  createGeminiCampaignGenerationProvider,
  createGeminiRepairCall,
} from "@/modules/campaigns/infrastructure/gemini-campaign-generation-provider";
import { createBlueprintPlanner } from "@/modules/campaigns/infrastructure/blueprint-planner";
import {
  createGenerationReferenceContextWriter,
  type GenerationReferenceContextPersistence,
} from "@/modules/campaigns/infrastructure/creation-repository";
import { createCampaignVariantStore } from "@/modules/campaigns/infrastructure/variant-repository";
import { createVariantContextLoader } from "@/modules/campaigns/infrastructure/variant-readers";
import {
  createVariantPlanner,
  CAMPAIGN_VARIANT_PROMPT_VERSION,
} from "@/modules/campaigns/infrastructure/variant-planner";
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
  if (
    taskId !== "campaign.generate-bundle" &&
    taskId !== "campaign.revise-bundle" &&
    taskId !== "campaign.generate-variants"
  ) {
    return;
  }
  // Parsed before a service-role client exists, exactly as in the run path.
  const parsed =
    taskId === "campaign.revise-bundle"
      ? parseCampaignRevisionPayload(payload)
      : taskId === "campaign.generate-variants"
        ? parseCampaignVariantPayload(payload)
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
    const router = campaignRouter();
    const generation = createGeminiRepairCall({ router });

    const result = await generateCampaignBundle(
      parsed,
      {
        runs,
        snapshots: context.snapshots,
        candidates: createReferenceCandidateReader(
          supabase as unknown as GenerationContextPersistence,
        ),
        referenceObjects: createSupabaseReferenceObjectReader(supabase),
        referenceContext: createGenerationReferenceContextWriter(
          supabase as unknown as GenerationReferenceContextPersistence,
        ),
        blueprintPlanner: createBlueprintPlanner({
          provider: generation.provider,
          repair: generation,
        }),
        planner: createCampaignPlanner(
          {
            provider: generation.provider,
            router,
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

export const generateCampaignVariantsTask = schemaTask({
  id: "campaign.generate-variants",
  schema: campaignVariantPayloadSchema,
  queue: campaignGenerationQueue,
  retry,
  maxDuration: GENERATE_VARIANTS_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    const parsed = parseCampaignVariantPayload(payload);
    const supabase = createCampaignWorkerServiceClient();
    const runs = createCampaignRunStore(supabase as unknown as CampaignRunPersistence);
    const generationContext = createGenerationContextLoader(
      supabase as unknown as GenerationContextPersistence,
      { organizationId: parsed.organizationId, runId: parsed.runId },
    );
    const router = campaignRouter();
    const generation = createGeminiRepairCall({ router });

    const result = await generateCampaignVariants(
      parsed,
      {
        runs,
        context: createVariantContextLoader(supabase as never),
        snapshots: generationContext.snapshots,
        candidates: createReferenceCandidateReader(
          supabase as unknown as GenerationContextPersistence,
        ),
        referenceObjects: createSupabaseReferenceObjectReader(supabase),
        referenceContext: createGenerationReferenceContextWriter(
          supabase as unknown as GenerationReferenceContextPersistence,
        ),
        blueprintPlanner: createBlueprintPlanner({
          provider: generation.provider,
          repair: generation,
        }),
        planner: createVariantPlanner(
          {
            provider: generation.provider,
            router,
            storage: createSupabaseCampaignAssetStorage(supabase),
          },
          {
            organizationId: parsed.organizationId,
            campaignId: parsed.campaignId,
            correlationId: parsed.correlationId,
          },
        ),
        variants: createCampaignVariantStore(supabase as never),
        isCancelled: () => signal.aborted,
        promptVersionId: CAMPAIGN_VARIANT_PROMPT_VERSION,
      },
      signal,
    );

    logger.info("campaign.variants_finished", {
      organizationId: parsed.organizationId,
      campaignId: parsed.campaignId,
      runId: parsed.runId,
      correlationId: parsed.correlationId,
      // A skipped or replayed run stored nothing and says so, rather than
      // reporting a zero that reads like a run that tried and failed.
      ...(result.status === "completed" ||
      result.status === "cancelled" ||
      result.status === "cost_ceiling_reached"
        ? { variantsStored: result.stored }
        : {}),
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

/**
 * Draft requests are cheap database work, not generation: their own lane so a
 * burst of admissions never queues behind image rendering, and generation
 * never queues behind drafts.
 */
export const campaignDraftQueue = queue({
  name: "campaign-drafts",
  concurrencyLimit: 3,
});

export const createCampaignDraftTask = schemaTask({
  id: "campaign.create-from-opportunity",
  schema: createFromOpportunityPayloadSchema,
  queue: campaignDraftQueue,
  retry: {
    maxAttempts: 5,
    minTimeoutInMs: 2_000,
    maxTimeoutInMs: 60_000,
    factor: 2,
  },
  maxDuration: 120,
  run: async (payload) => {
    const parsed = createFromOpportunityPayloadSchema.parse(payload);
    const supabase = createCampaignWorkerServiceClient();

    const drafts = {
      claim: async (input: {
        organizationId: string;
        requestId: string;
        claimToken: string;
        leaseSeconds: number;
      }) => {
        const { data, error } = await supabase.rpc("claim_campaign_draft_request", {
          p_organization_id: input.organizationId,
          p_request_id: input.requestId,
          p_claim_token: input.claimToken,
          p_lease_seconds: input.leaseSeconds,
        });
        if (error ?? !data) throw error ?? new Error("Draft claim returned nothing.");
        return { status: String((data as { status: string }).status) };
      },
      create: async (input: {
        organizationId: string;
        requestId: string;
        claimToken: string;
        idempotencyKey: string;
      }) => {
        const { data, error } = await supabase.rpc("create_campaign_draft_from_request", {
          p_organization_id: input.organizationId,
          p_request_id: input.requestId,
          p_claim_token: input.claimToken,
          p_idempotency_key: input.idempotencyKey,
        });
        if (error ?? !data) throw error ?? new Error("Draft creation returned nothing.");
        const outcome = data as {
          campaignId: string;
          sourceSnapshotId: string | null;
          status: string;
        };
        return {
          campaignId: outcome.campaignId,
          sourceSnapshotId: outcome.sourceSnapshotId,
          status: outcome.status,
        };
      },
      fail: async (input: {
        organizationId: string;
        requestId: string;
        claimToken: string;
        retryable: boolean;
        failureCode: string;
      }) => {
        const { data, error } = await supabase.rpc("fail_campaign_draft_request", {
          p_organization_id: input.organizationId,
          p_request_id: input.requestId,
          p_claim_token: input.claimToken,
          p_retryable: input.retryable,
          p_failure_code: input.failureCode,
        });
        if (error ?? !data) throw error ?? new Error("Draft failure returned nothing.");
        return { status: String((data as { status: string }).status) };
      },
    };

    const result = await createFromOpportunity(drafts, parsed);

    logger.info("campaign.draft_finished", {
      organizationId: parsed.organizationId,
      correlationId: parsed.correlationId,
      outcome: result.outcome,
      ...(result.outcome === "created" || result.outcome === "replayed"
        ? { campaignId: result.campaignId }
        : {}),
      ...(result.outcome === "failed" ? { failureCode: result.failureCode } : {}),
    });

    return result;
  },
});

/**
 * Poster rendering gets its own lane.
 *
 * It does not belong on `campaign-generation`, whose concurrency of 1 exists to
 * hold back expensive image generation. A render calls no model, spends
 * nothing, and takes a few hundred milliseconds of CPU; queueing one behind an
 * image generation would make the fast, free, deterministic half of the studio
 * wait on the slow, costly half for no reason.
 */
export const campaignRenderQueue = queue({
  name: "campaign-render",
  concurrencyLimit: 4,
});

export const renderCampaignPosterTask = schemaTask({
  id: "campaign.render-poster",
  schema: campaignPosterRenderPayloadSchema,
  queue: campaignRenderQueue,
  retry,
  maxDuration: RENDER_POSTER_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    // Parsed by the schema above before a service-role client is constructed.
    const supabase = createCampaignWorkerServiceClient();

    const result = await renderCampaignPoster(payload, {
      context: createPosterRenderContextLoader(
        supabase as never,
        createVariantContextLoader(supabase as never),
      ),
      plates: createSupabaseCampaignObjectReader(supabase),
      composite: compositePoster,
      storage: createSupabaseCampaignAssetStorage(supabase),
      renders: createPosterRenderStore(supabase as never),
      isCancelled: () => signal.aborted,
    });

    logger.info("campaign.poster_render_finished", {
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
      correlationId: payload.correlationId,
      script: payload.script,
      templateKey: payload.templateKey,
      status: result.status,
      // The digest is safe to log: it identifies a render without carrying the
      // words on it.
      ...(result.status === "rendered" || result.status === "refused"
        ? { renderDigest: result.renderDigest, replayed: result.replayed }
        : { reason: result.reason }),
      ...(result.status === "refused" ? { refusalCode: result.refusalCode } : {}),
    });

    return result;
  },
});

/**
 * Editing a plate calls an image model, so it runs on its own queue rather than
 * sharing the render queue. A batch of edits must not make a render -- which is
 * CPU only and takes under a second -- wait behind a provider.
 */
export const campaignPlateEditQueue = queue({
  name: "campaign-plate-edit",
  concurrencyLimit: 2,
});

export const editCampaignPlateTask = schemaTask({
  id: "campaign.edit-plate",
  schema: campaignPlateEditPayloadSchema,
  queue: campaignPlateEditQueue,
  retry,
  maxDuration: EDIT_PLATE_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    // Parsed by the schema above before a service-role client is constructed.
    const supabase = createCampaignWorkerServiceClient();

    const result = await editCampaignPlate(
      payload,
      {
        context: createPlateEditContextLoader(
          supabase as never,
          createVariantContextLoader(supabase as never),
        ),
        plates: createSupabaseCampaignObjectReader(supabase),
        // The same decoder the compositor uses, so admission and composite
        // measure the same picture.
        measure: measureImage,
        planner: createGeminiPlateEditPlanner(),
        composite: compositeMaskedEdit,
        plateStorage: createSupabaseCampaignAssetStorage(supabase),
        // Provenance, not creative. Its own bucket, its own policies.
        maskStorage: createSupabaseCampaignAssetStorage(supabase, "campaign-masks"),
        versions: createEditedVersionWriter(
          supabase as never,
          createCampaignVersionWriter(supabase as unknown as CampaignPersistence),
        ),
        edits: createPlateEditStore(supabase as never),
        isCancelled: () => signal.aborted,
      },
      buildPlateEditPrompt,
      signal,
    );

    logger.info("campaign.plate_edit_finished", {
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
      correlationId: payload.correlationId,
      status: result.status,
      ...(result.status === "edited"
        ? { replayed: result.replayed, invalidatedApproval: result.invalidatedApproval }
        : {}),
      ...(result.status === "refused" ? { refusalCode: result.refusalCode } : {}),
      ...(result.status === "skipped" ? { reason: result.reason } : {}),
    });

    return result;
  },
});

/**
 * The execution loop.
 *
 * Five workers were written and tested months before anything registered them,
 * so a campaign could be created, generated, approved, scheduled and drawn --
 * and then nothing published it, measured it, or said what happened. These are
 * the registrations that make the second half of a campaign real.
 *
 * They sit on their own queue, away from generation and rendering. Sweeps are
 * long and frequent; a poster render is short and someone is watching it.
 */
export const campaignExecutionQueue = queue({
  name: "campaign-execution",
  concurrencyLimit: 2,
});

/**
 * Sends approved actions to their provider.
 *
 * **Not scheduled.** Every other worker here reads or writes the platform's own
 * tables; this one publishes to a client's public account. Putting that on a
 * timer is a decision about someone's brand, so the cadence is left to be set
 * deliberately rather than assumed by whoever wired it up.
 *
 * With no provider connected, the gateway has no adapter for the tool an action
 * names and says so per action. The sweep records that and moves on rather than
 * abandoning the batch.
 */
export const dispatchDueCampaignActionsTask = schemaTask({
  id: "campaign.dispatch-due-actions",
  schema: campaignSweepPayloadSchema,
  queue: campaignExecutionQueue,
  retry,
  maxDuration: DISPATCH_DUE_ACTIONS_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    const supabase = createCampaignWorkerServiceClient();

    // The planner hands the adapter its payload by action-run id, because the
    // gateway's contract carries authority and not request bodies.
    const requests = new Map();

    const result = await dispatchDueActions(
      payload,
      {
        due: createDueActionReader(supabase as never),
        planner: createDispatchPlanner(supabase as never, requests),
        gateway: createToolGateway({
          store: createToolGatewayStore(supabase as never),
          // No provider is connected in this deployment, so no adapter is
          // installed. The gateway refuses by name rather than pretending.
          adapters: [],
        }),
        exposures: createExposureRecorder(supabase as never),
        isCancelled: () => signal.aborted,
      },
      signal,
    );

    logger.info("campaign.dispatch_sweep_finished", {
      considered: result.considered,
      published: result.published,
    });

    return result;
  },
});

/**
 * Brings provider results back at variant grain.
 *
 * Refuses per organization when the metrics capability is not granted, which is
 * every organization until a provider is connected. That is a blocked outcome
 * rather than a failure: nothing went wrong, the client simply has not granted
 * it.
 */
export const collectCampaignMetricsTask = schemaTask({
  id: "campaign.collect-metrics",
  schema: collectMetricsPayloadSchema,
  queue: campaignExecutionQueue,
  retry,
  maxDuration: COLLECT_METRICS_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    const supabase = createCampaignWorkerServiceClient();

    const result = await collectCampaignMetrics(
      payload,
      {
        subjects: createMetricSubjectReader(supabase as never),
        grants: createMetricsGrantReader(supabase as never),
        reader: createUnavailableInsightsReader(),
        ingest: createCampaignMetricIngest(supabase as never),
        isCancelled: () => signal.aborted,
      },
      signal,
    );

    logger.info("campaign.metric_sweep_finished", {
      considered: result.considered,
      collected: result.collected,
    });

    return result;
  },
});

/**
 * The fast loop: which variants should stop spending.
 *
 * Refuses outright when no allocation policy is configured. These thresholds
 * pause a client's advertising, and running on numbers this codebase invented
 * would be exactly the autonomous budget change `AGENTS.md` prohibits.
 */
export const runCampaignAllocationCycleTask = schemaTask({
  id: "campaign.allocation-cycle",
  schema: campaignCyclePayloadSchema,
  queue: campaignExecutionQueue,
  retry,
  maxDuration: ALLOCATION_CYCLE_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    // Read before the client is built, so an unconfigured deployment refuses
    // without opening a privileged connection first.
    const thresholds = allocationThresholds();
    const supabase = createCampaignWorkerServiceClient();

    const allocation = createAllocationRepository(supabase as never);
    const cycle = createCampaignCycleReader(supabase as never);
    const events = createCampaignCycleEvents();

    const result = await runAllocationCycle(
      payload,
      {
        listActiveCampaigns: cycle.listActiveCampaigns,
        evaluateCampaign: (input) =>
          evaluateCampaign(input, {
            readVariants: ({ organizationId, campaignId }) =>
              allocation.listCandidates(organizationId, campaignId),
            resolveMargin: ({ organizationId, channel }) =>
              allocation.resolveMargin(organizationId, channel),
            appendLedger: (row) => allocation.appendLedgerRow(row),
            thresholds,
          }),
        // The repository reports whether the variant moved; the workflow's port
        // does not take an answer, and the ledger row it already appended is
        // the record of the decision either way.
        pause: async ({ organizationId, variantId, decision }) => {
          await allocation.pauseVariant(organizationId, variantId, decision.reasonCode);
        },
        emitCycleCompleted: events.emitCycleCompleted,
        isCancelled: () => signal.aborted,
      },
      signal,
    );

    logger.info("campaign.allocation_cycle_finished", {
      organizationId: payload.organizationId,
      campaignCount: result.campaignCount,
      decisionCount: result.decisionCount,
    });

    return result;
  },
});

/** The slow loop: what a finished campaign actually did. */
export const settleCampaignOutcomeTask = schemaTask({
  id: "campaign.settle-outcome",
  schema: campaignCyclePayloadSchema,
  queue: campaignExecutionQueue,
  retry,
  maxDuration: SETTLE_OUTCOME_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    const supabase = createCampaignWorkerServiceClient();

    const measurement = createMeasurementRepository(supabase as never);
    const cycle = createCampaignCycleReader(supabase as never);
    const events = createCampaignCycleEvents();

    const result = await runSettleOutcome(
      payload,
      {
        listDueCampaigns: cycle.listDueCampaigns,
        settle: (input) =>
          settleCampaign(input, {
            readContext: (context) =>
              measurement.readContext(context.organizationId, context.campaignId),
            writeOutcome: (outcome) => measurement.writeOutcome(outcome),
          }),
        emitOutcomeSettled: events.emitOutcomeSettled,
        isCancelled: () => signal.aborted,
      },
      signal,
    );

    logger.info("campaign.settlement_finished", {
      organizationId: payload.organizationId,
      considered: result.considered,
      settled: result.settled,
    });

    return result;
  },
});

/** The last arrow: one proposed lesson per settled campaign. */
export const proposeCampaignLearningTask = schemaTask({
  id: "campaign.propose-learning",
  schema: campaignCyclePayloadSchema,
  queue: campaignExecutionQueue,
  retry,
  maxDuration: PROPOSE_LEARNING_MAX_DURATION_SECONDS,
  run: async (payload, { signal }) => {
    const supabase = createCampaignWorkerServiceClient();

    const learning = createLearningRepository(supabase as never);
    const draftLesson = createGeminiLearningDrafter();
    const cycle = createCampaignCycleReader(supabase as never);
    const events = createCampaignCycleEvents();

    const result = await runProposeLearning(
      payload,
      {
        listSettledCampaigns: cycle.listSettledCampaigns,
        propose: (input) =>
          proposeLearning(input, {
            readContext: (context) =>
              learning.readContext(context.organizationId, context.campaignId),
            // The one part of a proposal that is not computed. The verdict is
            // handed to it as a fact, and `validateLearningLesson` rejects any
            // wording that overclaims against it.
            draftLesson,
            writeProposal: (proposal) => learning.writeProposal(proposal),
          }),
        emitLearningProposed: events.emitLearningProposed,
        isCancelled: () => signal.aborted,
      },
      signal,
    );

    logger.info("campaign.learning_sweep_finished", {
      organizationId: payload.organizationId,
      considered: result.considered,
      proposed: result.proposed,
    });

    return result;
  },
});
