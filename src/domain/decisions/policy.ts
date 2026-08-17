import { DecisionError } from "@/domain/decisions/errors";
import type { ScoredCandidate } from "@/domain/decisions/value";

/**
 * The policy check runs after scoring and never moves a number.
 *
 * Per ADR 0014, tiers 0 through 3 select an approval path and leave the score
 * untouched in either direction; tier 4 removes the candidate outright. Risk is
 * a gate, not a term. See `specs/005` section 5.7.
 */
export type RiskTier = 0 | 1 | 2 | 3 | 4;

export type MarginFirewallOutcome = "pass" | "breach" | "unknown";

export type ApprovalPath = "automatic" | "human_approval";

export type PolicyGateCandidate = ScoredCandidate & {
  riskTier: RiskTier;
  marginFirewall: MarginFirewallOutcome;
};

export type AdmittedCandidate = PolicyGateCandidate & { approvalPath: ApprovalPath };

export type PolicyRemovalReason =
  | "risk_tier_prohibited"
  | "budget_exhausted"
  | "margin_firewall_breach";

export type PolicyRemoval = {
  candidateFingerprint: string;
  reason: PolicyRemovalReason;
};

export type PolicyNeedsData = {
  candidateFingerprint: string;
  missingInput: string;
};

export type PolicyContext = {
  policyVersionId: string;
  remainingBudgetMinor: number;
  currency: string;
};

export type PolicyGateResult = {
  admitted: readonly AdmittedCandidate[];
  removed: readonly PolicyRemoval[];
  needsData: readonly PolicyNeedsData[];
};

export function applyPolicyGate(
  candidates: readonly PolicyGateCandidate[],
  policy: PolicyContext,
): PolicyGateResult {
  if (!policy.policyVersionId) {
    // A missing policy version halts the cycle and raises an alert. It never
    // defaults to permissive.
    throw new DecisionError(
      "DECISION_POLICY_VERSION_MISSING",
      "No active policy version; the cycle halts rather than defaulting to permissive.",
    );
  }

  const admitted: AdmittedCandidate[] = [];
  const removed: PolicyRemoval[] = [];
  const needsData: PolicyNeedsData[] = [];
  let remainingBudgetMinor = policy.remainingBudgetMinor;

  for (const candidate of candidates) {
    if (candidate.currency !== policy.currency) {
      throw new DecisionError(
        "DECISION_CURRENCY_MISMATCH",
        "Candidate currency does not match the policy budget currency.",
      );
    }

    if (candidate.marginFirewall === "breach") {
      removed.push({
        candidateFingerprint: candidate.candidateFingerprint,
        reason: "margin_firewall_breach",
      });
      continue;
    }

    // A data gap is a platform problem and a breach is a business problem;
    // an unknown outcome never silently passes as either.
    if (candidate.marginFirewall === "unknown") {
      needsData.push({
        candidateFingerprint: candidate.candidateFingerprint,
        missingInput: "margin_firewall_outcome",
      });
      continue;
    }

    if (candidate.riskTier === 4) {
      removed.push({
        candidateFingerprint: candidate.candidateFingerprint,
        reason: "risk_tier_prohibited",
      });
      continue;
    }

    // Budget is consumed in the order candidates arrive, which is rank order.
    // Exceeding it removes the candidate rather than merely deprioritising it.
    if (candidate.executionCostMinor > remainingBudgetMinor) {
      removed.push({
        candidateFingerprint: candidate.candidateFingerprint,
        reason: "budget_exhausted",
      });
      continue;
    }
    remainingBudgetMinor -= candidate.executionCostMinor;

    admitted.push({
      ...candidate,
      approvalPath: candidate.riskTier === 0 ? "automatic" : "human_approval",
    });
  }

  return { admitted, removed, needsData };
}
