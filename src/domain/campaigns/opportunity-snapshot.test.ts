import { describe, expect, it } from "vitest";

import { opportunitySnapshotContentSchema } from "@/domain/campaigns/opportunity-snapshot";

function frozen() {
  return {
    decisionRecordId: "11111111-1111-4111-8111-111111111111",
    playbookVersionId: "22222222-2222-4222-8222-222222222222",
    opportunityId: "33333333-3333-4333-8333-333333333333",
    opportunityVersion: 2,
    actionKey: "campaign.governed_draft_v1",
    objective: "Lift September gross profit from the Friday dinner rush",
    audience: "Nearby residents ordering weekend delivery",
    goalMetricKey: "contribution.incremental_gross_profit",
    evidenceBundle: { sourceIds: ["metric-1"] },
    marketClaimIds: [],
    marketProfileVersionId: null,
    estimate: {
      impactLowMinor: 100_00,
      impactHighMinor: 400_00,
      expectedContributionMinor: 100_00,
      currency: "AED",
      assumptions: ["Friday demand repeats"],
    },
    assertions: [{ key: "budget_available", expectedOutcome: "pass" }],
    evaluationPlan: { primaryMetricKey: "contribution.incremental_gross_profit" },
    brandReadiness: null,
  };
}

describe("opportunitySnapshotContentSchema", () => {
  it("freezes exactly what the operator saw, no more", () => {
    const parsed = opportunitySnapshotContentSchema.parse(frozen());
    expect(parsed.objective).toContain("Friday");
    expect(parsed.estimate.expectedContributionMinor).toBe(100_00);
  });

  it("refuses an inverted estimate, missing refs, and empty assertions", () => {
    expect(() =>
      opportunitySnapshotContentSchema.parse({
        ...frozen(),
        estimate: { ...frozen().estimate, impactHighMinor: 50_00 },
      }),
    ).toThrow();
    expect(() =>
      opportunitySnapshotContentSchema.parse({ ...frozen(), objective: "  " }),
    ).toThrow();
    expect(() => opportunitySnapshotContentSchema.parse({ ...frozen(), assertions: [] })).toThrow();
    expect(() =>
      opportunitySnapshotContentSchema.parse({ ...frozen(), extra: "not frozen" }),
    ).toThrow();
  });
});
