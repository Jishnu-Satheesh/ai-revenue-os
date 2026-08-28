import { describe, expect, it } from "vitest";

import { splitEarnedLostPotential } from "@/domain/analysis/money-split";

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
