import {
  admitProposal,
  campaignProposalDocumentSchema,
  campaignProposalStateSchema,
  campaignProposalSourceKindSchema,
  campaignProposalDecisionKindSchema,
  preparationAuthority,
  type CampaignProposalDecisionKind,
  type CampaignProposalDocument,
  type CampaignProposalSourceKind,
  type CampaignProposalState,
  type PreparationAuthority,
} from "@/domain/campaigns/proposal";

/**
 * What a person can be shown about a proposal, and what they may decide on it.
 *
 * Everything the research machine produces landed in three tables that nothing
 * read. This is the read side of that gap: a pure projection over rows the
 * repository already scoped to one organization. It starts no work, decides
 * nothing, and — the point of putting it here rather than in a component — it
 * is the single place that answers two questions the UI must never guess at:
 *
 *   1. Is there anything to show yet? A proposal is created BEFORE its document
 *      exists, so "researching" is a real state with no content behind it. An
 *      empty card is not an error and must not read as one.
 *   2. May this be decided? The database admits a decision only from
 *      `ready_for_review`, `changes_requested` and `snoozed`, and only against
 *      the current version's exact digest. Offering a control the database will
 *      refuse is worse than offering none.
 *
 * A stored document that no longer satisfies the current schema is reported as
 * unreadable rather than partially rendered. A proposal is an argument for
 * spending money; half of one is not a smaller argument, it is an unreliable
 * one.
 */

