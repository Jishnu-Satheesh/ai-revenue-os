import { describe, expect, it } from "vitest";
import {
  orderRecommendationPicks,
  selectTier,
  type RecommendationPick,
} from "./question-context-tiers";

function pick(overrides: Partial<RecommendationPick> & { id: string }): RecommendationPick {
  return {
    title: `title-${overrides.id}`,
    body: `body-${overrides.id}`,
    decision: null,
    helpful: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("orderRecommendationPicks", () => {
  it("orders planned > acknowledged > helpful-true > untouched", () => {
    const untouched = pick({ id: "untouched", decision: null, helpful: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    const helpful = pick({ id: "helpful", decision: null, helpful: true, updatedAt: "2026-01-01T00:00:00.000Z" });
    const acked = pick({ id: "acked", decision: "acknowledged", helpful: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    const planned = pick({ id: "planned", decision: "planned", helpful: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    const result = orderRecommendationPicks([untouched, helpful, acked, planned]);
    expect(result.map((p) => p.id)).toEqual(["planned", "acked", "helpful", "untouched"]);
  });

  it("excludes dismissed and snoozed even when newest", () => {
    const planned = pick({ id: "planned", decision: "planned", updatedAt: "2026-01-01T00:00:00.000Z" });
    const dismissed = pick({ id: "dismissed", decision: "dismissed", updatedAt: "2026-12-31T00:00:00.000Z" });
    const snoozed = pick({ id: "snoozed", decision: "snoozed", updatedAt: "2026-12-30T00:00:00.000Z" });
    const result = orderRecommendationPicks([dismissed, snoozed, planned]);
    expect(result.map((p) => p.id)).toEqual(["planned"]);
  });

  it("excludes dismissed/snoozed even when marked helpful", () => {
    const dismissedHelpful = pick({
      id: "dismissed-helpful",
      decision: "dismissed",
      helpful: true,
      updatedAt: "2026-12-31T00:00:00.000Z",
    });
    const result = orderRecommendationPicks([dismissedHelpful]);
    expect(result).toEqual([]);
  });

  it("sorts newest updatedAt first within the same rank", () => {
    const older = pick({ id: "older", decision: "planned", updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = pick({ id: "newer", decision: "planned", updatedAt: "2026-06-01T00:00:00.000Z" });
    const result = orderRecommendationPicks([older, newer]);
    expect(result.map((p) => p.id)).toEqual(["newer", "older"]);
  });

  it("caps at 6 picks", () => {
    const picks = Array.from({ length: 8 }, (_, i) =>
      pick({ id: `p${i}`, decision: "planned", updatedAt: `2026-01-0${i + 1}T00:00:00.000Z` }),
    );
    const result = orderRecommendationPicks(picks);
    expect(result).toHaveLength(6);
    // newest first within rank
    expect(result[0]?.id).toBe("p7");
  });

  it("treats helpful=false with null decision as untouched, not interacted", () => {
    const untouchedFalse = pick({ id: "u", decision: null, helpful: false, updatedAt: "2026-01-01T00:00:00.000Z" });
    const result = orderRecommendationPicks([untouchedFalse]);
    expect(result.map((p) => p.id)).toEqual(["u"]);
  });

  it("does not mutate the input array", () => {
    const a = pick({ id: "a", decision: null, updatedAt: "2026-01-01T00:00:00.000Z" });
    const b = pick({ id: "b", decision: "planned", updatedAt: "2026-01-01T00:00:00.000Z" });
    const input = [a, b] as const;
    orderRecommendationPicks(input);
    expect([...input].map((p) => p.id)).toEqual(["a", "b"]);
  });
});

describe("selectTier", () => {
  it("selects business_memory when any memory entry has a non-empty body", () => {
    const scope = selectTier({
      memory: [{ id: "m1", title: "t", body: "something" }],
      orderedPicks: [pick({ id: "p", decision: "planned" })],
      orgDetailCount: 2,
      goalCount: 2,
    });
    expect(scope.tier).toBe("business_memory");
  });

  it("counts memory entries with empty bodies as absent", () => {
    const scope = selectTier({
      memory: [
        { id: "m1", title: "t", body: null },
        { id: "m2", title: null, body: "" },
        { id: "m3", title: "t", body: "   " },
      ],
      orderedPicks: [],
      orgDetailCount: 1,
      goalCount: 0,
    });
    expect(scope.tier).toBe("org_details");
  });

  it("selects gi_interacted for planned/acknowledged/helpful-true picks", () => {
    for (const p of [
      pick({ id: "p1", decision: "planned" }),
      pick({ id: "p2", decision: "acknowledged" }),
      pick({ id: "p3", decision: null, helpful: true }),
    ]) {
      const scope = selectTier({ memory: [], orderedPicks: [p], orgDetailCount: 0, goalCount: 0 });
      expect(scope.tier).toBe("gi_interacted");
    }
  });

  it("selects gi_untouched for untouched picks", () => {
    const scope = selectTier({
      memory: [],
      orderedPicks: [pick({ id: "u", decision: null, helpful: null })],
      orgDetailCount: 5,
      goalCount: 5,
    });
    expect(scope.tier).toBe("gi_untouched");
  });

  it("does not treat dismissed as untouched", () => {
    const scope = selectTier({
      memory: [],
      orderedPicks: [pick({ id: "d", decision: "dismissed" })],
      orgDetailCount: 0,
      goalCount: 0,
    });
    expect(scope.tier).toBe("none");
  });

  it("does not treat snoozed as untouched", () => {
    const scope = selectTier({
      memory: [],
      orderedPicks: [pick({ id: "s", decision: "snoozed" })],
      orgDetailCount: 0,
      goalCount: 0,
    });
    expect(scope.tier).toBe("none");
  });

  it("selects org_details when only org details exist", () => {
    const scope = selectTier({ memory: [], orderedPicks: [], orgDetailCount: 3, goalCount: 1 });
    expect(scope.tier).toBe("org_details");
  });

  it("selects goals when only goals exist", () => {
    const scope = selectTier({ memory: [], orderedPicks: [], orgDetailCount: 0, goalCount: 2 });
    expect(scope.tier).toBe("goals");
  });

  it("selects none when everything is empty", () => {
    const scope = selectTier({ memory: [], orderedPicks: [], orgDetailCount: 0, goalCount: 0 });
    expect(scope.tier).toBe("none");
  });

  it("passes through arrays and counts for the prompt builder", () => {
    const memory = [{ id: "m1", title: "t", body: "b" }] as const;
    const orderedPicks = [pick({ id: "p", decision: "planned" })] as const;
    const scope = selectTier({ memory, orderedPicks, orgDetailCount: 4, goalCount: 7 });
    expect(scope.memory).toBe(memory);
    expect(scope.picks).toBe(orderedPicks);
    expect(scope.orgDetailCount).toBe(4);
    expect(scope.goalCount).toBe(7);
  });
});
