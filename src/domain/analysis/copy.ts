import type { DetectorSeverity, FindingKind } from "@/domain/analysis/types";

/**
 * The words an operator reads, kept beside the detectors that produce the codes.
 *
 * Every sentence here is a translation of a deterministic outcome, never an
 * interpretation of one. Nothing in this file adds a cause, a recommendation, a
 * confidence, or a number: the numbers arrive already computed and cited, and a
 * sentence that stated one would be a second, uncited copy of it.
 *
 * An unrecognised code renders as the code. That is deliberate -- a detector
 * shipped ahead of its copy should look unfinished, not look like nothing
 * happened.
 */

export type WorkspaceChapterId =
  | "summary"
  | "money"
  | "cancellations"
  | "availability"
  | "funnel"
  | "retention"
  | "operations"
  | "items"
  | "promotions"
  | "customer-voice"
  | "recommendations"
  | "trust";

export type WorkspaceChapter = {
  id: WorkspaceChapterId;
  /** The rail label, from the approved design. */
  navLabel: string;
  heading: string;
  /** Detector keys whose findings fill this chapter. Empty means deferred. */
  detectorKeys: readonly string[];
  /**
   * Why this chapter has no detector yet, in the operator's terms. Present on
   * exactly the chapters `specs/018` section 11.2 defers, so the page says what
   * is missing instead of showing an empty frame that reads as "nothing wrong".
   */
  deferredReason?: string;
};

/** In the order the approved channel-workspace design lays them out. */
export const WORKSPACE_CHAPTERS: readonly WorkspaceChapter[] = [
  // The four numbered findings the approved draft leads with. Each is a
  // question the window answers, shown as an eight-column analysis card with a
  // four-column figure rail; nothing is merged across them because each owes
  // its numbers to a different detector.
  {
    id: "cancellations",
    navLabel: "Cancellations",
    heading: "Cancellations Financial Impact",
    detectorKeys: ["orders.cancellation_loss"],
  },
  {
    id: "availability",
    navLabel: "Availability",
    heading: "Operating Availability Heatmap",
    detectorKeys: ["operations.closed_share"],
  },
  {
    id: "funnel",
    navLabel: "Funnel",
    heading: "Conversion Funnel Performance",
    detectorKeys: ["funnel.stage_conversion"],
  },
  {
    id: "retention",
    navLabel: "Retention",
    heading: "Customer Mix & Retention",
    detectorKeys: ["customer.new_share"],
  },
  {
    id: "money",
    navLabel: "Money",
    heading: "Marketplace money audit",
    // No longer deferred. Keeta's order export writes the commission a
    // marketplace charged and its billing report writes the rest of the bill,
    // so two detectors can answer here from evidence rather than from a
    // configured rate. Both are listed: the narrower one is correct and, read
    // alone, misleading -- commission is about half of what a marketplace
    // charges, and a chapter showing only that would let an operator price
    // against half a cost.
    detectorKeys: ["economics.commission_share", "economics.channel_cost_load"],
  },
  {
    id: "items",
    navLabel: "Items",
    heading: "Catalogue performance",
    detectorKeys: [],
    deferredReason:
      "Item revenue and item margin need per-item sales and trusted item costs. Neither is recorded today, and item profit without a cost is a guess.",
  },
  {
    id: "promotions",
    navLabel: "Promotions",
    heading: "Promotion funding and dilution",
    detectorKeys: [],
    deferredReason:
      "Promotion funding, subsidy, and cost per order need discount inputs no approved report writes. Incremental return also needs a registered baseline, which does not exist yet.",
  },
  {
    id: "customer-voice",
    navLabel: "Customer Voice",
    heading: "Sentiment and voice",
    detectorKeys: [],
    deferredReason:
      "Ratings, reviews, and complaint themes need a review export the platform does not yet import.",
  },
  {
    id: "recommendations",
    navLabel: "Recommendations",
    heading: "Recommendations",
    detectorKeys: [],
    deferredReason:
      "A recommendation is a written explanation over findings, and it may only be written once those findings have been checked in practice. The findings this workspace does hold are shown in Summary and in Reports and evidence context, without narration, which is the fallback the specification requires.",
  },
  {
    id: "trust",
    navLabel: "Reports & Trust",
    heading: "Reports and evidence context",
    detectorKeys: ["evidence.period_coverage", "evidence.reconciliation_blocked"],
  },
];