export type ProposalRow = {
  id: string;
  sourceKind: string;
  sourceId: string | null;
  state: string;
  currentVersionId: string | null;
  linkedCampaignId: string | null;
  snoozedUntil: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProposalVersionRow = {
  id: string;
  proposalId: string;
  version: number;
  /** Parsed here, never trusted. Stored JSON is not a typed document. */
  document: unknown;
  digest: string;
  createdAt: string;
};

export type ProposalDecisionRow = {
  id: string;
  proposalId: string;
  proposalVersionId: string;
  proposalDigest: string;
  decision: string;
  reason: string | null;
  instructions: string | null;
  snoozedUntil: string | null;
  decidedAt: string;
};

/**
 * The content behind a proposal, as three separate facts rather than one
 * nullable document. "Not written yet" and "written but unreadable" call for
 * different words on screen and different controls, so they are different
 * shapes here.
 */
export type ProposalContent =
  | { kind: "awaiting_research" }
  | { kind: "unreadable" }
  | {
      kind: "document";
      versionId: string;
      versionNumber: number;
      digest: string;
      writtenAt: string;
      document: CampaignProposalDocument;
    };

export type ProposalDecisionView = {
  id: string;
  decision: CampaignProposalDecisionKind;
  reason: string | null;
  instructions: string | null;
  snoozedUntil: string | null;
  decidedAt: string;
  /**
   * Whether this decision still describes the content now on screen. A decision
   * against a superseded digest is history, not standing authority.
   */
  appliesToCurrentContent: boolean;
};

export type CampaignProposalCardView = {
  proposalId: string;
  state: CampaignProposalState;
  sourceKind: CampaignProposalSourceKind;
  createdAt: string;
  updatedAt: string;
  snoozedUntil: string | null;
  linkedCampaignId: string | null;
  content: ProposalContent;
  /** True only where the database would also admit a decision. */
  decidable: boolean;
  /** Newest first. Every decision, because the history is the record. */
  decisions: readonly ProposalDecisionView[];
  lastDecision: ProposalDecisionView | null;
};

export type CampaignProposalReviewView = CampaignProposalCardView & {
  /**
   * What approving this would actually permit. Carried as data so the review
   * surface states the terms rather than paraphrasing them, and so it cannot
   * describe an approval as broader than it is.
   */
  authority: PreparationAuthority | null;
  /** Everything the proposal itself says is missing (D07). */
  declaredGaps: readonly string[];
  /** Set when the proposal may not be put in front of a person at all. */
  refusal: string | null;
};

/**
 * The states the database will accept a decision from.
 *
 * Mirrors the `campaign_proposal_not_decidable` guard in
 * `20260913120000_campaign_proposal_preparation_approval.sql`. Kept as a named
 * constant next to the projection that uses it, so a future widening of that
 * guard has one obvious place to land.
 */
export const DECIDABLE_PROPOSAL_STATES: readonly CampaignProposalState[] = [
  "ready_for_review",
  "changes_requested",
  "snoozed",
];

function parseState(value: string): CampaignProposalState | null {
  const parsed = campaignProposalStateSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

function parseSourceKind(value: string): CampaignProposalSourceKind {
  const parsed = campaignProposalSourceKindSchema.safeParse(value);
  // A source kind nobody recognises does not change what the proposal says, so
  // it degrades to the manual arm rather than hiding the whole proposal.
  return parsed.success ? parsed.data : "manual_request";
}

function toContent(row: ProposalRow, version: ProposalVersionRow | null): ProposalContent {
  if (row.currentVersionId === null || version === null) return { kind: "awaiting_research" };

  const parsed = campaignProposalDocumentSchema.safeParse(version.document);
  if (!parsed.success) return { kind: "unreadable" };

  return {
    kind: "document",
    versionId: version.id,
    versionNumber: version.version,
    digest: version.digest,
    writtenAt: version.createdAt,
    document: parsed.data,
  };
}

function toDecisionView(
  row: ProposalDecisionRow,
  currentDigest: string | null,
): ProposalDecisionView | null {
  const decision = campaignProposalDecisionKindSchema.safeParse(row.decision);
  // An unrecognised decision kind is dropped rather than shown as something
  // else. Mislabelling what a person decided is the one thing this record
  // exists to prevent.
  if (!decision.success) return null;

  return {
    id: row.id,
    decision: decision.data,
    reason: row.reason,
    instructions: row.instructions,
    snoozedUntil: row.snoozedUntil,
    decidedAt: row.decidedAt,
    appliesToCurrentContent: currentDigest !== null && row.proposalDigest === currentDigest,
  };
}

function newestFirst(left: { decidedAt: string }, right: { decidedAt: string }): number {
  return left.decidedAt < right.decidedAt ? 1 : left.decidedAt > right.decidedAt ? -1 : 0;
}

/**
 * One proposal as a card. Returns null for a row whose state is not a state
 * this build knows, because every control and every sentence on the card is
 * chosen by that state.
 */
export function toProposalCard(input: {
  proposal: ProposalRow;
  version: ProposalVersionRow | null;
  decisions: readonly ProposalDecisionRow[];
}): CampaignProposalCardView | null {
  const state = parseState(input.proposal.state);
  if (state === null) return null;

  const content = toContent(input.proposal, input.version);
  const currentDigest = content.kind === "document" ? content.digest : null;
  const decisions = input.decisions
    .map((row) => toDecisionView(row, currentDigest))
    .filter((view): view is ProposalDecisionView => view !== null)
    .sort(newestFirst);

  return {
    proposalId: input.proposal.id,
    state,
    sourceKind: parseSourceKind(input.proposal.sourceKind),
    createdAt: input.proposal.createdAt,
    updatedAt: input.proposal.updatedAt,
    snoozedUntil: input.proposal.snoozedUntil,
    linkedCampaignId: input.proposal.linkedCampaignId,
    content,
    // Both halves are required. A decidable state with nothing readable behind
    // it cannot be decided: the database checks the digest, and there is none.
    decidable: DECIDABLE_PROPOSAL_STATES.includes(state) && content.kind === "document",
    decisions,
    lastDecision: decisions[0] ?? null,
  };
}

/** Every proposal a surface can read, newest movement first. */
export function toProposalCards(
  rows: readonly {
    proposal: ProposalRow;
    version: ProposalVersionRow | null;
    decisions: readonly ProposalDecisionRow[];
  }[],
): CampaignProposalCardView[] {
  return rows
    .map(toProposalCard)
    .filter((card): card is CampaignProposalCardView => card !== null)
    .sort((left, right) =>
      left.updatedAt < right.updatedAt ? 1 : left.updatedAt > right.updatedAt ? -1 : 0,
    );
}

/**
 * The states that have left the conversation.
 *
 * They stay readable at their own address, and they stay in the history of
 * what was decided — a dismissal is one of the most useful things a person can
 * look back on. What they do not do is sit in a lane still asking to be acted
 * on.
 */
const SETTLED_PROPOSAL_STATES: readonly CampaignProposalState[] = [
  "dismissed",
  "superseded",
  "cancelled",
];

/**
 * The card lane for Growth Intelligence.
 *
 * Separate from `toProposalCards` on purpose: the lane is what still wants
 * attention, while the timeline needs every proposal including the settled
 * ones. Filtering at the source would have made a dismissal invisible in the
 * record of what its reader decided.
 *
 * An approved proposal stays in the lane, because its card is how a person
 * reaches the campaign it opened.
 */
export function laneProposals(
  cards: readonly CampaignProposalCardView[],
): CampaignProposalCardView[] {
  return cards.filter((card) => !SETTLED_PROPOSAL_STATES.includes(card.state));
}

export function toProposalLane(
  rows: readonly {
    proposal: ProposalRow;
    version: ProposalVersionRow | null;
    decisions: readonly ProposalDecisionRow[];
  }[],
): CampaignProposalCardView[] {
  return laneProposals(toProposalCards(rows));
}

/**
 * One proposal in full, for the review surface.
 *
 * `admitProposal` runs here rather than at write time so the reader sees the
 * gaps as they stand against today's rules. D07 is the whole reason the gaps
 * and the refusal are separate fields: a proposal missing an estimate is still
 * worth reading, and saying so is what makes it honest. A proposal resting on
 * another tenant's records, or on nothing at all, is refused outright.
 */
export function toProposalReview(input: {
  organizationId: string;
  proposal: ProposalRow;
  version: ProposalVersionRow | null;
  decisions: readonly ProposalDecisionRow[];
  /**
   * Claims the drafter marked as being about the wider market.
   *
   * Not stored anywhere: they are an input to admission at write time, and
   * `research-planner.ts` supplies them when the proposal is drafted. A reader
   * therefore passes none, which means re-running admission here can only
   * re-check the two properties that live in the stored document itself —
   * foreign evidence and nothing reviewable. That is deliberate, not a gap: it
   * re-checks what today's rules say about the words on file, without
   * inventing a claim nobody marked.
   */
  marketClaimKeys?: readonly string[];
}): CampaignProposalReviewView | null {
  const card = toProposalCard(input);
  if (card === null) return null;

  if (card.content.kind !== "document") {
    return { ...card, authority: null, declaredGaps: [], refusal: null };
  }

  const admission = admitProposal({
    document: card.content.document,
    organizationId: input.organizationId,
    marketClaimKeys: input.marketClaimKeys ?? [],
  });

  return {
    ...card,
    // A refused proposal is never decidable, whatever its state says. The
    // refusals are about evidence that cannot be shown to anyone.
    decidable: card.decidable && admission.outcome === "admissible",
    authority: preparationAuthority(card.content.document),
    declaredGaps: admission.outcome === "admissible" ? admission.declaredGaps : [],
    refusal: admission.outcome === "refused" ? refusalSentence(admission.reasonCode) : null,
  };
}

/**
 * Why a refused proposal cannot be reviewed, in words a person can act on.
 *
 * Deliberately not the reason code. A reader needs to know whether to wait, to
 * ask someone, or to write the proposal off — the code says none of that.
 */
function refusalSentence(
  reasonCode: "market_claim_without_citation" | "foreign_evidence" | "no_reviewable_content",
): string {
  switch (reasonCode) {
    case "market_claim_without_citation":
      return "This proposal states something about the wider market without naming the research behind it, so it cannot be reviewed as written.";
    case "foreign_evidence":
      return "This proposal cites records that do not belong to this organization. It has been withheld and should be reported.";
    case "no_reviewable_content":
      return "This proposal carries no evidence and states no assumption, so there is nothing to review yet.";
  }
}

export type { CampaignProposalDecisionKind };
