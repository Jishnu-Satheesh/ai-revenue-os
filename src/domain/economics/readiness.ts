/**
 * Is the governed report evidence enough to begin Channel Economics work?
 *
 * That is the only question answered here. Nothing in this file computes a
 * margin, and nothing in it reads a value: readiness is a statement about the
 * *shape* of the evidence, so the inputs carry periods, states, and role
 * bindings and deliberately carry no numbers at all.
 *
 * Pure arithmetic over pure data, deliberately free of `server-only`, so the
 * same classification holds wherever readiness is shown or asserted.
 *
 * See `specs/012-channel-economics-ledger.md` section 6.3.
 */

import { createHash } from "node:crypto";

import type { EconomicsQualityTier, EconomicsRole } from "@/domain/economics/types";

/** Bumped when the classification itself changes, never for a copy edit. */
export const EVIDENCE_READINESS_MODEL_VERSION = 1;

/**
 * Worst first. A tuple is never described more favourably than its weakest
 * fact allows, and the order below is the order the rules are tried in.
 */
export type EvidenceReadinessState =
  /** Evidence exists but may not be used: held, superseded, excluded, or failed. */
  | "blocked"
  /** The inputs exist but cannot honestly be combined. */
  | "not_comparable"
  /** A required input is simply absent. */
  | "needs_data"
  /** Present and comparable, but incomplete or carrying warnings. */
  | "partial_evidence"
  /** Current, complete, comparable, and costed. Work may begin. */
  | "ready_for_economics";

const STATE_ORDER: readonly EvidenceReadinessState[] = [
  "blocked",
  "not_comparable",
  "needs_data",
  "partial_evidence",
  "ready_for_economics",
];

/**
 * Why a tuple landed where it did.
 *
 * Typed rather than free text, so the copy layer can speak plainly without the
 * classifier learning English and without a reason becoming unassertable.
 */
export type EvidenceReadinessReason =
  | "overlap_awaiting_reconciliation"
  | "evidence_superseded_without_replacement"
  | "evidence_excluded"
  | "source_package_failed"
  | "role_bound_to_conflicting_metrics"
  | "currency_conflict_within_period"
  | "role_supplied_by_different_period"
  | "role_supplied_by_different_timezone"
  | "role_supplied_by_different_branch_or_channel"
  | "revenue_role_absent"
  | "transaction_count_role_absent"
  | "cost_coverage_unchecked"
  | "cost_coverage_absent"
  | "cost_coverage_incomplete"
  | "evidence_quality_partial"
  | "evidence_completeness_partial";

/** How a source package stands, as far as readiness is concerned. */
export type EvidencePackageState = "usable" | "reconciliation_required" | "failed";

/**
 * One current exact-range observation, with every value field absent by
 * construction. The repository maps onto this type, so a value cannot reach the
 * classifier even by accident.
 */
export type ReadinessObservation = {
  observationId: string;
  channelId: string;
  branchId: string;
  metricDefinitionId: string;
  /** Null when the metric supplies no economics input; such rows are ignored. */
  economicsRole: EconomicsRole | null;
  periodStart: string;
  periodEnd: string;
  periodTimezone: string;
  /** Null for a count, per the ledger's own check constraint. */
  currency: string | null;
  qualityState: "complete" | "partial";
  completenessState: "complete" | "partial";
  reconciliationState: "current" | "blocked_overlap" | "excluded" | "superseded";
  reportPackageId: string;
  packageState: EvidencePackageState;
};

/**
 * Availability and tier for one registered cost component. There is no amount
 * field, and there is no place to put one.
 */
export type ReadinessCostComponent = {
  key: string;
  label: string;
  /** True when a rate prices it, or when a `sourced` component has observations. */
  covered: boolean;
  /** Null exactly when uncovered. Never an amount. */
  tier: Exclude<EconomicsQualityTier, "missing"> | null;
  /**
   * False where no rate anyone could type would resolve the gap — a `per_unit`
   * component with no unit count, or a `sourced` one whose metric is silent.
   * Those rows are named and explained but carry no action.
   */
  operatorCanResolve: boolean;
};

