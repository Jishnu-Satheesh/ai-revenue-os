import { describe, expect, it } from "vitest";

import { DecisionError } from "@/domain/decisions/errors";
import { applyPolicyGate, type PolicyGateCandidate } from "@/domain/decisions/policy";
import { expectedContributionMinor } from "@/domain/decisions/value";

function candidate(overrides: Partial<PolicyGateCandidate> = {}): PolicyGateCandidate {
  return {
    candidateFingerprint: "a".repeat(64),
    evidenceTier: "computed",
    impactLowMinor: 1000,
    impactHighMinor: 3000,
    executionCostMinor: 500,
    currency: "AED",
    confidence: 0.5,
    timeToImpactDays: 7,
    riskTier: 1,
    marginFirewall: "pass",
    ...overrides,
  };
}

const policy = {
  policyVersionId: "policy-1",
  remainingBudgetMinor: 10_000,
  currency: "AED",
};

describe("policy gate", () => {
  it("keeps a passing candidate and selects an approval path without touching its score", () => {
    const before = expectedContributionMinor(candidate());
    const result = applyPolicyGate([candidate()], policy);

    expect(result.admitted).toHaveLength(1);
    expect(expectedContributionMinor(result.admitted[0]!)).toBe(before);
    expect(result.admitted[0]!.approvalPath).toBe("human_approval");
  });

  it("routes tier 0 to automatic and tiers 1 through 3 to human approval", () => {
    const result = applyPolicyGate(
      [0, 1, 2, 3].map((riskTier, index) =>
        candidate({
          riskTier: riskTier as 0 | 1 | 2 | 3,
          candidateFingerprint: String(index).repeat(64),
        }),
      ),
      policy,
    );

    expect(result.admitted.map((c) => c.approvalPath)).toEqual([
      "automatic",
      "human_approval",
      "human_approval",
      "human_approval",
    ]);
  });

  it("removes a tier 4 candidate with a recorded reason rather than deprioritising it", () => {
    const result = applyPolicyGate([candidate({ riskTier: 4 })], policy);

    expect(result.admitted).toHaveLength(0);
    expect(result.removed[0]).toMatchObject({ reason: "risk_tier_prohibited" });
  });

  it("removes a candidate whose execution cost exceeds the remaining budget", () => {
    const result = applyPolicyGate([candidate({ executionCostMinor: 50_000 })], policy);

    expect(result.admitted).toHaveLength(0);
    expect(result.removed[0]).toMatchObject({ reason: "budget_exhausted" });
  });

  it("treats a cost exactly equal to the remaining budget as affordable", () => {
    const result = applyPolicyGate([candidate({ executionCostMinor: 10_000 })], policy);

    expect(result.admitted).toHaveLength(1);
  });

  it("removes a candidate the margin firewall breached", () => {
    const result = applyPolicyGate([candidate({ marginFirewall: "breach" })], policy);

    expect(result.admitted).toHaveLength(0);
    expect(result.removed[0]).toMatchObject({ reason: "margin_firewall_breach" });
  });

  it("converts an unknown firewall outcome to needs_data rather than passing it", () => {
    const result = applyPolicyGate([candidate({ marginFirewall: "unknown" })], policy);

    expect(result.admitted).toHaveLength(0);
    expect(result.needsData[0]).toMatchObject({ missingInput: "margin_firewall_outcome" });
  });

  it("refuses to evaluate against a budget in another currency", () => {
    expect(() => applyPolicyGate([candidate()], { ...policy, currency: "USD" })).toThrow(
      DecisionError,
    );
  });

  it("halts rather than defaulting to permissive when the policy version is missing", () => {
    expect(() => applyPolicyGate([candidate()], { ...policy, policyVersionId: "" })).toThrow(
      DecisionError,
    );
  });

  it("charges each admitted candidate against the remaining budget in rank order", () => {
    // Two candidates at 6000 each cannot both fit a 10000 budget.
    const result = applyPolicyGate(
      [
        candidate({ candidateFingerprint: "1".repeat(64), executionCostMinor: 6000 }),
        candidate({ candidateFingerprint: "2".repeat(64), executionCostMinor: 6000 }),
      ],
      policy,
    );

    expect(result.admitted).toHaveLength(1);
    expect(result.removed[0]).toMatchObject({ reason: "budget_exhausted" });
  });
});
