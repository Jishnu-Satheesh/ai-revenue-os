/**
 * Stage A of the funnel: deterministic, set-based elimination before scoring.
 *
 * Stage A writes counts and a rejection histogram onto the decision record, not
 * a row per candidate. A candidate eliminated by a deterministic threshold is
 * reproducible from the playbook version, the screening rule, and the recorded
 * inputs digest; it was never a live alternative and carries no counterfactual
 * information. See `specs/005` section 5.3.
 */
export type ScreeningRejectionReason =
  | "suppressed"
  | "capability_missing"
  | "stale_inputs"
  | "goal_misaligned";

export type ScreeningCandidate = {
  candidateFingerprint: string;
  requiredCapabilityKeys: readonly string[];
  primaryMetricKey: string;
  inputsObservedAt: Date;
  freshnessBoundMinutes: number;
};

export type SuppressionWindow = { suppressedUntil: Date | null };

export type ScreeningContext = {
  now: Date;
  grantedCapabilityKeys: ReadonlySet<string>;
  activeGoalMetricKeys: ReadonlySet<string>;
  /**
   * False while goals carry no registered metric keys. The predicate then
   * reports itself inactive rather than silently passing every candidate.
   */
  goalAlignmentActive: boolean;
  suppressedFingerprints: ReadonlyMap<string, SuppressionWindow>;
};

export type ScreeningRejection = {
  candidateFingerprint: string;
  reason: ScreeningRejectionReason;
  missingCapabilityKeys?: readonly string[];
};

export type ScreeningResult<T extends ScreeningCandidate> = {
  survivors: readonly T[];
  rejections: readonly ScreeningRejection[];
  rejectionHistogram: Readonly<Partial<Record<ScreeningRejectionReason, number>>>;
  screenedCount: number;
  goalAlignmentActive: boolean;
};

/**
 * `max_active_recommendations` less the count of currently active
 * opportunities. This is the cycle's termination condition rather than a filter
 * applied afterwards, so the engine stops proposing instead of proposing and
 * discarding.
 */
export function computeSlotBudget(input: {
  maxActiveRecommendations: number;
  activeOpportunityCount: number;
}): number {
  return Math.max(0, input.maxActiveRecommendations - input.activeOpportunityCount);
}

function firstRejection(
  candidate: ScreeningCandidate,
  context: ScreeningContext,
): ScreeningRejection | null {
  // Ordered cheapest-first so exactly one reason is recorded per candidate and
  // the histogram stays a count of candidates rather than of failed predicates.
  const suppression = context.suppressedFingerprints.get(candidate.candidateFingerprint);
  if (suppression) {
    const until = suppression.suppressedUntil;
    if (until === null || until.getTime() > context.now.getTime()) {
      return { candidateFingerprint: candidate.candidateFingerprint, reason: "suppressed" };
    }
  }

  const missingCapabilityKeys = candidate.requiredCapabilityKeys.filter(
    (key) => !context.grantedCapabilityKeys.has(key),
  );
  if (missingCapabilityKeys.length > 0) {
    return {
      candidateFingerprint: candidate.candidateFingerprint,
      reason: "capability_missing",
      missingCapabilityKeys,
    };
  }

  const ageMinutes = (context.now.getTime() - candidate.inputsObservedAt.getTime()) / (60 * 1000);
  if (ageMinutes > candidate.freshnessBoundMinutes) {
    return { candidateFingerprint: candidate.candidateFingerprint, reason: "stale_inputs" };
  }

  // An organization with no active goals is never screened on this predicate,
  // and neither is one whose goals have no registered metric keys yet.
  if (
    context.goalAlignmentActive &&
    context.activeGoalMetricKeys.size > 0 &&
    !context.activeGoalMetricKeys.has(candidate.primaryMetricKey)
  ) {
    return { candidateFingerprint: candidate.candidateFingerprint, reason: "goal_misaligned" };
  }

  return null;
}

export function screenCandidates<T extends ScreeningCandidate>(
  candidates: readonly T[],
  context: ScreeningContext,
): ScreeningResult<T> {
  const survivors: T[] = [];
  const rejections: ScreeningRejection[] = [];
  const rejectionHistogram: Partial<Record<ScreeningRejectionReason, number>> = {};

  for (const candidate of candidates) {
    const rejection = firstRejection(candidate, context);
    if (!rejection) {
      survivors.push(candidate);
      continue;
    }
    rejections.push(rejection);
    rejectionHistogram[rejection.reason] = (rejectionHistogram[rejection.reason] ?? 0) + 1;
  }

  return {
    survivors,
    rejections,
    rejectionHistogram,
    screenedCount: candidates.length,
    goalAlignmentActive: context.goalAlignmentActive,
  };
}

/**
 * The four recorded resurfacing conditions, plus the playbook-version change
 * that releases a permanent suppression. "New evidence" is a checkable
 * predicate here, never a judgement. See `specs/005` section 5.9.
 */
export type ResurfacingCondition =
  | "operator_unsuppressed"
  | "fingerprint_changed"
  | "playbook_version_changed"
  | "resurface_condition_met"
  | "window_elapsed";

export type SuppressionRecord = {
  candidateFingerprint: string;
  suppressedUntil: Date | null;
  playbookVersionId: string;
  unsuppressedAt: Date | null;
};

export function resurfacingCondition(input: {
  suppression: SuppressionRecord;
  candidateFingerprint: string;
  playbookVersionId: string;
  resurfaceSignalMet: boolean;
  now: Date;
}): ResurfacingCondition | null {
  if (input.suppression.unsuppressedAt !== null) return "operator_unsuppressed";
  if (input.suppression.candidateFingerprint !== input.candidateFingerprint) {
    return "fingerprint_changed";
  }
  if (input.suppression.playbookVersionId !== input.playbookVersionId) {
    return "playbook_version_changed";
  }
  if (input.resurfaceSignalMet) return "resurface_condition_met";

  // A null window is "this is wrong for my business": it persists until the
  // playbook version changes, which is checked above.
  if (
    input.suppression.suppressedUntil !== null &&
    input.suppression.suppressedUntil.getTime() <= input.now.getTime()
  ) {
    return "window_elapsed";
  }

  return null;
}
