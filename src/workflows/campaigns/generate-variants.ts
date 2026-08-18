import { logger } from "@/lib/logger";
import { admitVariant } from "@/modules/campaigns/application/variant-service";
import type { VariantRefusal } from "@/modules/campaigns/application/variant-service";
import { campaignCreativeVariantSchema } from "@/domain/campaigns/variants";
import type { CampaignCreativeVariant } from "@/domain/campaigns/variants";
import type { VariantEvidence } from "@/domain/campaigns/derivation";
import type { ChannelContentLimits } from "@/domain/campaigns/content-policy";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type { ApprovalRow } from "@/domain/campaigns/state-machine";
import type {
  CampaignVariantStore,
  VariantProvenance,
} from "@/modules/campaigns/infrastructure/variant-repository";
import type { GenerationRunStore } from "@/workflows/campaigns/generate-bundle";
import { GENERATE_VARIANTS_LEASE_SECONDS } from "@/workflows/campaigns/durations";

/**
 * Producing creative inside an approval that already exists.
 *
 * The shape of this workflow differs from bundle generation in one way that
 * matters: it is *partially* successful by design. Asked for four variants it
 * may store three, and that is a real outcome rather than a failure — the
 * fourth was refused for a reason worth reading, and the three that passed are
 * legitimate creative the campaign can use.
 *
 * So nothing is dropped. Every refusal is returned with its reason, because a
 * silent shortfall is how an operator ends up believing a test ran at a size it
 * never reached.
 */

export type VariantContextReader = {
  /** The approved version this run produces creative for, and its authority. */
  read(input: { organizationId: string; bundleVersionId: string }): Promise<{
    manifest: CampaignBundleManifest;
    digest: string;
    approval: ApprovalRow | null;
    evidence: VariantEvidence;
    limits: ChannelContentLimits;
  }>;
};

export type VariantPlanner = {
  /**
   * Draws one variant for a direction. Returns `unknown`: the application
   * boundary parses, so a provider that changes its shape fails here rather
   * than somewhere further in.
   */
  draw(input: {
    manifest: CampaignBundleManifest;
    directionId: string;
    attemptOrdinal: number;
    signal: AbortSignal;
  }): Promise<{ candidate: unknown; assetId: string; costMinor: number; modelId: string }>;
};

export type GenerateVariantsDependencies = {
  runs: GenerationRunStore;
  context: VariantContextReader;
  planner: VariantPlanner;
  variants: CampaignVariantStore;
  isCancelled: () => boolean;
  promptVersionId: string;
  now?: () => Date;
};

export type VariantOutcome =
  | { status: "stored"; variantId: string; directionId: string; contentHash: string }
  | { status: "refused"; directionId: string; reason: VariantRefusal["reason"]; detail: string };

export type GenerateVariantsResult =
  | { status: "skipped"; reason: "already_claimed" }
  | { status: "replayed"; previousStatus: string }
  | {
      status: "completed";
      requested: number;
      stored: number;
      outcomes: readonly VariantOutcome[];
      costMinor: number;
    }
  | { status: "cancelled"; stored: number }
  | { status: "cost_ceiling_reached"; stored: number; costMinor: number };

export async function generateCampaignVariants(
  payload: {
    organizationId: string;
    campaignId: string;
    bundleVersionId: string;
    /** The persisted run this work belongs to. Never a prompt or a secret. */
    runId: string;
    correlationId: string;
    costCeilingMinor: number;
  },
  dependencies: GenerateVariantsDependencies,
  signal: AbortSignal,
): Promise<GenerateVariantsResult> {
  const now = dependencies.now ?? (() => new Date());

  // Claimed before anything is read or drawn. The lease is what stops a
  // duplicate delivery producing a second fleet, and completing the run is what
  // stops it sitting claimed for ever after a crash — the failure mode that
  // made a stalled campaign look like a running one.
  const claim = await dependencies.runs.claim({
    organizationId: payload.organizationId,
    runId: payload.runId,
    leaseSeconds: GENERATE_VARIANTS_LEASE_SECONDS,
  });

  if (claim.outcome === "already_claimed") {
    return { status: "skipped", reason: "already_claimed" };
  }
  if (claim.outcome === "already_finished") {
    return { status: "replayed", previousStatus: claim.status };
  }

  // Read from the run rather than the payload, so a redelivery reproduces the
  // size the first attempt asked for.
  const perDirection = claim.variantsPerDirection ?? 1;

  try {
    return await produce({ payload, dependencies, claim, perDirection, now, signal });
  } catch (error) {
    await dependencies.runs.fail({
      organizationId: payload.organizationId,
      runId: payload.runId,
      claimToken: claim.claimToken,
      failureCode: "variant_generation_failed",
      costMinor: null,
    });
    throw error;
  }
}