/** The headline for one deterministic outcome. */
export function findingHeadline(code: string): string {
  switch (code) {
    case "PERIOD_COVERAGE_COMPLETE":
      return "Every period in this window carries governed evidence";
    case "PERIOD_COVERAGE_INCOMPLETE":
      return "Some periods in this window carry no governed evidence";
    case "PERIOD_COVERAGE_UNAVAILABLE":
      return "Coverage cannot be reported for this window";
    case "NO_EVIDENCE_HELD":
      return "No evidence is waiting on a decision";
    case "EVIDENCE_HELD_FOR_DECISION":
      return "Evidence is waiting on your decision";
    case "REVENUE_PERIOD_MOVEMENT_UP":
      return "Gross revenue rose against the period before";
    case "REVENUE_PERIOD_MOVEMENT_DOWN":
      return "Gross revenue fell against the period before";
    case "REVENUE_PERIOD_MOVEMENT_FLAT":
      return "Gross revenue held level against the period before";
    case "REVENUE_PERIOD_MOVEMENT_UNAVAILABLE":
      return "No period-over-period comparison is available";
    case "CHANNEL_REVENUE_SHARE":
      return "Share of gross revenue across channels";
    case "CHANNEL_REVENUE_SHARE_UNAVAILABLE":
      return "No cross-channel share is available";
    case "FUNNEL_STAGE_CONVERSION":
      return "Conversion between consecutive reported funnel stages";
    case "FUNNEL_STAGE_CONVERSION_END_TO_END":
      return "From impression to placed order";
    case "FUNNEL_STAGE_CONVERSION_UNAVAILABLE":
      return "The funnel cannot be reported for this window";
    case "ORDER_CANCELLATION_LOSS":
      return "Avoidable cancellations, with the provider's own rejection loss";
    case "ORDER_CANCELLATION_REASON":
      return "Avoidable cancellations, by the provider's own reason";
    case "ORDER_CANCELLATION_LOSS_UNAVAILABLE":
      return "Cancellation loss cannot be reported for this window";
    case "OPERATIONS_CLOSED_SHARE":
      return "Share of scheduled minutes this channel reported closed";
    case "OPERATIONS_CLOSED_DAYS":
      return "Closed days recorded, by the provider's own reason";
    case "OPERATIONS_CLOSED_SHARE_UNAVAILABLE":
      return "Closed time cannot be reported for this window";
    case "CUSTOMER_REPEAT_SHARE":
      return "Share of orders from returning customers";
    case "CUSTOMER_NEW_SHARE_UNAVAILABLE":
      return "Customer mix cannot be reported for this window";
    case "COMMISSION_SHARE_OF_REVENUE":
      return "Commission charged, against the revenue it was charged on";
    case "COMMISSION_SHARE_UNAVAILABLE":
      return "The commission rate cannot be reported for this window";
    case "CHANNEL_COST_LOAD_OF_REVENUE":
      return "Every deduction this marketplace made, against the revenue it was charged on";
    case "CHANNEL_COST_LOAD_UNAVAILABLE":
      return "What this channel costs cannot be reported for this window";
    default:
      return code;
  }
}

