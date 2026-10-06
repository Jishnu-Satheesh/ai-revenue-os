import { z } from "zod";

import { isoDateSchema } from "@/domain/organizations/growth-periods";
import type { GrowthComparison } from "@/domain/organizations/growth-progress";
import {
  growthAdviceRelationSchema,
  type GrowthAdviceRelation,
  type GrowthAdviceRow,
} from "@/modules/organizations/application/growth-progress-view";

/**
 * Deterministic advice qualification and compare-first selection (data
 * contract D06).
 *
 * Like a pharmacist reading only the label, never guessing from the
 * handwriting: a candidate's relation comes from the registered source
 * kind, detector key or action key its owning module actually stored — never
 * from free-text prose. A key nobody registered stays general, and a row
 * whose evidence postdates the displayed comparison date is left out rather
 * than stated as the cause of an older gap.
 *
 * Pure and deterministic: same inputs always give the same rows. No
 * database, clock, model, network or Node built-in is touched, so this
 * module is safe to import from browser code.
 */

/**
 * Registered channel detector keys admitted as recovery evidence.
 *
 * Inventory source: `src/domain/analysis/detectors/` via
 * `src/domain/analysis/registry.ts` (13 registered keys). Only the two
 * cancellation keys are admitted here: D06 explicitly blesses registered
 * order-cancellation-loss findings as support for "Review cancellation
 * findings" (a signal to investigate, never proof of the whole gap), and
 * the attribution detector names the same recoverable shape. Every other
 * registered detector key (revenue.*, operations.closed_share,
 * funnel.stage_conversion, economics.*, evidence.*, listing.*,
 * customer.*, order.*, promotion.funding, cost.*) maps to general.
 */
export const RECOVERY_DETECTOR_KEYS: ReadonlySet<string> = new Set([
  "orders.cancellation_loss",
  "orders.cancellation_attribution",
]);

/**
 * Registered detector keys admitted as expansion evidence.
 *
 * Inventory source: same registry. Only `customer.new_share` is admitted:
 * the key literally names new-customer share, which is what an ahead-state
 * "build on this progress" panel may point at. Everything else stays
 * general rather than guessed.
 */
export const EXPANSION_DETECTOR_KEYS: ReadonlySet<string> = new Set(["customer.new_share"]);

/**
 * Registered opportunity action keys admitted as expansion evidence.
 *
 * Inventory source: stored playbook `actionKey` values observed through the
 * decisions module (`campaign.governed_draft_v1`, `campaign.meta_bundle_v1`
 * in workspace fixtures and read-model tests). Both name campaign builds —
 * forward-looking creative work, the ahead-state shape. Placement, pricing
 * and telephony keys stay general: their direction depends on context this
 * slice does not prove.
 */
export const EXPANSION_ACTION_KEYS: ReadonlySet<string> = new Set([
  "campaign.governed_draft_v1",
  "campaign.meta_bundle_v1",
]);

/**
 * Registered campaign proposal source kinds.
 *
 * Inventory source: `CAMPAIGN_PROPOSAL_SOURCE_KINDS` in
 * `src/domain/campaigns/proposal.ts` (`manual_request`, `business_signal`,
 * `next_test`). All three stay general: a business signal is a prompt to
 * investigate rather than proof (D06), and a next test may aim at recovery
 * or expansion depending on context this slice does not prove. They are
 * listed here so the mapping is explicit rather than silent.
 */
export const GENERAL_PROPOSAL_SOURCE_KINDS: ReadonlySet<string> = new Set([
  "manual_request",
  "business_signal",
  "next_test",
]);

/**
 * Qualifies one candidate's relation from the registered key its source
 * row actually carried. Null or unregistered keys are general — never
 * guessed from titles, detail prose or supported-action text.
 */
export function qualifyAdviceRelation(key: string | null): GrowthAdviceRelation {
  if (typeof key === "string") {
    const trimmed = key.trim();
    if (trimmed.length > 0) {
      if (RECOVERY_DETECTOR_KEYS.has(trimmed)) return "recovery";
      if (EXPANSION_DETECTOR_KEYS.has(trimmed) || EXPANSION_ACTION_KEYS.has(trimmed)) {
        return "expansion";
      }
      return "general";
    }
  }
  return "general";
}