/**
 * What the coverage read produced.
 *
 * `unchecked` is a distinct outcome rather than an empty list, because silence
 * from the coverage function is not the same as having nothing left to price
 * and must never be allowed to read as sufficiency.
 */
export type ReadinessCostCoverage =
  | { outcome: "checked"; components: readonly ReadinessCostComponent[] }
  | { outcome: "unchecked" };

export type ReadinessTupleKey = {
  channelId: string;
  branchId: string;
  periodStart: string;
  periodEnd: string;
  periodTimezone: string;
};

export type ReadinessTuple = ReadinessTupleKey & {
  state: EvidenceReadinessState;
  /** Every reason that applied, not only the one that decided the state. */
  reasons: readonly EvidenceReadinessReason[];
  /** As recorded. Null where the tuple holds only counts. */
  currency: string | null;
  rolesPresent: readonly EconomicsRole[];
  /** Identifiers only, so a tuple can be traced back to its lineage. */
  observationIds: readonly string[];
  reportPackageIds: readonly string[];
};

export type EvidenceReadinessModel = {
  readModelVersion: number;
  tuples: readonly ReadinessTuple[];
  costCoverage: ReadinessCostCoverage;
  digest: string;
};

/** Absent any of these, no honest per-transaction economics can begin. */
const REQUIRED_ROLES = [
  "gross_revenue",
  "transaction_count",
] as const satisfies readonly EconomicsRole[];

function tupleKeyOf(observation: ReadinessObservation): string {
  return [
    observation.channelId,
    observation.branchId,
    observation.periodStart,
    observation.periodEnd,
    observation.periodTimezone,
  ].join("|");
}

/** Inclusive local dates, so a shared endpoint is an intersection. */
function rangesIntersect(
  left: Pick<ReadinessTupleKey, "periodStart" | "periodEnd">,
  right: Pick<ReadinessTupleKey, "periodStart" | "periodEnd">,
): boolean {
  return left.periodStart <= right.periodEnd && right.periodStart <= left.periodEnd;
}

function sameRange(
  left: Pick<ReadinessTupleKey, "periodStart" | "periodEnd">,
  right: Pick<ReadinessTupleKey, "periodStart" | "periodEnd">,
): boolean {
  return left.periodStart === right.periodStart && left.periodEnd === right.periodEnd;
}

/**
 * Reasons that cannot be answered from the tuple's own observations.
 *
 * A required role missing here might be genuinely absent, or it might exist
 * next door under a period, timezone, branch, or channel this one cannot be
 * combined with. Those are different problems with different next steps — one
 * asks for an upload, the other asks for a correction — so they are separated
 * rather than both reported as missing data.
 */
function incomparabilityReasons(input: {
  key: ReadinessTupleKey;
  missingRoles: readonly EconomicsRole[];
  elsewhere: readonly ReadinessObservation[];
}): EvidenceReadinessReason[] {
  const reasons = new Set<EvidenceReadinessReason>();

  for (const role of input.missingRoles) {
    for (const observation of input.elsewhere) {
      if (observation.economicsRole !== role) continue;

      const sameChannelAndBranch =
        observation.channelId === input.key.channelId &&
        observation.branchId === input.key.branchId;

      if (sameChannelAndBranch) {
        if (
          sameRange(observation, input.key) &&
          observation.periodTimezone !== input.key.periodTimezone
        ) {
          reasons.add("role_supplied_by_different_timezone");
          continue;
        }
        if (!sameRange(observation, input.key) && rangesIntersect(observation, input.key)) {
          reasons.add("role_supplied_by_different_period");
        }
        continue;
      }

      if (
        sameRange(observation, input.key) &&
        observation.periodTimezone === input.key.periodTimezone
      ) {
        reasons.add("role_supplied_by_different_branch_or_channel");
      }
    }
  }

  return [...reasons];
}

