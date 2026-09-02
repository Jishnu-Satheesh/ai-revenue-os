import { bundleDigest } from "@/domain/campaigns/digest";
import { logger } from "@/lib/logger";
import type { CampaignImageReference } from "@/ai/campaign-generation-provider";
import type { ArtDirectionBlueprint } from "@/domain/campaigns/art-direction";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type {
  ReferenceCandidate,
  ReferenceResolution,
  ReferenceResolutionInput,
  ReferenceResolutionRequest,
  ResolvedReferenceSlot,
} from "@/domain/campaigns/reference-resolution";
import { resolveReferences } from "@/domain/campaigns/reference-resolution";
import { deriveGeneratedTruthClass } from "@/domain/campaigns/truth-class";
import type { ChannelContentLimits } from "@/domain/campaigns/content-policy";
import type { CampaignChannel } from "@/domain/campaigns/schemas";
import {
  decideRepair,
  evaluateGeneratedBundle,
  safeFailureSummary,
  type EvaluationFailure,
} from "@/modules/campaigns/application/evaluation";
import {
  buildGenerationContext,
  renderGenerationPrompt,
  type GenerationContext,
} from "@/modules/campaigns/application/generation-context";
import type { CreateBundleVersionResult } from "@/modules/campaigns/application/ports";
import { GENERATE_BUNDLE_LEASE_SECONDS } from "@/workflows/campaigns/durations";

/**
 * One generation run, from claim to published version.
 *
 * The shape that matters: nothing is published until everything has succeeded.
 * A run that generated two of three images and then failed leaves no version
 * behind — a half-built proposal an operator could open and approve is worse
 * than no proposal, because it looks finished.
 *
 * Cancellation is checked before every model call rather than once at the top.
 * A cancelled campaign that keeps generating is still spending money, and the
 * gap between "operator pressed cancel" and "worker noticed" is exactly the
 * window where that happens.
 */

export type GenerationRunClaim =
  | {
      outcome: "claimed";
      claimToken: string;
      attempt: number;
      campaignId: string;
      sourceSnapshotId: string;
      kind: "generate" | "revise" | "variants";
      correlationId: string;
      /** Set only for a variants run. */
      variantsPerDirection?: number | null;
    }
  | { outcome: "already_claimed" }
  | {
      outcome: "already_finished";
      status: "succeeded" | "failed" | "cancelled";
      resultVersionId: string | null;
      failureCode: string | null;
    };

export type GenerationRunStore = {
  claim(input: {
    organizationId: string;
    runId: string;
    leaseSeconds: number;
  }): Promise<GenerationRunClaim>;
  complete(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
    /** Null only for a variants run, which produces creative, not a version. */
    resultVersionId: string | null;
    costMinor: number | null;
  }): Promise<void>;
  fail(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
    failureCode: string;
    costMinor: number | null;
  }): Promise<void>;
};

export type GenerationSnapshotReader = {
  read(input: {
    organizationId: string;
    campaignId: string;
    sourceSnapshotId: string;
    /**
     * Proves this worker still holds the run. Reading without it would let any
     * service-role caller pull another run's pinned evidence.
     */
    claimToken: string;
  }): Promise<{
    snapshot: Record<string, unknown>;
    generationProfile: "brand_restricted" | "brand_guided" | "full_visual_freedom";
    brandAssetVersionIds: readonly string[];
    /** Intent captured when the campaign was created; never recomputed from live copy. */
    resolutionRequest: ReferenceResolutionRequest;
    /** Explicit brief-picker choices, used only as declared resolver preferences. */
    declaredReferenceSlots: readonly ResolvedReferenceSlot[];
    subjectDescription: string | null;
    creativeDirection: string | null;
    syntheticAssetsAllowed: boolean;
  } | null>;
};

export type ReferenceCandidateFile = ReferenceCandidate & {
  storagePath: string;
  mimeType: CampaignImageReference["mimeType"];
};

export type ReferenceCandidateReader = {
  read(organizationId: string): Promise<{
    candidates: readonly ReferenceCandidateFile[];
    reasonRegistry: ReferenceResolutionInput["reasonRegistry"];
  }>;
};

export type ReferenceObjectReader = {
  read(storagePath: string): Promise<Uint8Array | null>;
};

export type GenerationReferenceContextWriter = {
  pinResolution(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
    resolution: ReferenceResolution;
  }): Promise<void>;
  pinBlueprint(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
    blueprint: Record<string, unknown>;
    planModelId: string;
  }): Promise<void>;
};

