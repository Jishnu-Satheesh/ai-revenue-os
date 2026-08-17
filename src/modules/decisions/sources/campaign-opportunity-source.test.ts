import { describe, expect, it } from "vitest";

import { CAMPAIGN_META_BUNDLE_ACTION_KEY } from "@/modules/decisions/playbooks/meta-campaign-v1";
import {
  createCampaignOpportunitySource,
  type CampaignEvidence,
} from "@/modules/decisions/sources/campaign-opportunity-source";

const organizationId = "11111111-1111-4111-8111-111111111111";
const playbookVersionId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-08-12T12:00:00.000Z");

function evidence(overrides: Partial<CampaignEvidence> = {}): CampaignEvidence {
  return {
    organizationProfileCurrent: true,
    brandConstraintsVerified: true,
    brandAssetsUsable: true,
    syntheticAssetsAllowed: false,
    economics: { currency: "AED", completenessGrade: "complete" },
    activeGoalMetricKeys: ["contribution.incremental_gross_profit"],
    metaAccountMapped: true,
    grantedCapabilityKeys: ["publish_instagram", "publish_facebook", "advertise_meta_ads"],
    spendPolicy: { monthlyBudgetMinor: 1_000_000, currency: "AED" },
    trackingReady: true,
    measurementPlanRegistered: true,
    accessPolicyActive: true,
    marginFirewallResult: "pass",
    impactEvidence: {
      evidenceTier: "computed",
      impactLowMinor: 600_000,
      impactHighMinor: 900_000,
      currency: "AED",
      sourceRevisionIds: ["metric-revision-1", "economics-revision-1"],
      observedAt: new Date("2026-08-12T06:00:00.000Z"),
      timeToImpactDays: 7,
      completenessGrade: "complete",
    },
    inputsObservedAt: new Date("2026-08-12T06:00:00.000Z"),
    observedVolume: 420,
    ...overrides,
  };
}

const source = createCampaignOpportunitySource();

function generate(overrides: Partial<CampaignEvidence> = {}) {
  return source.generate({
    organizationId,
    playbookVersionId,
    evidence: evidence(overrides),
    now,
  });
}

