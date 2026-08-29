import { describe, expect, it } from "vitest";

import { describeChannelMoney, splitEarnedLostPotential } from "@/domain/analysis/money-split";

const aed = (minorUnits: number) => ({ minorUnits, currency: "AED" });

describe("splitEarnedLostPotential", () => {
  it("subtracts the recorded loss from the reported gross", () => {
    expect(splitEarnedLostPotential({ potential: aed(55300), lost: aed(35700) })).toEqual({
      potential: aed(55300),
      lost: aed(35700),
      earned: aed(19600),
    });
  });

  it("refuses when the two figures are in different currencies", () => {
    expect(
      splitEarnedLostPotential({
        potential: aed(55300),
        lost: { minorUnits: 100, currency: "USD" },
      }),
    ).toEqual({ potential: null, lost: null, earned: null });
  });

  it("refuses when the loss exceeds the gross, rather than stating a negative earned", () => {
    expect(splitEarnedLostPotential({ potential: aed(100), lost: aed(101) })).toEqual({
      potential: null,
      lost: null,
      earned: null,
    });
  });

  it("refuses when either half is absent", () => {
    expect(splitEarnedLostPotential({ potential: aed(100), lost: null })).toEqual({
      potential: null,
      lost: null,
      earned: null,
    });
    expect(splitEarnedLostPotential({ potential: null, lost: aed(100) })).toEqual({
      potential: null,
      lost: null,
      earned: null,
    });
  });

  it("states a zero earned when the loss exactly equals the gross", () => {
    // Boundary: potential >= lost admits equality, and a measured zero here is
    // a real result rather than an absence.
    expect(splitEarnedLostPotential({ potential: aed(100), lost: aed(100) })).toEqual({
      potential: aed(100),
      lost: aed(100),
      earned: aed(0),
    });
  });
});

describe("describeChannelMoney", () => {
  // Talabat's export records its own rejection loss, so both halves exist.
  // Keeta's does not: it reports what was sold and says nothing about what was
  // lost. Collapsing that into the same refusal as "we have no analysis at all"
  // is what made an ingested channel read as an unread one.
  it("names the complete split when both figures are present", () => {
    expect(describeChannelMoney({ potential: aed(55300), lost: aed(35700) })).toEqual({
      state: "complete",
      potential: aed(55300),
      lost: aed(35700),
      earned: aed(19600),
    });
  });

  it("keeps the reported revenue when no loss was measured", () => {
    expect(describeChannelMoney({ potential: aed(55300), lost: null })).toEqual({
      state: "revenue_only",
      potential: aed(55300),
      lost: null,
      earned: null,
    });
  });

  it("refuses outright when there is no revenue figure to report", () => {
    expect(describeChannelMoney({ potential: null, lost: aed(100) })).toEqual({
      state: "refused",
      potential: null,
      lost: null,
      earned: null,
    });
    expect(describeChannelMoney({ potential: null, lost: null })).toEqual({
      state: "refused",
      potential: null,
      lost: null,
      earned: null,
    });
  });

  it("refuses rather than reporting revenue it cannot subtract from", () => {
    // A loss that is real but incomparable is not the same as an unmeasured
    // one. Downgrading it to `revenue_only` would quietly drop a figure the
    // provider did state, so both of these stay refusals.
    expect(
      describeChannelMoney({ potential: aed(55300), lost: { minorUnits: 100, currency: "USD" } }),
    ).toEqual({ state: "refused", potential: null, lost: null, earned: null });
    expect(describeChannelMoney({ potential: aed(100), lost: aed(101) })).toEqual({
      state: "refused",
      potential: null,
      lost: null,
      earned: null,
    });
  });

  it("agrees with splitEarnedLostPotential on every case it admits", () => {
    // The two functions must never disagree about the subtraction itself --
    // that is the whole reason there is one module. The strict view is the
    // complete state and nothing else.
    const cases = [
      { potential: aed(55300), lost: aed(35700) },
      { potential: aed(100), lost: aed(100) },
      { potential: aed(100), lost: aed(101) },
      { potential: aed(100), lost: null },
      { potential: null, lost: aed(100) },
    ];

    for (const input of cases) {
      const { state, ...figures } = describeChannelMoney(input);
      expect(splitEarnedLostPotential(input)).toEqual(
        state === "complete" ? figures : { potential: null, lost: null, earned: null },
      );
    }
  });
});
