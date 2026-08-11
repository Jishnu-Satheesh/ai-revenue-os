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
    effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    effectiveTo: null,
    ...overrides,
  };
}

const march = new Date("2026-03-15T00:00:00Z");

describe("resolveEffectiveRate", () => {
  it("ignores a rate that had not started or had already ended", () => {
    const notYet = rate({ id: "future", effectiveFrom: new Date("2026-06-01T00:00:00Z") });
    const ended = rate({
      id: "past",
      effectiveFrom: new Date("2026-01-01T00:00:00Z"),
      effectiveTo: new Date("2026-03-01T00:00:00Z"),
    });

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
    const original = rate({
      id: "march",
      channel: "talabat",
      effectiveFrom: new Date("2026-03-01T00:00:00Z"),
    });
    const raised = rate({
      id: "june",
      channel: "talabat",
      effectiveFrom: new Date("2026-06-01T00:00:00Z"),
    });

    // In March the old tier still applies, which is the point of effective
    // dating: a June increase must not rewrite March's margin.
    expect(
      resolveEffectiveRate([original, raised], { on: march, channel: "talabat", branchId: null })
        ?.id,
    ).toBe("march");

    expect(
      resolveEffectiveRate([original, raised], {
        on: new Date("2026-07-01T00:00:00Z"),
        channel: "talabat",
        branchId: null,
      })?.id,
    ).toBe("june");
  });

  it("returns null rather than the nearest rate in time", () => {
    // Falling back would price a period with a number that was not in force.
    const later = rate({ id: "later", effectiveFrom: new Date("2026-09-01T00:00:00Z") });
    expect(resolveEffectiveRate([later], { on: march, channel: null, branchId: null })).toBeNull();
  });
});

describe("resolveRatesByKey", () => {
  it("resolves each component independently", () => {
    const rates: StoredCostRate[] = [
      rate({ id: "c", definitionKey: "commission", channel: "talabat", rateOfRevenue: 0.28 }),
      rate({ id: "f", definitionKey: "food_cost", rateOfRevenue: 0.3 }),
      rate({
        id: "p",
        definitionKey: "packaging",
        effectiveFrom: new Date("2026-12-01T00:00:00Z"),
      }),
    ];

    const resolved = resolveRatesByKey(rates, { on: march, channel: "talabat", branchId: null });

    expect(resolved.get("commission")?.id).toBe("c");
    expect(resolved.get("food_cost")?.id).toBe("f");
    // Not yet in force, so it stays unpriced and becomes a missing component.
    expect(resolved.has("packaging")).toBe(false);
  });
});
