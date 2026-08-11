import { describe, expect, it } from "vitest";

import { EconomicsError } from "@/domain/economics/errors";
import { rollUpComponents, rollUpWindow, type LedgerEntry } from "@/domain/economics/rollup";

function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    channel: "talabat",
    periodStart: new Date("2026-07-01T20:00:00Z"),
    grossRevenueMinor: 1_000_000,
    transactionCount: 200,
    currency: "AED",
    marginSource: "derived",
    completenessGrade: "complete",
    contributionMarginMinor: 420_000,
    atMostMinor: null,
    components: [],
    ...overrides,
  };
}

const indicative = (overrides: Partial<LedgerEntry> = {}) =>
  entry({
    completenessGrade: "indicative",
    contributionMarginMinor: null,
    atMostMinor: 720_000,
    ...overrides,
  });

describe("rollUpWindow", () => {
  it("sums a channel and states its margin rate", () => {
    const { channels, currency } = rollUpWindow([entry(), entry()]);

    expect(currency).toBe("AED");
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      channel: "talabat",
      grossRevenueMinor: 2_000_000,
      transactionCount: 400,
      periodCount: 2,
      grade: "complete",
      contributionMarginMinor: 840_000,
      marginRate: 0.42,
    });
  });

  it("is only as trustworthy as its weakest period", () => {
    // Sixty good days and one unpriced one do not make a stated figure.
    const { channels } = rollUpWindow([entry(), entry(), indicative()]);

    expect(channels[0].grade).toBe("indicative");
  });

  it("gives an indicative window a ceiling and no figure to read", () => {
    const { channels } = rollUpWindow([entry(), indicative()]);
    const [channel] = channels;

    expect(channel.grade).toBe("indicative");
    if (channel.grade !== "indicative") return;
    // The exact period contributes its figure, the unpriced one its bound.
    expect(channel.atMostMinor).toBe(1_140_000);
    // There is no scalar to read, which is how section 12 is enforced.
    expect(channel).not.toHaveProperty("contributionMarginMinor");
    expect(channel).not.toHaveProperty("marginRate");
  });

  it("downgrades to partial on a single partial period", () => {
    const { channels } = rollUpWindow([entry(), entry({ completenessGrade: "partial" })]);

    expect(channels[0].grade).toBe("partial");
  });

  it("labels a window holding both margin sources rather than blending it", () => {
    // The components explain only the derived periods, so no waterfall may be
    // offered for this channel.
    const { channels, hasAnyDerivedChannel } = rollUpWindow([
      entry(),
      entry({ marginSource: "reported" }),
    ]);

    expect(channels[0].marginSource).toBe("mixed");
    expect(hasAnyDerivedChannel).toBe(false);
  });

  it("keeps a wholly reported window reported", () => {
    const { channels, hasAnyDerivedChannel } = rollUpWindow([
      entry({ marginSource: "reported" }),
      entry({ marginSource: "reported" }),
    ]);

    expect(channels[0].marginSource).toBe("reported");
    expect(hasAnyDerivedChannel).toBe(false);
  });

  it("separates channels and orders them by revenue", () => {
    const { channels } = rollUpWindow([
      entry({ channel: "noon_food", grossRevenueMinor: 200_000 }),
      entry({ channel: "talabat", grossRevenueMinor: 900_000 }),
      entry({ channel: "deliveroo", grossRevenueMinor: 500_000 }),
    ]);

    expect(channels.map((channel) => channel.channel)).toEqual([
      "talabat",
      "deliveroo",
      "noon_food",
    ]);
  });

  it("refuses to combine two currencies", () => {
    // specs/012 section 11: rejected, never converted.
    expect(() => rollUpWindow([entry(), entry({ currency: "SAR" })])).toThrow(EconomicsError);
  });

  it("reports no rate where there was no revenue to take one of", () => {
    const { channels } = rollUpWindow([
      entry({ grossRevenueMinor: 0, contributionMarginMinor: 0 }),
    ]);

    // Zero revenue makes the rate undefined; 0% would read as a measurement.
    expect(channels[0]).toMatchObject({ grade: "complete", marginRate: null });
  });

  it("returns an empty window rather than inventing a channel", () => {
    expect(rollUpWindow([])).toEqual({
      channels: [],
      currency: null,
      hasAnyDerivedChannel: false,
    });
  });
});

describe("rollUpComponents", () => {
  const commission = {
    key: "commission",
    label: "Marketplace commission",
    amountMinor: 280_000,
    qualityTier: "measured" as const,
  };

  it("sums each component across the window", () => {
    const rolled = rollUpComponents([
      entry({ components: [commission] }),
      entry({ components: [commission] }),
    ]);

    expect(rolled).toEqual([
      {
        key: "commission",
        label: "Marketplace commission",
        amountMinor: 560_000,
        qualityTier: "measured",
      },
    ]);
  });

  it("keeps a component missing if it was missing on any day", () => {
    // A cost known on some days and not others is not a known cost.
    const rolled = rollUpComponents([
      entry({ components: [commission] }),
      entry({
        components: [{ ...commission, amountMinor: 0, qualityTier: "missing" }],
      }),
    ]);

    expect(rolled[0].qualityTier).toBe("missing");
  });

  it("orders components by what they cost, largest first", () => {
    const rolled = rollUpComponents([
      entry({
        components: [
          { key: "fees", label: "Payment fees", amountMinor: 20_000, qualityTier: "measured" },
          commission,
          { key: "food", label: "Food cost", amountMinor: 300_000, qualityTier: "estimated" },
        ],
      }),
    ]);

    expect(rolled.map((component) => component.key)).toEqual(["food", "commission", "fees"]);
  });
});
