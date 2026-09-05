import { describe, expect, it } from "vitest";

import {
  createGrowthIntelligenceOpportunitySource,
  type GrowthIntelligenceSourceInput,
} from "@/modules/decisions/sources/growth-intelligence-opportunity-source";
import { GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY } from "@/modules/decisions/playbooks/governed-campaign-draft-v1";

function input(overrides: Partial<GrowthIntelligenceSourceInput["evidence"]> = {}) {
  const evidence: GrowthIntelligenceSourceInput["evidence"] = {
    itemKind: "recommendation",
    itemId: "70000000-0000-4000-8000-000000000007",
    itemFingerprint: "a".repeat(64),
    narrative: "Extend Friday hours from observed dinner demand.",
    businessEvidenceCurrent: true,
    businessEvidenceObservedAt: new Date("2026-09-01T08:00:00.000Z"),
    marketSupport: "corroborated",
    marketEvidenceUnexpired: true,
    marketProfileApprovedCurrent: true,
    activeGoalMetricKeys: ["contribution.incremental_gross_profit"],
    objective: "Lift September gross profit from the Friday dinner rush",
    audience: "Nearby residents ordering weekend delivery",
    brandGuidanceCurrent: true,
    brandAssetsUsable: true,
    syntheticAssetPathAllowed: false,
    impact: {
      impactLowMinor: 100_00,
      impactHighMinor: 400_00,
      executionCostMinor: 50_00,
      currency: "AED",
      confidence: 0.6,
      confidenceBasis: "computed tier over complete evidence",
      evidenceTier: "computed",
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
    ...overrides,
  };
  return {
    organizationId: "10000000-0000-4000-8000-000000000001",
    playbookVersionId: "52000000-0000-4000-8000-000000000052",
    evidence,
    now: new Date("2026-09-04T10:00:00.000Z"),
  } satisfies GrowthIntelligenceSourceInput;
}

describe("createGrowthIntelligenceOpportunitySource", () => {
  it("proposes a governed-draft candidate for an eligible recommendation", () => {
    const source = createGrowthIntelligenceOpportunitySource();
    const result = source.generate(input());

    expect(source.playbookActionKey).toBe(GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY);
    expect(result.outcome).toBe("candidates");
    if (result.outcome !== "candidates") return;
    expect(result.candidates).toHaveLength(1);
    const candidate = result.candidates[0]!;
    expect(candidate.parameters.objective).toContain("Friday");
    expect(candidate.parameters.itemFingerprint).toBe("a".repeat(64));
    expect(candidate.impactEvidence.expectedContributionMinor).toBe(100_00);
  });

  it("returns named gaps for an insight, a stale input, or a missing objective", () => {
    const source = createGrowthIntelligenceOpportunitySource();

    const insight = source.generate(input({ itemKind: "insight" }));
    expect(insight.outcome).toBe("needs_data");
    if (insight.outcome !== "needs_data") return;
    expect(insight.missingEvidenceKeys).toContain("item_kind_recommendation");

    const stale = source.generate(
      input({ businessEvidenceObservedAt: new Date("2026-01-01T08:00:00.000Z") }),
    );
    expect(stale.outcome).toBe("needs_data");
    if (stale.outcome !== "needs_data") return;
    expect(stale.missingEvidenceKeys).toContain("business_evidence_current");

    const noObjective = source.generate(input({ objective: "  " }));
    expect(noObjective.outcome).toBe("needs_data");
    if (noObjective.outcome !== "needs_data") return;
    expect(noObjective.missingEvidenceKeys).toContain("campaign_objective");
  });

  it("never asks for provider mapping, spend, or tracking on an internal draft", () => {
    const source = createGrowthIntelligenceOpportunitySource();
    const result = source.generate(input());

    expect(result.outcome).toBe("candidates");
    if (result.outcome !== "candidates") return;
    expect(source.requiredCapabilityKeys).toEqual([]);
  });
});
