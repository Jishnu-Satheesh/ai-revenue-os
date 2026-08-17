import { describe, expect, it } from "vitest";

import {
  qualifyCampaignSource,
  type QualificationOpportunity,
} from "@/modules/campaigns/application/qualification";

const organizationId = "11111111-1111-4111-8111-111111111111";
const opportunityId = "22222222-2222-4222-8222-222222222222";
const now = new Date("2026-08-12T12:00:00.000Z");

function opportunity(overrides: Partial<QualificationOpportunity> = {}): QualificationOpportunity {
  return {
    id: opportunityId,
    organizationId,
    status: "proposed",
    actionKey: "campaign.meta_bundle_v1",
    playbookVersionId: "33333333-3333-4333-8333-333333333333",
    decisionRecordId: "44444444-4444-4444-8444-444444444444",
    assertions: [{ key: "budget_available", expectedOutcome: "pass" }],
    expiresAt: new Date("2026-08-20T00:00:00.000Z"),
    ...overrides,
  };
}

describe("manual brief qualification", () => {
  it("returns a typed source with no decision record", () => {
    const result = qualifyCampaignSource({
      organizationId,
      source: { kind: "manual_brief", briefId: "brief-1" },
      now,
    });

    expect(result.outcome).toBe("qualified");
    if (result.outcome !== "qualified") return;
    expect(result.source).toEqual({ kind: "manual_brief", sourceId: "brief-1" });
    expect(result.decisionRecordId).toBeNull();
    expect(result.assertions).toEqual([]);
  });

  it("does not receive a weaker safety path than the opportunity entry", () => {
    const result = qualifyCampaignSource({
      organizationId,
      source: { kind: "manual_brief", briefId: "" },
      now,
    });

    expect(result.outcome).toBe("blocked");
  });
});

describe("opportunity qualification", () => {
  it("qualifies a current proposed opportunity for the campaign action", () => {
    const result = qualifyCampaignSource({
      organizationId,
      source: { kind: "decision_opportunity", opportunity: opportunity() },
      now,
    });

    expect(result.outcome).toBe("qualified");
    if (result.outcome !== "qualified") return;
    expect(result.source).toEqual({ kind: "decision_opportunity", sourceId: opportunityId });
    expect(result.decisionRecordId).toBe("44444444-4444-4444-8444-444444444444");
  });

  it("snapshots the opportunity's exact assertions rather than changing it", () => {
    const live = opportunity();
    const result = qualifyCampaignSource({
      organizationId,
      source: { kind: "decision_opportunity", opportunity: live },
      now,
    });

    if (result.outcome !== "qualified") throw new Error("expected qualified");
    expect(result.assertions).toEqual(live.assertions);
    // A later mutation of the live row must not reach the snapshot.
    expect(Object.isFrozen(result.assertions)).toBe(true);
  });

  it("refuses an opportunity belonging to another organization", () => {
    const result = qualifyCampaignSource({
      organizationId,
      source: {
        kind: "decision_opportunity",
        opportunity: opportunity({ organizationId: "99999999-9999-4999-8999-999999999999" }),
      },
      now,
    });

    expect(result).toMatchObject({ outcome: "blocked", reason: "opportunity_not_in_organization" });
  });

  it.each(["approved", "rejected", "snoozed", "expired", "awaiting_approval"] as const)(
    "refuses a %s opportunity, because only a current proposal qualifies",
    (status) => {
      const result = qualifyCampaignSource({
        organizationId,
        source: { kind: "decision_opportunity", opportunity: opportunity({ status }) },
        now,
      });

      expect(result).toMatchObject({ outcome: "blocked", reason: "opportunity_not_proposed" });
    },
  );

  it("refuses an opportunity whose action is not the campaign action", () => {
    const result = qualifyCampaignSource({
      organizationId,
      source: {
        kind: "decision_opportunity",
        opportunity: opportunity({ actionKey: "pricing.adjust_v1" }),
      },
      now,
    });

    expect(result).toMatchObject({ outcome: "blocked", reason: "action_not_campaign" });
  });

  it("refuses an expired opportunity, which needs reassessment not revival", () => {
    const result = qualifyCampaignSource({
      organizationId,
      source: {
        kind: "decision_opportunity",
        opportunity: opportunity({ expiresAt: new Date("2026-08-01T00:00:00.000Z") }),
      },
      now,
    });

    expect(result).toMatchObject({ outcome: "blocked", reason: "opportunity_expired" });
  });

  it("treats the exact expiry instant as expired", () => {
    const result = qualifyCampaignSource({
      organizationId,
      source: {
        kind: "decision_opportunity",
        opportunity: opportunity({ expiresAt: now }),
      },
      now,
    });

    expect(result).toMatchObject({ outcome: "blocked", reason: "opportunity_expired" });
  });

  it("refuses an opportunity carrying no assertions to re-check at execution", () => {
    const result = qualifyCampaignSource({
      organizationId,
      source: { kind: "decision_opportunity", opportunity: opportunity({ assertions: [] }) },
      now,
    });

    expect(result).toMatchObject({ outcome: "blocked", reason: "assertions_missing" });
  });
});
