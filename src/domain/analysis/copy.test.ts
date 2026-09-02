import { describe, expect, it } from "vitest";

import { buildVerdictView } from "@/domain/analysis/copy";

describe("buildVerdictView", () => {
  it("chooses a directional sentence when the window is fully covered", () => {
    const view = buildVerdictView({
      grossMoney: { minorUnits: 55_300, currency: "AED" },
      movement: "up",
      coverage: { expectedPeriods: 31, observedPeriods: 31 },
    });

    expect(view.headlineSentence).toContain("rose");
    expect(view.badges).toEqual([
      "Gross revenue is reported for this window.",
      "Gross revenue rose against the period before.",
      "Every period in this window carries governed evidence.",
    ]);
  });

  it("says fell and held level in the provider's own direction", () => {
    const down = buildVerdictView({
      grossMoney: { minorUnits: -30_000, currency: "AED" },
      movement: "down",
      coverage: { expectedPeriods: 7, observedPeriods: 7 },
    });
    expect(down.headlineSentence).toContain("fell");

    const flat = buildVerdictView({
      grossMoney: { minorUnits: 100, currency: "AED" },
      movement: "flat",
      coverage: null,
    });
    expect(flat.headlineSentence).toContain("held level");
  });

  it("lets incomplete coverage gate the headline before any direction is spoken", () => {
    // A trend over fourteen of thirty-one days is a coincidence wearing a
    // trend's clothes, so the band leads with the gap rather than the fall.
    const view = buildVerdictView({
      grossMoney: { minorUnits: 55_300, currency: "AED" },
      movement: "down",
      coverage: { expectedPeriods: 31, observedPeriods: 14 },
    });

    expect(view.headlineSentence).toMatch(/with care/);
    expect(view.badges[1]).toBe("Gross revenue fell against the period before.");
    expect(view.badges[2]).toBe("Some periods in this window carry no governed evidence.");
  });

  it("names each missing input instead of papering over it", () => {
    const view = buildVerdictView({
      grossMoney: null,
      movement: null,
      coverage: null,
    });

    expect(view.headlineSentence).toMatch(/not enough governed evidence/);
    expect(view.badges).toEqual([
      "No gross figure is available for this window yet.",
      "No period-over-period comparison is available yet.",
      "Evidence coverage has not been reported for this window.",
    ]);
  });

  it("states words only: no figure ever enters the band", () => {
    const view = buildVerdictView({
      grossMoney: { minorUnits: 55_300, currency: "AED" },
      movement: "down",
      coverage: { expectedPeriods: 31, observedPeriods: 14 },
    });

    // Every number lives in a cited finding the UI renders beside these
    // words. A figure rendered by prose here would be an uncited second copy.
    expect(view.headlineSentence).not.toMatch(/\d/);
    for (const badge of view.badges) expect(badge).not.toMatch(/\d/);
  });
});
