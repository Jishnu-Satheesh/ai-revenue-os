import type { CampaignState } from "@/domain/campaigns/state-machine";

/**
 * Where a campaign actually stands, and what the next real move is.
 *
 * The database state alone does not answer this. `approved` is one word that
 * covers three very different situations: creative not made yet, creative made
 * but not reviewed, and reviewed but not authorized to publish. An operator
 * looking at the word "approved" cannot tell which of those they are in, and
 * the difference is the difference between waiting and being blocked.
 *
 * So the phase is derived from the saved records of the two gates — the version
 * approval that authorizes preparation, and the launch approval that authorizes
 * publication — rather than from the state column.
 *
 * The names are the ones the visual contract uses, because they are the words
 * the client sees: Proposal, Creating, Review, Scheduled / Live, Results &
 * learning. Both gates live inside Review: reviewing each finished output and
 * authorizing the set to publish are two acts of the same stage, and the next
 * action is what tells them apart.
 *
 * The rule that matters most here: a signal that could not be read is reported
 * as undetermined, never as zero. "No deliverables have been approved" and "we
 * could not read the deliverables" look identical in a count and mean opposite
 * things. The first is a reason to go and review; the second is a reason to
 * distrust the whole panel.
 */

export const CAMPAIGN_PHASES = [
  "proposal",
  "creating",
  "review",
  "scheduled_live",
  "results",
  "stopped",
] as const;

export type CampaignPhase = (typeof CAMPAIGN_PHASES)[number];

/** The approval statuses the studio view already distinguishes. */
export type PhaseApprovalStatus =
  | "none"
  | "live"
  | "expired"
  | "superseded"
  | "digest_mismatch"
  | "revoked";

/**
 * What exists among the finished outputs.
 *
 * `planned` comes from the approved bundle, the rest from saved deliverable
 * records. All four are counts of things that exist; none is an estimate.
 */
export type DeliverableTally = {
  planned: number;
  produced: number;
  approved: number;
  rejected: number;
};

export type CampaignPhaseInput = {
  state: CampaignState;
  /** Whether any bundle version exists at all. */
  hasVersion: boolean;
  approvalStatus: PhaseApprovalStatus;
  /** `null` when deliverable records could not be read — never an empty tally. */
  deliverables: DeliverableTally | null;
  /** `null` when launch authority could not be read. */
  launchAuthorized: boolean | null;
  /** When the outcome settled, if it has. */
  settledAt: string | null;
};

/** A signal the panel asked for and did not get. Named so it can be said aloud. */
export type UndeterminedSignal = "deliverables" | "launch";

export type PhaseFact = {
  label: string;
  /** `null` renders as the missing-value treatment, never as a zero or a dash. */
  value: string | null;
  /** True when the value is absent because it could not be read. */
  undetermined?: boolean;
};

/** Which tab of the detail workspace an action lives on. */
export type CampaignDetailTab = "overview" | "creative" | "publishing" | "results" | "activity";

/**
 * The one thing worth doing next, and who may do it.
 *
 * `permission` travels with the action so the interface can show a viewer what
 * is waiting without offering them a button that will refuse them. Telling
 * somebody "this needs an owner's approval" is useful; letting them press a
 * button that fails is not.
 */
export type PhaseNextAction = {
  key: string;
  label: string;
  detail: string;
  /** The capability required. Checked again server-side; this is for honesty. */
  permission: "campaign.edit" | "campaign.approve" | "campaign.publish" | "campaign.create";
  tab: CampaignDetailTab;
};

export type CampaignPhaseVerdict = {
  phase: CampaignPhase;
  label: string;
  /** One sentence stating where this stands, in the operator's terms. */
  summary: string;
  /** Signals that could not be read. Non-empty means the panel is incomplete. */
  undetermined: readonly UndeterminedSignal[];
  facts: readonly PhaseFact[];
  /** `null` when there is genuinely nothing to do, which is a real answer. */
  nextAction: PhaseNextAction | null;
};

const PHASE_LABEL: Readonly<Record<CampaignPhase, string>> = {
  proposal: "Proposal",
  creating: "Creating",
  review: "Review",
  scheduled_live: "Scheduled / Live",
  results: "Results & learning",
  stopped: "Stopped",
};