export type GeneratedAssetUpload = {
  assetId: string;
  storagePath: string;
  contentHash: string;
  /** The provider model that returned the stored bytes, never the planner's claim. */
  modelId: string;
  /** The deterministic prompt contract used to request those bytes. */
  promptVersionId: string;
};

export type CampaignImageGuidance = {
  /** Exact confirmed description pinned for this run, where synthesis is used. */
  subjectDescription: string | null;
  resolution: ReferenceResolution;
  /** Bytes corresponding to the pinned positive and avoid references. */
  references: readonly CampaignImageReference[];
  /** One validated stage-one plan for every image in the manifest. */
  blueprintsByAssetId: Readonly<Record<string, ArtDirectionBlueprint>>;
  /** Organization rules appended after the blueprint. */
  hardConstraints: readonly string[];
};

export type CampaignBlueprintPlanner = {
  plan(input: {
    context: { organizationId: string; campaignId: string; correlationId: string };
    operatorCreativeDirection: string;
    brandContext: string;
    subjectDescription: string | null;
    resolution: ReferenceResolution;
    references: readonly CampaignImageReference[];
  }): Promise<{
    blueprint: ArtDirectionBlueprint;
    planModelId: string;
    repairModelId: string | null;
    costMinor: number | null;
  }>;
};

export type CampaignPlanner = {
  /** Returns a candidate manifest and the assets it actually produced. */
  plan(input: {
    context: GenerationContext;
    prompt: string;
    signal: AbortSignal;
    repairFailures?: readonly EvaluationFailure[];
  }): Promise<{ candidate: unknown; costMinor: number | null }>;
  /** Produces and stores every image the accepted manifest names. */
  materializeAssets(input: {
    context: GenerationContext;
    manifest: CampaignBundleManifest;
    signal: AbortSignal;
    imageGuidance: CampaignImageGuidance;
  }): Promise<{ uploads: readonly GeneratedAssetUpload[]; costMinor: number | null }>;
};

export type BundleVersionPublisher = {
  publish(input: {
    organizationId: string;
    campaignId: string;
    sourceSnapshotId: string;
    manifest: CampaignBundleManifest;
    digest: string;
    assetStoragePaths: Record<string, string>;
  }): Promise<CreateBundleVersionResult>;
};

export type GenerateBundleDependencies = {
  runs: GenerationRunStore;
  snapshots: GenerationSnapshotReader;
  candidates: ReferenceCandidateReader;
  referenceObjects: ReferenceObjectReader;
  referenceContext: GenerationReferenceContextWriter;
  blueprintPlanner: CampaignBlueprintPlanner;
  planner: CampaignPlanner;
  publisher: BundleVersionPublisher;
  limitsByChannel: Partial<Record<CampaignChannel, ChannelContentLimits>>;
  /** True once the operator cancelled or the platform fenced this run. */
  isCancelled: () => boolean;
  leaseSeconds?: number;
  /** Injected so a test can generate against a fixed date. */
  clock?: () => Date;
  scheduleLeadMinutes?: number;
};

export type GenerateBundleResult =
  | { status: "published"; bundleVersionId: string; version: number; costMinor: number | null }
  | { status: "skipped"; reason: "already_claimed" }
  | { status: "replayed"; resultVersionId: string | null; previousStatus: string }
  | { status: "needs_data"; missing: readonly string[] }
  | { status: "failed"; failureCode: string; summary: string }
  | { status: "cancelled" };

const DEFAULT_LEASE_SECONDS = GENERATE_BUNDLE_LEASE_SECONDS;

