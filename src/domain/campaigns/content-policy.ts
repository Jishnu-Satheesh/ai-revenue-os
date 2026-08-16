import type {
  CampaignBundleManifest,
  CampaignChannel,
  CampaignCreativeDirection,
  CampaignGenerationProfile,
  CampaignHashtagSet,
} from "@/domain/campaigns/schemas";

/**
 * What creative is allowed to do, and what it is never allowed to do.
 *
 * The split that matters is between hard constraints and soft conventions.
 * Hard constraints — factual accuracy, legal and provider policy, intellectual
 * property, consent, safety, and the approved offer — hold under every profile,
 * including full visual freedom. Soft conventions are the brand's own habits:
 * palette emphasis, composition, tone. Only those may be stretched, only where
 * the profile permits it, and only when the direction says so out loud.
 */

export type ContentPolicyViolation = {
  code:
    | "profile_forbids_departure"
    | "departure_not_disclosed"
    | "departure_outside_experimental"
    | "hard_constraint_violated"
    | "hashtag_duplicate"
    | "hashtag_restricted"
    | "hashtag_over_limit"
    | "hashtag_limits_unverified"
    | "experiment_not_distinct";
  /** Points at the offending part of the manifest, for the review UI. */
  path: readonly (string | number)[];
  message: string;
};

/**
 * Provider limits as the *verified* contract states them.
 *
 * `null` means the contract does not yet prove a limit. That is not permission
 * to guess one: an unverified limit blocks the channel, because inventing a
 * platform rule is how a bundle passes review and then fails at the provider.
 */
export type ChannelContentLimits = {
  maxHashtags: number | null;
  maxCopyCharacters: number | null;
};

export type ContentPolicyInput = {
  manifest: CampaignBundleManifest;
  /** Keyed by channel. A channel absent here has no verified contract at all. */
  limitsByChannel: Partial<Record<CampaignChannel, ChannelContentLimits>>;
  /** Terms the organization or provider forbids, compared case-insensitively. */
  restrictedTerms: readonly string[];
  /**
   * Failures found by deterministic checks outside the domain: claim
   * verification, legal review, provider policy. Passed in rather than guessed,
   * and fatal under every profile.
   */
  hardConstraintFailures?: readonly { path: readonly (string | number)[]; message: string }[];
};

export function evaluateContentPolicy(input: ContentPolicyInput): {
  violations: readonly ContentPolicyViolation[];
} {
  const violations: ContentPolicyViolation[] = [];

  for (const failure of input.hardConstraintFailures ?? []) {
    violations.push({
      code: "hard_constraint_violated",
      path: failure.path,
      message: failure.message,
    });
  }

  input.manifest.directions.forEach((direction, index) => {
    violations.push(...checkProfile(input.manifest, direction, index));
    direction.hashtagSets.forEach((set, setIndex) => {
      violations.push(
        ...checkHashtags(set, {
          path: ["directions", index, "hashtagSets", setIndex],
          limits: input.limitsByChannel[set.channel],
          restrictedTerms: input.restrictedTerms,
        }),
      );
    });
  });

  violations.push(...checkExperimentDistinct(input.manifest));

  return { violations };
}

/** The profile actually in force for one direction. */
export function effectiveProfile(
  manifest: CampaignBundleManifest,
  direction: CampaignCreativeDirection,
): CampaignGenerationProfile {
  return direction.generationProfileOverride ?? manifest.generationProfile;
}

