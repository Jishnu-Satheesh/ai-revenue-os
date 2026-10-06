import {
  allowedPathsForScope,
  applyCampaignPatch,
  type PatchScopeKind,
} from "@/modules/campaigns/application/patch-service";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type {
  BundleVersionPublisher,
  GenerationRunStore,
} from "@/workflows/campaigns/generate-bundle";
import { REVISE_BUNDLE_LEASE_SECONDS } from "@/workflows/campaigns/durations";

/**
 * One revision run.
 *
 * A revision is not a fresh proposal. It is a change to a version an operator
 * was looking at, which is why the version and its digest both travel in the
 * payload: if the campaign moved on while the operator was typing, applying
 * their words to whatever is latest now would silently edit something they
 * never read.
 *
 * No image is generated here. A prompt revision changes words, tags, schedule,
 * or profile — the paths the patch allowlist permits — and any change that
 * would need new artwork is a new generation, not an edit.
 */

export type RevisionSourceReader = {
  read(input: { organizationId: string; bundleVersionId: string; claimToken: string }): Promise<{
    campaignId: string;
    sourceSnapshotId: string;
    digest: string;
    manifest: CampaignBundleManifest;
    /** The newest version of this campaign, which may not be the base. */
    latestVersionId: string;
    assetStoragePaths: Record<string, string>;
    /**
     * The pinned shared-memory manifest for this run, if any. Pinned to the
     * claimed run so revalidation is a new bounded attempt, never a silent
     * swap. Text-only: it may shape copy, never assertions, spend, or pixels.
     */
    memoryContext?: { manifestId: string; digest: string } | null;
  } | null>;
};

export type RevisionPlanner = {
  proposePatch(input: {
    organizationId: string;
    campaignId: string;
    correlationId: string;
    operatorPrompt: string;
    allowedPaths: readonly string[];
    currentSummary: string;
    signal: AbortSignal;
  }): Promise<{ proposal: unknown; costMinor: number | null }>;
};

export type RevisionPromptReader = {
  /**
   * The operator's instruction, read from the database rather than the payload.
   * It is business content and must not travel through the queue.
   */
  read(input: {
    organizationId: string;
    runId: string;
    claimToken: string;
  }): Promise<{ prompt: string; scope: PatchScopeKind } | null>;
};

export type ReviseBundleDependencies = {
  runs: GenerationRunStore;
  source: RevisionSourceReader;
  prompts: RevisionPromptReader;
  planner: RevisionPlanner;
  publisher: BundleVersionPublisher;
  isCancelled: () => boolean;
  leaseSeconds?: number;
  /**
   * Revalidates the pinned shared-memory manifest before patching. A changed
   * pack is a new bounded attempt, never a silent swap: the run fails with
   * `memory_context_changed` so the caller enqueues a fresh attempt against
   * the new manifest. A material revision always publishes a new immutable
   * version under the existing lifecycle; revalidation never edits in place.
   */
  revalidateMemoryContext?: (input: {
    manifestId: string | null;
    digest: string | null;
  }) => Promise<"valid" | "changed" | "revoked" | "absent">;
};

export type ReviseBundleResult =
  | { status: "published"; bundleVersionId: string; version: number; costMinor: number | null }
  | { status: "skipped"; reason: "already_claimed" }
  | { status: "replayed"; resultVersionId: string | null; previousStatus: string }
  | { status: "stale"; latestVersionId: string }
  | { status: "rejected"; reason: string; message: string }
  | { status: "failed"; failureCode: string }
  | { status: "cancelled" };

const DEFAULT_LEASE_SECONDS = REVISE_BUNDLE_LEASE_SECONDS;

