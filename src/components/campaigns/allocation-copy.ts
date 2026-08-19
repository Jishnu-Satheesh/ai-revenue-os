import type { ResolvedMarginGrade } from "@/domain/campaigns/allocation";
import type { TruncationCauseKind } from "@/domain/campaigns/measurement";

/**
 * The allocation loop's vocabulary, translated for an operator.
 *
 * The ledger and the outcome proof both show what the fast loop decided, and an
 * operator reading them is not expected to know what `diagnostic.ctr_floor`
 * means. The raw keys and reason codes stay in the database and in the audit
 * record; the screen shows plain words. Every mapping falls back to the raw
 * value rather than hiding it, so an unknown code is still visible to a reader
 * who needs to ask about it.
 */

export type AllocationRuleUnit = "money" | "percent" | "number";

export const ALLOCATION_RULE_COPY: Readonly<
  Record<string, { title: string; description: string; unit: AllocationRuleUnit }>
> = {
  "diagnostic.spend_ceiling": {
    title: "Spend ceiling",
    description: "Stops a variant the moment it spends more than this guardrail allows.",
    unit: "money",
  },
  "diagnostic.ctr_floor": {
    title: "Click-through floor",
    description:
      "Stops a variant whose share of views that click falls below this floor, once enough people have seen it.",
    unit: "percent",
  },
  "margin.contribution_floor": {
    title: "Contribution margin floor",
    description: "Stops a variant when the channel's contribution margin falls below this floor.",
    unit: "money",
  },
};

export function allocationRuleCopy(ruleKey: string): {
  title: string;
  description: string;
  unit: AllocationRuleUnit;
} {
  return (
    ALLOCATION_RULE_COPY[ruleKey] ?? {
      title: ruleKey,
      description: "A recorded decision rule.",
      unit: "number",
    }
  );
}

export const ALLOCATION_REASON_COPY: Readonly<Record<string, string>> = {
  spend_ceiling_exceeded: "Spend went above the approved ceiling.",
  ctr_below_floor: "Click-through fell below the floor.",
  margin_below_floor: "Contribution margin fell below the floor.",
  no_threshold_breached: "Every threshold held.",
  below_minimum_exposure: "Too few views to judge yet, so nothing was stopped.",
  margin_grade_insufficient: "The margin quality was too weak to judge, so nothing was stopped.",
  value_unavailable: "The value was not available.",
};

export function allocationReasonCopy(reasonCode: string): string {
  return ALLOCATION_REASON_COPY[reasonCode] ?? reasonCode;
}

export const MARGIN_GRADE_LABELS: Readonly<Record<ResolvedMarginGrade, string>> = {
  measured: "Measured",
  derived: "Derived",
  estimated: "Estimated",
  assumed: "Assumed",
};

export const TRUNCATION_CAUSE_COPY: Readonly<Record<TruncationCauseKind, string>> = {
  agent_pause: "paused automatically",
  operator_pause: "paused by an operator",
  guardrail: "stopped by a guardrail",
};