function checkProfile(
  manifest: CampaignBundleManifest,
  direction: CampaignCreativeDirection,
  index: number,
): ContentPolicyViolation[] {
  const profile = effectiveProfile(manifest, direction);
  const departures = direction.softConventionDepartures;
  const path = ["directions", index, "softConventionDepartures"] as const;

  if (departures.length === 0) {
    // Nothing to police. An experimental direction that stretches nothing is
    // caught by the distinctness check instead, where the failure is clearer.
    return [];
  }

  if (profile === "brand_restricted") {
    return [
      {
        code: "profile_forbids_departure",
        path,
        message:
          "Brand restricted keeps the brand's visual system intact, so this direction cannot depart from it. Explore a different treatment hypothesis or change the profile, which creates a new version.",
      },
    ];
  }

  if (profile === "brand_guided" && direction.kind !== "experimental") {
    return [
      {
        code: "departure_outside_experimental",
        path,
        message:
          "Brand guided allows a disclosed stretch only in the experimental direction. The control and evidence-led directions must stay inside the brand's conventions.",
      },
    ];
  }

  if (direction.kind === "experimental" && direction.experiment) {
    // The disclosure an operator reads at review is `stretchedConvention`. If
    // it does not name one of the declared departures, review shows less than
    // the bundle is actually doing.
    const disclosed = normalize(direction.experiment.stretchedConvention);
    const anyDisclosed = departures.some(
      (departure) =>
        disclosed.includes(normalize(departure)) || normalize(departure).includes(disclosed),
    );
    if (!anyDisclosed) {
      return [
        {
          code: "departure_not_disclosed",
          path,
          message:
            "The experiment must disclose the convention it stretches, so review shows what the bundle actually does.",
        },
      ];
    }
  }

  return [];
}

function checkHashtags(
  set: CampaignHashtagSet,
  context: {
    path: readonly (string | number)[];
    limits: ChannelContentLimits | undefined;
    restrictedTerms: readonly string[];
  },
): ContentPolicyViolation[] {
  const violations: ContentPolicyViolation[] = [];

  // Case-insensitive for detection only. `#DubaiEats` and `#dubaieats` are one
  // tag to a provider, but the operator's capitalisation is theirs to keep.
  const seen = new Set<string>();
  set.tags.forEach((tag, tagIndex) => {
    const key = normalize(tag);
    if (seen.has(key)) {
      violations.push({
        code: "hashtag_duplicate",
        path: [...context.path, "tags", tagIndex],
        message: `${tag} repeats a tag already in this set. Providers count it once.`,
      });
    }
    seen.add(key);

    const restricted = context.restrictedTerms.find((term) => key.includes(normalize(term)));
    if (restricted) {
      violations.push({
        code: "hashtag_restricted",
        path: [...context.path, "tags", tagIndex],
        message: `${tag} contains a restricted term and cannot be published.`,
      });
    }
  });

  const limits = context.limits;
  if (!limits || limits.maxHashtags === null) {
    // A set that proposes no tags has nothing to check against a limit, known
    // or unknown. Treating it as unverifiable conflated "you proposed tags I
    // cannot check" with "you proposed none", and blocked every bundle for a
    // channel whose contract is not yet proven — including the truthful bundle
    // that declines to suggest hashtags precisely because it cannot verify them.
    if (seen.size === 0) return violations;

    violations.push({
      code: "hashtag_limits_unverified",
      path: context.path,
      message:
        "The verified provider contract does not yet state a hashtag limit for this channel, so the set cannot be checked. The channel stays blocked until the contract proves the limit.",
    });
    return violations;
  }

  if (seen.size > limits.maxHashtags) {
    violations.push({
      code: "hashtag_over_limit",
      path: context.path,
      message: `This channel accepts ${limits.maxHashtags} hashtags and the set has ${seen.size}.`,
    });
  }

  return violations;
}

/**
 * A variant that repeats the control is not an experiment.
 *
 * Distinctness is judged on what a viewer would actually see: the image and the
 * words. Two directions sharing both would produce identical exposure and could
 * never settle the question the experiment claims to ask.
 */
function checkExperimentDistinct(manifest: CampaignBundleManifest): ContentPolicyViolation[] {
  const control = manifest.directions.find((direction) => direction.kind === "control");
  const experimental = manifest.directions.find((direction) => direction.kind === "experimental");
  if (!control || !experimental) return [];

  const index = manifest.directions.indexOf(experimental);
  const sameAssets =
    experimental.assetIds.length === control.assetIds.length &&
    experimental.assetIds.every((assetId) => control.assetIds.includes(assetId));
  const sameWords = experimental.copy.every((entry) =>
    control.copy.some(
      (reference) =>
        reference.channel === entry.channel &&
        reference.placement === entry.placement &&
        normalize(reference.hook) === normalize(entry.hook) &&
        normalize(reference.caption) === normalize(entry.caption),
    ),
  );

  if (sameAssets && sameWords) {
    return [
      {
        code: "experiment_not_distinct",
        path: ["directions", index],
        message:
          "The experimental direction shows the same image and says the same words as the control, so no result could tell them apart.",
      },
    ];
  }

  return [];
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}
