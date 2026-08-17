import { describe, expect, it } from "vitest";

import { DecisionError } from "@/domain/decisions/errors";
import {
  compareCandidates,
  evidenceTierForCompleteness,
  expectedContributionMinor,
  rankCandidates,
  type ScoredCandidate,
} from "@/domain/decisions/value";

function candidate(overrides: Partial<ScoredCandidate> = {}): ScoredCandidate {
  return {
    candidateFingerprint: "f".repeat(64),
    evidenceTier: "computed",
    impactLowMinor: 1000,
    impactHighMinor: 3000,
    executionCostMinor: 500,
    currency: "AED",
    confidence: 0.5,
    timeToImpactDays: 7,
    ...overrides,
  };
}

describe("expected contribution", () => {
  it("is the confidence-weighted impact midpoint less execution cost", () => {
    // midpoint 2000 × 0.5 = 1000, less 500.
    expect(expectedContributionMinor(candidate())).toBe(500);
  });

  it("rounds the weighted impact before subtracting cost, and stays an integer", () => {
    const value = expectedContributionMinor(
      candidate({ impactLowMinor: 1001, impactHighMinor: 1002, confidence: 0.333 }),
    );

    expect(Number.isInteger(value)).toBe(true);
    // midpoint 1001.5 × 0.333 = 333.4995 → 333, less 500.
    expect(value).toBe(-167);
  });

  it("can be negative, because a costly low-impact action is a real answer", () => {
    expect(
      expectedContributionMinor(
        candidate({ impactLowMinor: 0, impactHighMinor: 100, executionCostMinor: 900 }),
      ),
    ).toBeLessThan(0);
  });

  it("rejects an inverted impact range instead of quietly sorting it", () => {
    expect(() =>
      expectedContributionMinor(candidate({ impactLowMinor: 3000, impactHighMinor: 1000 })),
    ).toThrow(DecisionError);
  });

  it("rejects a confidence outside zero to one", () => {
    for (const confidence of [-0.1, 1.1]) {
      expect(() => expectedContributionMinor(candidate({ confidence }))).toThrow(DecisionError);
    }
  });

  it("rejects a non-integer minor unit, which is money the ledger cannot hold", () => {
    expect(() => expectedContributionMinor(candidate({ impactLowMinor: 10.5 }))).toThrow(
      DecisionError,
    );
  });
});

describe("evidence tier from completeness", () => {
  it("maps a complete or partial grade to the computed tier", () => {
    expect(evidenceTierForCompleteness("complete")).toBe("computed");
    expect(evidenceTierForCompleteness("partial")).toBe("computed");
  });

  it("maps an indicative grade to no tier at all, which is needs_data", () => {
    expect(evidenceTierForCompleteness("indicative")).toBeNull();
  });
});

describe("ranking", () => {
  it("orders by evidence tier before value, never blending tiers", () => {
    const weakComputed = candidate({
      candidateFingerprint: "a".repeat(64),
      evidenceTier: "computed",
      impactLowMinor: 1,
      impactHighMinor: 1,
      executionCostMinor: 0,
      confidence: 1,
    });
    const strongPrior = candidate({
      candidateFingerprint: "b".repeat(64),
      evidenceTier: "prior",
      impactLowMinor: 900_000,
      impactHighMinor: 900_000,
      executionCostMinor: 0,
      confidence: 1,
    });

    // A far larger prior-tier number never outranks a computed one.
    expect(rankCandidates([strongPrior, weakComputed]).map((c) => c.candidateFingerprint)).toEqual([
      "a".repeat(64),
      "b".repeat(64),
    ]);
  });

  it("orders computed before observed before prior", () => {
    const tiers = ["prior", "computed", "observed"] as const;
    const ranked = rankCandidates(
      tiers.map((evidenceTier, index) =>
        candidate({ evidenceTier, candidateFingerprint: String(index).repeat(64) }),
      ),
    );

    expect(ranked.map((c) => c.evidenceTier)).toEqual(["computed", "observed", "prior"]);
  });

  it("orders by expected contribution descending inside a tier", () => {
    const low = candidate({ candidateFingerprint: "1".repeat(64), impactHighMinor: 2000 });
    const high = candidate({ candidateFingerprint: "2".repeat(64), impactHighMinor: 8000 });

    expect(rankCandidates([low, high]).map((c) => c.candidateFingerprint)).toEqual([
      "2".repeat(64),
      "1".repeat(64),
    ]);
  });

  it("breaks a value tie by shorter time to impact", () => {
    const slow = candidate({ candidateFingerprint: "3".repeat(64), timeToImpactDays: 30 });
    const fast = candidate({ candidateFingerprint: "4".repeat(64), timeToImpactDays: 2 });

    expect(rankCandidates([slow, fast]).map((c) => c.candidateFingerprint)).toEqual([
      "4".repeat(64),
      "3".repeat(64),
    ]);
  });

  it("is a total order: fully tied candidates fall back to the fingerprint", () => {
    const first = candidate({ candidateFingerprint: "5".repeat(64) });
    const second = candidate({ candidateFingerprint: "6".repeat(64) });

    expect(compareCandidates(first, second)).toBeLessThan(0);
    expect(compareCandidates(second, first)).toBeGreaterThan(0);
    expect(compareCandidates(first, first)).toBe(0);
  });

  it("is stable under re-run and independent of input order", () => {
    const input = [
      candidate({ candidateFingerprint: "7".repeat(64), evidenceTier: "observed" }),
      candidate({ candidateFingerprint: "8".repeat(64), impactHighMinor: 9000 }),
      candidate({ candidateFingerprint: "9".repeat(64), timeToImpactDays: 1 }),
    ];

    const forward = rankCandidates(input).map((c) => c.candidateFingerprint);
    const reversed = rankCandidates([...input].reverse()).map((c) => c.candidateFingerprint);

    expect(reversed).toEqual(forward);
    expect(rankCandidates(input).map((c) => c.candidateFingerprint)).toEqual(forward);
  });

  it("refuses to rank candidates whose money spans currencies", () => {
    expect(() =>
      rankCandidates([
        candidate(),
        candidate({ currency: "USD", candidateFingerprint: "c".repeat(64) }),
      ]),
    ).toThrow(DecisionError);
  });

  it("does not mutate the caller's array", () => {
    const input = [
      candidate({ candidateFingerprint: "d".repeat(64), impactHighMinor: 1200 }),
      candidate({ candidateFingerprint: "e".repeat(64), impactHighMinor: 90_000 }),
    ];
    const before = input.map((c) => c.candidateFingerprint);

    rankCandidates(input);

    expect(input.map((c) => c.candidateFingerprint)).toEqual(before);
  });
});