function costCoverageReasons(coverage: ReadinessCostCoverage): EvidenceReadinessReason[] {
  if (coverage.outcome === "unchecked") return ["cost_coverage_unchecked"];
  if (coverage.components.length === 0) return ["cost_coverage_absent"];

  const covered = coverage.components.filter((component) => component.covered);
  if (covered.length === 0) return ["cost_coverage_absent"];
  if (covered.length < coverage.components.length) return ["cost_coverage_incomplete"];
  return [];
}

/** The worst state any of these reasons implies. */
function stateForReasons(reasons: readonly EvidenceReadinessReason[]): EvidenceReadinessState {
  const blocked: readonly EvidenceReadinessReason[] = [
    "overlap_awaiting_reconciliation",
    "evidence_superseded_without_replacement",
    "evidence_excluded",
    "source_package_failed",
  ];
  const notComparable: readonly EvidenceReadinessReason[] = [
    "role_bound_to_conflicting_metrics",
    "currency_conflict_within_period",
    "role_supplied_by_different_period",
    "role_supplied_by_different_timezone",
    "role_supplied_by_different_branch_or_channel",
  ];
  const needsData: readonly EvidenceReadinessReason[] = [
    "revenue_role_absent",
    "transaction_count_role_absent",
    "cost_coverage_unchecked",
    "cost_coverage_absent",
  ];

  if (reasons.some((reason) => blocked.includes(reason))) return "blocked";
  if (reasons.some((reason) => notComparable.includes(reason))) return "not_comparable";
  if (reasons.some((reason) => needsData.includes(reason))) return "needs_data";
  if (reasons.length > 0) return "partial_evidence";
  return "ready_for_economics";
}

function compareTuples(left: ReadinessTuple, right: ReadinessTuple): number {
  return (
    left.channelId.localeCompare(right.channelId) ||
    left.branchId.localeCompare(right.branchId) ||
    left.periodStart.localeCompare(right.periodStart) ||
    left.periodEnd.localeCompare(right.periodEnd) ||
    left.periodTimezone.localeCompare(right.periodTimezone)
  );
}

/**
 * A digest over the ordered classification, so the same evidence always yields
 * the same response.
 *
 * Only identifiers, dates, states, and reason codes go in. There is nothing
 * else available to put in, which is the point: a readiness digest that changed
 * because a number moved would be reporting the number.
 */
function digestOf(tuples: readonly ReadinessTuple[], coverage: ReadinessCostCoverage): string {
  const rows = tuples.map((tuple) =>
    [
      tuple.channelId,
      tuple.branchId,
      tuple.periodStart,
      tuple.periodEnd,
      tuple.periodTimezone,
      tuple.currency ?? "",
      tuple.state,
      [...tuple.reasons].sort().join(","),
      [...tuple.rolesPresent].sort().join(","),
      [...tuple.observationIds].sort().join(","),
    ].join("|"),
  );

  const coverageRow =
    coverage.outcome === "unchecked"
      ? "unchecked"
      : [...coverage.components]
          .map((component) => `${component.key}:${component.covered}:${component.tier ?? ""}`)
          .sort()
          .join(",");

  return createHash("sha256")
    .update([`v${EVIDENCE_READINESS_MODEL_VERSION}`, coverageRow, ...rows].join("\n"))
    .digest("hex");
}

/**
 * Classify every organization/channel/branch/exact-period tuple the
 * organization holds governed evidence for.
 *
 * Observations arrive in any order and are grouped here rather than by the
 * query, so ordering is a property of this function and can be asserted.
 */
