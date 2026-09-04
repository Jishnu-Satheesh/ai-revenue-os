import { describe, expect, it } from "vitest";

import {
  buildRecommendationPriority,
  compareRecommendationPriority,
  type RecommendationPriorityInput,
} from "@/domain/growth-intelligence/priority";

function input(overrides: Partial<RecommendationPriorityInput> = {}): RecommendationPriorityInput {
  return {
    itemId: "90000000-0000-4000-8000-000000000009",
    urgency: "high",
    goalAlignment: "direct",
    supportGrade: "corroborated",
    freshness: "current",
    impactEstimate: null,
    organizationCurrency: "AED",
    pinned: false,
    ...overrides,
  };
}

describe("buildRecommendationPriority", () => {
  it("bands urgent, aligned, supported, current evidence as now", () => {
    const priority = buildRecommendationPriority(input());
    expect(priority.band).toBe("now");
    expect(priority.components.map((component) => component.key)).toEqual([
      "urgency",
      "goal_alignment",
      "support",
      "freshness",
      "impact",
    ]);
  });

  it("orders components without blending money or confidence", () => {
    const priority = buildRecommendationPriority(
      input({ impactEstimate: { lowMinorUnits: 10_000, highMinorUnits: 50_000, currency: "AED" } }),
    );
    expect(priority.components.find((component) => component.key === "impact")).toMatchObject({
      contribution: 1,
    });
    expect(JSON.stringify(priority)).not.toContain("confidence");
    expect(JSON.stringify(priority)).not.toContain("score");
  });

  it("downgrades stale and conflicted evidence", () => {
    expect(buildRecommendationPriority(input({ freshness: "stale" })).band).toBe("next");
    expect(buildRecommendationPriority(input({ supportGrade: "conflicted" })).band).toBe("later");
  });

  it("refuses mixed currencies instead of blending them", () => {
    expect(() =>
      buildRecommendationPriority(
        input({
          impactEstimate: { lowMinorUnits: 10_000, highMinorUnits: 50_000, currency: "USD" },
        }),
      ),
    ).toThrow(/currency/i);
  });

  it("refuses inverted impact ranges", () => {
    expect(() =>
      buildRecommendationPriority(
        input({
          impactEstimate: { lowMinorUnits: 50_000, highMinorUnits: 10_000, currency: "AED" },
        }),
      ),
    ).toThrow(/impact/i);
  });

  it("stamps the versioned priority rule set", () => {
    expect(buildRecommendationPriority(input()).ruleVersion).toBe("priority-rules@1");
  });
});

describe("compareRecommendationPriority", () => {
  it("ranks bands first, then components, then stable item identity", () => {
    const now = buildRecommendationPriority(input());
    const next = buildRecommendationPriority(input({ urgency: "low", goalAlignment: "none" }));
    expect(compareRecommendationPriority(now, next)).toBeLessThan(0);
    expect(compareRecommendationPriority(next, now)).toBeGreaterThan(0);

    const twin = buildRecommendationPriority(
      input({ itemId: "91000000-0000-4000-8000-000000000091" }),
    );
    expect(compareRecommendationPriority(now, twin)).not.toBe(0);
    expect(compareRecommendationPriority(now, buildRecommendationPriority(input()))).toBe(0);
  });

  it("keeps pins out of the deterministic order", () => {
    const unpinned = buildRecommendationPriority(input());
    const pinned = buildRecommendationPriority({ ...input(), pinned: true });
    expect(compareRecommendationPriority(unpinned, pinned)).toBe(0);
    expect(pinned.pinned).toBe(true);
  });

  it("ignores the rule version in the deterministic order", () => {
    const left = buildRecommendationPriority(input());
    const right = { ...buildRecommendationPriority(input()), ruleVersion: "priority-rules@99" };
    expect(compareRecommendationPriority(left, right)).toBe(0);
  });
});
