import { describe, expect, it } from "vitest";

import { checkDraftEligibility } from "@/domain/decisions/campaign-draft-eligibility";

function eligibleInput() {
  return {
    businessEvidenceCurrent: true,
    businessEvidenceObservedAt: new Date("2026-09-01T08:00:00.000Z"),
    freshnessBoundMinutes: 60 * 24 * 7,
    marketSupport: "corroborated" as const,
    marketEvidenceUnexpired: true,
    marketProfileApprovedCurrent: true,
    activeGoalMetricKeys: ["contribution.incremental_gross_profit"],
    primaryMetricKey: "contribution.incremental_gross_profit",
    objective: "Lift September gross profit from the Friday dinner rush",
    audience: "Nearby residents ordering weekend delivery",
    brandGuidanceCurrent: true,
    brandAssetsUsable: false,
    syntheticAssetPathAllowed: true,
    impact: {
      impactLowMinor: 100_00,
      impactHighMinor: 400_00,
      executionCostMinor: 50_00,
      currency: "AED",
      confidence: 0.6,
      confidenceBasis: "computed tier over complete evidence",
      evidenceTier: "computed" as const,
      timeToImpactDays: 14,
      assumptions: ["Friday demand repeats"],
      sourceRevisionIds: ["rev-1"],
      observedAt: new Date("2026-09-01T08:00:00.000Z"),
    },
    evaluationTemplateRegistered: true,
    assertionsRecheckable: true,
    currencyAgreement: true,
    policyProhibition: false,
    governanceBreach: false,
    now: new Date("2026-09-04T10:00:00.000Z"),
  };
}

describe("checkDraftEligibility", () => {
  it("declares an eligible draft with its qualified impact", () => {
    const outcome = checkDraftEligibility(eligibleInput());

    expect(outcome.eligible).toBe(true);
    if (!outcome.eligible) return;
    expect(outcome.impact.expectedContributionMinor).toBe(100_00);
  });

  it("names each missing prerequisite as a data gap instead of refusing", () => {
    const stale = checkDraftEligibility({
      ...eligibleInput(),
      businessEvidenceObservedAt: new Date("2026-01-01T08:00:00.000Z"),
    });
    expect(stale.eligible).toBe(false);
    if (stale.eligible) return;
    expect(stale.missingGaps).toContain("business_evidence_current");

    const single = checkDraftEligibility({
      ...eligibleInput(),
      marketSupport: "single_source",
      marketEvidenceUnexpired: true,
    });
    expect(single.eligible).toBe(false);
    if (single.eligible) return;
    expect(single.missingGaps).toContain("market_support_primary_or_corroborated");
  });

  it("keeps the item a recommendation when the goal, objective, or evaluation is missing", () => {
    for (const patch of [
      { activeGoalMetricKeys: ["other.metric"] },
      { objective: "  " },
      { audience: "" },
      { evaluationTemplateRegistered: false },
      { assertionsRecheckable: false },
    ]) {
      const outcome = checkDraftEligibility({ ...eligibleInput(), ...patch });
      expect(outcome.eligible).toBe(false);
    }
  });

  it("treats prohibition, breach, and currency conflict as ineligibility, never as gaps to fill", () => {
    for (const patch of [
      { policyProhibition: true },
      { governanceBreach: true },
      { currencyAgreement: false },
    ]) {
      const outcome = checkDraftEligibility({ ...eligibleInput(), ...patch });
      expect(outcome.eligible).toBe(false);
      if (outcome.eligible) return;
      expect(outcome.missingGaps).toEqual([]);
    }
  });

  it("never blocks on provider mapping, publishing, ad accounts, spend, or tracking", () => {
    const outcome = checkDraftEligibility({
      ...eligibleInput(),
      providerMappingPresent: false,
      publishPermissionGranted: false,
      adAccountCapability: false,
      spendAuthorizationPresent: false,
      trackingReady: false,
    });

    expect(outcome.eligible).toBe(true);
  });
});
