import {
  memoryPurposes,
  sensitivities,
  type MemoryPurpose,
  type Sensitivity,
} from "@/domain/memory/types";
import type { OrganizationRole } from "@/domain/organizations/types";

export { memoryPurposes, sensitivities };

/**
 * The purpose-to-ceiling map is a constant, so a caller can never raise its own
 * allowance. A request whose requested sensitivity exceeds its ceiling is
 * rejected outright rather than quietly downgraded: silently returning a
 * narrower set would let a worker believe it had seen everything it asked for.
 *
 * No worker purpose reaches `customer_content` in V1. Only a human with an
 * owner or admin role can retrieve customer content, and only through the
 * workspace.
 */
const ceilingByWorkerPurpose: Readonly<
  Record<Exclude<MemoryPurpose, "operator_search">, Sensitivity>
> = {
  decision_context: "internal",
  opportunity_generation: "internal",
  outcome_analysis: "confidential",
  onboarding_assist: "internal",
};

const ceilingByRole: Readonly<Record<OrganizationRole, Sensitivity>> = {
  owner: "customer_content",
  admin: "customer_content",
  operator: "internal",
  viewer: "internal",
};

/**
 * Operator search carries the caller's role, and the union makes omitting it a
 * compile error rather than a runtime hazard. An unrecognized role still fails
 * closed to the most restrictive class, because role values can arrive from
 * persisted rows that predate a vocabulary change.
 */
export type SensitivityCeilingInput =
  | { purpose: "operator_search"; role: OrganizationRole }
  | { purpose: Exclude<MemoryPurpose, "operator_search">; role?: never };

export function sensitivityCeilingFor(input: SensitivityCeilingInput): Sensitivity {
  if (input.purpose === "operator_search") {
    return ceilingByRole[input.role] ?? "public";
  }
  return ceilingByWorkerPurpose[input.purpose] ?? "public";
}

const restrictionRank: Readonly<Record<Sensitivity, number>> = {
  public: 0,
  internal: 1,
  confidential: 2,
  customer_content: 3,
};

export function isSensitivityWithinCeiling(requested: Sensitivity, ceiling: Sensitivity): boolean {
  return restrictionRank[requested] <= restrictionRank[ceiling];
}

/** The sensitivity classes a caller at this ceiling may see, most restrictive last. */
export function sensitivitiesWithinCeiling(ceiling: Sensitivity): readonly Sensitivity[] {
  return sensitivities.filter((sensitivity) => isSensitivityWithinCeiling(sensitivity, ceiling));
}