/** Source-owned statuses that remove a row from advice (D06 exclusion list). */
export const EXCLUDED_ADVICE_STATUSES: ReadonlySet<string> = new Set([
  "dismissed",
  "rejected",
  "expired",
  "deleted",
  "snoozed",
  "unavailable",
  "resolved",
  "completed",
  "approved",
  "approved_for_preparation",
]);

/** Proposal states that still want attention on the advice rail. */
export const ADVICE_ELIGIBLE_PROPOSAL_STATES: ReadonlySet<string> = new Set([
  "ready_for_review",
  "changes_requested",
]);

/**
 * True when a stored triage/decision status keeps the row eligible.
 * Planned stays eligible with intent wording (planned is never completed);
 * completed/resolved rows are evidence only where attribution permits, which
 * this slice never asserts, so they are excluded.
 */
export function isAdviceEligibleStatus(status: string | null): boolean {
  if (status === null) return true;
  return !EXCLUDED_ADVICE_STATUSES.has(status.trim().toLowerCase());
}

export const growthAdviceCandidateSchema = z.strictObject({
  id: z.string().trim().min(1).max(200),
  kind: z.enum(["finding", "recommendation", "proposal", "insight"]),
  title: z.string().trim().min(1).max(200),
  supportingText: z.string().trim().min(1).max(1000),
  href: z.string().trim().min(1).max(500).nullable(),
  /** The registered detector/action/source key the source row carried, if any. */
  key: z.string().trim().min(1).max(200).nullable(),
  /** Ledger revision when the source row carries one; null is honest absence. */
  sourceRevision: z.string().trim().min(1).max(200).nullable(),
  sourceWindowStart: isoDateSchema.nullable(),
  sourceWindowEnd: isoDateSchema.nullable(),
  channelIds: z.array(z.string().uuid()).max(50),
  branchIds: z.array(z.string().uuid()).max(50),
  /** Standing triage/decision answer, lowercased by the reader; null when none. */
  sourceStatus: z.string().trim().min(1).max(80).nullable(),
  evidenceRefs: z.array(z.string().trim().min(1).max(200)).max(100),
  relation: growthAdviceRelationSchema,
  /** The permission that admitted this row; kept for audit, never displayed. */
  permission: z.enum(["growth_intelligence.read", "campaign.read", "channel.read"]),
});
export type GrowthAdviceCandidate = z.output<typeof growthAdviceCandidateSchema>;

/**
 * Admitted lane order for within-range ties (D06 "source priority order").
 * Proposals name a concrete reviewable next step, narrated recommendations
 * name an action, insights carry context, raw findings carry signals. Pinned
 * here so every surface ranks the same way; tested, never per-caller.
 */
export const ADVICE_SOURCE_PRIORITY: ReadonlyArray<GrowthAdviceCandidate["kind"]> = [
  "proposal",
  "recommendation",
  "insight",
  "finding",
];

/** At most two rows ever reach the rail (D06, V06). */
export const GROWTH_ADVICE_MAX_ROWS = 2;

/** Neutral fallback body when a visible difference has no qualified explanation (V06). */
export const NEUTRAL_FALLBACK_TEXT =
  "We can see the difference, but do not yet have enough evidence to explain it.";

const selectAdviceInputSchema = z.strictObject({
  /** Behind/ahead/within_range/equal from the same-date comparison, or null when uncompared. */
  comparisonState: z.enum(["behind", "ahead", "within_range", "equal"]).nullable(),
  /** Present exactly when a difference is on screen (upcoming views pass null). */
  comparisonVisible: z.boolean(),
  latestComparableDate: isoDateSchema.nullable(),
  organizationId: z.string().uuid(),
  /** Null href fallback when the viewer may not open recommendations. */
  workspaceHref: z.string().trim().min(1).max(500).nullable(),
  candidates: z.array(growthAdviceCandidateSchema).max(100),
});
export type SelectGrowthAdviceInput = z.input<typeof selectAdviceInputSchema>;

/**
 * Compare-first advice selection (D06).
 *
 * Behind shows admissible recovery then general; ahead shows admissible
 * expansion then general; within range (and exact equality) follows source
 * priority. Ties break on the newest permitted evidence window, then source
 * id — speculative money is never a ranking input because candidates carry
 * no amounts at all. At most two rows; unknown keys already arrived as
 * general, so no branch here guesses.
 */
