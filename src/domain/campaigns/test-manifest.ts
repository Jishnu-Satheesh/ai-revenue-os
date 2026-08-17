import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";

/**
 * A complete, valid manifest used as the starting point for domain tests.
 *
 * It is deliberately exhaustive rather than minimal: most campaign rules are
 * about the relationships between directions, actions, assets, and copy, and a
 * skeleton fixture would let those relationships go untested.
 */

const ID = {
  campaign: "c0000000-0000-4000-8000-000000000001",
  brief: "c0000000-0000-4000-8000-000000000002",
  control: "d0000000-0000-4000-8000-000000000001",
  evidenceLed: "d0000000-0000-4000-8000-000000000002",
  experimental: "d0000000-0000-4000-8000-000000000003",
  assetControl: "a0000000-0000-4000-8000-000000000001",
  assetEvidence: "a0000000-0000-4000-8000-000000000002",
  assetExperimental: "a0000000-0000-4000-8000-000000000003",
  actionControl: "b0000000-0000-4000-8000-000000000001",
  actionEvidence: "b0000000-0000-4000-8000-000000000002",
  actionExperimental: "b0000000-0000-4000-8000-000000000003",
} as const;

export const manifestIds = ID;

function asset(id: string, hashSeed: string) {
  return {
    id,
    contentHash: hashSeed.repeat(64).slice(0, 64),
    mimeType: "image/png" as const,
    widthPx: 1080,
    heightPx: 1080,
    truthClass: "synthetic_generated" as const,
    provenance: {
      kind: "generated" as const,
      modelId: "image-model-v1",
      promptVersionId: "campaign-image-prompt-v1",
      generationProfile: "brand_guided" as const,
      derivedFromBrandAssetVersionIds: [],
    },
    altText: "A plated dish on a wooden table with the restaurant logo in the corner.",
  };
}

function copy(hook: string) {
  return {
    channel: "instagram" as const,
    placement: "feed_image" as const,
    hook,
    caption: "Lunch that pays for itself. Two courses, one price, this week only.",
    callToAction: "Book a table",
    timingRationale: "Weekday lunch bookings peak the evening before, so this posts at 18:00.",
  };
}

export function validManifest(): CampaignBundleManifest {
  return {
    schemaVersion: 2,
    campaignId: ID.campaign,
    version: 1,
    source: { kind: "manual_brief", sourceId: ID.brief },
    objective: "Increase weekday lunch covers without discounting dinner.",
    rationale:
      "Weekday lunch has the widest gap between capacity and covers, and the contribution margin is already measured.",
    generationProfile: "brand_guided",
    generationPolicy: {
      maxVariantsPerDirection: 4,
      maxVariantsTotal: 12,
      policyExpiresAt: "2026-09-30T14:00:00.000Z",
      lockedOfferRef: "lunch-set-menu-2026-09",
      lockedAssertionKeys: ["offer.lunch_set_price", "hours.weekday_lunch"],
    },
    directions: [
      {
        id: ID.control,
        kind: "control",
        name: "House style",
        rationale: "The current brand treatment, kept as the reference to measure against.",
        generationProfileOverride: null,
        assetIds: [ID.assetControl],
        copy: [copy("The lunch you keep meaning to book")],
        hashtagSets: [
          {
            channel: "instagram",
            tags: ["#lunch", "#dubaieats"],
            rationale: "Two tags the account already ranks for, kept as the control.",
          },
        ],
        internalContentTags: ["lunch-offer"],
        softConventionDepartures: [],
        experiment: null,
      },
      {
        id: ID.evidenceLed,
        kind: "evidence_led",
        name: "Contribution-led",
        rationale: "Leads with the measured margin gap that the objective names.",
        generationProfileOverride: null,
        assetIds: [ID.assetEvidence],
        copy: [copy("Two courses, one price, weekdays only")],
        hashtagSets: [
          {
            channel: "instagram",
            tags: ["#lunchdeal", "#dubaieats"],
            rationale: "Adds the offer term the observed search activity favours.",
          },
        ],
        internalContentTags: ["lunch-offer", "margin-led"],
        softConventionDepartures: [],
        experiment: null,
      },
      {
        id: ID.experimental,
        kind: "experimental",
        name: "Empty-table honesty",
        rationale: "Tests whether naming the quiet hour outperforms naming the offer.",
        generationProfileOverride: null,
        assetIds: [ID.assetExperimental],
        copy: [copy("Our quietest hour is your best table")],
        hashtagSets: [
          {
            channel: "instagram",
            tags: ["#quiethour", "#dubaieats"],
            rationale: "Tests a scarcity-free framing the account has never published.",
          },
        ],
        internalContentTags: ["lunch-offer", "experiment"],
        softConventionDepartures: ["Food is always the hero image."],
        experiment: {
          challengedAssumption: "That an offer must lead with a price to earn a booking.",
          differenceFromControl:
            "It names the empty hour rather than the discount, and shows the room instead of the plate.",
          whyItCouldWin: "Diners who avoid discount language may still respond to a quiet room.",
          stretchedConvention: "The soft convention that food is always the hero image.",
          decidingEvidence: "Bookings attributed within the registered outcome window.",
        },
      },
    ],
    actions: [
      {
        id: ID.actionControl,
        directionId: ID.control,
        channel: "instagram",
        placement: "feed_image",
        scheduledFor: "2026-09-01T14:00:00.000Z",
        requirement: "required",
        spendCeiling: null,
      },
      {
        id: ID.actionEvidence,
        directionId: ID.evidenceLed,
        channel: "instagram",
        placement: "feed_image",
        scheduledFor: "2026-09-02T14:00:00.000Z",
        requirement: "required",
        spendCeiling: null,
      },
      {
        id: ID.actionExperimental,
        directionId: ID.experimental,
        channel: "instagram",
        placement: "feed_image",
        scheduledFor: "2026-09-03T14:00:00.000Z",
        requirement: "optional",
        spendCeiling: { amountMinor: 150_000, currency: "AED" },
      },
    ],
    assets: [
      asset(ID.assetControl, "1"),
      asset(ID.assetEvidence, "2"),
      asset(ID.assetExperimental, "3"),
    ],
    measurementPlan: {
      primaryMetricKey: "contribution.incremental_gross_profit",
      guardrailMetricKeys: ["spend.total"],
      baselineSource: "channel_economics_entries weekday lunch periods",
      baselineLookbackDays: 28,
      attributionMethod: "observational_prepost",
      outcomeWindowDays: 14,
      settlementDelayDays: 3,
      minimumEvidenceTier: "computed",
      insufficientEvidenceConclusion: "inconclusive",
    },
    executionMode: "best_effort",
    totalSpendCeiling: { amountMinor: 150_000, currency: "AED" },
  };
}
