/**
 * Demonstration data for the Campaign Studio.
 *
 * This module exists so the Studio can be shown before its API and execution
 * layers are built. It is deliberately the only source of campaign data in the
 * UI today, so deleting this file and its flag removes every trace of sample
 * content rather than leaving invented values scattered through components.
 *
 * What is represented here is proposal content: creative, copy, schedule,
 * capability state, spend ceilings, and version history. What is deliberately
 * NOT represented is a business result. The approved design contract forbids a
 * fabricated business result, and the product's whole claim is that it will not
 * assert an outcome it cannot evidence. Measurement therefore shows a
 * preregistered plan and a pending verdict, which is the truthful state for a
 * campaign that has not run.
 */

export const CAMPAIGN_DEMO_ENABLED = true;

export type CampaignLifecycle =
  | "draft"
  | "needs_data"
  | "ready_for_review"
  | "approved"
  | "scheduled"
  | "blocked";

export type DemoCampaignSummary = {
  id: string;
  title: string;
  objective: string;
  lifecycle: CampaignLifecycle;
  version: number;
  sourceKind: "decision_opportunity" | "manual_brief";
  sourceLabel: string;
  channels: readonly string[];
  spendCeiling: { amountMinor: number; currency: string } | null;
  updatedAt: string;
  blockerCount: number;
};

export type DemoDirectionKind = "control" | "evidence_led" | "experimental";

export type DemoDirection = {
  id: string;
  kind: DemoDirectionKind;
  label: string;
  generationProfile: "brand_restricted" | "brand_guided" | "full_visual_freedom";
  rationale: string;
  /** What this direction challenges. Empty for the control. */
  hypothesis: string | null;
  imageAlt: string;
  syntheticContent: boolean;
  hook: string;
  caption: string;
  hashtags: readonly string[];
  contentTags: readonly string[];
  callToAction: string;
};

export type DemoChannelAction = {
  id: string;
  channel: string;
  placement: string;
  state: "ready" | "blocked";
  restrictionCode: string | null;
  reason: string | null;
  recovery: string | null;
};

export type DemoAssertion = { key: string; label: string; state: "pass" | "pending" | "fail" };

export type DemoVersionEntry = {
  version: number;
  createdAt: string;
  author: string;
  summary: string;
  materialChanges: readonly string[];
  invalidatedApproval: boolean;
};

export type DemoCampaignDetail = DemoCampaignSummary & {
  hypothesis: string;
  rationale: string;
  digest: string;
  approvalExpiresAt: string;
  dryRun: boolean;
  generationProfile: "brand_restricted" | "brand_guided" | "full_visual_freedom";
  directions: readonly DemoDirection[];
  actions: readonly DemoChannelAction[];
  schedule: { windowLabel: string; timeZone: string; rationale: string; executionMode: string };
  measurement: {
    primaryMetric: string;
    method: string;
    baselineSource: string;
    windowDays: number;
    verdict: "pending";
    limitations: readonly string[];
  };
  assertions: readonly DemoAssertion[];
  versions: readonly DemoVersionEntry[];
};

const CAMPAIGN_ID = "c1000000-0000-4000-8000-000000000001";

export const demoCampaigns: readonly DemoCampaignSummary[] = Object.freeze([
  {
    id: CAMPAIGN_ID,
    title: "Weekday evening demand lift",
    objective: "Raise incremental gross profit on low-occupancy weekday evenings",
    lifecycle: "ready_for_review",
    version: 3,
    sourceKind: "decision_opportunity",
    sourceLabel: "Decision Engine opportunity",
    channels: ["Instagram", "Facebook"],
    spendCeiling: { amountMinor: 450_000, currency: "AED" },
    updatedAt: "2026-08-12T09:40:00.000Z",
    blockerCount: 3,
  },
  {
    id: "c1000000-0000-4000-8000-000000000002",
    title: "New location announcement",
    objective: "Build awareness for the Deira branch opening",
    lifecycle: "needs_data",
    version: 1,
    sourceKind: "manual_brief",
    sourceLabel: "Manual operator brief",
    channels: ["Instagram"],
    spendCeiling: null,
    updatedAt: "2026-08-11T16:05:00.000Z",
    blockerCount: 2,
  },
  {
    id: "c1000000-0000-4000-8000-000000000004",
    title: "Early-week lunch trial",
    objective: "Test whether an early-week offer lifts contribution without discounting peak trade",
    lifecycle: "scheduled",
    version: 2,
    sourceKind: "decision_opportunity",
    sourceLabel: "Decision Engine opportunity",
    channels: ["Instagram"],
    spendCeiling: { amountMinor: 200_000, currency: "AED" },
    updatedAt: "2026-08-10T13:47:00.000Z",
    blockerCount: 1,
  },
  {
    id: "c1000000-0000-4000-8000-000000000003",
    title: "Family bundle re-run",
    objective: "Repeat the strongest performing offer structure from July",
    lifecycle: "draft",
    version: 1,
    sourceKind: "manual_brief",
    sourceLabel: "Manual operator brief",
    channels: ["Instagram", "Facebook"],
    spendCeiling: { amountMinor: 200_000, currency: "AED" },
    updatedAt: "2026-08-10T11:20:00.000Z",
    blockerCount: 3,
  },
]);