async function produce({
  payload,
  dependencies,
  claim,
  perDirection,
  now,
  signal,
}: {
  payload: {
    organizationId: string;
    campaignId: string;
    bundleVersionId: string;
    runId: string;
    correlationId: string;
    costCeilingMinor: number;
  };
  dependencies: GenerateVariantsDependencies;
  claim: { claimToken: string };
  perDirection: number;
  now: () => Date;
  signal: AbortSignal;
}): Promise<GenerateVariantsResult> {
  const context = await dependencies.context.read({
    organizationId: payload.organizationId,
    bundleVersionId: payload.bundleVersionId,
  });

  const outcomes: VariantOutcome[] = [];
  let spentMinor = 0;
  let stored = 0;

  // Read once up front, then tracked in memory. The database counts again
  // under a lock when each variant lands, so this is a fast path rather than
  // the authority — a stale count here costs an extra refusal, never a slot.
  const capacity = await dependencies.variants.readCapacity(
    payload.organizationId,
    payload.bundleVersionId,
  );
  const contentHashes = [...capacity.contentHashes];
  const usedByDirection: Record<string, number> = { ...capacity.usedByDirection };
  let usedInTotal = capacity.usedInTotal;

  let requested = 0;

  for (const direction of context.manifest.directions) {
    for (let ordinal = 0; ordinal < perDirection; ordinal += 1) {
      if (dependencies.isCancelled() || signal.aborted) {
        // Failed rather than left claimed. An abandoned lease reads as a live
        // worker for as long as it lasts, which is the exact confusion the
        // stalled-run work removed from the portfolio.
        await dependencies.runs.fail({
          organizationId: payload.organizationId,
          runId: payload.runId,
          claimToken: claim.claimToken,
          failureCode: "cancelled",
          costMinor: spentMinor,
        });
        return { status: "cancelled", stored };
      }
      requested += 1;

      const drawn = await dependencies.planner.draw({
        manifest: context.manifest,
        directionId: direction.id,
        attemptOrdinal: ordinal + 1,
        signal,
      });
      spentMinor += drawn.costMinor;

      // Checked after the spend it caused, not before the next one. A ceiling
      // tested only at the top of the loop lets one expensive draw run past it.
      if (spentMinor > payload.costCeilingMinor) {
        logger.warn("campaign.variant_cost_ceiling_reached", {
          organizationId: payload.organizationId,
          campaignId: payload.campaignId,
          runId: payload.runId,
          correlationId: payload.correlationId,
          costMinor: spentMinor,
        });
        await dependencies.runs.fail({
          organizationId: payload.organizationId,
          runId: payload.runId,
          claimToken: claim.claimToken,
          failureCode: "cost_ceiling_reached",
          costMinor: spentMinor,
        });
        return { status: "cost_ceiling_reached", stored, costMinor: spentMinor };
      }

      const parsed = campaignCreativeVariantSchema.safeParse(drawn.candidate);
      if (!parsed.success) {
        outcomes.push({
          status: "refused",
          directionId: direction.id,
          reason: "not_derived",
          detail: "The generated variant was not a variant this system can read.",
        });
        continue;
      }

      const outcome = await storeOne({
        variant: parsed.data,
        // The planner's own report of what it drew, never the variant's claim
        // about it. Trusting the candidate here would make the cross-tenant
        // asset check compare a value against itself and always pass.
        producedAssetIds: [drawn.assetId],
        direction: direction.id,
        payload,
        dependencies,
        context,
        contentHashes,
        capacity: {
          usedInDirection: usedByDirection[direction.id] ?? 0,
          usedInTotal,
        },
        provenance: {
          modelId: drawn.modelId,
          promptVersionId: dependencies.promptVersionId,
          generationRunId: payload.runId,
        },
        now: now(),
      });

      outcomes.push(outcome);
      if (outcome.status === "stored") {
        stored += 1;
        usedInTotal += 1;
        usedByDirection[direction.id] = (usedByDirection[direction.id] ?? 0) + 1;
        contentHashes.push(outcome.contentHash);
      }
    }
  }

  logger.info("campaign.variants_generated", {
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    runId: payload.runId,
    correlationId: payload.correlationId,
    variantsRequested: requested,
    variantsStored: stored,
    variantsRefused: outcomes.length - stored,
    costMinor: spentMinor,
  });

  // A variants run names no result version: it produced creative inside one
  // that already existed. The relaxed constraint in 20260818110000 is what lets
  // this succeed honestly rather than pointing at its own input.
  await dependencies.runs.complete({
    organizationId: payload.organizationId,
    runId: payload.runId,
    claimToken: claim.claimToken,
    resultVersionId: null,
    costMinor: spentMinor,
  });

  return { status: "completed", requested, stored, outcomes, costMinor: spentMinor };
}

async function storeOne(input: {
  variant: CampaignCreativeVariant;
  producedAssetIds: readonly string[];
  direction: string;
  payload: { organizationId: string; bundleVersionId: string };
  dependencies: GenerateVariantsDependencies;
  context: Awaited<ReturnType<VariantContextReader["read"]>>;
  contentHashes: readonly string[];
  capacity: { usedInDirection: number; usedInTotal: number };
  provenance: VariantProvenance;
  now: Date;
}): Promise<VariantOutcome> {
  const admission = admitVariant({
    manifest: input.context.manifest,
    approval: input.context.approval,
    bundleVersionId: input.payload.bundleVersionId,
    bundleDigest: input.context.digest,
    variant: input.variant,
    producedAssetIds: input.producedAssetIds,
    evidence: input.context.evidence,
    limits: input.context.limits,
    existingContentHashes: input.contentHashes,
    capacity: input.capacity,
    now: input.now,
  });

  if (admission.outcome === "refused") {
    return {
      status: "refused",
      directionId: input.direction,
      reason: admission.refusal.reason,
      detail: admission.refusal.detail,
    };
  }

  const appended = await input.dependencies.variants.append({
    organizationId: input.payload.organizationId,
    bundleVersionId: input.payload.bundleVersionId,
    variant: input.variant,
    contentHash: admission.contentHash,
    provenance: input.provenance,
  });

  if (appended.outcome === "refused") {
    // The service said yes and the database said no, which means the world
    // changed underneath this run — an approval revoked, another worker taking
    // the last slot. The database is right and its reason is what gets reported.
    return {
      status: "refused",
      directionId: input.direction,
      reason: appended.reason,
      detail: "Storage refused this variant; the campaign changed while it was being produced.",
    };
  }

  return {
    status: "stored",
    variantId: appended.variantId,
    directionId: input.direction,
    contentHash: admission.contentHash,
  };
}