describe("campaign opportunity source", () => {
  it("declares the inputs it requires before it is ever run", () => {
    expect(source.requiredEvidenceKeys).toContain("economics_configured");
    expect(source.playbookActionKey).toBe(CAMPAIGN_META_BUNDLE_ACTION_KEY);
  });

  it("yields one candidate for one action when every input is present", () => {
    const result = generate();

    expect(result.outcome).toBe("candidates");
    if (result.outcome !== "candidates") return;
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.parameters.spendCeiling.currency).toBe("AED");
    expect(result.candidates[0]?.impactEvidence.sourceRevisionIds).toEqual([
      "metric-revision-1",
      "economics-revision-1",
    ]);
  });

  it("requires defensible impact evidence rather than treating margin as campaign lift", () => {
    const result = generate({ impactEvidence: null });

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingEvidenceKeys).toEqual(
      expect.arrayContaining([
        "impact.range",
        "impact.currency",
        "impact.source_revisions",
        "impact.observed_at",
        "impact.time_to_impact",
      ]),
    );
  });

  it("names every incomplete impact field and never manufactures a candidate", () => {
    const result = generate({
      impactEvidence: {
        evidenceTier: "computed",
        impactLowMinor: null,
        impactHighMinor: null,
        currency: null,
        sourceRevisionIds: [],
        observedAt: null,
        timeToImpactDays: null,
        completenessGrade: "complete",
      },
    });

    expect(result).toEqual({
      outcome: "needs_data",
      missingEvidenceKeys: expect.arrayContaining([
        "impact.range",
        "impact.currency",
        "impact.source_revisions",
        "impact.observed_at",
        "impact.time_to_impact",
      ]),
      missingCapabilityKeys: [],
    });
    expect("candidates" in result).toBe(false);
  });

  it("rejects unsupported observed or prior impact evidence", () => {
    for (const evidenceTier of ["observed", "prior"] as const) {
      const complete = evidence().impactEvidence!;
      const result = generate({ impactEvidence: { ...complete, evidenceTier } });
      expect(result.outcome).toBe("needs_data");
      if (result.outcome !== "needs_data") continue;
      expect(result.missingEvidenceKeys).toContain("impact.approved_source");
    }
  });

  it("routes unknown margin to needs_data but treats a breach as a deterministic rejection", () => {
    const unknown = generate({ marginFirewallResult: "unknown" });
    expect(unknown.outcome).toBe("needs_data");
    if (unknown.outcome === "needs_data") {
      expect(unknown.missingEvidenceKeys).toContain("margin.firewall.pass");
    }

    expect(generate({ marginFirewallResult: "breach" })).toEqual({
      outcome: "rejected",
      rejectionReason: "margin_firewall_breach",
    });
  });

  it.each([
    ["organizationProfileCurrent", "organization_profile_current"],
    ["brandConstraintsVerified", "brand_constraints_verified"],
    ["metaAccountMapped", "meta_account_mapped"],
    ["trackingReady", "tracking_ready"],
  ] as const)("names %s as the missing input rather than guessing", (field, expectedKey) => {
    const result = generate({ [field]: false } as Partial<CampaignEvidence>);

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingEvidenceKeys).toContain(expectedKey);
  });

  it("accepts an explicit synthetic-asset allowance in place of usable brand assets", () => {
    expect(generate({ brandAssetsUsable: false, syntheticAssetsAllowed: true }).outcome).toBe(
      "candidates",
    );
    expect(generate({ brandAssetsUsable: false, syntheticAssetsAllowed: false }).outcome).toBe(
      "needs_data",
    );
  });

  it("treats an indicative economics grade as needs_data, never a prior-tier guess", () => {
    const result = generate({ economics: { currency: "AED", completenessGrade: "indicative" } });

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingEvidenceKeys).toContain("economics_configured");
  });

  it("yields needs_data when a required capability is not granted", () => {
    const result = generate({ grantedCapabilityKeys: ["publish_instagram"] });

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingEvidenceKeys).toContain("action_capabilities_granted");
    expect(result.missingCapabilityKeys).toEqual(["publish_facebook", "advertise_meta_ads"]);
  });

  it("yields needs_data rather than a zero cost when no spend policy is configured", () => {
    const result = generate({ spendPolicy: null });

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingEvidenceKeys).toContain("spend_policy_configured");
    expect(result.missingEvidenceKeys).toContain("policy.spend.active");
  });

  it("refuses to mix currencies between economics and the spend policy", () => {
    const result = generate({ spendPolicy: { monthlyBudgetMinor: 1_000_000, currency: "USD" } });

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingEvidenceKeys).toContain("currency_agreement");
  });

  it("yields needs_data when inputs are older than the playbook freshness bound", () => {
    const result = generate({ inputsObservedAt: new Date("2026-08-09T00:00:00.000Z") });

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingEvidenceKeys).toContain("inputs_fresh");
  });

  it("yields needs_data when no complete authoritative input timestamp exists", () => {
    const result = generate({ inputsObservedAt: null });

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingEvidenceKeys).toContain("inputs_fresh");
  });

  it("reports every missing input at once, so the operator gets one list", () => {
    const result = generate({ trackingReady: false, metaAccountMapped: false });

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingEvidenceKeys).toEqual(
      expect.arrayContaining(["tracking_ready", "meta_account_mapped"]),
    );
  });

  it("never yields a candidate alongside a needs_data outcome", () => {
    const result = generate({ trackingReady: false });

    expect(result.outcome).toBe("needs_data");
    expect("candidates" in result).toBe(false);
  });

  it("produces a stable fingerprint across runs with identical evidence", () => {
    const first = generate();
    const second = generate();

    if (first.outcome !== "candidates" || second.outcome !== "candidates") throw new Error("setup");
    expect(first.candidates[0]?.candidateFingerprint).toBe(
      second.candidates[0]?.candidateFingerprint,
    );
  });

  it("cannot propose a campaign today, because no Meta capability is grantable", () => {
    // The Meta provider declares its capabilities as blocked and ships no
    // adapter, so no organization can hold these grants yet. The source must
    // say so by name rather than proposing something unexecutable.
    const result = generate({ grantedCapabilityKeys: [] });

    expect(result.outcome).toBe("needs_data");
    if (result.outcome !== "needs_data") return;
    expect(result.missingCapabilityKeys).toEqual([
      "publish_instagram",
      "publish_facebook",
      "advertise_meta_ads",
    ]);
  });

  it("caps the proposed spend ceiling at the configured monthly budget", () => {
    const result = generate({ spendPolicy: { monthlyBudgetMinor: 25_000, currency: "AED" } });

    if (result.outcome !== "candidates") throw new Error("expected candidates");
    expect(result.candidates[0]?.parameters.spendCeiling.amountMinor).toBeLessThanOrEqual(25_000);
  });
});