export const demoCampaignDetail: DemoCampaignDetail = Object.freeze({
  ...demoCampaigns[0]!,
  hypothesis:
    "Weekday evening occupancy is below the four-week median while weekend demand is stable, so a bounded weekday-only offer should lift covers without discounting peak trade.",
  rationale:
    "Selected from one Decision Engine opportunity. Value was computed from the organization's own channel economics at a complete completeness grade, not from a generic benchmark.",
  digest: "sha256:82c4f1e944a7d0",
  approvalExpiresAt: "2026-08-14T19:59:00.000Z",
  dryRun: true,
  generationProfile: "brand_guided",
  directions: Object.freeze([
    Object.freeze({
      id: "d-control",
      kind: "control",
      label: "Control",
      generationProfile: "brand_restricted",
      rationale:
        "The organization's established layout, palette, and tone. This is the baseline every other direction is measured against.",
      hypothesis: null,
      imageAlt:
        "Plated evening meal on a dark table, styled in the organization's approved palette",
      syntheticContent: true,
      hook: "Weekday evenings, made easier.",
      caption:
        "The weekday evening set is available Tuesday to Thursday, 17:30–20:00, for dine-in and takeaway at both branches.",
      hashtags: Object.freeze(["#WeekdayEvenings", "#JLTDining", "#DubaiEats"]),
      contentTags: Object.freeze(["offer:weekday-set", "segment:local-residents"]),
      callToAction: "Order now",
    }),
    Object.freeze({
      id: "d-evidence",
      kind: "evidence_led",
      label: "Evidence-led",
      generationProfile: "brand_guided",
      rationale:
        "Leads with the specific time window, because weekday evening searches concentrate between 16:00 and 18:00 in the organization's own observed traffic.",
      hypothesis:
        "Naming the exact window converts better than a general offer, because the constraint is timing rather than price.",
      imageAlt: "Table set for a family of four with a visible clock showing early evening",
      syntheticContent: true,
      hook: "Home by six? Dinner is handled.",
      caption:
        "Tuesday to Thursday, 17:30–20:00. The weekday evening set is ready when you are, for dine-in or takeaway at JLT and Marina.",
      hashtags: Object.freeze(["#WeekdayEvenings", "#EarlyDinner", "#JLTDining"]),
      contentTags: Object.freeze(["offer:weekday-set", "segment:commuters"]),
      callToAction: "Reserve a table",
    }),
    Object.freeze({
      id: "d-experimental",
      kind: "experimental",
      label: "Experimental",
      generationProfile: "full_visual_freedom",
      rationale:
        "Departs from the established composition to test whether an abstract treatment earns more attention in a crowded feed.",
      hypothesis:
        "Challenges the assumption that food photography outperforms graphic treatment for a time-bound offer.",
      imageAlt: "Abstract graphic composition of an hourglass formed from tableware",
      syntheticContent: true,
      hook: "The hour that usually goes to waste.",
      caption:
        "Between leaving work and getting home, there is an hour nobody plans for. Tuesday to Thursday, 17:30–20:00, we planned it for you.",
      hashtags: Object.freeze(["#WeekdayEvenings", "#DubaiEats"]),
      contentTags: Object.freeze(["offer:weekday-set", "experiment:visual-metaphor"]),
      callToAction: "Order now",
    }),
  ]),
  actions: Object.freeze([
    Object.freeze({
      id: "a-ig-feed",
      channel: "Instagram",
      placement: "Feed image",
      state: "blocked",
      restrictionCode: "meta.instagram_feed_image_blocked",
      reason:
        "No verified size, copy, or hashtag limits exist for this placement, and no duplicate-safe recovery has been proven after a timed-out send.",
      recovery: "Complete controlled-account verification for Instagram publishing.",
    }),
    Object.freeze({
      id: "a-ig-story",
      channel: "Instagram",
      placement: "Image story",
      state: "blocked",
      restrictionCode: "meta.instagram_image_story_blocked",
      reason: "The story placement has no verified contract on the controlled account.",
      recovery: "Complete controlled-account verification for Instagram publishing.",
    }),
    Object.freeze({
      id: "a-fb-feed",
      channel: "Facebook",
      placement: "Feed image",
      state: "blocked",
      restrictionCode: "meta.facebook_feed_image_blocked",
      reason: "Page image publishing has no proven limits on the controlled account.",
      recovery: "Complete controlled-account verification for Facebook publishing.",
    }),
  ]),
  schedule: Object.freeze({
    windowLabel: "Tue 12 Aug, 17:45",
    timeZone: "Asia/Dubai",
    rationale:
      "Targets the hour before the observed weekday evening peak, inside the organization's registered trading hours.",
    executionMode: "Best effort",
  }),
  measurement: Object.freeze({
    primaryMetric: "Incremental gross profit",
    method: "Reconciliation against a preregistered baseline",
    baselineSource: "Channel economics ledger, four-week weekday median",
    windowDays: 7,
    // Never a number. A campaign that has not run has no result, and inventing
    // one is precisely the claim this product refuses to make.
    verdict: "pending",
    limitations: Object.freeze([
      "Observational design: no randomised control is available for static brand creative.",
      "A verdict requires provider receipts and exposure evidence, neither of which exists before execution.",
    ]),
  }),
  assertions: Object.freeze<DemoAssertion[]>([
    { key: "budget_available", label: "Spend ceiling within configured budget", state: "pass" },
    { key: "inputs_fresh", label: "Inputs within freshness bound", state: "pass" },
    { key: "margin_floor", label: "Margin floor not breached", state: "pass" },
    { key: "capability_granted", label: "Provider capabilities granted", state: "fail" },
    { key: "tracking_ready", label: "Conversion tracking ready", state: "pending" },
  ]),
  versions: Object.freeze([
    {
      version: 3,
      createdAt: "2026-08-12T09:40:00.000Z",
      author: "Agency operator",
      summary: "Revised hashtag set and tightened the evidence-led caption",
      materialChanges: Object.freeze([
        "Hashtags changed on the evidence-led direction",
        "Spend ceiling raised to AED 4,500.00",
      ]),
      invalidatedApproval: true,
    },
    {
      version: 2,
      createdAt: "2026-08-11T18:12:00.000Z",
      author: "Agency operator",
      summary: "Switched generation profile from Brand restricted to Brand guided",
      materialChanges: Object.freeze(["Generation profile changed"]),
      invalidatedApproval: true,
    },
    {
      version: 1,
      createdAt: "2026-08-11T15:02:00.000Z",
      author: "Decision Engine",
      summary: "Initial bundle compiled from the selected opportunity",
      materialChanges: Object.freeze([]),
      invalidatedApproval: false,
    },
  ]),
});