/** The short label a portfolio card shows. "Results & learning" is too long there. */
const PHASE_BADGE: Readonly<Record<CampaignPhase, string>> = {
  proposal: "Needs review",
  creating: "Preparing",
  review: "Needs review",
  scheduled_live: "Live",
  results: "Completed",
  stopped: "Stopped",
};

/** States that mean this campaign is not going anywhere without intervention. */
const STOPPED_STATES: ReadonlySet<CampaignState> = new Set(["cancelled", "failed", "blocked"]);

/**
 * Whether an approval currently authorizes anything.
 *
 * Everything that is not `live` is treated the same way here on purpose: an
 * expired, revoked, superseded or mismatched approval all authorize exactly
 * nothing. They differ in what the operator should do about it, which is the
 * next action's job to say, not the phase's.
 */
function authorizes(status: PhaseApprovalStatus): boolean {
  return status === "live";
}

function tally(deliverables: DeliverableTally | null): readonly PhaseFact[] {
  if (deliverables === null) {
    // Deliberately not "0 of 0". A count nobody could read is not a count.
    return [
      { label: "Finished outputs", value: null, undetermined: true },
      { label: "Reviewed", value: null, undetermined: true },
    ];
  }

  return [
    {
      label: "Finished outputs",
      value: `${deliverables.produced} of ${deliverables.planned} planned`,
    },
    {
      label: "Reviewed",
      value:
        deliverables.rejected > 0
          ? `${deliverables.approved} approved, ${deliverables.rejected} rejected`
          : `${deliverables.approved} of ${deliverables.produced} produced`,
    },
  ];
}

/** Why an approval authorizes nothing, in words an operator can act on. */
function approvalFact(status: PhaseApprovalStatus): string {
  switch (status) {
    case "none":
      return "Not approved";
    case "live":
      return "Live";
    case "expired":
      return "Expired";
    case "superseded":
      return "Superseded by a newer version";
    case "digest_mismatch":
      return "Does not match this version";
    case "revoked":
      return "Revoked";
  }
}

/**
 * The phase, its facts and the next move, from saved records only.
 *
 * Order matters. A stopped campaign is stopped whatever else is true of it, and
 * a settled one keeps its result even after its approval lapses — history stays
 * readable when authority ends, which is what C09 requires of a rollback.
 */
