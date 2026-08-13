import { describe, expect, it } from "vitest";

import { mapCampaignEvidence } from "@/modules/decisions/infrastructure/campaign-evidence-repository";

describe("production Campaign evidence mapping", () => {
  it("maps only bounded authoritative fields and never creates impact evidence", () => {
    expect(
      mapCampaignEvidence(
        {
          organizationProfileCurrent: true,
          brandConstraintsVerified: false,
          brandAssetsUsable: false,
          syntheticAssetsAllowed: false,
          economics: { currency: "AED", completenessGrade: "complete" },
          activeGoalMetricKeys: ["contribution.incremental_gross_profit"],
          metaAccountMapped: false,
          grantedCapabilityKeys: [],
          trackingReady: false,
          measurementPlanRegistered: true,
          marginFirewallResult: "unknown",
          inputsObservedAt: "2026-08-13T12:00:00.000Z",
          observedVolume: 12,
        },
        null,
      ),
    ).toEqual({
      organizationProfileCurrent: true,
      brandConstraintsVerified: false,
      brandAssetsUsable: false,
      syntheticAssetsAllowed: false,
      economics: { currency: "AED", completenessGrade: "complete" },
      activeGoalMetricKeys: ["contribution.incremental_gross_profit"],
      metaAccountMapped: false,
      grantedCapabilityKeys: [],
      spendPolicy: null,
      trackingReady: false,
      measurementPlanRegistered: true,
      accessPolicyActive: true,
      marginFirewallResult: "unknown",
      impactEvidence: null,
      inputsObservedAt: new Date("2026-08-13T12:00:00.000Z"),
      observedVolume: 12,
    });
  });

  it("does not interpret onboarding prose or uploaded files as verified brand evidence", () => {
    const mapped = mapCampaignEvidence(
      {
        organizationProfileCurrent: true,
        brandConstraintsVerified: false,
        brandAssetsUsable: false,
        syntheticAssetsAllowed: false,
        economics: null,
        activeGoalMetricKeys: [],
        metaAccountMapped: false,
        grantedCapabilityKeys: [],
        trackingReady: false,
        measurementPlanRegistered: true,
        marginFirewallResult: "unknown",
        inputsObservedAt: "2026-08-13T12:00:00.000Z",
        observedVolume: 0,
      },
      { id: "11111111-1111-4111-8111-111111111111", monthlyBudgetMinor: 1, currency: "AED" },
    );

    expect(mapped.brandConstraintsVerified).toBe(false);
    expect(mapped.brandAssetsUsable).toBe(false);
    expect(mapped.impactEvidence).toBeNull();
  });
});
