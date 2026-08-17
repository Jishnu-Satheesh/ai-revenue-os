import { describe, expect, it } from "vitest";

import {
  CAMPAIGN_META_BUNDLE_ACTION_KEY,
  campaignActionParametersSchema,
  metaCampaignPlaybookV1,
} from "@/modules/decisions/playbooks/meta-campaign-v1";

const parameters = {
  objective: "Lift weekday dinner covers",
  channels: ["instagram", "facebook"],
  placements: ["feed_image", "image_story"],
  spendCeiling: { amountMinor: 450_000, currency: "AED" },
  measurementMethod: "reconciliation",
  executionMode: "best_effort",
  constraints: ["no_alcohol_imagery"],
} as const;

describe("meta campaign playbook", () => {
  it("registers exactly one action, because one decision selects one action", () => {
    expect(metaCampaignPlaybookV1.actionKey).toBe(CAMPAIGN_META_BUNDLE_ACTION_KEY);
    expect(CAMPAIGN_META_BUNDLE_ACTION_KEY).toBe("campaign.meta_bundle_v1");
  });

  it("keeps the platform core industry-neutral", () => {
    const serialised = JSON.stringify(metaCampaignPlaybookV1).toLowerCase();

    for (const term of ["restaurant", "menu", "cover", "dish", "kitchen", "diner"]) {
      expect(serialised).not.toContain(term);
    }
  });

  it("accepts a well-formed parameter set", () => {
    expect(campaignActionParametersSchema.parse(parameters).channels).toEqual([
      "instagram",
      "facebook",
    ]);
  });

  it("requires a spend ceiling, because an unbounded cost is needs_data not zero", () => {
    const withoutCeiling = Object.fromEntries(
      Object.entries(parameters).filter(([key]) => key !== "spendCeiling"),
    );

    expect(() => campaignActionParametersSchema.parse(withoutCeiling)).toThrow();
    expect(() =>
      campaignActionParametersSchema.parse({ ...parameters, spendCeiling: null }),
    ).toThrow();
  });

  it("requires money in integer minor units with an explicit currency", () => {
    expect(() =>
      campaignActionParametersSchema.parse({
        ...parameters,
        spendCeiling: { amountMinor: 4500.5, currency: "AED" },
      }),
    ).toThrow();
    expect(() =>
      campaignActionParametersSchema.parse({
        ...parameters,
        spendCeiling: { amountMinor: 450_000, currency: "" },
      }),
    ).toThrow();
  });

  it("accepts only the Meta channels and image placements this slice proved", () => {
    expect(() =>
      campaignActionParametersSchema.parse({ ...parameters, channels: ["tiktok"] }),
    ).toThrow();
    expect(() =>
      campaignActionParametersSchema.parse({ ...parameters, placements: ["reel_video"] }),
    ).toThrow();
  });

  it("requires at least one channel and one placement", () => {
    expect(() => campaignActionParametersSchema.parse({ ...parameters, channels: [] })).toThrow();
    expect(() => campaignActionParametersSchema.parse({ ...parameters, placements: [] })).toThrow();
  });

  it("does not accept creative directions as action parameters", () => {
    // The three directions are downstream alternatives inside the selected
    // action. Admitting them here would turn one decision into a top-K set.
    expect(() =>
      campaignActionParametersSchema.parse({
        ...parameters,
        directions: ["control", "evidence_led", "experimental"],
      }),
    ).toThrow();
  });

  it("declares the capabilities and evidence a candidate needs, without granting them", () => {
    expect(metaCampaignPlaybookV1.requiredCapabilityKeys).toContain("publish_instagram");
    expect(metaCampaignPlaybookV1.requiredEvidenceKeys.length).toBeGreaterThan(0);
    expect(metaCampaignPlaybookV1.riskClass).toBe(3);
    expect(metaCampaignPlaybookV1.requiredImpactEvidenceKeys).toEqual([
      "impact.range",
      "impact.currency",
      "impact.source_revisions",
      "impact.observed_at",
      "impact.time_to_impact",
    ]);
    expect(metaCampaignPlaybookV1.requiredPolicyKeys).toEqual([
      "policy.access.active",
      "policy.spend.active",
    ]);
    expect(metaCampaignPlaybookV1.requiredMarginKeys).toEqual(["margin.firewall.pass"]);
    expect(metaCampaignPlaybookV1.requiredMeasurementKeys).toEqual([
      "measurement.tracking_ready",
      "measurement.plan_registered",
    ]);
    expect(metaCampaignPlaybookV1.prior).toBeNull();
  });

  it("declares a resurface condition as a named signal with a threshold", () => {
    expect(metaCampaignPlaybookV1.resurfaceCondition.signalKey).toBeTruthy();
    expect(typeof metaCampaignPlaybookV1.resurfaceCondition.threshold).toBe("number");
  });

  it("declares a freshness bound and a measurement window", () => {
    expect(metaCampaignPlaybookV1.freshnessBoundMinutes).toBeGreaterThan(0);
    expect(metaCampaignPlaybookV1.measurementWindowDays).toBeGreaterThan(0);
  });
});
