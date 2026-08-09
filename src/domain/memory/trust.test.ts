import { describe, expect, it } from "vitest";

import {
  compareByTrustThenRelevance,
  deriveSourceTier,
  deriveTrustRank,
  memoryOrigins,
  sourceTiers,
  verificationStates,
  type RankableMemoryResult,
} from "@/domain/memory/trust";

const now = new Date("2026-08-09T12:00:00.000Z");

describe("deriveSourceTier", () => {
  it("puts explicitly verified user input in tier 1", () => {
    expect(
      deriveSourceTier({
        origin: "user_verified",
        verificationState: "verified",
        memoryType: "note",
      }),
    ).toBe(1);
  });

  it("promotes any confirmed item to tier 1 regardless of how it was produced", () => {
    expect(
      deriveSourceTier({
        origin: "ai_proposed",
        verificationState: "verified",
        memoryType: "lesson",
      }),
    ).toBe(1);
  });

  it("keeps unconfirmed model output in tier 5", () => {
    expect(
      deriveSourceTier({
        origin: "ai_proposed",
        verificationState: "unverified",
        memoryType: "lesson",
      }),
    ).toBe(5);
    expect(
      deriveSourceTier({
        origin: "outcome_learned",
        verificationState: "unverified",
        memoryType: "outcome",
      }),
    ).toBe(5);
  });

  it("keeps a model-authored document in tier 5 rather than treating it as an approved document", () => {
    expect(
      deriveSourceTier({
        origin: "ai_proposed",
        verificationState: "unverified",
        memoryType: "document",
      }),
    ).toBe(5);
  });

  it("puts unconfirmed direct user input in tier 1 because the source is still the user", () => {
    expect(
      deriveSourceTier({
        origin: "user_verified",
        verificationState: "unverified",
        memoryType: "note",
      }),
    ).toBe(1);
  });

  it("puts an approved document in tier 3", () => {
    expect(
      deriveSourceTier({
        origin: "system_generated",
        verificationState: "unverified",
        memoryType: "document",
      }),
    ).toBe(3);
  });

  it("puts current system-of-record data in tier 2", () => {
    expect(
      deriveSourceTier({
        origin: "provider_imported",
        verificationState: "unverified",
        memoryType: "episode",
      }),
    ).toBe(2);
    expect(
      deriveSourceTier({
        origin: "system_generated",
        verificationState: "unverified",
        memoryType: "episode",
      }),
    ).toBe(2);
  });

  it("demotes provider data past its review date to historical tier 4", () => {
    expect(
      deriveSourceTier({
        origin: "provider_imported",
        verificationState: "unverified",
        memoryType: "episode",
        reviewDueAt: "2026-08-08T12:00:00.000Z",
        now,
      }),
    ).toBe(4);
  });

  it("keeps provider data inside its review date in tier 2", () => {
    expect(
      deriveSourceTier({
        origin: "provider_imported",
        verificationState: "unverified",
        memoryType: "episode",
        reviewDueAt: "2026-08-10T12:00:00.000Z",
        now,
      }),
    ).toBe(2);
  });

  it("is total across every origin and verification state", () => {
    for (const origin of memoryOrigins) {
      for (const verificationState of verificationStates) {
        const tier = deriveSourceTier({ origin, verificationState, memoryType: "episode" });
        expect(sourceTiers).toContain(tier);
      }
    }
  });
});

