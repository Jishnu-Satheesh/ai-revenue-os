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
 * So the phase is derived from the saved records of the two gates — the
 * proposal/version approval that authorizes preparation, and the launch
 * approval that authorizes publication — rather than from the state column.
 *
 * The rule that matters most here: a signal that could not be read is reported
 * as undetermined, never as zero. "No deliverables have been approved" and "we
 * could not read the deliverables" look identical in a count and mean opposite
 * things. The first is a reason to go and review; the second is a reason to
 * distrust the whole panel.
 */

export const CAMPAIGN_PHASES = [
  "drafting",
  "awaiting_review",
  "preparing_creative",
  "awaiting_publication",
  "publishing",
  "settled",
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
  /** Which tab of the detail workspace the action lives on. */
  tab: "overview" | "creative" | "publishing" | "results" | "activity";
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
  drafting: "Drafting",
  awaiting_review: "Awaiting review",
  preparing_creative: "Preparing creative",
  awaiting_publication: "Awaiting publication",
  publishing: "Publishing",
  settled: "Settled",
  stopped: "Stopped",
};

/** States that mean this campaign is not going anywhere without intervention. */
const STOPPED_STATES: ReadonlySet<CampaignState> = new Set([
  "cancelled",
  "failed",
  "blocked",
]);

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
      phase: "settled",
      label: PHASE_LABEL.settled,
      summary: "This campaign ran and its result has been measured.",
      undetermined,
      facts: [
        { label: "Settled", value: input.settledAt },
        ...tally(input.deliverables),
      ],
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
      phase: "drafting",
      label: PHASE_LABEL.drafting,
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
      phase: "awaiting_review",
      label: PHASE_LABEL.awaiting_review,
      summary:
        input.approvalStatus === "none"
          ? "A proposal is ready and nothing authorizes it yet."
          : "Nothing currently authorizes this version. Preparation is on hold until it is approved again.",
      undetermined,
      facts: [{ label: "Approval", value: approvalFact(input.approvalStatus) }],
      nextAction: {
        key: "approve_version",
        label: "Review and approve this version",
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
      phase: "preparing_creative",
      label: PHASE_LABEL.preparing_creative,
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
      phase: "preparing_creative",
      label: PHASE_LABEL.preparing_creative,
      summary: "Every planned output exists. Some have not been reviewed yet.",
      undetermined,
      facts: tally(deliverables),
      nextAction: {
        key: "review_outputs",
        label: "Review the finished outputs",
        detail:
          "Each output is approved on its own exact artwork and words. A later re-render needs reviewing again.",
        permission: "campaign.approve",
        tab: "publishing",
      },
    };
  }

  if (input.launchAuthorized === true) {
    return {
      phase: "publishing",
      label: PHASE_LABEL.publishing,
      summary: "These exact outputs are authorized to publish on the agreed terms.",
      undetermined,
      facts: [...tally(deliverables), { label: "Publication", value: "Authorized" }],
      nextAction: null,
    };
  }

  return {
    phase: "awaiting_publication",
    label: PHASE_LABEL.awaiting_publication,
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
 * The phases, in order, for a strip that shows where this one sits.
 *
 * `stopped` and `settled` are ends rather than steps, so the strip renders the
 * path up to the current phase and marks the ending separately. Showing
 * "Publishing" as a future step for a cancelled campaign would promise
 * something that is not going to happen.
 */
export const PHASE_SEQUENCE: readonly CampaignPhase[] = [
  "drafting",
  "awaiting_review",
  "preparing_creative",
  "awaiting_publication",
  "publishing",
];

export function phaseLabel(phase: CampaignPhase): string {
  return PHASE_LABEL[phase];
}

/**
 * Where this phase sits in the sequence, or `null` for an ending.
 *
 * `null` is not "position zero". A settled campaign is not at the start of
 * anything, and rendering it that way would undo every step it actually took.
 */
export function phasePosition(phase: CampaignPhase): number | null {
  const index = PHASE_SEQUENCE.indexOf(phase);
  return index === -1 ? null : index;
}
