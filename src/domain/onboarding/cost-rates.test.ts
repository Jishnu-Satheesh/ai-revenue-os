import { describe, expect, it } from "vitest";

import { toCostRateRows } from "@/domain/onboarding/cost-rates";

const definitionIdByKey = new Map([
  ["commission", "def-commission"],
  ["delivery_cost", "def-delivery"],
]);

const context = { definitionIdByKey, baseCurrency: "AED" };

const entry = (overrides: Record<string, unknown> = {}) => ({
  componentKey: "commission",
  channel: null,
  percent: null,
  amountMinor: null,
  confidence: "measured",
  ...overrides,
});

const payload = (costRates: unknown[], extra: Record<string, unknown> = {}) => ({
  costRates,
  effectiveFrom: "2026-06-01",
  ...extra,
});

describe("toCostRateRows", () => {
  it("stores a percentage as the share the ledger multiplies by", () => {
    // 28, not 0.28, would price a period at twenty-eight times its commission.
    const [row] = toCostRateRows(payload([entry({ percent: 28 })]), context);

    expect(row).toMatchObject({
      definition_id: "def-commission",
      rate_of_revenue: 0.28,
      amount_minor: null,
      currency: null,
      quality_tier: "measured",
      effective_from: "2026-06-01",
      channel: null,
      branch_id: null,
    });
  });

  it("gives an absolute amount its currency and a share none", () => {
    const rows = toCostRateRows(
      payload([entry({ componentKey: "delivery_cost", amountMinor: 350 }), entry({ percent: 28 })]),
      context,
    );

    expect(rows[0]).toMatchObject({ amount_minor: 350, currency: "AED", rate_of_revenue: null });
    expect(rows[1].currency).toBeNull();
  });

  it("keeps a zero, which is an answer", () => {
    // Dine-in commission genuinely is zero, and the rate table stores that as a
    // measured fact rather than an absence.
    const [row] = toCostRateRows(payload([entry({ percent: 0 })]), context);

    expect(row.rate_of_revenue).toBe(0);
  });

  it("drops a row the operator opened but never filled", () => {
    // Writing it would turn "I have not told you yet" into a priced zero.
    expect(toCostRateRows(payload([entry({ confidence: "assumed" })]), context)).toEqual([]);
  });

  it("carries the channel scope through", () => {
    const [row] = toCostRateRows(payload([entry({ channel: "talabat", percent: 30 })]), context);

    expect(row.channel).toBe("talabat");
  });

  it("writes nothing without an effective date", () => {
    // A rate with no start has no period it applies to, so there is nothing
    // defensible to store.
    expect(toCostRateRows({ costRates: [entry({ percent: 28 })] }, context)).toEqual([]);
  });

  it("drops a component that is no longer registered", () => {
    expect(
      toCostRateRows(payload([entry({ componentKey: "retired_component", percent: 10 })]), context),
    ).toEqual([]);
  });

  it("attaches the operator's notes as the source reference", () => {
    const [row] = toCostRateRows(
      payload([entry({ percent: 28 })], { sourceNotes: "  Talabat contract, June tier.  " }),
      context,
    );

    expect(row.source_reference).toBe("Talabat contract, June tier.");
  });

  it("refuses a row that claims to be both a share and an amount", () => {
    // The rate table rejects it too; failing here keeps the whole save honest
    // rather than writing the rows either side of it.
    expect(toCostRateRows(payload([entry({ percent: 28, amountMinor: 500 })]), context)).toEqual(
      [],
    );
  });
});
