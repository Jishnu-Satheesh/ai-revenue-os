import { describe, expect, it } from "vitest";

import {
  ADVICE_ELIGIBLE_PROPOSAL_STATES,
  ADVICE_SOURCE_PRIORITY,
  EXCLUDED_ADVICE_STATUSES,
  EXPANSION_ACTION_KEYS,
  EXPANSION_DETECTOR_KEYS,
  GENERAL_PROPOSAL_SOURCE_KINDS,
  GROWTH_ADVICE_MAX_ROWS,
  NEUTRAL_FALLBACK_TEXT,
  RECOVERY_DETECTOR_KEYS,
  isAdviceEligibleStatus,
  qualifyAdviceRelation,
  selectGrowthAdvice,
  type GrowthAdviceCandidate,
} from "@/modules/organizations/application/growth-advice";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_HREF = `/organizations/${ORG_ID}/growth-intelligence`;

function candidate(overrides: Partial<GrowthAdviceCandidate> = {}): GrowthAdviceCandidate {
  return {
    id: "cand-1",
    kind: "recommendation",
    title: "Review cancellation findings",
    supportingText: "Reports from 2026-08-01–2026-08-31.",
    href: WORKSPACE_HREF,
    key: null,
    sourceRevision: null,
    sourceWindowStart: "2026-08-01",
    sourceWindowEnd: "2026-08-31",
    channelIds: [],
    branchIds: [],
    sourceStatus: null,
    evidenceRefs: [],
    relation: "general",
    permission: "growth_intelligence.read",
    ...overrides,
  };
}

describe("explicit key mapping (no free-text guessing)", () => {
  it("admits every registered recovery detector key", () => {
    expect(RECOVERY_DETECTOR_KEYS.has("orders.cancellation_loss")).toBe(true);
    expect(RECOVERY_DETECTOR_KEYS.has("orders.cancellation_attribution")).toBe(true);
    for (const key of RECOVERY_DETECTOR_KEYS) {
      expect(qualifyAdviceRelation(key)).toBe("recovery");
    }
  });

  it("admits every registered expansion key", () => {
    expect(EXPANSION_DETECTOR_KEYS.has("customer.new_share")).toBe(true);
    expect(EXPANSION_ACTION_KEYS.has("campaign.governed_draft_v1")).toBe(true);
    expect(EXPANSION_ACTION_KEYS.has("campaign.meta_bundle_v1")).toBe(true);
    for (const key of [...EXPANSION_DETECTOR_KEYS, ...EXPANSION_ACTION_KEYS]) {
      expect(qualifyAdviceRelation(key)).toBe("expansion");
    }
  });

  it("keeps every other registered detector key general", () => {
    const registeredGeneral = [
      "revenue.window_gross",
      "revenue.channel_share",
      "revenue.period_movement",
      "operations.closed_share",
      "funnel.stage_conversion",
      "economics.channel_cost_load",
      "economics.commission_share",
      "economics.company_cost_structure",
      "evidence.period_coverage",
      "evidence.reconciliation_blocked",
      "customer.returning_order_count",
      "listing.menu_views",
      "listing.placed_orders",
    ];
    for (const key of registeredGeneral) {
      expect(qualifyAdviceRelation(key)).toBe("general");
    }
  });

  it("keeps every registered proposal source kind general", () => {
    expect(GENERAL_PROPOSAL_SOURCE_KINDS.has("manual_request")).toBe(true);
    expect(GENERAL_PROPOSAL_SOURCE_KINDS.has("business_signal")).toBe(true);
    expect(GENERAL_PROPOSAL_SOURCE_KINDS.has("next_test")).toBe(true);
    for (const key of GENERAL_PROPOSAL_SOURCE_KINDS) {
      expect(qualifyAdviceRelation(key)).toBe("general");
    }
  });

  it("sends unknown, null and blank keys to general", () => {
    expect(qualifyAdviceRelation("some.future_detector_v9")).toBe("general");
    expect(qualifyAdviceRelation("Review cancellations now")).toBe("general");
    expect(qualifyAdviceRelation(null)).toBe("general");
    expect(qualifyAdviceRelation("   ")).toBe("general");
  });
});

describe("status eligibility", () => {
  it("excludes the full D06 exclusion list", () => {
    for (const status of [
      "dismissed",
      "rejected",
      "expired",
      "deleted",
      "snoozed",
      "unavailable",
    ]) {
      expect(EXCLUDED_ADVICE_STATUSES.has(status)).toBe(true);
      expect(isAdviceEligibleStatus(status)).toBe(false);
    }
    // Completed work is evidence only where attribution permits — never advice here.
    expect(isAdviceEligibleStatus("resolved")).toBe(false);
    expect(isAdviceEligibleStatus("completed")).toBe(false);
  });

  it("keeps planned, acknowledged and status-free rows eligible", () => {
    expect(isAdviceEligibleStatus("planned")).toBe(true);
    expect(isAdviceEligibleStatus("acknowledged")).toBe(true);
    expect(isAdviceEligibleStatus(null)).toBe(true);
  });

  it("admits only reviewable proposal states", () => {
    expect(ADVICE_ELIGIBLE_PROPOSAL_STATES.has("ready_for_review")).toBe(true);
    expect(ADVICE_ELIGIBLE_PROPOSAL_STATES.has("changes_requested")).toBe(true);
    for (const state of [
      "researching",
      "needs_input",
      "approved_for_preparation",
      "snoozed",
      "dismissed",
      "superseded",
      "cancelled",
    ]) {
      expect(ADVICE_ELIGIBLE_PROPOSAL_STATES.has(state)).toBe(false);
    }
  });
});

