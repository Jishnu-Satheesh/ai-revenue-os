import { describe, expect, it } from "vitest";

import {
  GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY,
  governedCampaignDraftPlaybookV1,
} from "@/modules/decisions/playbooks/governed-campaign-draft-v1";

describe("governedCampaignDraftPlaybookV1", () => {
  it("is a Tier-1 internal draft action with no provider capabilities", () => {
    expect(GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY).toBe("campaign.governed_draft_v1");
    expect(governedCampaignDraftPlaybookV1.actionKey).toBe(GOVERNED_CAMPAIGN_DRAFT_ACTION_KEY);
    expect(governedCampaignDraftPlaybookV1.riskClass).toBe(1);
    expect(governedCampaignDraftPlaybookV1.requiredCapabilityKeys).toEqual([]);
  });

  it("declares the section 10.1 evidence it needs up front", () => {
    expect(governedCampaignDraftPlaybookV1.requiredEvidenceKeys).toContain(
      "market_support_primary_or_corroborated",
    );
    expect(governedCampaignDraftPlaybookV1.requiredEvidenceKeys).toContain(
      "brand_assets_usable_or_synthetic_allowed",
    );
    expect(governedCampaignDraftPlaybookV1.requiredEvidenceKeys).toContain(
      "evaluation_template_registered",
    );
    expect(governedCampaignDraftPlaybookV1.primaryMetricKey).toBe(
      "contribution.incremental_gross_profit",
    );
  });
});
