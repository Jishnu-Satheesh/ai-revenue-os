import { describe, expect, it } from "vitest";

import { qualifyDraftImpact } from "@/domain/decisions/campaign-draft-impact";
import { DecisionError } from "@/domain/decisions/errors";

function supportedInput() {
  return {
    impactLowMinor: 100_00,
    impactHighMinor: 400_00,
    executionCostMinor: 50_00,
    currency: "AED",
    confidence: 0.6,
    confidenceBasis: "computed tier over complete evidence with 4 governed revisions",
    evidenceTier: "computed" as const,
    timeToImpactDays: 14,
    assumptions: ["Friday demand repeats the observed four-week pattern"],
    sourceRevisionIds: ["rev-1", "rev-2", "rev-3", "rev-4"],
    observedAt: new Date("2026-09-01T08:00:00.000Z"),
  };
}

describe("qualifyDraftImpact", () => {
  it("supports a governed range with a carried rationale and contribution", () => {
    const outcome = qualifyDraftImpact(supportedInput());

    expect(outcome.outcome).toBe("supported");
    if (outcome.outcome !== "supported") return;
    expect(outcome.impactLowMinor).toBe(100_00);
    expect(outcome.impactHighMinor).toBe(400_00);
    // round(250_00 * 0.6) - 50_00 = 100_00: the same deterministic method as scoring.
    expect(outcome.expectedContributionMinor).toBe(100_00);
    expect(outcome.confidenceRationale).toContain("computed");
    expect(outcome.assumptions).toEqual(["Friday demand repeats the observed four-week pattern"]);
  });

  it("refuses an inverted range, a non-integer, and a missing basis without inventing any", () => {
    expect(() => qualifyDraftImpact({ ...supportedInput(), impactLowMinor: 500_00 })).toThrowError(
      DecisionError,
    );
    expect(() => qualifyDraftImpact({ ...supportedInput(), impactLowMinor: 100.5 })).toThrowError(
      DecisionError,
    );
    expect(() => qualifyDraftImpact({ ...supportedInput(), confidenceBasis: "  " })).toThrowError(
      DecisionError,
    );
  });

  it("refuses a range with no revisions, no date, or an empty assumption list", () => {
    expect(() => qualifyDraftImpact({ ...supportedInput(), sourceRevisionIds: [] })).toThrowError(
      DecisionError,
    );
    expect(() => qualifyDraftImpact({ ...supportedInput(), observedAt: null })).toThrowError(
      DecisionError,
    );
    expect(() => qualifyDraftImpact({ ...supportedInput(), assumptions: [] })).toThrowError(
      DecisionError,
    );
  });

  it("refuses mixed-currency inputs and out-of-range confidence", () => {
    expect(() => qualifyDraftImpact({ ...supportedInput(), currency: "usd" })).toThrowError(
      DecisionError,
    );
    expect(() => qualifyDraftImpact({ ...supportedInput(), confidence: 1.5 })).toThrowError(
      DecisionError,
    );
  });
});