describe("compare-first selection", () => {
  function select(
    comparisonState: "behind" | "ahead" | "within_range" | "equal" | null,
    candidates: GrowthAdviceCandidate[],
    extra: { comparisonVisible?: boolean; latestComparableDate?: string | null } = {},
  ) {
    return selectGrowthAdvice({
      comparisonState,
      comparisonVisible: extra.comparisonVisible ?? true,
      latestComparableDate: extra.latestComparableDate ?? "2026-08-31",
      organizationId: ORG_ID,
      workspaceHref: WORKSPACE_HREF,
      candidates,
    });
  }

  it("behind orders recovery before general and hides expansion", () => {
    const rows = select("behind", [
      candidate({ id: "g1", kind: "insight", relation: "general", title: "General context" }),
      candidate({
        id: "x1",
        kind: "recommendation",
        relation: "expansion",
        title: "Expansion bet",
      }),
      candidate({ id: "r1", kind: "recommendation", relation: "recovery", title: "Recovery fix" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["r1", "g1"]);
  });

  it("ahead orders expansion before general and hides recovery", () => {
    const rows = select("ahead", [
      candidate({ id: "g1", kind: "insight", relation: "general", title: "General context" }),
      candidate({ id: "r1", kind: "recommendation", relation: "recovery", title: "Recovery fix" }),
      candidate({
        id: "x1",
        kind: "recommendation",
        relation: "expansion",
        title: "Expansion bet",
      }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["x1", "g1"]);
  });

  it("within range follows source priority across relations", () => {
    expect(ADVICE_SOURCE_PRIORITY).toEqual(["proposal", "recommendation", "insight", "finding"]);
    const rows = select("within_range", [
      candidate({ id: "f1", kind: "finding", relation: "recovery", title: "Finding signal" }),
      candidate({ id: "i1", kind: "insight", relation: "general", title: "Insight context" }),
      candidate({ id: "p1", kind: "proposal", relation: "general", title: "Proposal step" }),
      candidate({ id: "r1", kind: "recommendation", relation: "expansion", title: "Rec action" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["p1", "r1"]);
  });

  it("treats exact equality like within range", () => {
    const rows = select("equal", [
      candidate({ id: "i1", kind: "insight", title: "Insight context" }),
      candidate({ id: "p1", kind: "proposal", title: "Proposal step" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["p1", "i1"]);
  });

  it("breaks ties by newest permitted window, then source id", () => {
    const rows = select("within_range", [
      candidate({ id: "b-id", kind: "insight", sourceWindowEnd: "2026-08-10", title: "Older" }),
      candidate({ id: "a-id", kind: "insight", sourceWindowEnd: "2026-08-20", title: "Newer" }),
      candidate({ id: "c-id", kind: "insight", sourceWindowEnd: null, title: "Undated" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["a-id", "b-id"]);
  });

  it("caps rows at two without money-ranked ordering", () => {
    const rows = select("behind", [
      candidate({ id: "r1", relation: "recovery", title: "One" }),
      candidate({ id: "r2", relation: "recovery", title: "Two" }),
      candidate({ id: "r3", relation: "recovery", title: "Three" }),
    ]);
    expect(rows).toHaveLength(GROWTH_ADVICE_MAX_ROWS);
    expect(GROWTH_ADVICE_MAX_ROWS).toBe(2);
  });

  it("drops evidence newer than the displayed comparison date", () => {
    const rows = select("behind", [
      candidate({
        id: "late",
        relation: "recovery",
        sourceWindowEnd: "2026-09-15",
        title: "Later report",
      }),
      candidate({
        id: "ontime",
        relation: "general",
        sourceWindowEnd: "2026-08-31",
        title: "On-time row",
      }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["ontime"]);
  });

  it("keeps undated rows when no comparison date bounds them", () => {
    const rows = select("behind", [candidate({ id: "u1", sourceWindowEnd: null })], {
      latestComparableDate: null,
    });
    expect(rows.map((row) => row.id)).toEqual(["u1"]);
  });

  it("falls back to the neutral V06 row when a visible gap has no qualified rows", () => {
    const rows = select("behind", []);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "neutral-fallback",
      supportingText: NEUTRAL_FALLBACK_TEXT,
      href: WORKSPACE_HREF,
      relation: "general",
    });
  });

  it("omits the fallback link when recommendations are not permitted", () => {
    const rows = selectGrowthAdvice({
      comparisonState: "ahead",
      comparisonVisible: true,
      latestComparableDate: "2026-08-31",
      organizationId: ORG_ID,
      workspaceHref: null,
      candidates: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.href).toBeNull();
  });

  it("shows no rows and no fallback when nothing is compared yet", () => {
    const rows = select(null, [], { comparisonVisible: false, latestComparableDate: null });
    expect(rows).toEqual([]);
  });

  it("uncompared upcoming periods still surface general rows by source priority", () => {
    const rows = select(null, [
      candidate({ id: "i1", kind: "insight", title: "Insight context" }),
      candidate({ id: "p1", kind: "proposal", title: "Proposal step" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["p1", "i1"]);
  });

  it("returns no rows for malformed input instead of guessing", () => {
    const rows = selectGrowthAdvice({
      comparisonState: "behind",
      comparisonVisible: true,
      latestComparableDate: "not-a-date",
      organizationId: ORG_ID,
      workspaceHref: WORKSPACE_HREF,
      candidates: [],
    });
    expect(rows).toEqual([]);
  });
});