export async function reviseCampaignBundle(
  payload: {
    organizationId: string;
    campaignId: string;
    runId: string;
    correlationId: string;
    costCeilingMinor: number;
    baseVersionId: string;
    baseDigest: string;
  },
  dependencies: ReviseBundleDependencies,
  signal: AbortSignal,
): Promise<ReviseBundleResult> {
  const claim = await dependencies.runs.claim({
    organizationId: payload.organizationId,
    runId: payload.runId,
    leaseSeconds: dependencies.leaseSeconds ?? DEFAULT_LEASE_SECONDS,
  });

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

  const failWith = async (failureCode: string): Promise<ReviseBundleResult> => {
    await dependencies.runs.fail({
      organizationId: payload.organizationId,
      runId: payload.runId,
      claimToken,
      failureCode,
      costMinor: spentMinor > 0 ? spentMinor : null,
    });
    return { status: "failed", failureCode };
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

    const base = await dependencies.source.read({
      organizationId: payload.organizationId,
      bundleVersionId: payload.baseVersionId,
      claimToken,
    });
    if (!base) return failWith("base_version_missing");

    // Both checks matter. The digest catches a version edited underneath the
    // operator; the latest-version check catches a newer version published
    // while they were typing.
    if (base.digest !== payload.baseDigest || base.latestVersionId !== payload.baseVersionId) {
      await dependencies.runs.fail({
        organizationId: payload.organizationId,
        runId: payload.runId,
        claimToken,
        failureCode: "base_version_superseded",
        costMinor: null,
      });
      return { status: "stale", latestVersionId: base.latestVersionId };
    }

    const instruction = await dependencies.prompts.read({
      organizationId: payload.organizationId,
      runId: payload.runId,
      claimToken,
    });
    if (!instruction) return failWith("revision_prompt_missing");

    if (dependencies.revalidateMemoryContext) {
      const revalidation = await dependencies.revalidateMemoryContext({
        manifestId: base.memoryContext?.manifestId ?? null,
        digest: base.memoryContext?.digest ?? null,
      });
      if (revalidation === "changed") return failWith("memory_context_changed");
      if (revalidation === "revoked") return failWith("memory_context_revoked");
    }

    const allowedPaths = allowedPathsForScope(instruction.scope);

    const proposed = await dependencies.planner.proposePatch({
      organizationId: payload.organizationId,
      campaignId: base.campaignId,
      correlationId: payload.correlationId,
      operatorPrompt: instruction.prompt,
      allowedPaths,
      currentSummary: summarize(base.manifest),
      signal,
    });
    spentMinor += proposed.costMinor ?? 0;

    if (spentMinor > payload.costCeilingMinor) return failWith("cost_ceiling_exceeded");

    // The allowlist decides, not the model. A proposal touching anything else
    // is refused here, before it can reach a manifest.
    const applied = applyCampaignPatch({
      base: base.manifest,
      proposal: proposed.proposal,
      scope: instruction.scope,
    });

    if (applied.outcome === "rejected") {
      await dependencies.runs.fail({
        organizationId: payload.organizationId,
        runId: payload.runId,
        claimToken,
        failureCode: `patch_rejected:${applied.reason}`,
        costMinor: spentMinor > 0 ? spentMinor : null,
      });
      return { status: "rejected", reason: applied.reason, message: applied.message };
    }

    if (dependencies.isCancelled() || signal.aborted) {
      await dependencies.runs.fail({
        organizationId: payload.organizationId,
        runId: payload.runId,
        claimToken,
        failureCode: "cancelled_before_publish",
        costMinor: spentMinor > 0 ? spentMinor : null,
      });
      return { status: "cancelled" };
    }

    // The revision reuses the base version's stored assets: a words-only change
    // must not re-upload identical bytes under new paths.
    const published = await dependencies.publisher.publish({
      organizationId: payload.organizationId,
      campaignId: base.campaignId,
      sourceSnapshotId: base.sourceSnapshotId,
      manifest: applied.manifest,
      digest: applied.digest,
      assetStoragePaths: base.assetStoragePaths,
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
    try {
      await dependencies.runs.fail({
        organizationId: payload.organizationId,
        runId: payload.runId,
        claimToken,
        failureCode: "worker_error",
        costMinor: spentMinor > 0 ? spentMinor : null,
      });
    } catch {
      // A failure to record the failure must not replace the original error.
    }
    throw error;
  }
}

/**
 * A compact view of the current version for the model to patch against.
 *
 * Deliberately not the whole manifest: asset bytes, storage paths, and internal
 * identifiers are not needed to reword a caption, and sending them would put
 * more in the prompt than the job requires.
 */
function summarize(manifest: CampaignBundleManifest): string {
  return JSON.stringify(
    {
      objective: manifest.objective,
      generationProfile: manifest.generationProfile,
      directions: manifest.directions.map((direction) => ({
        id: direction.id,
        kind: direction.kind,
        name: direction.name,
        copy: direction.copy,
        hashtagSets: direction.hashtagSets,
      })),
      actions: manifest.actions.map((action) => ({
        id: action.id,
        channel: action.channel,
        placement: action.placement,
        scheduledFor: action.scheduledFor,
      })),
    },
    null,
    2,
  );
}
