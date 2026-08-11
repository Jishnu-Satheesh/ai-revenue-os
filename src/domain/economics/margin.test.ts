import { describe, expect, it } from "vitest";

import {
  appliesToChannel,
  computeComponentAmount,
  computeDerivedMargin,
  deriveCompletenessGrade,
  reconcileReportedMargin,
  recordReportedMargin,
} from "@/domain/economics/margin";
import { isPresentableMargin } from "@/domain/economics/types";
import type {
  CostComponentDefinition,
  CostComponentRate,
  EconomicsBasis,
} from "@/domain/economics/types";

const commission: CostComponentDefinition = {
  key: "commission",
  label: "Marketplace commission",
  computationKind: "rate_of_revenue",
  appliesToChannels: ["talabat", "deliveroo"],
};

const packaging: CostComponentDefinition = {
  key: "packaging",
  label: "Packaging",
  computationKind: "per_unit",
  appliesToChannels: null,
};

const foodCost: CostComponentDefinition = {
  key: "food_cost",
  label: "Food cost",
  computationKind: "rate_of_revenue",
  appliesToChannels: null,
};

// AED 10,000.00 over 200 orders, 500 items.
const basis: EconomicsBasis = {
  grossRevenueMinor: 1_000_000,
  transactionCount: 200,
  unitCount: 500,
  currency: "AED",
};

const measured = (rate: Partial<CostComponentRate> & { key: string }): CostComponentRate => ({
  qualityTier: "measured",
  ...rate,
});

describe("appliesToChannel", () => {
  it("treats a null channel list as every channel", () => {
    expect(appliesToChannel(packaging, "talabat")).toBe(true);
    expect(appliesToChannel(packaging, null)).toBe(true);
  });

  it("excludes a channel the component does not cover", () => {
    expect(appliesToChannel(commission, "talabat")).toBe(true);
    expect(appliesToChannel(commission, "dine_in")).toBe(false);
    // A channel-specific component cannot apply to an unchannelled period.
    expect(appliesToChannel(commission, null)).toBe(false);
  });
});

describe("computeComponentAmount", () => {
  it("charges a fixed amount per transaction and a per-unit amount per unit", () => {
    // The distinction is the point: 200 orders carrying 500 items.
    expect(
      computeComponentAmount(
        { ...packaging, computationKind: "fixed_amount" },
        measured({ key: "packaging", amountMinor: 150 }),
        basis,
      ),
    ).toBe(30_000);

    expect(
      computeComponentAmount(packaging, measured({ key: "packaging", amountMinor: 150 }), basis),
    ).toBe(75_000);
  });

  it("rounds a revenue share once on the period total", () => {
    // 28% of AED 10,000.00. Rounding per order and summing would drift.
    expect(
      computeComponentAmount(
        commission,
        measured({ key: "commission", rateOfRevenue: 0.28 }),
        basis,
      ),
    ).toBe(280_000);
  });

  it("cannot price per unit without a unit count", () => {
    // Assuming one order equals one unit would understate packaging on every
    // multi-item basket, so the amount is unknown rather than guessed.
    const withoutUnits = {
      grossRevenueMinor: basis.grossRevenueMinor,
      transactionCount: basis.transactionCount,
      currency: basis.currency,
    };
    expect(
      computeComponentAmount(
        packaging,
        measured({ key: "packaging", amountMinor: 150 }),
        withoutUnits,
      ),
    ).toBeNull();
  });

  it("returns null when the rate carries nothing usable", () => {
    expect(computeComponentAmount(commission, measured({ key: "commission" }), basis)).toBeNull();
    expect(
      computeComponentAmount(
        { ...commission, computationKind: "sourced" },
        measured({ key: "commission" }),
        basis,
      ),
    ).toBeNull();
  });
});

describe("deriveCompletenessGrade", () => {
  it("is only as good as the weakest component", () => {
    expect(deriveCompletenessGrade([{ qualityTier: "measured" }, { qualityTier: "derived" }])).toBe(
      "complete",
    );
    expect(deriveCompletenessGrade([{ qualityTier: "measured" }, { qualityTier: "assumed" }])).toBe(
      "partial",
    );
    expect(deriveCompletenessGrade([{ qualityTier: "measured" }, { qualityTier: "missing" }])).toBe(
      "indicative",
    );
  });

  it("grades an entry with no applicable components as complete", () => {
    expect(deriveCompletenessGrade([])).toBe("complete");
  });
});

