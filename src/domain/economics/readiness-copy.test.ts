import { describe, expect, it } from "vitest";

import type { EvidenceReadinessReason, EvidenceReadinessState } from "@/domain/economics/readiness";
import {
  describeReadinessReason,
  describeReadinessState,
  summarizeMissingCosts,
} from "@/domain/economics/readiness-copy";

const everyReason: readonly EvidenceReadinessReason[] = [
  "overlap_awaiting_reconciliation",
  "evidence_superseded_without_replacement",
  "evidence_excluded",
  "source_package_failed",
  "role_bound_to_conflicting_metrics",
  "currency_conflict_within_period",
  "role_supplied_by_different_period",
  "role_supplied_by_different_timezone",
  "role_supplied_by_different_branch_or_channel",
  "revenue_role_absent",
  "transaction_count_role_absent",
  "cost_coverage_unchecked",
  "cost_coverage_absent",
  "cost_coverage_incomplete",
  "evidence_quality_partial",
  "evidence_completeness_partial",
];

const everyState: readonly EvidenceReadinessState[] = [
  "blocked",
  "not_comparable",
  "needs_data",
  "partial_evidence",
  "ready_for_economics",
];

describe("readiness copy", () => {
  it("explains every reason the classifier can produce", () => {
    for (const reason of everyReason) {
      const copy = describeReadinessReason(reason);
      expect(copy.explanation.length, reason).toBeGreaterThan(20);
      expect(copy.explanation, reason).toMatch(/\.$/);
    }
  });

  it("names every state without using the code as the label", () => {
    for (const state of everyState) {
      const copy = describeReadinessState(state);
      expect(copy.label, state).not.toContain("_");
      expect(copy.summary.length, state).toBeGreaterThan(20);
    }
  });

  it("speaks the operator's language rather than the ledger's", () => {
    // A screen that says "exact_range_metric_observation" has explained nothing.
    // These are the internal words most likely to leak through a copy edit.
    const jargon =
      /observation|tuple|projection|reconciliation state|economics_role|metric definition|digest|RLS|null/i;

    for (const reason of everyReason) {
      const copy = describeReadinessReason(reason);
      expect(copy.explanation, reason).not.toMatch(jargon);
      expect(copy.nextStep ?? "", reason).not.toMatch(jargon);
    }
    for (const state of everyState) {
      expect(describeReadinessState(state).summary, state).not.toMatch(jargon);
    }
  });

  it("states no figure, because readiness has none", () => {
    for (const reason of everyReason) {
      const copy = describeReadinessReason(reason);
      expect(`${copy.explanation} ${copy.nextStep ?? ""}`, reason).not.toMatch(
        /\d+(\.\d+)?\s*%|\d{3,}/,
      );
    }
  });

  it("produces the sentence the panel exists to be able to say", () => {
    expect(summarizeMissingCosts(["commission", "delivery cost", "food cost"])).toBe(
      "Contribution margin is not calculated because commission, delivery cost and food cost evidence is missing.",
    );
  });

  it("says nothing when nothing is missing", () => {
    expect(summarizeMissingCosts([])).toBe("");
  });

  it("reads naturally for a single missing cost", () => {
    expect(summarizeMissingCosts(["food cost"])).toBe(
      "Contribution margin is not calculated because food cost evidence is missing.",
    );
  });
});