/** Why a detector could not answer. Always the evidence, never a workaround. */
export function needsDataSentence(reason: string): string {
  switch (reason) {
    case "WINDOW_CONTAINS_NO_PERIOD":
      return "This window is shorter than one whole period at the grain that was analysed, so there is no period to report on.";
    case "NO_GOVERNED_EVIDENCE_IN_WINDOW":
      return "No approved report has written evidence for these days yet.";
    case "EVIDENCE_AT_DIFFERENT_GRAIN":
      return "Evidence for these days exists, but it is recorded at a different period length than the one analysed. It was not reshaped to fit, because splitting or merging a recorded figure would invent the split. Analyse this window at the period length the evidence was written at.";
    case "INSUFFICIENT_COMPARABLE_PERIODS":
      return "Fewer than two comparable periods carry evidence, and a movement needs two.";
    case "INCOMPARABLE_PERIODS":
      return "The periods in this window come from more than one grain, branch, channel, or recorded timezone, and those cannot be compared with each other.";
    case "PRIOR_PERIOD_ABSENT":
      return "The period immediately before the most recent one carries no evidence. Reaching further back would compare across days nobody measured.";
    case "MIXED_CURRENCY":
      return "The evidence carries more than one currency. Converting between them would need an exchange rate the platform does not hold, so nothing is converted.";
    case "CURRENCY_UNAVAILABLE":
      return "The evidence carries no currency, so no money figure can be stated.";
    case "MIXED_TIMEZONE":
      return "The evidence was bucketed in more than one timezone, so its periods do not line up with each other.";
    case "SINGLE_CHANNEL_IN_WINDOW":
      return "Only one channel reported in this window. A share of one tells you nothing you did not already know.";
    case "WINDOW_TOTAL_IS_ZERO":
      return "The total across every channel is zero, so no share is defined.";
    case "IMPRESSION_SERIES_ABSENT":
      return "No approved report has written impression figures for these days, so even the top of the funnel is undefined.";
    case "STAGE_SERIES_ABSENT":
      return "One of the two stages this pair converts between carries no figures in this window. Nothing is filled in, because a missing step that read as a complete funnel would be worse than no funnel.";
    case "CANCELLATION_LOSS_SERIES_ABSENT":
      return "No approved report has written the cancellation or rejection-loss figures these days need, so neither a count nor a provider-stated loss can be reported.";
    case "CLOSED_SHARE_SERIES_ABSENT":
      return "No approved report has written the closed-minute or scheduled-minute figures these days need, so no share of scheduled time can be reported.";
    case "CUSTOMER_MIX_SERIES_ABSENT":
      return "No approved report has written the new-order or returning-order figures these days need, so no customer mix can be reported.";
    case "CUSTOMER_ORDER_TOTAL_IS_ZERO":
      return "Every order count in this window is zero, so no share of customers is defined. Zero percent would read as nobody coming back over what is really nobody ordering.";
    case "COMMISSION_SERIES_ABSENT":
      return "No approved report has written what this marketplace charged for these days, so no rate can be stated.";
    case "COST_SERIES_ABSENT":
      return "No approved report has written any cost this marketplace charged for these days. A channel with no recorded cost is not a free channel, only an unmeasured one.";
    case "REVENUE_SERIES_ABSENT":
      return "No approved report has written revenue for these days, so there is nothing for a cost to be a share of.";
    case "NO_SHARED_PERIOD":
      return "The cost figures and the revenue figures cover different days, and none overlap. Dividing one by the other would report a rate for days nobody measured both sides of.";
    case "REVENUE_NOT_POSITIVE":
      return "Revenue over the days carrying both figures is zero, so a share of it is undefined rather than zero.";
    default:
      return reason;
  }
}

export const SEVERITY_TONE: Readonly<Record<DetectorSeverity, "danger" | "warning" | "neutral">> = {
  critical: "danger",
  high: "danger",
  medium: "warning",
  low: "neutral",
};

export const KIND_LABEL: Readonly<Record<FindingKind, string>> = {
  observation: "Observation",
  finding: "Finding",
  needs_data: "Needs data",
};

// ---------------------------------------------------------------------------
// Verdict band
// ---------------------------------------------------------------------------