export function campaignPhase(input: CampaignPhaseInput): CampaignPhaseVerdict {
  const undetermined: UndeterminedSignal[] = [];
  if (input.deliverables === null) undetermined.push("deliverables");
  if (input.launchAuthorized === null) undetermined.push("launch");

  // A settled result outranks everything except being stopped. The campaign ran;
  // whether its approval is still live says nothing about what it achieved.
  if (input.settledAt !== null) {
    return {
      phase: "results",
      label: PHASE_LABEL.results,
      summary: "This campaign ran and its result has been measured.",
      undetermined,
      facts: [{ label: "Settled", value: input.settledAt }, ...tally(input.deliverables)],
      nextAction: null,
    };
  }

  if (STOPPED_STATES.has(input.state)) {
    return {
      phase: "stopped",
      label: PHASE_LABEL.stopped,
      summary:
        input.state === "blocked"
          ? "Something is blocking this campaign. It will not progress until that is cleared."
          : "This campaign was stopped before it ran.",
      undetermined,
      facts: [{ label: "State", value: input.state.replace(/_/g, " ") }],
      // Not invented. A stopped campaign's recovery depends on why it stopped,
      // and guessing a next step here would send an operator somewhere useless.
      nextAction: null,
    };
  }

  if (!input.hasVersion) {
    return {
      phase: "proposal",
      label: PHASE_LABEL.proposal,
      summary: "No proposal has been generated yet, so there is nothing to review.",
      undetermined,
      facts: [{ label: "Proposal", value: "Not generated" }],
      nextAction: {
        key: "generate",
        label: "Generate the proposal",
        detail: "Builds the first version from this campaign's brief or opportunity.",
        permission: "campaign.create",
        tab: "overview",
      },
    };
  }

  if (!authorizes(input.approvalStatus)) {
    return {
      phase: "proposal",
      label: PHASE_LABEL.proposal,
      summary:
        input.approvalStatus === "none"
          ? "A proposal is ready and nothing authorizes it yet."
          : "Nothing currently authorizes this version. Preparation is on hold until it is approved again.",
      undetermined,
      facts: [{ label: "Approval", value: approvalFact(input.approvalStatus) }],
      nextAction: {
        key: "approve_version",
        label: "Review the proposal",
        detail:
          "Authorizes creative to be prepared inside this version's limits. It does not publish anything.",
        permission: "campaign.approve",
        tab: "creative",
      },
    };
  }

  // From here the version approval is live: preparation is authorized. What
  // remains is whether the outputs exist, have been reviewed, and have been
  // authorized to go out — the second gate.
  const deliverables = input.deliverables;

  if (deliverables === null || deliverables.produced < deliverables.planned) {
    return {
      phase: "creating",
      label: PHASE_LABEL.creating,
      summary:
        deliverables === null
          ? "Creative is authorized. How much of it exists could not be read."
          : "Creative is authorized and is still being produced.",
      undetermined,
      facts: tally(deliverables),
      nextAction: null,
    };
  }

  if (deliverables.approved < deliverables.produced) {
    return {
      phase: "review",
      label: PHASE_LABEL.review,
      summary: "Every planned output exists. Some have not been reviewed yet.",
      undetermined,
      facts: tally(deliverables),
      nextAction: {
        key: "review_outputs",
        label:
          deliverables.produced - deliverables.approved === 1
            ? "Review 1 creative"
            : `Review ${deliverables.produced - deliverables.approved} creatives`,
        detail:
          "Each output is approved on its own exact artwork and words. A later re-render needs reviewing again.",
        permission: "campaign.approve",
        tab: "creative",
      },
    };
  }

  if (input.launchAuthorized === true) {
    return {
      phase: "scheduled_live",
      label: PHASE_LABEL.scheduled_live,
      summary: "These exact outputs are authorized to publish on the agreed terms.",
      undetermined,
      facts: [...tally(deliverables), { label: "Publication", value: "Authorized" }],
      nextAction: null,
    };
  }

  return {
    phase: "review",
    label: PHASE_LABEL.review,
    summary:
      input.launchAuthorized === null
        ? "Every output is reviewed. Whether publication is authorized could not be read."
        : "Every output is reviewed and nothing is authorized to publish yet.",
    undetermined,
    facts: [
      ...tally(deliverables),
      input.launchAuthorized === null
        ? { label: "Publication", value: null, undetermined: true }
        : { label: "Publication", value: "Not authorized" },
    ],
    nextAction:
      input.launchAuthorized === null
        ? null
        : {
            key: "authorize_launch",
            label: "Authorize publication",
            detail:
              "Binds these exact outputs to the accounts, words, schedule and spend they go out with.",
            permission: "campaign.publish",
            tab: "publishing",
          },
  };
}

/**
 * The phase as far as a list can honestly tell.
 *
 * The portfolio does not read deliverable records — one list of twenty
 * campaigns would mean sixty more queries to draw a card. That is a decision
 * not to ask, which is NOT the same as asking and failing, and it must not be
 * reported the same way: running the full derivation here would mark every card
 * "incomplete" and teach operators to ignore a warning that means something
 * real on the detail page.
 *
 * So this claims less. It stops at "creative is authorized and being prepared"
 * and leaves how far along to the detail page, which does read the records.
 */