describe("computeDerivedMargin", () => {
  it("subtracts every applicable component from gross revenue", () => {
    const outcome = computeDerivedMargin({
      basis,
      channel: "talabat",
      definitions: [commission, foodCost, packaging],
      rates: [
        measured({ key: "commission", rateOfRevenue: 0.28 }),
        measured({ key: "food_cost", rateOfRevenue: 0.3 }),
        measured({ key: "packaging", amountMinor: 150 }),
      ],
    });

    // 1,000,000 − 280,000 − 300,000 − 75,000
    expect(outcome).toMatchObject({
      grade: "complete",
      marginSource: "derived",
      contributionMarginMinor: 345_000,
      currency: "AED",
    });
    expect(isPresentableMargin(outcome)).toBe(true);
  });

  it("never counts an unknown cost as zero", () => {
    // Dropping food cost instead of marking it missing would report a margin of
    // 645,000 — nearly double the truth. That is the mistake this ledger exists
    // to prevent, so the figure becomes a ceiling instead.
    const outcome = computeDerivedMargin({
      basis,
      channel: "talabat",
      definitions: [commission, foodCost, packaging],
      rates: [
        measured({ key: "commission", rateOfRevenue: 0.28 }),
        measured({ key: "packaging", amountMinor: 150 }),
      ],
    });

    expect(outcome.grade).toBe("indicative");
    if (outcome.grade !== "indicative") return;
    expect(outcome.atMostMinor).toBe(645_000);
    expect(outcome.missingComponentKeys).toEqual(["food_cost"]);
    expect(isPresentableMargin(outcome)).toBe(false);
    expect(outcome).not.toHaveProperty("contributionMarginMinor");
  });

  it("drops a component the channel does not carry", () => {
    // Dine-in pays no marketplace commission, so its absence is not a gap.
    const outcome = computeDerivedMargin({
      basis,
      channel: "dine_in",
      definitions: [commission, foodCost],
      rates: [measured({ key: "food_cost", rateOfRevenue: 0.3 })],
    });

    expect(outcome.grade).toBe("complete");
    expect(outcome.components.map((component) => component.key)).toEqual(["food_cost"]);
  });

  it("downgrades to partial on a single platform default", () => {
    const outcome = computeDerivedMargin({
      basis,
      channel: "talabat",
      definitions: [commission, foodCost],
      rates: [
        measured({ key: "commission", rateOfRevenue: 0.28 }),
        { key: "food_cost", rateOfRevenue: 0.3, qualityTier: "assumed" },
      ],
    });

    expect(outcome.grade).toBe("partial");
    expect(isPresentableMargin(outcome)).toBe(true);
  });
});

describe("recordReportedMargin", () => {
  it("accepts a figure an export stated outright", () => {
    const outcome = recordReportedMargin({
      basis,
      contributionMarginMinor: 345_000,
      qualityTier: "measured",
    });

    expect(outcome).toMatchObject({
      marginSource: "reported",
      grade: "complete",
      contributionMarginMinor: 345_000,
    });
    // Measured, so usable; it simply carries no components to explain itself.
    expect(isPresentableMargin(outcome)).toBe(true);
    expect(outcome).not.toHaveProperty("components");
  });

  it("grades an assumed report as partial", () => {
    expect(
      recordReportedMargin({ basis, contributionMarginMinor: 1, qualityTier: "assumed" }).grade,
    ).toBe("partial");
  });
});

describe("reconcileReportedMargin", () => {
  const derived = computeDerivedMargin({
    basis,
    channel: "talabat",
    definitions: [commission, foodCost, packaging],
    rates: [
      measured({ key: "commission", rateOfRevenue: 0.28 }),
      measured({ key: "food_cost", rateOfRevenue: 0.3 }),
      measured({ key: "packaging", amountMinor: 150 }),
    ],
  });

  it("surfaces a disagreement rather than reconciling it", () => {
    // Either a rate is wrong or the export is. Both matter, so neither is
    // quietly overwritten.
    expect(reconcileReportedMargin({ derived, reportedMinor: 300_000 })).toEqual({
      agrees: false,
      differenceMinor: 45_000,
    });
  });

  it("accepts a difference inside the declared tolerance", () => {
    expect(
      reconcileReportedMargin({ derived, reportedMinor: 344_990, toleranceMinor: 50 }),
    ).toMatchObject({ agrees: true });
  });

  it("has nothing to reconcile against an indicative margin", () => {
    const indicative = computeDerivedMargin({
      basis,
      channel: "talabat",
      definitions: [commission, foodCost],
      rates: [measured({ key: "commission", rateOfRevenue: 0.28 })],
    });

    expect(reconcileReportedMargin({ derived: indicative, reportedMinor: 1 })).toBeNull();
  });
});