/**
 * The words the verdict band leads with.
 *
 * A verdict here is a band of English chosen from stored values, never a
 * conclusion computed from them: the only operations these functions perform
 * are equality checks that decide which sentence to say. No figure is ever
 * written into one, because a number rendered by prose would be an uncited
 * second copy of a figure that already exists in a cited finding -- and
 * formatting minor units into currency would itself be arithmetic. The UI
 * renders the figures beside the words; this file only chooses the words.
 *
 * A null input means the platform has no stored answer, and each null is met
 * with wording that says exactly what is missing. An em-dash with a reason is
 * how the rest of the page treats absence, and the verdict band does not get
 * to be vaguer than the page it leads.
 */

/** Coverage as stored on a period-coverage finding, or null when none ran. */
export type VerdictCoverage = {
  expectedPeriods: number;
  observedPeriods: number;
};

export type VerdictView = {
  /** The sentence the band opens with. */
  headlineSentence: string;
  /** Short factual statements, one per input, naming the fact or the gap. */
  badges: readonly string[];
  /**
   * The deterministic split the band's scale draws, or nulls where a side
   * cannot be stated. `potential` is the window's gross revenue, `lost` is the
   * provider's own rejection loss, and `earned` is potential minus lost -- each
   * carried so the page can render the figures beside the sentence rather than
   * folding a number into prose.
   */
  verdictFigures: {
    earned: { minorUnits: number; currency: string } | null;
    lost: { minorUnits: number; currency: string } | null;
    potential: { minorUnits: number; currency: string } | null;
  };
};

export function buildVerdictView(input: {
  grossMoney: { minorUnits: number; currency: string } | null;
  movement: "up" | "down" | "flat" | null;
  coverage: VerdictCoverage | null;
  earnedLostPotential?: {
    potential: { minorUnits: number; currency: string } | null;
    lost: { minorUnits: number; currency: string } | null;
    earned: { minorUnits: number; currency: string } | null;
  };
}): VerdictView {
  // Trust gates everything else, mirroring why `evidence.period_coverage`
  // ships before every other detector: a trend over fourteen of thirty-one
  // days is a coincidence wearing a trend's clothes, and the band says so
  // before it says anything directional.
  const coverageIncomplete =
    input.coverage !== null && input.coverage.observedPeriods < input.coverage.expectedPeriods;

  // The design's headline is a statement about cancellations, so it is told
  // only when both sides of the split are actually stated. Otherwise the band
  // falls back to the plain chronicle of what the evidence supports.
  const split = input.earnedLostPotential;
  const splitStated =
    split !== undefined && split.earned !== null && split.lost !== null && split.potential !== null;

  let headlineSentence: string;
  if (splitStated) {
    headlineSentence = "You earned and lost revenue to cancellations you could have prevented.";
  } else if (coverageIncomplete) {
    headlineSentence =
      "Read this window's figures with care: some of its periods carry no governed evidence.";
  } else if (input.movement === "down") {
    headlineSentence = "Gross revenue fell against the period before.";
  } else if (input.movement === "up") {
    headlineSentence = "Gross revenue rose against the period before.";
  } else if (input.movement === "flat") {
    headlineSentence = "Gross revenue held level against the period before.";
  } else if (input.grossMoney !== null) {
    headlineSentence = "This window reports gross revenue, but not enough else to characterise it.";
  } else {
    headlineSentence = "There is not enough governed evidence to characterise this window yet.";
  }

  return {
    headlineSentence,
    badges: [
      input.grossMoney !== null
        ? "Gross revenue is reported for this window."
        : "No gross figure is available for this window yet.",
      input.movement === "up"
        ? "Gross revenue rose against the period before."
        : input.movement === "down"
          ? "Gross revenue fell against the period before."
          : input.movement === "flat"
            ? "Gross revenue held level against the period before."
            : "No period-over-period comparison is available yet.",
      input.coverage === null
        ? "Evidence coverage has not been reported for this window."
        : input.coverage.observedPeriods < input.coverage.expectedPeriods
          ? "Some periods in this window carry no governed evidence."
          : "Every period in this window carries governed evidence.",
    ],
    verdictFigures: {
      earned: split?.earned ?? null,
      lost: split?.lost ?? null,
      potential: split?.potential ?? null,
    },
  };
}