export function campaignListPhase(input: {
  state: CampaignState;
  hasVersion: boolean;
  approvalStatus: PhaseApprovalStatus;
  settledAt: string | null;
}): CampaignPhaseVerdict {
  if (input.settledAt !== null) {
    return {
      phase: "results",
      label: PHASE_LABEL.results,
      summary: "Ran and measured.",
      undetermined: [],
      facts: [],
      nextAction: null,
    };
  }

  if (STOPPED_STATES.has(input.state)) {
    return {
      phase: "stopped",
      label: PHASE_LABEL.stopped,
      summary:
        input.state === "blocked" ? "Blocked and will not progress." : "Stopped before it ran.",
      undetermined: [],
      facts: [],
      nextAction: null,
    };
  }

  if (!input.hasVersion) {
    return {
      phase: "proposal",
      label: PHASE_LABEL.proposal,
      summary: "No proposal yet.",
      undetermined: [],
      facts: [],
      nextAction: {
        key: "generate",
        label: "Generate the proposal",
        detail: "Builds the first version from this campaign's brief or opportunity.",
        permission: "campaign.create",
        tab: "overview",
      },
    };
  }

  if (!authorizes(input.approvalStatus)) {
    return {
      phase: "proposal",
      label: PHASE_LABEL.proposal,
      summary:
        input.approvalStatus === "none"
          ? "Waiting for review."
          : `Not authorized — ${approvalFact(input.approvalStatus).toLowerCase()}.`,
      undetermined: [],
      facts: [],
      nextAction: {
        key: "approve_version",
        label: "Review proposal",
        detail: "Authorizes creative to be prepared. It does not publish anything.",
        permission: "campaign.approve",
        tab: "creative",
      },
    };
  }

  // Deliberately as far as this goes. Whether the outputs exist, have been
  // reviewed, or may publish is a question only the detail page has asked.
  return {
    phase: "creating",
    label: PHASE_LABEL.creating,
    summary: "Creative is authorized and being prepared.",
    undetermined: [],
    facts: [],
    nextAction: null,
  };
}

/**
 * Whether this campaign is waiting on a person right now.
 *
 * A real count of things needing attention, derived from the same next action
 * the card shows. Not a badge that counts everything unfinished: a campaign
 * whose creative is still rendering is not waiting on anybody.
 */
export function needsAttention(verdict: CampaignPhaseVerdict): boolean {
  return verdict.nextAction !== null;
}

/**
 * The phases, in order, for the strip the visual contract specifies.
 *
 * `stopped` is an end rather than a step, so a stopped campaign gets no
 * position: drawing "Scheduled / Live" as an upcoming step for a cancelled
 * campaign would promise something that is not going to happen.
 */
export const PHASE_SEQUENCE: readonly CampaignPhase[] = [
  "proposal",
  "creating",
  "review",
  "scheduled_live",
  "results",
];

export function phaseLabel(phase: CampaignPhase): string {
  return PHASE_LABEL[phase];
}

/** The short form for a portfolio card's status pill. */
export function phaseBadge(phase: CampaignPhase): string {
  return PHASE_BADGE[phase];
}

/**
 * Where this phase sits in the sequence, or `null` for an ending.
 *
 * `null` is not "position zero". A stopped campaign is not at the start of
 * anything, and rendering it that way would undo every step it actually took.
 */
export function phasePosition(phase: CampaignPhase): number | null {
  const index = PHASE_SEQUENCE.indexOf(phase);
  return index === -1 ? null : index;
}

/**
 * The status groupings the portfolio filter offers.
 *
 * Display groupings over real phases, never a new lifecycle. "Completed" here
 * means a settled outcome exists, not an archive somebody moved a campaign
 * into — introducing an archive through a visual filter is exactly what the
 * visual contract forbids.
 */
export const PORTFOLIO_FILTERS = [
  { key: "all", label: "All" },
  { key: "needs_review", label: "Needs review" },
  { key: "preparing", label: "Preparing" },
  { key: "scheduled", label: "Scheduled" },
  { key: "live", label: "Live" },
  { key: "completed", label: "Completed" },
] as const;

export type PortfolioFilter = (typeof PORTFOLIO_FILTERS)[number]["key"];

/** Whether a phase belongs to a filter grouping. */
export function matchesFilter(phase: CampaignPhase, filter: PortfolioFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "needs_review":
      return phase === "proposal" || phase === "review";
    case "preparing":
      return phase === "creating";
    // Nothing dispatches yet, so "Scheduled" and "Live" both read from the one
    // phase that means authorized-to-publish. They separate when the dispatch
    // records exist to separate them, not before.
    case "scheduled":
    case "live":
      return phase === "scheduled_live";
    case "completed":
      return phase === "results";
  }
}
