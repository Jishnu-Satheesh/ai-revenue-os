import { describe, expect, it } from "vitest";

import { classifyItemLineage } from "@/domain/growth-intelligence/lineage";
import { createGrowthIntelligenceItemIdentity } from "@/domain/growth-intelligence/items";

const narrative = "Recorded dinner demand clusters across Dubai this month.";
const claims = ["b".repeat(64)];
const findings = ["c".repeat(64)];

function identity(overrides: { narrative?: string; claims?: string[] } = {}) {
  return createGrowthIntelligenceItemIdentity({
    kind: "insight",
    narrative: overrides.narrative ?? narrative,
    claimDigests: overrides.claims ?? claims,
    businessFindingDigests: findings,
    geographicLayer: "city",
    geographyRef: "ae:du",
    limitationCodes: [],
    synthesisVersion: "synthesis@1",
  });
}

describe("classifyItemLineage", () => {
  it("suppresses byte-for-byte repeats", () => {
    expect(classifyItemLineage(identity(), identity())).toBe("duplicate");
  });

  it("suppresses narration-only rewrites over identical evidence", () => {
    expect(
      classifyItemLineage(identity(), identity({ narrative: "Reworded, same evidence." })),
    ).toBe("duplicate");
  });

  it("opens a new untriaged item when the evidence materially changes", () => {
    expect(classifyItemLineage(identity(), identity({ claims: ["d".repeat(64)] }))).toBe(
      "material_change",
    );
  });

  it("opens a new untriaged item when limitations change the reading", () => {
    const previous = identity();
    const current = createGrowthIntelligenceItemIdentity({
      kind: "insight",
      narrative,
      claimDigests: claims,
      businessFindingDigests: findings,
      geographicLayer: "city",
      geographyRef: "ae:du",
      limitationCodes: ["STALE_BUSINESS_EVIDENCE"],
      synthesisVersion: "synthesis@1",
    });
    expect(classifyItemLineage(previous, current)).toBe("material_change");
  });
});