export function classifyEvidenceReadiness(input: {
  observations: readonly ReadinessObservation[];
  costCoverage: ReadinessCostCoverage;
}): EvidenceReadinessModel {
  const coverageReasons = costCoverageReasons(input.costCoverage);

  // Grouped by the tuple key alone. Every observation counts toward its group,
  // including the held and the retired ones: a period whose only evidence was
  // superseded still exists as a question, and dropping it here would let it
  // disappear from the panel rather than be reported as blocked.
  const groups = new Map<string, ReadinessObservation[]>();
  for (const observation of input.observations) {
    const key = tupleKeyOf(observation);
    const group = groups.get(key);
    if (group) group.push(observation);
    else groups.set(key, [observation]);
  }

  const tuples: ReadinessTuple[] = [];

  for (const group of groups.values()) {
    const first = group[0];
    if (!first) continue;

    const key: ReadinessTupleKey = {
      channelId: first.channelId,
      branchId: first.branchId,
      periodStart: first.periodStart,
      periodEnd: first.periodEnd,
      periodTimezone: first.periodTimezone,
    };

    const current = group.filter((observation) => observation.reconciliationState === "current");
    const reasons = new Set<EvidenceReadinessReason>();

    // Blocked, decided over the whole group rather than the current subset.
    if (group.some((observation) => observation.reconciliationState === "blocked_overlap")) {
      reasons.add("overlap_awaiting_reconciliation");
    }
    if (group.some((observation) => observation.packageState === "reconciliation_required")) {
      reasons.add("overlap_awaiting_reconciliation");
    }
    if (group.some((observation) => observation.packageState === "failed")) {
      reasons.add("source_package_failed");
    }
    if (current.length === 0) {
      if (group.some((observation) => observation.reconciliationState === "superseded")) {
        reasons.add("evidence_superseded_without_replacement");
      }
      if (group.some((observation) => observation.reconciliationState === "excluded")) {
        reasons.add("evidence_excluded");
      }
    }

    // Comparability inside the tuple.
    const byRole = new Map<EconomicsRole, ReadinessObservation[]>();
    for (const observation of current) {
      if (!observation.economicsRole) continue;
      const bucket = byRole.get(observation.economicsRole);
      if (bucket) bucket.push(observation);
      else byRole.set(observation.economicsRole, [observation]);
    }

    for (const supplying of byRole.values()) {
      const definitions = new Set(supplying.map((observation) => observation.metricDefinitionId));
      if (definitions.size > 1) reasons.add("role_bound_to_conflicting_metrics");
    }

    const currencies = new Set(
      current
        .map((observation) => observation.currency)
        .filter((currency): currency is string => currency !== null),
    );
    if (currencies.size > 1) reasons.add("currency_conflict_within_period");

    // Required roles, and where they went if they are not here.
    const missingRoles = REQUIRED_ROLES.filter((role) => !byRole.has(role));
    for (const reason of incomparabilityReasons({
      key,
      missingRoles,
      elsewhere: input.observations.filter(
        (observation) =>
          observation.reconciliationState === "current" &&
          tupleKeyOf(observation) !== tupleKeyOf(first),
      ),
    })) {
      reasons.add(reason);
    }

    if (!byRole.has("gross_revenue")) reasons.add("revenue_role_absent");
    if (!byRole.has("transaction_count")) reasons.add("transaction_count_role_absent");

    // Quality, read only from the observations that actually supply a role.
    const supplying = current.filter((observation) =>
      REQUIRED_ROLES.some((role) => observation.economicsRole === role),
    );
    if (supplying.some((observation) => observation.qualityState === "partial")) {
      reasons.add("evidence_quality_partial");
    }
    if (supplying.some((observation) => observation.completenessState === "partial")) {
      reasons.add("evidence_completeness_partial");
    }

    for (const reason of coverageReasons) reasons.add(reason);

    const ordered = [...reasons].sort(
      (left, right) =>
        STATE_ORDER.indexOf(stateForReasons([left])) -
          STATE_ORDER.indexOf(stateForReasons([right])) || left.localeCompare(right),
    );

    tuples.push({
      ...key,
      state: stateForReasons(ordered),
      reasons: ordered,
      currency: [...currencies].sort()[0] ?? null,
      rolesPresent: [...byRole.keys()].sort(),
      observationIds: current.map((observation) => observation.observationId).sort(),
      reportPackageIds: [
        ...new Set(group.map((observation) => observation.reportPackageId)),
      ].sort(),
    });
  }

  tuples.sort(compareTuples);

  return {
    readModelVersion: EVIDENCE_READINESS_MODEL_VERSION,
    tuples,
    costCoverage: input.costCoverage,
    digest: digestOf(tuples, input.costCoverage),
  };
}