/**
 * A campaign that has been approved and is mid-flight.
 *
 * The verdict is `execution_only`, which is one of the four honest conclusions
 * the measurement design allows: provider activity is verified, but no
 * qualified business outcome is available yet because the outcome window has
 * not closed. That is the truthful state, and it demonstrates the thing worth
 * demonstrating — the system saying what it cannot yet claim.
 */
export type DemoReceipt = {
  id: string;
  channel: string;
  placement: string;
  state: "published" | "provider_pending" | "reconciled" | "blocked";
  externalReference: string | null;
  publishedAt: string | null;
  detail: string;
};

export type DemoSpendLine = { label: string; amountMinor: number; currency: string };

export type DemoExecutionCampaign = {
  id: string;
  title: string;
  version: number;
  digest: string;
  approvedAt: string;
  approvedBy: string;
  timeZone: string;
  receipts: readonly DemoReceipt[];
  spend: {
    approved: DemoSpendLine;
    reserved: DemoSpendLine;
    providerReported: DemoSpendLine;
    settled: DemoSpendLine | null;
  };
  exposures: { recorded: number; source: string };
  measurement: {
    primaryMetric: string;
    method: string;
    baselineSource: string;
    windowDays: number;
    windowClosesAt: string;
    verdict: "execution_only";
    verdictExplanation: string;
    limitations: readonly string[];
  };
  guardrails: readonly { label: string; state: "holding" | "breached" }[];
  learningProposal: {
    observation: string;
    limitation: string;
    suggestedNextTest: string;
    status: "campaign_scoped";
  };
};

