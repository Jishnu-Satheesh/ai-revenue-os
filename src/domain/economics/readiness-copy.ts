/**
 * Readiness, in the operator's words rather than the ledger's.
 *
 * The classifier speaks in codes so it can be asserted; this file is the only
 * place those codes become English. Keeping the two apart means a copy edit
 * cannot change a verdict, and a verdict cannot quietly change what the screen
 * says.
 *
 * Nothing here states a figure, because readiness has none to state.
 *
 * See `specs/012-channel-economics-ledger.md` section 7.5.
 */

import type { EvidenceReadinessReason, EvidenceReadinessState } from "@/domain/economics/readiness";

export type ReadinessStateCopy = {
  label: string;
  /** One sentence, safe to read on its own. */
  summary: string;
};

const stateCopy: Readonly<Record<EvidenceReadinessState, ReadinessStateCopy>> = {
  ready_for_economics: {
    label: "Ready",
    summary: "The evidence for this period is current, complete, and safe to work from.",
  },
  partial_evidence: {
    label: "Partial",
    summary:
      "The evidence for this period is usable but incomplete, so anything built on it inherits that gap.",
  },
  needs_data: {
    label: "Needs data",
    summary: "Something required for this period has not arrived yet.",
  },
  not_comparable: {
    label: "Not comparable",
    summary:
      "The pieces for this period exist but do not line up, so combining them would invent a number.",
  },
  blocked: {
    label: "Blocked",
    summary: "Evidence for this period exists but is not currently usable.",
  },
};

export function describeReadinessState(state: EvidenceReadinessState): ReadinessStateCopy {
  return stateCopy[state];
}

export type ReadinessReasonCopy = {
  /** What is wrong, in one line. */
  explanation: string;
  /**
   * What the user should do about it, or null where nothing they could do
   * would help. A gap nobody can close is named and explained and offers no
   * action, because a button nobody can complete is worse than no button.
   */
  nextStep: string | null;
};

const reasonCopy: Readonly<Record<EvidenceReadinessReason, ReadinessReasonCopy>> = {
  overlap_awaiting_reconciliation: {
    explanation:
      "Two reports cover overlapping dates for this channel, and the platform will not guess which one is right.",
    nextStep: "An owner or admin needs to choose which report stands in the Integration Hub.",
  },
  evidence_superseded_without_replacement: {
    explanation:
      "The report that covered this period was replaced, and nothing current took its place.",
    nextStep: "Upload the corrected report for these exact dates.",
  },
  evidence_excluded: {
    explanation:
      "The report for this period was set aside during reconciliation and is not in use.",
    nextStep:
      "Upload a replacement report for these exact dates, or restore the original decision.",
  },
  source_package_failed: {
    explanation: "The report this period came from did not finish processing.",
    nextStep: "Open the report in the Integration Hub and retry it.",
  },
  role_bound_to_conflicting_metrics: {
    explanation:
      "Two different measures both claim to be the same input for this period, so neither can be trusted as the one.",
    nextStep: "An owner or admin needs to leave one measure registered for this input.",
  },
  currency_conflict_within_period: {
    explanation:
      "This period holds amounts in more than one currency. They are never converted, so they cannot be added together.",
    nextStep: "Upload one report per currency, each covering its own dates.",
  },
  role_supplied_by_different_period: {
    explanation:
      "A required input exists for this channel but covers different dates, and periods are never stretched or split to fit.",
    nextStep: "Upload a report whose dates match this one exactly.",
  },
  role_supplied_by_different_timezone: {
    explanation:
      "A required input covers the same dates in a different timezone, which means a different set of hours.",
    nextStep:
      "Re-upload the report against the outlet whose timezone these dates were recorded in.",
  },
  role_supplied_by_different_branch_or_channel: {
    explanation:
      "A required input for these dates is recorded against a different outlet or channel.",
    nextStep:
      "Check the outlet and channel on that report, and re-upload it against the right one.",
  },
  revenue_role_absent: {
    explanation: "No sales total has arrived for this period.",
    nextStep: "Upload the report that states sales for these exact dates.",
  },
  transaction_count_role_absent: {
    explanation:
      "No order count has arrived for this period, so there is nothing to divide earnings by.",
    nextStep: "Upload the report that states order counts for these exact dates.",
  },
  cost_coverage_unchecked: {
    explanation:
      "Your cost setup could not be read, so nothing about costs has been checked. This is not the same as having nothing missing.",
    nextStep: "Reload the page. If it keeps happening, this needs looking at.",
  },
  cost_coverage_absent: {
    explanation: "No costs have been recorded yet, so there is nothing to subtract from sales.",
    nextStep: "Add your cost structure.",
  },
  cost_coverage_incomplete: {
    explanation: "Some of your costs are recorded and some are still missing.",
    nextStep: "Fill in the remaining costs.",
  },
  evidence_quality_partial: {
    explanation:
      "The report behind this period came through with warnings that are still standing.",
    nextStep: "Review the warnings on that report in the Integration Hub.",
  },
  evidence_completeness_partial: {
    explanation:
      "The report behind this period was only partly read, so some of it is not represented.",
    nextStep:
      "Review that report in the Integration Hub and re-upload it if part of it is missing.",
  },
};

export function describeReadinessReason(reason: EvidenceReadinessReason): ReadinessReasonCopy {
  return reasonCopy[reason];
}

/**
 * The one-line answer to "what prevents an honest contribution margin".
 *
 * Written as two plain statements — what is in hand, then what is not — which
 * is the shape of the sentence the spec asks the panel to be able to produce.
 */
export function summarizeMissingCosts(missingLabels: readonly string[]): string {
  if (missingLabels.length === 0) return "";
  const named = [...missingLabels].sort((left, right) => left.localeCompare(right));
  const list =
    named.length === 1
      ? named[0]
      : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  return `Contribution margin is not calculated because ${list} evidence is missing.`;
}
