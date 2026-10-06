import {
  ProviderContractVerificationError,
  getMetaCampaignProviderContract,
} from "@/modules/integrations/providers/meta/contract";
import {
  campaignReadinessBlocker,
  type CampaignReadinessBlocker,
} from "@/domain/campaigns/readiness";
import type { ChannelContentLimits } from "@/domain/campaigns/content-policy";
import type { CampaignChannel } from "@/domain/campaigns/schemas";

/**
 * Hashtag and copy limits as the *verified* provider contract states them.
 *
 * Where the contract proves no limit, the channel is absent here and content
 * policy blocks it rather than checking against a guess. Today the checked-in
 * Meta contract proves none, so both channels block — which is the honest state
 * until controlled-account evidence lands.
 *
 * Shared rather than duplicated because an operator editing a caption by hand
 * and a model writing one must be held to identical limits. Two copies of this
 * would eventually disagree, and the direction they would disagree in is the
 * one where a person can type something a model is not allowed to produce.
 *
 * **It does not throw.** It used to. An expired contract raised out of here,
 * through `getMetaCampaignProviderContract`, and killed the generation worker
 * while it was still assembling its dependencies — before the run was claimed,
 * so the database still says `queued` for a Trigger run that has been FAILED
 * since 12 September (audit findings F01 and F02). An expired contract means
 * *nothing is verified*, which is precisely the empty map an unverified live
 * contract already returns. Crashing was never a different fact; it was the
 * same fact, delivered in a way nothing could handle.
 *
 * The expiry itself stays. It is correct: our record of what Meta allows is out
 * of date, and pretending otherwise by moving the date would let unverified
 * limits become verified ones — contract C01, ruling R5.
 */
export function verifiedChannelLimits(
  now: Date = new Date(),
): Partial<Record<CampaignChannel, ChannelContentLimits>> {
  return verifiedChannelLimitsEvidence(now).limitsByChannel;
}

export type VerifiedChannelLimitsEvidence = {
  /**
   * `verified` means **nothing is outstanding**: the contract parsed, is
   * current, proves at least one placement, and has no blocked or unknown
   * placement left to explain.
   *
   * The invariant is exactly `outcome === "verified"` iff `blockers` is empty,
   * and it is asserted in the tests. A partially verified contract used to
   * report `verified` with no blockers at all, which told a caller asking about
   * one placement that everything was fine because some *other* placement was
   * proven. "Verified except the one you want" is not verified.
   */
  outcome: "verified" | "unverified";
  limitsByChannel: Partial<Record<CampaignChannel, ChannelContentLimits>>;
  /** Always launch-phase. These block publishing, never drafting. */
  blockers: readonly CampaignReadinessBlocker[];
};

/**
 * Placements a caller actually intends to publish to.
 *
 * Optional, and the default is "all of them" rather than "none of them": a
 * caller that does not say what it needs is asking whether the contract is
 * wholly sound, and gets told about every placement that is not.
 */
export type ChannelLimitsQuery = {
  /** Contract placement keys, e.g. `instagram.feed_image`. */
  requestedPlacementKeys?: readonly string[];
};

const META_PROVIDER_KEY = "meta_campaign";

/**
 * The same read, with the reason the answer is what it is.
 *
 * Callers that only need limits use `verifiedChannelLimits`. Callers building a
 * readiness answer need to say *why* a channel has none, and "the contract
 * lapsed" and "the contract is current but proves no limit" are different
 * things to tell a client, with different repairs.
 */
