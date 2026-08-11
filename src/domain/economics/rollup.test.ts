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
    reportedMarginMinor: null,
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

describe("reported-margin disagreement", () => {
  it("reports the gap in money and in points", () => {
    const rollup = rollUpWindow([
      entry({ contributionMarginMinor: 420_000, reportedMarginMinor: 300_000 }),
      entry({
        periodStart: new Date("2026-07-02T20:00:00Z"),
        contributionMarginMinor: 380_000,
        reportedMarginMinor: 300_000,
      }),
    ]);

    // Derived 800,000 against a reported 600,000 on 2,000,000 of revenue.
    expect(rollup.channels[0].disagreement).toEqual({
      reportedMinor: 600_000,
      differenceMinor: 200_000,
      periodCount: 2,
      differencePoints: 10,
    });
  });

  it("says nothing when the two agree exactly", () => {
    // A disagreement of zero is agreement. Marking it would make the marker
    // meaningless on every channel that reconciles.
    const rollup = rollUpWindow([
      entry({ contributionMarginMinor: 420_000, reportedMarginMinor: 420_000 }),
    ]);

    expect(rollup.channels[0].disagreement).toBeUndefined();
  });

  it("surfaces a gap of any size, with no threshold", () => {
    const rollup = rollUpWindow([
      entry({ contributionMarginMinor: 420_001, reportedMarginMinor: 420_000 }),
    ]);

    expect(rollup.channels[0].disagreement).toMatchObject({ differenceMinor: 1 });
  });

  it("compares only the periods that carry both figures", () => {
    // A window where the export was silent for half the days would otherwise
    // look like it disagreed by the value of the missing half.
    const rollup = rollUpWindow([
      entry({ contributionMarginMinor: 420_000, reportedMarginMinor: 400_000 }),
      entry({
        periodStart: new Date("2026-07-02T20:00:00Z"),
        contributionMarginMinor: 380_000,
        reportedMarginMinor: null,
      }),
    ]);

    expect(rollup.channels[0].disagreement).toMatchObject({
      reportedMinor: 400_000,
      differenceMinor: 20_000,
      periodCount: 1,
      // Two points of the one comparable period's revenue, not of the window's.
      differencePoints: 2,
    });
  });

  it("keeps the sign, so an over-reported margin reads as one", () => {
    const rollup = rollUpWindow([
      entry({ contributionMarginMinor: 300_000, reportedMarginMinor: 420_000 }),
    ]);

    expect(rollup.channels[0].disagreement).toMatchObject({ differenceMinor: -120_000 });
    expect(rollup.channels[0].disagreement?.differencePoints).toBeCloseTo(-12, 10);
  });

  it("has nothing to compare on a reported channel", () => {
    // The stated figure is the contribution margin there; it cannot differ
    // from itself.
    const rollup = rollUpWindow([
      entry({
        marginSource: "reported",
        contributionMarginMinor: 420_000,
        reportedMarginMinor: null,
      }),
    ]);

    expect(rollup.channels[0].disagreement).toBeUndefined();
  });
});
