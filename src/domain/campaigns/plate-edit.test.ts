import { describe, expect, it } from "vitest";

import {
  admitPlateEdit,
  plateEditRequestSchema,
  rectangleUnionArea,
  MAX_UNION_COVERAGE_RATIO,
  type PlateAnnotation,
} from "@/domain/campaigns/plate-edit";

const PLATE = { plateWidthPx: 1000, plateHeightPx: 1000 };

function annotation(overrides: Partial<PlateAnnotation> = {}): PlateAnnotation {
  return {
    ordinal: 1,
    bounds: { xPx: 100, yPx: 100, widthPx: 200, heightPx: 200 },
    instruction: "Make the curry look less orange.",
    ...overrides,
  };
}

describe("admitPlateEdit", () => {
  it("admits a marked region and reports what it covers", () => {
    const result = admitPlateEdit({ annotations: [annotation()], ...PLATE });

    expect(result.admitted).toBe(true);
    if (!result.admitted) return;
    // 200x200 of 1000x1000.
    expect(result.unionCoverageRatio).toBeCloseTo(0.04, 6);
  });

  it("refuses a region that runs off the plate", () => {
    const result = admitPlateEdit({
      annotations: [annotation({ bounds: { xPx: 900, yPx: 100, widthPx: 200, heightPx: 200 } })],
      ...PLATE,
    });

    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.refusals.map((refusal) => refusal.code)).toContain("region_outside_plate");
  });

  /** A stray drag, not a decision. */
  it("refuses a region too small to have been meant", () => {
    const result = admitPlateEdit({
      annotations: [annotation({ bounds: { xPx: 10, yPx: 10, widthPx: 20, heightPx: 20 } })],
      ...PLATE,
    });

    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.refusals.map((refusal) => refusal.code)).toContain("region_too_small");
  });

  /**
   * Not a safety rule -- the compositor bounds the edit either way. It is an
   * honesty rule: composing most of a new image into an approved one and filing
   * it as a correction misdescribes what happened.
   */
  it("refuses an edit that is really a regeneration", () => {
    const result = admitPlateEdit({
      annotations: [annotation({ bounds: { xPx: 0, yPx: 0, widthPx: 900, heightPx: 900 } })],
      ...PLATE,
    });

    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.refusals.map((refusal) => refusal.code)).toContain("union_too_large");
  });

  /**
   * Overlapping marks are one area, not two. Summing them would refuse an edit
   * for covering more than it does, and would record a coverage ratio the
   * provenance then rests on.
   */
  it("counts overlapping regions once", () => {
    const result = admitPlateEdit({
      annotations: [
        annotation({ ordinal: 1, bounds: { xPx: 0, yPx: 0, widthPx: 400, heightPx: 400 } }),
        annotation({ ordinal: 2, bounds: { xPx: 200, yPx: 200, widthPx: 400, heightPx: 400 } }),
      ],
      ...PLATE,
    });

    expect(result.admitted).toBe(true);
    if (!result.admitted) return;
    // Two 400x400 squares overlapping in a 200x200 corner: 160000 + 160000 - 40000.
    expect(result.unionCoverageRatio).toBeCloseTo(0.28, 6);
  });

  it("refuses ordinals that are not the replay order the database requires", () => {
    const result = admitPlateEdit({
      annotations: [
        annotation({ ordinal: 2 }),
        annotation({ ordinal: 1, bounds: { xPx: 400, yPx: 400, widthPx: 200, heightPx: 200 } }),
      ],
      ...PLATE,
    });

    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.refusals.map((refusal) => refusal.code)).toContain("ordinals_not_sequential");
  });

  it("reports every problem rather than the first", () => {
    const result = admitPlateEdit({
      annotations: [
        annotation({ ordinal: 5, bounds: { xPx: 10, yPx: 10, widthPx: 20, heightPx: 20 } }),
      ],
      ...PLATE,
    });

    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.refusals.map((refusal) => refusal.code).sort()).toEqual([
      "ordinals_not_sequential",
      "region_too_small",
    ]);
  });

  /** An out-of-bounds region must not be able to inflate the coverage refusal. */
  it("does not count a region off the plate toward coverage", () => {
    const result = admitPlateEdit({
      annotations: [
        annotation({ ordinal: 1, bounds: { xPx: 0, yPx: 0, widthPx: 100, heightPx: 100 } }),
        annotation({ ordinal: 2, bounds: { xPx: 500, yPx: 500, widthPx: 900, heightPx: 900 } }),
      ],
      ...PLATE,
    });

    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.refusals.map((refusal) => refusal.code)).toContain("region_outside_plate");
    expect(result.refusals.map((refusal) => refusal.code)).not.toContain("union_too_large");
  });

  it("admits an edit sitting exactly on the coverage limit", () => {
    // 774x774 is 599076 of 1000000, just under the 60% ceiling.
    const result = admitPlateEdit({
      annotations: [annotation({ bounds: { xPx: 0, yPx: 0, widthPx: 774, heightPx: 774 } })],
      ...PLATE,
    });

    expect(result.admitted).toBe(true);
    if (!result.admitted) return;
    expect(result.unionCoverageRatio).toBeLessThanOrEqual(MAX_UNION_COVERAGE_RATIO);
  });
});

describe("plateEditRequestSchema", () => {
  it("caps regions at the eight the database allows", () => {
    const annotations = Array.from({ length: 9 }, (_, index) => annotation({ ordinal: index + 1 }));

    expect(plateEditRequestSchema.safeParse({ annotations }).success).toBe(false);
  });

  it("refuses an empty instruction, which asks the model for nothing", () => {
    expect(
      plateEditRequestSchema.safeParse({ annotations: [annotation({ instruction: "   " })] })
        .success,
    ).toBe(false);
  });

  it("refuses an instruction past the length the column stores", () => {
    expect(
      plateEditRequestSchema.safeParse({
        annotations: [annotation({ instruction: "x".repeat(501) })],
      }).success,
    ).toBe(false);
  });

  it("refuses an edit with no regions at all", () => {
    expect(plateEditRequestSchema.safeParse({ annotations: [] }).success).toBe(false);
  });
});

describe("rectangleUnionArea", () => {
  it("is zero for nothing", () => {
    expect(rectangleUnionArea([])).toBe(0);
  });

  it("counts a fully contained rectangle once", () => {
    expect(
      rectangleUnionArea([
        { xPx: 0, yPx: 0, widthPx: 100, heightPx: 100 },
        { xPx: 10, yPx: 10, widthPx: 10, heightPx: 10 },
      ]),
    ).toBe(10_000);
  });

  it("adds disjoint rectangles", () => {
    expect(
      rectangleUnionArea([
        { xPx: 0, yPx: 0, widthPx: 10, heightPx: 10 },
        { xPx: 50, yPx: 50, widthPx: 10, heightPx: 10 },
      ]),
    ).toBe(200);
  });
});
