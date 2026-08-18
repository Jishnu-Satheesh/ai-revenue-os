import { approvalStatus, type ApprovalRow } from "@/domain/campaigns/state-machine";
import { checkVariantDerivation } from "@/domain/campaigns/derivation";
import type { VariantDerivationFailure, VariantEvidence } from "@/domain/campaigns/derivation";
import type { CampaignCreativeVariant } from "@/domain/campaigns/variants";
import type { ChannelContentLimits } from "@/domain/campaigns/content-policy";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";

/**
 * Whether a proposed variant may be stored, and why not when it may not.
 *
 * The order of the checks is the point. Authority first — is there a live
 * approval for exactly this version — then the window, then capacity, then the
 * creative itself. A caller that has run out of slots should be told that,
 * rather than being handed a content complaint about a variant it was never
 * allowed to add.
 *
 * Nothing here truncates. A request for more variants than remain is refused
 * with the number that remain, because silently producing fewer than asked for
 * is how an operator ends up believing a test ran that never did.
 */

export type VariantRefusal =
  | { reason: "no_live_approval"; detail: string }
  | { reason: "approval_superseded"; detail: string }
  | { reason: "policy_expired"; detail: string }
  | { reason: "direction_cap_reached"; detail: string; remaining: 0 }
  | { reason: "total_cap_reached"; detail: string; remaining: 0 }
  | { reason: "not_derived"; detail: string; failures: readonly VariantDerivationFailure[] };

export type VariantAdmission =
  | { outcome: "admitted"; contentHash: string }
  | { outcome: "refused"; refusal: VariantRefusal };

export type VariantCapacity = {
  /** Variants already stored for this direction. */
  usedInDirection: number;
  /** Variants already stored across the whole version. */
  usedInTotal: number;
};

export type AdmitVariantInput = {
  manifest: CampaignBundleManifest;
  approval: ApprovalRow | null;
  bundleVersionId: string;
  bundleDigest: string;
  variant: CampaignCreativeVariant;
  producedAssetIds: readonly string[];
  evidence: VariantEvidence;
  limits: ChannelContentLimits;
  existingContentHashes: readonly string[];
  capacity: VariantCapacity;
  now: Date;
};

export function admitVariant(input: AdmitVariantInput): VariantAdmission {
  // A variant is creative no human reviewed one by one. The only thing standing
  // behind it is the approval on the version above it, so that approval has to
  // be live at this moment — not merely to have existed once.
  const status = approvalStatus(
    input.approval,
    {
      bundleVersionId: input.bundleVersionId,
      bundleDigest: input.bundleDigest,
    },
    input.now,
  );

  if (!status.isApproved) {
    return {
      outcome: "refused",
      refusal:
        status.reason === "version_superseded" || status.reason === "digest_mismatch"
          ? {
              reason: "approval_superseded",
              detail:
                "The approval on file covers a different version of this campaign, so it authorizes no creative here.",
            }
          : {
              reason: "no_live_approval",
              detail:
                status.reason === "expired"
                  ? "The approval for this version has expired. Approve it again before generating more creative."
                  : "No live approval covers this version, so no variant may be produced under it.",
            },
    };
  }

  const policy = input.manifest.generationPolicy;

  if (new Date(policy.policyExpiresAt).getTime() <= input.now.getTime()) {
    return {
      outcome: "refused",
      refusal: {
        reason: "policy_expired",
        detail: `This approval licensed creative until ${policy.policyExpiresAt}. That window has closed.`,
      },
    };
  }

  if (input.capacity.usedInDirection >= policy.maxVariantsPerDirection) {
    return {
      outcome: "refused",
      refusal: {
        reason: "direction_cap_reached",
        detail: `This direction already holds its full ${policy.maxVariantsPerDirection} variants.`,
        remaining: 0,
      },
    };
  }

  if (input.capacity.usedInTotal >= policy.maxVariantsTotal) {
    return {
      outcome: "refused",
      refusal: {
        reason: "total_cap_reached",
        detail: `This approval covers ${policy.maxVariantsTotal} variants in total and they are all used.`,
        remaining: 0,
      },
    };
  }

  const derivation = checkVariantDerivation({
    manifest: input.manifest,
    variant: input.variant,
    producedAssetIds: input.producedAssetIds,
    evidence: input.evidence,
    limits: input.limits,
    existingContentHashes: input.existingContentHashes,
    now: input.now,
  });

  if (derivation.outcome === "refused") {
    return {
      outcome: "refused",
      refusal: {
        reason: "not_derived",
        // Codes, not model text. A provider message can echo prompt content,
        // and prompt content can be anything a customer once wrote.
        detail: `This variant left the approved envelope: ${[
          ...new Set(derivation.failures.map((failure) => failure.code)),
        ].join(", ")}.`,
        failures: derivation.failures,
      },
    };
  }

  return { outcome: "admitted", contentHash: derivation.contentHash };
}

/**
 * How many more variants this direction may still take.
 *
 * Reported rather than silently applied, so a caller asking for five when two
 * remain gets two and is told so. The alternative — quietly producing fewer —
 * leaves an operator believing a test ran at a size it never reached.
 */
export function remainingCapacity(
  manifest: CampaignBundleManifest,
  capacity: VariantCapacity,
): number {
  const policy = manifest.generationPolicy;
  return Math.max(
    0,
    Math.min(
      policy.maxVariantsPerDirection - capacity.usedInDirection,
      policy.maxVariantsTotal - capacity.usedInTotal,
    ),
  );
}
