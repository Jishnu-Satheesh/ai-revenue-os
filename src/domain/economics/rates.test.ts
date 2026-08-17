import { describe, expect, it } from "vitest";

import { resolveEffectiveRate, resolveRatesByKey } from "@/domain/economics/rates";
import type { StoredCostRate } from "@/domain/economics/rates";

function rate(overrides: Partial<StoredCostRate> & { id: string }): StoredCostRate {
  return {
    key: "commission",
    definitionKey: "commission",
    qualityTier: "measured",
    channel: null,
    branchId: null,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    ...overrides,
  };
}

const march = "2026-03-15";

describe("resolveEffectiveRate", () => {
  it("ignores a rate that had not started or had already ended", () => {
    const notYet = rate({ id: "future", effectiveFrom: "2026-06-01" });
    const ended = rate({ id: "past", effectiveFrom: "2026-01-01", effectiveTo: "2026-03-01" });

    expect(
      resolveEffectiveRate([notYet, ended], { on: march, channel: null, branchId: null }),
    ).toBeNull();
  });

  it("treats the end of a period as exclusive", () => {
    const ends = rate({ id: "ends", effectiveTo: march });
    expect(resolveEffectiveRate([ends], { on: march, channel: null, branchId: null })).toBeNull();

    const startsToday = rate({ id: "starts", effectiveFrom: march });
    expect(
      resolveEffectiveRate([startsToday], { on: march, channel: null, branchId: null })?.id,
    ).toBe("starts");
  });

  it("prefers a channel-specific rate over the organization default", () => {
    const fallback = rate({ id: "default", rateOfRevenue: 0.25 });
    const talabat = rate({ id: "talabat", channel: "talabat", rateOfRevenue: 0.28 });

    expect(
      resolveEffectiveRate([fallback, talabat], {
        on: march,
        channel: "talabat",
        branchId: null,
      })?.id,
    ).toBe("talabat");
  });

  it("prefers a channel match over a branch match", () => {
    // Most-specific-wins in the same order the margin floor resolves, so an
    // operator learns one rule rather than two.
    const byBranch = rate({ id: "branch", branchId: "b1" });
    const byChannel = rate({ id: "channel", channel: "talabat" });

    expect(
      resolveEffectiveRate([byBranch, byChannel], {
        on: march,
        channel: "talabat",
        branchId: "b1",
      })?.id,
    ).toBe("channel");
  });

  it("does not apply a rate scoped to a different channel or branch", () => {
    const other = rate({ id: "deliveroo", channel: "deliveroo" });
    expect(
      resolveEffectiveRate([other], { on: march, channel: "talabat", branchId: null }),
    ).toBeNull();

    const otherBranch = rate({ id: "b2", branchId: "b2" });
    expect(
      resolveEffectiveRate([otherBranch], { on: march, channel: null, branchId: "b1" }),
    ).toBeNull();
  });

  it("takes the later revision when two rates share a scope", () => {
    const original = rate({ id: "march", channel: "talabat", effectiveFrom: "2026-03-01" });
    const raised = rate({ id: "june", channel: "talabat", effectiveFrom: "2026-06-01" });

    // In March the old tier still applies, which is the point of effective
    // dating: a June increase must not rewrite March's margin.
    expect(
      resolveEffectiveRate([original, raised], { on: march, channel: "talabat", branchId: null })
        ?.id,
    ).toBe("march");

    expect(
      resolveEffectiveRate([original, raised], {
        on: "2026-07-01",
        channel: "talabat",
        branchId: null,
      })?.id,
    ).toBe("june");
  });

  it("returns null rather than the nearest rate in time", () => {
    // Falling back would price a period with a number that was not in force.
    const later = rate({ id: "later", effectiveFrom: "2026-09-01" });
    expect(resolveEffectiveRate([later], { on: march, channel: null, branchId: null })).toBeNull();
  });

  it("orders dates across a year and month boundary", () => {
    // Lexicographic comparison is only sound because the dates are
    // zero-padded ISO. Pinning it so a future format change cannot pass quietly.
    const rates = [
      rate({ id: "2025", effectiveFrom: "2025-12-31" }),
      rate({ id: "2026", effectiveFrom: "2026-01-09" }),
    ];

    expect(
      resolveEffectiveRate(rates, { on: "2026-01-10", channel: null, branchId: null })?.id,
    ).toBe("2026");
    expect(
      resolveEffectiveRate(rates, { on: "2026-01-08", channel: null, branchId: null })?.id,
    ).toBe("2025");
  });
});

describe("resolveRatesByKey", () => {
  it("resolves each component independently", () => {
    const rates: StoredCostRate[] = [
      rate({ id: "c", definitionKey: "commission", channel: "talabat", rateOfRevenue: 0.28 }),
      rate({ id: "f", definitionKey: "food_cost", rateOfRevenue: 0.3 }),
      rate({ id: "p", definitionKey: "packaging", effectiveFrom: "2026-12-01" }),
    ];

    const resolved = resolveRatesByKey(rates, { on: march, channel: "talabat", branchId: null });

    expect(resolved.get("commission")?.id).toBe("c");
    expect(resolved.get("food_cost")?.id).toBe("f");
    // Not yet in force, so it stays unpriced and becomes a missing component.
    expect(resolved.has("packaging")).toBe(false);
  });
});