export function selectGrowthAdvice(rawInput: SelectGrowthAdviceInput): GrowthAdviceRow[] {
  const parsed = selectAdviceInputSchema.safeParse(rawInput);
  if (!parsed.success) return [];
  const input = parsed.data;

  // A factual claim must rest on an observation window ending no later than
  // the displayed comparison date. A newer window is not a cause of an older
  // gap; it is left out, while the row's standing status may still be newer
  // because the reader labels it explicitly as current status.
  const timely = input.candidates.filter((candidate) => {
    if (candidate.sourceWindowEnd === null || input.latestComparableDate === null) return true;
    return candidate.sourceWindowEnd <= input.latestComparableDate;
  });

  const byRelation = (relation: GrowthAdviceRelation): GrowthAdviceCandidate[] =>
    timely.filter((candidate) => candidate.relation === relation);

  const byPriority = (left: GrowthAdviceCandidate, right: GrowthAdviceCandidate): number => {
    const leftRank = ADVICE_SOURCE_PRIORITY.indexOf(left.kind);
    const rightRank = ADVICE_SOURCE_PRIORITY.indexOf(right.kind);
    if (leftRank !== rightRank) return leftRank - rightRank;
    const leftWindow = left.sourceWindowEnd ?? "";
    const rightWindow = right.sourceWindowEnd ?? "";
    if (leftWindow !== rightWindow) return leftWindow < rightWindow ? 1 : -1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  };

  let ordered: GrowthAdviceCandidate[];
  if (input.comparisonState === "behind") {
    ordered = [
      ...byRelation("recovery").sort(byPriority),
      ...byRelation("general").sort(byPriority),
    ];
  } else if (input.comparisonState === "ahead") {
    ordered = [
      ...byRelation("expansion").sort(byPriority),
      ...byRelation("general").sort(byPriority),
    ];
  } else if (input.comparisonState === "within_range" || input.comparisonState === "equal") {
    // Within range (and exact equality) the rail is not a verdict about the
    // gap, so relation steps aside and source priority orders every row.
    ordered = [...timely].sort(byPriority);
  } else {
    // Uncompared (upcoming period): useful general rows by source priority,
    // with no verdict to explain and therefore no neutral fallback.
    ordered = [...timely].sort(byPriority);
  }

  const rows = ordered.slice(0, GROWTH_ADVICE_MAX_ROWS).map((candidate) => ({
    id: candidate.id,
    title: candidate.title,
    supportingText: candidate.supportingText,
    href: candidate.href,
    relation: candidate.relation,
  }));

  if (rows.length === 0 && input.comparisonVisible && input.comparisonState !== null) {
    return [
      {
        id: "neutral-fallback",
        title: "No supporting evidence yet",
        supportingText: NEUTRAL_FALLBACK_TEXT,
        href: input.workspaceHref,
        relation: "general" as const,
      },
    ];
  }
  return rows;
}

/** Convenience for the service: the latest comparison's state, or null when uncompared. */
export function comparisonStateOf(
  comparison: GrowthComparison | null,
): SelectGrowthAdviceInput["comparisonState"] {
  if (comparison === null || comparison.state === "unavailable") return null;
  return comparison.state;
}

/** One lane's read outcome: candidates plus an independent safe error code. */
export const growthAdviceLaneResultSchema = z.strictObject({
  candidates: z.array(growthAdviceCandidateSchema),
  errorCode: z.string().trim().min(1).max(120).nullable(),
});
export type GrowthAdviceLaneResult = z.output<typeof growthAdviceLaneResultSchema>;

/** Reader outcome across all lanes; one lane's failure never hides another's rows. */
export type GrowthAdviceReadResult = {
  readonly candidates: readonly GrowthAdviceCandidate[];
  /** Lane key → safe code, present only for lanes that failed. */
  readonly laneErrors: Readonly<Record<string, string>>;
};

/** Server-resolved lane permissions behind one advice read; denied lanes are never fetched. */
export type GrowthAdviceReadInput = {
  organizationId: string;
  actorId: string;
  /** UTC instant; bounds preference snoozes and the workspace activity month. */
  nowIso: string;
  allow: {
    recommendations: boolean;
    items: boolean;
    proposals: boolean;
  };
};
