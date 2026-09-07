import { describe, expect, it } from "vitest";

import {
  allocationThresholds,
  allocationThresholdsConfigured,
} from "@/modules/campaigns/infrastructure/allocation-policy";

const CONFIGURED = {
  CAMPAIGN_ALLOCATION_SPEND_CEILING_MINOR: "50000",
  CAMPAIGN_ALLOCATION_CTR_FLOOR: "0.002",
  CAMPAIGN_ALLOCATION_MARGIN_FLOOR_MINOR: "0",
  CAMPAIGN_ALLOCATION_MINIMUM_IMPRESSIONS: "1000",
};

describe("allocationThresholds", () => {
  it("reads a fully configured policy", () => {
    expect(allocationThresholds(CONFIGURED)).toEqual({
      spendCeilingMinor: 50_000,
      ctrFloor: 0.002,
      marginFloorMinor: 0,
      minimumImpressions: 1_000,
    });
  });

  /**
   * The rule this file exists for. These numbers stop a client's advertising,
   * and a default invented here would be this codebase's opinion applied to
   * somebody's campaigns rather than a policy anyone configured.
   */
  it("refuses to run on numbers nobody chose, and names what is missing", () => {
    expect(() => allocationThresholds({})).toThrow(/no configured policy/);
    expect(() => allocationThresholds({})).toThrow(/CAMPAIGN_ALLOCATION_SPEND_CEILING_MINOR/);
  });

  it("refuses a partially configured policy rather than filling the gap", () => {
    const partial = { ...CONFIGURED, CAMPAIGN_ALLOCATION_CTR_FLOOR: "" };

    expect(() => allocationThresholds(partial)).toThrow(/CAMPAIGN_ALLOCATION_CTR_FLOOR/);
  });

  /**
   * Zero is a deliberate margin floor -- pause a variant that has gone negative
   * -- but a spend ceiling of zero would pause everything on sight.
   */
  it("allows a zero margin floor and refuses a zero spend ceiling", () => {
    expect(
      allocationThresholds({ ...CONFIGURED, CAMPAIGN_ALLOCATION_MARGIN_FLOOR_MINOR: "0" })
        .marginFloorMinor,
    ).toBe(0);
    expect(() =>
      allocationThresholds({ ...CONFIGURED, CAMPAIGN_ALLOCATION_SPEND_CEILING_MINOR: "0" }),
    ).toThrow(/positive whole number/);
  });

  /** `parseInt` reads "1e9" as 1, so a mistyped ceiling would silently shrink. */
  it("refuses a ceiling that is not plainly digits", () => {
    for (const bad of ["1e9", "500abc", "-5", "5.5"]) {
      expect(() =>
        allocationThresholds({ ...CONFIGURED, CAMPAIGN_ALLOCATION_SPEND_CEILING_MINOR: bad }),
      ).toThrow(/whole number/);
    }
  });

  it("refuses a click-through floor outside a share", () => {
    for (const bad of ["1.5", "-0.1", "half"]) {
      expect(() =>
        allocationThresholds({ ...CONFIGURED, CAMPAIGN_ALLOCATION_CTR_FLOOR: bad }),
      ).toThrow(/between 0 and 1/);
    }
  });
});

describe("allocationThresholdsConfigured", () => {
  it("reports whether the cycle may run at all", () => {
    expect(allocationThresholdsConfigured(CONFIGURED)).toBe(true);
    expect(allocationThresholdsConfigured({})).toBe(false);
    expect(
      allocationThresholdsConfigured({ ...CONFIGURED, CAMPAIGN_ALLOCATION_CTR_FLOOR: "   " }),
    ).toBe(false);
  });
});
