import type { OrganizationRole } from "@/domain/organizations/types";
import type { EvidenceTier } from "@/domain/decisions/value";
import { hasDecisionPermission } from "@/modules/decisions/application/authorization";
import type { OpportunityFeedItem, OpportunityStatus } from "@/modules/decisions/application/ports";

/**
 * The operator-facing read model over `opportunities`.
 *
 * The Decision Engine already decided what to propose. This layer decides only
 * how a human reads that decision, so it computes nothing about value: it
 * groups, orders, and states plainly what may still be answered and what may
 * not. `needs_data` never appears here because a readiness gap creates a
 * decision record and no opportunity at all, which is exactly the point --
 * missing evidence must not be dressed up as a weak recommendation.
 */

/** Tier before value: a well-evidenced smaller number outranks a guessed larger one. */
const TIER_ORDER: readonly EvidenceTier[] = ["computed", "observed", "prior"];

/** The states a human can still answer. Everything else is already resolved. */
const ANSWERABLE_STATUSES: ReadonlySet<OpportunityStatus> = new Set([
  "proposed",
  "awaiting_approval",
]);

/**
 * Ordered as an operator reads them: accept, change, decline, defer, ask. The
 * order is stable so the same control never moves between renders.
 */
export const OPPORTUNITY_ACTIONS = [
  "approved",
  "edited",
  "rejected",
  "snoozed",
  "more_evidence_requested",
] as const;

export type OpportunityAction = (typeof OPPORTUNITY_ACTIONS)[number];

/** Why an action is unavailable. Absent when the reader may act. */
export type OpportunityBlockedReason = "expired" | "role_not_permitted";

export type OpportunityImpactRange = {
  lowMinor: number;
  highMinor: number;
  currency: string;
  /**
   * Travels with the range on purpose. A range without its evidence tier reads
   * as a forecast; the tier is what tells the operator how much to trust it.
   */
  evidenceTier: EvidenceTier;
};

export type OpportunityFeedEntry = {
  id: string;
  decisionRecordId: string;
  playbookVersionId: string;
  title: string;
  summary: string;
  status: OpportunityStatus;
  impact: OpportunityImpactRange;
  executionCostMinor: number;
  expectedContributionMinor: number;
  currency: string;
  timeToImpactDays: number;
  expiresAt: string;
  isExpired: boolean;
  availableActions: readonly OpportunityAction[];
  blockedReason?: OpportunityBlockedReason;
};

export type OpportunityFeedGroup = {
  evidenceTier: EvidenceTier;
  items: readonly OpportunityFeedEntry[];
};

export type OpportunityFeed = {
  groups: readonly OpportunityFeedGroup[];
  /** Opportunities still open for an answer, across every tier. */
  totalCount: number;
  /** Already answered or lapsed, and therefore not shown. Never silently dropped. */
  answeredCount: number;
};

export type OpportunityFeedInput = {
  items: readonly OpportunityFeedItem[];
  role: OrganizationRole;
  now: Date;
  /**
   * When supplied, every row must belong to it. RLS is the real boundary; this
   * is the application-side assertion that a mis-scoped read fails loudly
   * instead of rendering another tenant's proposal.
   */
  organizationId?: string;
};

export function buildOpportunityFeed(input: OpportunityFeedInput): OpportunityFeed {
  const { items, role, now, organizationId } = input;

  if (organizationId) {
    for (const item of items) {
      if (item.organizationId !== organizationId) {
        throw new Error("Opportunity belongs to another organization.");
      }
    }
  }

  const answerable = items.filter((item) => ANSWERABLE_STATUSES.has(item.status));
  const mayAnswer = hasDecisionPermission(role, "decision.feedback");

  const groups = TIER_ORDER.map((evidenceTier) => ({
    evidenceTier,
    items: answerable
      .filter((item) => item.evidenceTier === evidenceTier)
      .sort(compareByValueThenSpeed)
      .map((item) => toEntry(item, { mayAnswer, now })),
  })).filter((group) => group.items.length > 0);

  return {
    groups,
    totalCount: answerable.length,
    answeredCount: items.length - answerable.length,
  };
}

/**
 * Within one tier the evidence quality is already equal, so the larger expected
 * contribution leads, and a tie breaks toward whichever pays back sooner.
 */
function compareByValueThenSpeed(left: OpportunityFeedItem, right: OpportunityFeedItem): number {
  if (left.expectedContributionMinor !== right.expectedContributionMinor) {
    return right.expectedContributionMinor - left.expectedContributionMinor;
  }
  if (left.timeToImpactDays !== right.timeToImpactDays) {
    return left.timeToImpactDays - right.timeToImpactDays;
  }
  return left.id.localeCompare(right.id);
}

function toEntry(
  item: OpportunityFeedItem,
  context: { mayAnswer: boolean; now: Date },
): OpportunityFeedEntry {
  // The database rejects an answer at `expires_at <= now()`, so the boundary
  // instant counts as expired here too. A UI that offered a control the write
  // path would refuse is worse than one that explains why it is closed.
  const isExpired = new Date(item.expiresAt).getTime() <= context.now.getTime();
  const blockedReason: OpportunityBlockedReason | undefined = isExpired
    ? "expired"
    : context.mayAnswer
      ? undefined
      : "role_not_permitted";

  return {
    id: item.id,
    decisionRecordId: item.decisionRecordId,
    playbookVersionId: item.playbookVersionId,
    title: item.title,
    summary: item.summary,
    status: item.status,
    impact: {
      lowMinor: item.impactLowMinor,
      highMinor: item.impactHighMinor,
      currency: item.currency,
      evidenceTier: item.evidenceTier,
    },
    executionCostMinor: item.executionCostMinor,
    expectedContributionMinor: item.expectedContributionMinor,
    currency: item.currency,
    timeToImpactDays: item.timeToImpactDays,
    expiresAt: item.expiresAt,
    isExpired,
    availableActions: blockedReason ? [] : OPPORTUNITY_ACTIONS,
    ...(blockedReason ? { blockedReason } : {}),
  };
}