describe("deriveTrustRank", () => {
  it("ranks verified tier 1 highest", () => {
    expect(deriveTrustRank({ verificationState: "verified", sourceTier: 1 })).toBe(0);
  });

  it("ranks unverified inference lowest", () => {
    expect(deriveTrustRank({ verificationState: "unverified", sourceTier: 5 })).toBe(4);
  });

  it("ranks verified system-of-record and approved documents together", () => {
    expect(deriveTrustRank({ verificationState: "verified", sourceTier: 2 })).toBe(1);
    expect(deriveTrustRank({ verificationState: "verified", sourceTier: 3 })).toBe(1);
  });

  it("ranks unverified system-of-record above unverified documents and history", () => {
    expect(deriveTrustRank({ verificationState: "unverified", sourceTier: 2 })).toBe(2);
    expect(deriveTrustRank({ verificationState: "unverified", sourceTier: 3 })).toBe(3);
    expect(deriveTrustRank({ verificationState: "unverified", sourceTier: 4 })).toBe(3);
  });

  it("ranks unconfirmed direct user input below verified input but above provider data", () => {
    expect(deriveTrustRank({ verificationState: "unverified", sourceTier: 1 })).toBe(1);
  });

  it("gives proposed and rejected items the lowest rank so they never outrank real knowledge", () => {
    expect(deriveTrustRank({ verificationState: "proposed", sourceTier: 1 })).toBe(4);
    expect(deriveTrustRank({ verificationState: "rejected", sourceTier: 1 })).toBe(4);
  });

  it("is total across every verification state and source tier", () => {
    for (const verificationState of verificationStates) {
      for (const sourceTier of sourceTiers) {
        const rank = deriveTrustRank({ verificationState, sourceTier });
        expect(rank).toBeGreaterThanOrEqual(0);
        expect(rank).toBeLessThanOrEqual(4);
      }
    }
  });
});

/**
 * Acceptance criterion 2. Trust ordering must be structural: no blended
 * relevance score may move an item across a trust rank boundary. The generator
 * deliberately gives the least trustworthy items the best scores.
 */
describe("compareByTrustThenRelevance", () => {
  function seededRandom(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return state / 4_294_967_296;
    };
  }

  function generateResults(seed: number): RankableMemoryResult[] {
    const random = seededRandom(seed);
    const results: RankableMemoryResult[] = [];
    for (const verificationState of verificationStates) {
      for (const sourceTier of sourceTiers) {
        const trustRank = deriveTrustRank({ verificationState, sourceTier });
        results.push({
          id: `${verificationState}-${sourceTier}`,
          trustRank,
          // Invert the score against trust so relevance fights the ordering.
          blended: (4 - trustRank) / 4 + random() * 0.001,
          observedAt: new Date(1_760_000_000_000 + random() * 1_000_000).toISOString(),
        });
      }
    }
    return results;
  }

  it("never lets a blended score reorder trust ranks, across many generated corpora", () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const sorted = [...generateResults(seed)].sort(compareByTrustThenRelevance);
      for (let index = 1; index < sorted.length; index += 1) {
        expect(sorted[index].trustRank).toBeGreaterThanOrEqual(sorted[index - 1].trustRank);
      }
    }
  });

  it("orders by descending blended score inside one trust rank", () => {
    const sorted = [
      { id: "low", trustRank: 2 as const, blended: 0.1, observedAt: undefined },
      { id: "high", trustRank: 2 as const, blended: 0.9, observedAt: undefined },
    ].sort(compareByTrustThenRelevance);

    expect(sorted.map((result) => result.id)).toEqual(["high", "low"]);
  });

  it("breaks a blended tie by recency and then by id so ordering is total", () => {
    const sorted = [
      { id: "b", trustRank: 0 as const, blended: 0.5, observedAt: "2026-08-01T00:00:00.000Z" },
      { id: "a", trustRank: 0 as const, blended: 0.5, observedAt: "2026-08-01T00:00:00.000Z" },
      { id: "c", trustRank: 0 as const, blended: 0.5, observedAt: "2026-08-02T00:00:00.000Z" },
    ].sort(compareByTrustThenRelevance);

    expect(sorted.map((result) => result.id)).toEqual(["c", "a", "b"]);
  });

  it("sorts an item with no observation date below one that has it", () => {
    const sorted = [
      { id: "undated", trustRank: 0 as const, blended: 0.5, observedAt: undefined },
      { id: "dated", trustRank: 0 as const, blended: 0.5, observedAt: "2026-08-01T00:00:00.000Z" },
    ].sort(compareByTrustThenRelevance);

    expect(sorted.map((result) => result.id)).toEqual(["dated", "undated"]);
  });
});