export const demoExecutionCampaign: DemoExecutionCampaign = Object.freeze({
  id: "c1000000-0000-4000-8000-000000000004",
  title: "Early-week lunch trial",
  version: 2,
  digest: "sha256:0b71ac93e2f5c8",
  approvedAt: "2026-08-09T10:15:00.000Z",
  approvedBy: "Agency operator",
  timeZone: "Asia/Dubai",
  receipts: Object.freeze([
    Object.freeze({
      id: "r-1",
      channel: "Instagram",
      placement: "Feed image",
      state: "reconciled",
      externalReference: "ig_media_17…4821",
      publishedAt: "2026-08-10T13:45:00.000Z",
      detail: "Provider confirmed the post and the reference was reconciled against the request.",
    }),
    Object.freeze({
      id: "r-2",
      channel: "Instagram",
      placement: "Image story",
      state: "published",
      externalReference: "ig_media_17…4822",
      publishedAt: "2026-08-10T13:47:00.000Z",
      detail:
        "Published. Awaiting the reconciliation sweep that confirms no duplicate was created.",
    }),
    Object.freeze({
      id: "r-3",
      channel: "Facebook",
      placement: "Feed image",
      state: "blocked",
      externalReference: null,
      publishedAt: null,
      detail:
        "Optional action, blocked at preflight. Execution mode is best effort, so the ready actions still ran.",
    }),
  ]),
  spend: Object.freeze({
    approved: { label: "Approved ceiling", amountMinor: 200_000, currency: "AED" },
    reserved: { label: "Reserved at claim", amountMinor: 200_000, currency: "AED" },
    providerReported: { label: "Provider reported", amountMinor: 138_400, currency: "AED" },
    settled: null,
  }),
  exposures: Object.freeze({
    recorded: 2,
    source: "Provider receipts, one exposure record per confirmed action",
  }),
  measurement: Object.freeze({
    primaryMetric: "Incremental gross profit",
    method: "Reconciliation against a preregistered baseline",
    baselineSource: "Channel economics ledger, four-week early-week median",
    windowDays: 7,
    windowClosesAt: "2026-08-17T13:45:00.000Z",
    verdict: "execution_only",
    verdictExplanation:
      "Provider activity is verified, but the outcome window has not closed and settled spend has not arrived. No incremental result can be claimed yet.",
    limitations: Object.freeze([
      "Observational design: no randomised control is available for static brand creative.",
      "Provider-reported spend is not final until the account settles.",
      "One optional channel did not run, so reach is not comparable to the full approved plan.",
    ]),
  }),
  guardrails: Object.freeze<DemoExecutionCampaign["guardrails"][number][]>([
    { label: "Spend within approved ceiling", state: "holding" },
    { label: "Margin floor not breached", state: "holding" },
  ]),
  learningProposal: Object.freeze({
    observation:
      "The evidence-led direction was the only one dispatched, so no comparison between directions is available from this run.",
    limitation:
      "A single campaign cannot separate the creative direction from the timing change made in the same version.",
    suggestedNextTest:
      "Hold the schedule fixed and vary only the direction, so the two effects are not confounded.",
    status: "campaign_scoped",
  }),
});

export function findDemoCampaign(campaignId: string): DemoCampaignDetail | null {
  return campaignId === demoCampaignDetail.id ? demoCampaignDetail : null;
}

export function findDemoExecution(campaignId: string): DemoExecutionCampaign | null {
  return campaignId === demoExecutionCampaign.id ? demoExecutionCampaign : null;
}

export function formatMinor(money: { amountMinor: number; currency: string } | null): string {
  if (!money) return "Not set";
  return `${money.currency} ${(money.amountMinor / 100).toLocaleString("en-AE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
