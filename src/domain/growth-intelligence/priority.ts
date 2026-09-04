import { z } from "zod";

import type {
  MarketEvidenceFreshness,
  MarketEvidenceSupportGrade,
} from "@/domain/growth-intelligence/types";
import { GrowthIntelligenceError } from "@/domain/growth-intelligence/errors";

/**
 * Deterministic Recommendation priority.
 *
 * The model never emits a score or rank. The UI exposes a band (`now`,
 * `next`, `later`) and its ordered components instead of a dimensionally
 * invalid blended number: urgency, approved-goal alignment, evidence support,
 * freshness, and impact presence are reported side by side, and money in a
 * foreign currency refuses rather than converts.
 */

const moneySchema = z
  .object({
    lowMinorUnits: z.number().int().min(0),
    highMinorUnits: z.number().int().min(0),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const priorityInputSchema = z
  .object({
    itemId: z.string().uuid(),
    urgency: z.enum(["high", "medium", "low"]),
    goalAlignment: z.enum(["direct", "indirect", "none"]),
    supportGrade: z.enum(["primary", "corroborated", "single_source", "contextual", "conflicted"]),
    freshness: z.enum(["current", "stale", "expired"]),
    impactEstimate: moneySchema.nullable(),
    organizationCurrency: z.string().regex(/^[A-Z]{3}$/),
    pinned: z.boolean(),
  })
  .strict();

export type RecommendationPriorityInput = z.infer<typeof priorityInputSchema>;

export type RecommendationPriorityBand = "now" | "next" | "later";

export type RecommendationPriorityComponent = {
  key: "urgency" | "goal_alignment" | "support" | "freshness" | "impact";
  label: string;
  contribution: number;
};

export const PRIORITY_RULE_VERSION = "priority-rules@1" as const;

export type RecommendationPriority = {
  itemId: string;
  band: RecommendationPriorityBand;
  components: RecommendationPriorityComponent[];
  total: number;
  pinned: boolean;
  ruleVersion: string;
};

const URGENCY_WEIGHT = { high: 2, medium: 1, low: 0 } as const;
const GOAL_WEIGHT = { direct: 2, indirect: 1, none: 0 } as const;
const SUPPORT_WEIGHT: Record<MarketEvidenceSupportGrade, number> = {
  primary: 2,
  corroborated: 1,
  single_source: 0,
  contextual: 0,
  conflicted: -99,
};
const FRESHNESS_WEIGHT: Record<MarketEvidenceFreshness, number> = {
  current: 2,
  stale: 0,
  expired: -99,
};

const BAND_RANK: Record<RecommendationPriorityBand, number> = { now: 0, next: 1, later: 2 };

export function buildRecommendationPriority(
  input: RecommendationPriorityInput,
): RecommendationPriority {
  const parsed = priorityInputSchema.parse(input);
  if (
    parsed.impactEstimate &&
    parsed.impactEstimate.lowMinorUnits > parsed.impactEstimate.highMinorUnits
  ) {
    throw new GrowthIntelligenceError(
      "IMPACT_RANGE_INVALID",
      "A Recommendation impact range must run from low to high.",
    );
  }
  if (parsed.impactEstimate && parsed.impactEstimate.currency !== parsed.organizationCurrency) {
    throw new GrowthIntelligenceError(
      "IMPACT_CURRENCY_MISMATCH",
      "Impact in a foreign currency cannot join this organization's priority.",
    );
  }

  const components: RecommendationPriorityComponent[] = [
    {
      key: "urgency",
      label: `Urgency ${parsed.urgency}`,
      contribution: URGENCY_WEIGHT[parsed.urgency],
    },
    {
      key: "goal_alignment",
      label: `Goal alignment ${parsed.goalAlignment}`,
      contribution: GOAL_WEIGHT[parsed.goalAlignment],
    },
    {
      key: "support",
      label: `Support ${parsed.supportGrade}`,
      contribution: SUPPORT_WEIGHT[parsed.supportGrade],
    },
    {
      key: "freshness",
      label: `Freshness ${parsed.freshness}`,
      contribution: FRESHNESS_WEIGHT[parsed.freshness],
    },
    {
      key: "impact",
      label: parsed.impactEstimate ? "Deterministic impact present" : "No impact estimate",
      contribution: parsed.impactEstimate ? 1 : 0,
    },
  ];
  const total = components.reduce((sum, component) => sum + component.contribution, 0);
  const band: RecommendationPriorityBand = total >= 6 ? "now" : total >= 3 ? "next" : "later";
  return {
    itemId: parsed.itemId,
    band,
    components,
    total,
    pinned: parsed.pinned,
    ruleVersion: PRIORITY_RULE_VERSION,
  };
}

/**
 * Stable deterministic order across items: band rank first, then component
 * total, then item identity. Pins are presentation preferences and never
 * disturb the order: pinning changes grouping, not rank. The rule version
 * likewise rides along for auditability and never disturbs the order.
 */
export function compareRecommendationPriority(
  left: RecommendationPriority,
  right: RecommendationPriority,
): number {
  if (BAND_RANK[left.band] !== BAND_RANK[right.band]) {
    return BAND_RANK[left.band] - BAND_RANK[right.band];
  }
  if (left.total !== right.total) {
    return right.total - left.total;
  }
  return left.itemId < right.itemId ? -1 : left.itemId > right.itemId ? 1 : 0;
}
