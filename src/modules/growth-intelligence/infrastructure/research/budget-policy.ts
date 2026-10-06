import { z } from "zod";

/**
 * Research day-allowance policy (ADR 0077).
 *
 * The USD 5 organization-day allowance stays the production rule. Workers
 * whose runtime policy resolves to `uncapped` pass the service_role-only
 * `p_skip_allowance` flag on reservation RPCs, so staging and development
 * can run research without spend walls. Every reservation call, ledger row,
 * quote validation, and conflict check stays in place either way.
 *
 * Default-closed: a missing, blank, or unrecognized value resolves to
 * `capped`. Production behavior can never change by accident.
 */
const researchBudgetPolicySchema = z.enum(["capped", "uncapped"]);

export type ResearchBudgetPolicy = z.infer<typeof researchBudgetPolicySchema>;

export function resolveResearchBudgetPolicy(value: unknown): ResearchBudgetPolicy {
  const normalized = typeof value === "string" ? value.trim() : value;
  const parsed = researchBudgetPolicySchema.safeParse(normalized);
  return parsed.success ? parsed.data : "capped";
}

/** True only when the runtime policy explicitly opts out of the day cap. */
export function isResearchBudgetUncapped(
  rawValue: unknown = process.env.RESEARCH_BUDGET_POLICY,
): boolean {
  return resolveResearchBudgetPolicy(rawValue) === "uncapped";
}
