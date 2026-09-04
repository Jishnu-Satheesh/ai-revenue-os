import { describe, expect, it } from "vitest";

import {
  createGrowthIntelligenceItemFingerprint,
  type GrowthIntelligenceItemInput,
} from "@/domain/growth-intelligence/items";

function item(overrides: Partial<GrowthIntelligenceItemInput> = {}): GrowthIntelligenceItemInput {
  return {
    kind: "insight",
    narrative: "Recorded dinner demand clusters across Dubai this month.",
    claimDigests: ["b".repeat(64)],
    businessFindingDigests: ["c".repeat(64)],
    geographicLayer: "city",
    geographyRef: "ae:du",
    limitationCodes: [],
    synthesisVersion: "synthesis@1",
    ...overrides,
  };
}

describe("createGrowthIntelligenceItemFingerprint", () => {
  it("is stable under key order and invalidated by every bound semantic change", () => {
    const first = createGrowthIntelligenceItemFingerprint(item());
    expect(createGrowthIntelligenceItemFingerprint(item())).toBe(first);
    expect(createGrowthIntelligenceItemFingerprint(item({ kind: "recommendation" }))).not.toBe(
      first,
    );
    expect(
      createGrowthIntelligenceItemFingerprint(item({ narrative: "Different words." })),
    ).not.toBe(first);
    expect(
      createGrowthIntelligenceItemFingerprint(item({ claimDigests: ["d".repeat(64)] })),
    ).not.toBe(first);
    expect(createGrowthIntelligenceItemFingerprint(item({ geographicLayer: "country" }))).not.toBe(
      first,
    );
    expect(
      createGrowthIntelligenceItemFingerprint(
        item({ limitationCodes: ["STALE_BUSINESS_EVIDENCE"] }),
      ),
    ).not.toBe(first);
  });

  it("treats digest order as identity, not sequence", () => {
    const ordered = createGrowthIntelligenceItemFingerprint(
      item({ claimDigests: ["b".repeat(64), "d".repeat(64)] }),
    );
    const reversed = createGrowthIntelligenceItemFingerprint(
      item({ claimDigests: ["d".repeat(64), "b".repeat(64)] }),
    );
    expect(ordered).toBe(reversed);
  });

  it("refuses duplicate digests and malformed identity", () => {
    expect(() =>
      createGrowthIntelligenceItemFingerprint(
        item({ claimDigests: ["b".repeat(64), "b".repeat(64)] }),
      ),
    ).toThrow(/unique/i);
    expect(() =>
      createGrowthIntelligenceItemFingerprint(item({ claimDigests: ["not-a-digest"] })),
    ).toThrow();
    expect(() =>
      createGrowthIntelligenceItemFingerprint(item({ kind: "opportunity" as never })),
    ).toThrow();
  });
});