export async function generateCampaignBundle(
  payload: {
    organizationId: string;
    campaignId: string;
    runId: string;
    correlationId: string;
    costCeilingMinor: number;
  },
  dependencies: GenerateBundleDependencies,
  signal: AbortSignal,
): Promise<GenerateBundleResult> {
  const claim = await dependencies.runs.claim({
    organizationId: payload.organizationId,
    runId: payload.runId,
    leaseSeconds: dependencies.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
  });

  // Another worker is on it, or it is already done. Either way this attempt
  // does nothing: duplicating the work would double the spend and could publish
  // two versions of one proposal.
  if (claim.outcome === "already_claimed") return { status: "skipped", reason: "already_claimed" };
  if (claim.outcome === "already_finished") {
    return {
      status: "replayed",
      resultVersionId: claim.resultVersionId,
      previousStatus: claim.status,
    };
  }

  const { claimToken } = claim;
  let spentMinor = 0;

  const failWith = async (failureCode: string, summary: string): Promise<GenerateBundleResult> => {
    await dependencies.runs.fail({
      organizationId: payload.organizationId,
      runId: payload.runId,
      claimToken,
      failureCode,
      costMinor: spentMinor > 0 ? spentMinor : null,
    });
    return { status: "failed", failureCode, summary };
  };

  try {
    if (dependencies.isCancelled() || signal.aborted) {
      await dependencies.runs.fail({
        organizationId: payload.organizationId,
        runId: payload.runId,
        claimToken,
        failureCode: "cancelled_before_start",
        costMinor: null,
      });
      return { status: "cancelled" };
    }

    const pinned = await dependencies.snapshots.read({
      organizationId: payload.organizationId,
      campaignId: claim.campaignId,
      sourceSnapshotId: claim.sourceSnapshotId,
      claimToken,
    });
    if (!pinned) {
      return failWith(
        "source_snapshot_missing",
        "The evidence this campaign was built on is gone.",
      );
    }

    const readiness = buildGenerationContext({
      organizationId: payload.organizationId,
      campaignId: claim.campaignId,
      sourceSnapshotId: claim.sourceSnapshotId,
      generationProfile: pinned.generationProfile,
      snapshot: pinned.snapshot,
      brandAssetVersionIds: pinned.brandAssetVersionIds,
      syntheticAssetsAllowed: pinned.syntheticAssetsAllowed,
      now: (dependencies.clock ?? (() => new Date()))(),
      scheduleLeadMinutes: dependencies.scheduleLeadMinutes,
    });

    // A readiness gap is an ordinary outcome, not a failure of the run. It is
    // recorded so the operator sees exactly what to supply.
    if (readiness.outcome === "needs_data") {
      await dependencies.runs.fail({
        organizationId: payload.organizationId,
        runId: payload.runId,
        claimToken,
        failureCode: `needs_data:${readiness.missing.join(",")}`,
        costMinor: null,
      });
      return { status: "needs_data", missing: readiness.missing };
    }

    const context = readiness.context;
    const prompt = renderGenerationPrompt(context);
    const candidateSet = await dependencies.candidates.read(payload.organizationId);
    const declaredModes = new Map(
      pinned.declaredReferenceSlots.map((slot) => [slot.brandAssetVersionId, slot.referenceMode]),
    );
    const resolution = resolveReferences({
      candidates: candidateSet.candidates.map((candidate) => {
        const { storagePath: _storagePath, mimeType: _mimeType, ...domainCandidate } = candidate;
        return {
          ...domainCandidate,
          requestedReferenceMode:
            declaredModes.get(candidate.brandAssetVersionId) ?? candidate.requestedReferenceMode,
        };
      }),
      reasonRegistry: candidateSet.reasonRegistry,
      request: pinned.resolutionRequest,
    });

    if (resolution.outcome === "insufficient") {
      await dependencies.runs.fail({
        organizationId: payload.organizationId,
        runId: payload.runId,
        claimToken,
        failureCode: "no_declared_subject",
        costMinor: null,
      });
      return { status: "needs_data", missing: ["no_declared_subject"] };
    }

    await dependencies.referenceContext.pinResolution({
      organizationId: payload.organizationId,
      runId: payload.runId,
      claimToken,
      resolution,
    });

    const references = await loadReferenceBytes(
      resolution,
      candidateSet.candidates,
      dependencies.referenceObjects,
    );
    if (!references) {
      return failWith("reference_bytes_unavailable", "A pinned image reference could not be read.");
    }

    const truthClass = deriveGeneratedTruthClass(resolution.outcome);
    const derivedFromBrandAssetVersionIds = resolution.referenceSlots.map(
      (slot) => slot.brandAssetVersionId,
    );

    let attempt = 0;
    let failures: readonly EvaluationFailure[] = [];
    let manifest: CampaignBundleManifest | null = null;

    // At most one repair. Bounded here rather than inside the planner so the
    // ceiling is visible to whoever reads the workflow.
    while (manifest === null) {
      if (dependencies.isCancelled() || signal.aborted) {
        await dependencies.runs.fail({
          organizationId: payload.organizationId,
          runId: payload.runId,
          claimToken,
          failureCode: "cancelled_during_generation",
          costMinor: spentMinor > 0 ? spentMinor : null,
        });
        return { status: "cancelled" };
      }

      const planned = await dependencies.planner.plan({
        context,
        prompt,
        signal,
        ...(attempt > 0 ? { repairFailures: failures } : {}),
      });
      spentMinor += planned.costMinor ?? 0;

      if (spentMinor > payload.costCeilingMinor) {
        return failWith("cost_ceiling_exceeded", "Generation stopped at its cost ceiling.");
      }

      const evaluated = evaluateGeneratedBundle({
        candidate: planned.candidate,
        context,
        truthClass,
        derivedFromBrandAssetVersionIds,
        limitsByChannel: dependencies.limitsByChannel,
        // Nothing has been produced yet, so the manifest's assets are checked
        // against what it declares; the real containment check happens after
        // materialization, below.
        producedAssetIds: declaredAssetIds(planned.candidate),
      });

      const decision = decideRepair(evaluated, attempt);
      if (decision.action === "accept") {
        manifest = decision.manifest;
        break;
      }
      if (decision.action === "fail") {
        // The operator-facing summary is deliberately vague, because the
        // detail comes from model output. The codes and paths do not: they are
        // this system's own vocabulary, and without them in the log a rejected
        // generation is unexplainable after the fact.
        logger.warn("campaign.generation_rejected", {
          organizationId: payload.organizationId,
          campaignId: claim.campaignId,
          runId: payload.runId,
          correlationId: payload.correlationId,
          errorCode: decision.failures.map((failure) => failure.code).join(","),
          failurePaths: decision.failures
            .map((failure) => (failure.path ?? []).join("."))
            .filter((path) => path.length > 0)
            .join(" | "),
        });
        return failWith("validation_failed", safeFailureSummary(decision.failures));
      }
      failures = decision.failures;
      attempt = decision.attempt;
    }

    const blueprintsByAssetId: Record<string, ArtDirectionBlueprint> = {};
    const planModelIds = new Set<string>();
    for (const asset of manifest.assets) {
      if (dependencies.isCancelled() || signal.aborted) {
        await dependencies.runs.fail({
          organizationId: payload.organizationId,
          runId: payload.runId,
          claimToken,
          failureCode: "cancelled_before_assets",
          costMinor: spentMinor > 0 ? spentMinor : null,
        });
        return { status: "cancelled" };
      }

      const direction = manifest.directions.find((entry) => entry.assetIds.includes(asset.id));
      const plannedBlueprint = await dependencies.blueprintPlanner.plan({
        context: {
          organizationId: payload.organizationId,
          campaignId: claim.campaignId,
          correlationId: payload.correlationId,
        },
        operatorCreativeDirection: [pinned.creativeDirection, direction?.rationale]
          .filter((value): value is string => Boolean(value))
          .join("\n"),
        brandContext: declaredBrandContext(pinned.snapshot, context),
        subjectDescription: pinned.subjectDescription,
        resolution,
        references,
      });
      spentMinor += plannedBlueprint.costMinor ?? 0;
      if (spentMinor > payload.costCeilingMinor) {
        return failWith("cost_ceiling_exceeded", "Generation stopped at its cost ceiling.");
      }
      blueprintsByAssetId[asset.id] = plannedBlueprint.blueprint;
      planModelIds.add(plannedBlueprint.planModelId);
    }

    if (planModelIds.size !== 1) {
      return failWith(
        "blueprint_model_mismatch",
        "The art-direction plans did not use one configured model.",
      );
    }
    await dependencies.referenceContext.pinBlueprint({
      organizationId: payload.organizationId,
      runId: payload.runId,
      claimToken,
      blueprint: { byAssetId: blueprintsByAssetId },
      planModelId: [...planModelIds][0]!,
    });

    if (dependencies.isCancelled() || signal.aborted) {
      await dependencies.runs.fail({
        organizationId: payload.organizationId,
        runId: payload.runId,
        claimToken,
        failureCode: "cancelled_before_assets",
        costMinor: spentMinor > 0 ? spentMinor : null,
      });
      return { status: "cancelled" };
    }

    const materialized = await dependencies.planner.materializeAssets({
      context,
      manifest,
      signal,
      imageGuidance: {
        subjectDescription: pinned.subjectDescription,
        resolution,
        references,
        blueprintsByAssetId,
        hardConstraints: context.hardConstraints,
      },
    });
    spentMinor += materialized.costMinor ?? 0;
    if (spentMinor > payload.costCeilingMinor) {
      return failWith("cost_ceiling_exceeded", "Generation stopped at its cost ceiling.");
    }

    // Every asset the manifest names must exist. A version published with a
    // missing image would render as a broken proposal an operator might still
    // approve.
    const uploaded = new Map(materialized.uploads.map((upload) => [upload.assetId, upload]));
    const missingAsset = manifest.assets.find((asset) => !uploaded.has(asset.id));
    if (missingAsset) {
      return failWith("asset_generation_incomplete", "Not every image could be produced.");
    }

    // The stored bytes decide the content hash. A manifest whose hash disagrees
    // with what is in storage would produce a digest that describes nothing.
    const reconciled: CampaignBundleManifest = {
      ...manifest,
      assets: manifest.assets.map((asset) => ({
        ...asset,
        contentHash: uploaded.get(asset.id)!.contentHash,
        provenance:
          asset.provenance.kind === "generated"
            ? {
                ...asset.provenance,
                modelId: uploaded.get(asset.id)!.modelId,
                promptVersionId: uploaded.get(asset.id)!.promptVersionId,
              }
            : asset.provenance,
      })),
    };

    const published = await dependencies.publisher.publish({
      organizationId: payload.organizationId,
      campaignId: claim.campaignId,
      sourceSnapshotId: claim.sourceSnapshotId,
      manifest: reconciled,
      digest: bundleDigest(reconciled),
      assetStoragePaths: Object.fromEntries(
        materialized.uploads.map((upload) => [upload.assetId, upload.storagePath]),
      ),
    });

    await dependencies.runs.complete({
      organizationId: payload.organizationId,
      runId: payload.runId,
      claimToken,
      resultVersionId: published.bundleVersionId,
      costMinor: spentMinor > 0 ? spentMinor : null,
    });

    return {
      status: "published",
      bundleVersionId: published.bundleVersionId,
      version: published.version,
      costMinor: spentMinor > 0 ? spentMinor : null,
    };
  } catch (error) {
    // The run is marked failed with a stable code before the error propagates,
    // so a crashed attempt never leaves a run stuck in `claimed` until its
    // lease expires.
    try {
      await dependencies.runs.fail({
        organizationId: payload.organizationId,
        runId: payload.runId,
        claimToken,
        failureCode: "worker_error",
        costMinor: spentMinor > 0 ? spentMinor : null,
      });
    } catch {
      // A failure to record the failure must not replace the original error,
      // which is the one that explains what actually went wrong.
    }
    throw error;
  }
}

