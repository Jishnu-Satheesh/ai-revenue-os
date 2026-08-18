import { createHash } from "node:crypto";

import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type { CampaignCreativeVariant } from "@/domain/campaigns/variants";
import type { ChannelContentLimits } from "@/domain/campaigns/content-policy";

/**
 * Whether a proposed variant is a legal instance of an approved bundle.
 *
 * The schema already removed the fields a variant must never carry. This is the
 * second half: everything a variant *can* express, checked against what the
 * approval actually authorized. The two together are what let one human
 * decision cover creative that did not exist when it was made.
 *
 * Nothing here consults a model. A judgement call about whether copy is "on
 * brand" belongs to the operator reading the envelope; what belongs here is the
 * set of questions with one right answer — does this direction exist, was this
 * image produced for this campaign, is this claim in the pinned evidence, is
 * the window still open.
 */

export type VariantDerivationFailure = {
  code:
    | "unknown_direction"
    | "placement_not_approved"
    | "asset_not_produced"
    | "unsourced_claim"
    | "invented_offer"
    | "restricted_term"
    | "hashtag_over_limit"
    | "copy_over_limit"
    | "policy_expired"
    | "duplicate_variant";
  detail: string;
};

/** The pinned evidence a variant's words must trace back to. */
export type VariantEvidence = {
  /** The offer the campaign recorded, or null when it sells none. */
  offer: string | null;
  /** Assertion keys the policy locked. Present for provenance, not matching. */
  factKeys: readonly string[];
  /** The verified fact text this campaign was built on, lowercased on read. */
  factText: string;
  restrictedTerms: readonly string[];
};

export type VariantDerivationInput = {
  manifest: CampaignBundleManifest;
  variant: CampaignCreativeVariant;
  /** Asset ids the planner actually produced for this variant run. */
  producedAssetIds: readonly string[];
  evidence: VariantEvidence;
  limits: ChannelContentLimits;
  /** Content hashes of variants already stored for this bundle version. */
  existingContentHashes: readonly string[];
  now: Date;
};

export type VariantDerivationResult =
  | { outcome: "derived"; contentHash: string }
  | { outcome: "refused"; failures: readonly VariantDerivationFailure[] };

/**
 * Ranking claims are what get a business into trouble, so those are what the
 * claim check looks for.
 *
 * Deliberately narrow, and the narrowness is the point. A bare `best` matches
 * "our best table", which is ordinary writing and not a claim about the world.
 * A checker that rejects ordinary writing gets ignored, and an ignored checker
 * protects nothing — so this matches only constructions that assert a position
 * against others: an award, a vote, a rating, a rank.
 *
 * It catches the confident specific invention, not every overstatement. The
 * operator reading the envelope covers the rest.
 */
const RANKING_CLAIM =
  /\b(voted|award[- ]winning|top[- ]rated|number one|no\.? ?1|#1|best (?:restaurant|cafe|place|in\b))/i;
const OFFERISH = /\b(half price|free|discount|\d+\s*%\s*off|bogo|buy one)\b/i;

export function checkVariantDerivation(input: VariantDerivationInput): VariantDerivationResult {
  const failures: VariantDerivationFailure[] = [];
  const { manifest, variant, evidence } = input;

  const direction = manifest.directions.find((entry) => entry.id === variant.directionId);
  if (!direction) {
    failures.push({
      code: "unknown_direction",
      detail: `Direction ${variant.directionId} is not part of this approved bundle.`,
    });
  }

  // The variant names an approved action, it does not invent one. Checking the
  // pair against the direction's own actions is what stops a variant quietly
  // appearing on a placement nobody approved for this creative.
  const approvedHere = manifest.actions.filter(
    (action) => action.directionId === variant.directionId,
  );
  if (
    direction &&
    !approvedHere.some(
      (action) => action.channel === variant.channel && action.placement === variant.placement,
    )
  ) {
    failures.push({
      code: "placement_not_approved",
      detail: `No approved action places this direction on ${variant.channel} ${variant.placement}.`,
    });
  }

  if (!input.producedAssetIds.includes(variant.assetId)) {
    failures.push({
      code: "asset_not_produced",
      detail: `Asset ${variant.assetId} was not produced for this campaign.`,
    });
  }

  if (new Date(manifest.generationPolicy.policyExpiresAt).getTime() <= input.now.getTime()) {
    failures.push({
      code: "policy_expired",
      detail: `The policy closed at ${manifest.generationPolicy.policyExpiresAt}; no further variants may be produced under it.`,
    });
  }

  failures.push(...checkWords(variant, evidence));
  failures.push(...checkLimits(variant, input.limits));

  const contentHash = variantContentHash(variant);
  if (input.existingContentHashes.includes(contentHash)) {
    failures.push({
      code: "duplicate_variant",
      detail: "An identical variant already exists for this bundle version.",
    });
  }

  return failures.length === 0
    ? { outcome: "derived", contentHash }
    : { outcome: "refused", failures };
}

function checkWords(
  variant: CampaignCreativeVariant,
  evidence: VariantEvidence,
): VariantDerivationFailure[] {
  const failures: VariantDerivationFailure[] = [];
  const words = `${variant.hook} ${variant.caption} ${variant.callToAction}`;
  const haystack = `${evidence.factText} ${evidence.offer ?? ""}`.toLowerCase();

  for (const term of evidence.restrictedTerms) {
    if (words.toLowerCase().includes(term.toLowerCase())) {
      failures.push({
        code: "restricted_term",
        detail: `Copy uses the restricted term "${term}".`,
      });
    }
  }

  // A superlative is a claim about the world, so it needs the world to have
  // said it first. Nothing in the pinned evidence means nothing to stand on.
  const ranking = RANKING_CLAIM.exec(words);
  if (ranking && !haystack.includes(ranking[0].toLowerCase())) {
    failures.push({
      code: "unsourced_claim",
      detail: `Copy claims "${ranking[0]}", which the pinned evidence does not support.`,
    });
  }

  const offerish = OFFERISH.exec(words);
  if (offerish && evidence.offer === null) {
    failures.push({
      code: "invented_offer",
      detail: `Copy promises "${offerish[0]}" but this campaign records no offer.`,
    });
  }

  return failures;
}

function checkLimits(
  variant: CampaignCreativeVariant,
  limits: ChannelContentLimits,
): VariantDerivationFailure[] {
  const failures: VariantDerivationFailure[] = [];

  if (limits.maxHashtags !== null && variant.hashtags.length > limits.maxHashtags) {
    failures.push({
      code: "hashtag_over_limit",
      detail: `${variant.hashtags.length} hashtags exceeds the verified limit of ${limits.maxHashtags}.`,
    });
  }

  if (limits.maxCopyCharacters !== null && variant.caption.length > limits.maxCopyCharacters) {
    failures.push({
      code: "copy_over_limit",
      detail: `The caption is ${variant.caption.length} characters against a verified limit of ${limits.maxCopyCharacters}.`,
    });
  }

  return failures;
}

/**
 * What makes two variants the same variant.
 *
 * Hashtag order is included rather than sorted away, because a reader sees the
 * order under the caption — two orderings are two different posts. The variant
 * id is excluded, since a fresh id is exactly how a duplicate would sneak past.
 */
export function variantContentHash(variant: CampaignCreativeVariant): string {
  const canonical = JSON.stringify([
    variant.directionId,
    variant.assetId,
    variant.channel,
    variant.placement,
    variant.hook,
    variant.caption,
    variant.hashtags,
    variant.callToAction,
  ]);
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