export function verifiedChannelLimitsEvidence(
  now: Date = new Date(),
  query: ChannelLimitsQuery = {},
): VerifiedChannelLimitsEvidence {
  const limits: Partial<Record<CampaignChannel, ChannelContentLimits>> = {};

  let contract;
  try {
    contract = getMetaCampaignProviderContract(now);
  } catch (error) {
    if (error instanceof ProviderContractVerificationError) {
      return {
        outcome: "unverified",
        limitsByChannel: {},
        blockers: [
          campaignReadinessBlocker({
            code: "provider_contract_expired",
            phase: "launch",
            actionKey: `${error.providerKey}.all_placements`,
            explanation:
              error.reason === "expired"
                ? "Our record of what this platform currently allows is out of date, so nothing may be published to it until it is checked again."
                : "Our record of what this platform allows is dated in the future and cannot be trusted.",
            repair: { kind: "reverify_provider_contract", providerKey: error.providerKey },
            deterministic: true,
          }),
        ],
      };
    }
    // A contract that fails its own schema is a defect in the checked-in
    // record, not a tenant's problem. It still blocks launch rather than
    // crashing whoever asked, and it is still named exactly.
    return {
      outcome: "unverified",
      limitsByChannel: {},
      blockers: [
        campaignReadinessBlocker({
          code: "provider_content_limits_unverified",
          phase: "launch",
          actionKey: `${META_PROVIDER_KEY}.all_placements`,
          explanation:
            "Our record of this platform's rules could not be read, so nothing may be published to it.",
          repair: { kind: "reverify_provider_contract", providerKey: META_PROVIDER_KEY },
          deterministic: true,
        }),
      ],
    };
  }

  const blockers: CampaignReadinessBlocker[] = [];
  const described = new Set<string>();

  for (const placement of contract.placements) {
    described.add(placement.key);

    if (placement.verificationStatus !== "verified") {
      // Named one by one rather than summarised. "This platform is not fully
      // verified" is not something a person can act on; "your Instagram story
      // cannot be published yet" is.
      blockers.push(
        campaignReadinessBlocker({
          code: "provider_placement_blocked",
          phase: "launch",
          actionKey: placement.key,
          explanation: `Publishing to ${placement.key.replace(".", " ")} is not proven yet, so nothing may be sent to it.`,
          repair: { kind: "reverify_provider_contract", providerKey: contract.providerKey },
          deterministic: true,
        }),
      );
      continue;
    }

    const channel = placement.key.split(".")[0];
    if (channel !== "instagram" && channel !== "facebook") continue;
    limits[channel] = {
      maxHashtags: placement.limits.maxHashtags,
      maxCopyCharacters: placement.limits.maxCopyCharacters,
    };
  }

  // A placement the contract has never heard of is a different failure from one
  // it describes and refuses, and it has a different cause: somebody asked to
  // publish somewhere our record does not cover.
  for (const requested of query.requestedPlacementKeys ?? []) {
    if (described.has(requested)) continue;
    blockers.push(
      campaignReadinessBlocker({
        code: "provider_placement_unknown",
        phase: "launch",
        actionKey: requested,
        explanation: `Our record of this platform does not cover ${requested.replace(".", " ")}, so we cannot say whether a post there would be accepted.`,
        repair: { kind: "reverify_provider_contract", providerKey: contract.providerKey },
        deterministic: true,
      }),
    );
  }

  if (Object.keys(limits).length === 0) {
    blockers.push(
      campaignReadinessBlocker({
        code: "provider_content_limits_unverified",
        phase: "launch",
        actionKey: `${contract.providerKey}.all_placements`,
        explanation:
          "We cannot yet prove this platform's caption and hashtag limits, so its posts cannot be checked before publishing.",
        repair: { kind: "reverify_provider_contract", providerKey: contract.providerKey },
        deterministic: true,
      }),
    );
  }

  return {
    outcome: blockers.length === 0 ? "verified" : "unverified",
    limitsByChannel: limits,
    blockers,
  };
}

export type InternalDraftContentContract = {
  /**
   * What an internal draft is checked against. Identical to the verified
   * limits where the contract proves them, and **empty where it does not** —
   * an unprovable limit is never replaced by a plausible one.
   */
  limitsByChannel: Partial<Record<CampaignChannel, ChannelContentLimits>>;
  /**
   * The launch blockers this draft is already carrying.
   *
   * Not reasons to refuse the draft. A draft nobody can publish yet is still
   * worth making: it is the thing a person reviews, edits and approves, and the
   * platform's job is to have it ready the moment publishing is possible. These
   * travel with it so the surface showing the draft can also say, plainly, what
   * will stop it being published.
   */
  deferredLaunchBlockers: readonly CampaignReadinessBlocker[];
};

/**
 * The bounded contract an internal draft is drawn under.
 *
 * The distinction contract C01 requires: drafting and publishing are different
 * questions with different evidence. Publishing needs current, provider-specific
 * verification of the exact output. Drafting needs none of it — nothing is sent
 * anywhere, nothing is charged, nobody is shown a claim.
 *
 * What drafting must never do is *pretend*. Handing a draft an invented hashtag
 * ceiling so generation can finish would produce a proposal that passes review
 * and fails at the provider, which is worse than a proposal that is honestly
 * marked unpublishable. So where the contract proves nothing, this contract
 * proves nothing either, and the resulting blockers are carried rather than
 * hidden.
 */
export function internalDraftContentContract(
  now: Date = new Date(),
  query: ChannelLimitsQuery = {},
): InternalDraftContentContract {
  const evidence = verifiedChannelLimitsEvidence(now, query);
  return {
    limitsByChannel: evidence.limitsByChannel,
    deferredLaunchBlockers: evidence.blockers,
  };
}