/** Asset ids the candidate declares, read defensively from unvalidated output. */
function declaredAssetIds(candidate: unknown): readonly string[] {
  if (typeof candidate !== "object" || candidate === null) return [];
  const assets = (candidate as { assets?: unknown }).assets;
  if (!Array.isArray(assets)) return [];
  return assets.flatMap((asset) =>
    typeof asset === "object" &&
    asset !== null &&
    typeof (asset as { id?: unknown }).id === "string"
      ? [(asset as { id: string }).id]
      : [],
  );
}

export async function loadReferenceBytes(
  resolution: ReferenceResolution,
  candidates: readonly ReferenceCandidateFile[],
  objects: ReferenceObjectReader,
): Promise<readonly CampaignImageReference[] | null> {
  const byVersion = new Map(
    candidates.map((candidate) => [candidate.brandAssetVersionId, candidate]),
  );
  const requested = [
    ...resolution.referenceSlots.map((slot) => ({
      versionId: slot.brandAssetVersionId,
      role: slot.role,
      ordinal: slot.ordinal,
    })),
    ...resolution.avoidReferences.map((reference, ordinal) => ({
      versionId: reference.brandAssetVersionId,
      role: "avoid" as const,
      ordinal,
    })),
  ];
  const loaded: CampaignImageReference[] = [];
  for (const reference of requested) {
    const candidate = byVersion.get(reference.versionId);
    if (!candidate) return null;
    const bytes = await objects.read(candidate.storagePath);
    if (!bytes) return null;
    loaded.push({
      role: reference.role,
      ordinal: reference.ordinal,
      mimeType: candidate.mimeType,
      bytes,
    });
  }
  return loaded;
}

export function declaredBrandContext(
  snapshot: Record<string, unknown>,
  context: Pick<GenerationContext, "hardConstraints" | "softConventions">,
): string {
  const profile =
    typeof snapshot.organizationProfile === "string" ? snapshot.organizationProfile : "";
  const voice = typeof snapshot.brandVoice === "string" ? snapshot.brandVoice : "";
  return [profile, voice, ...context.hardConstraints, ...context.softConventions]
    .filter((value) => value.length > 0)
    .join("\n");
}
