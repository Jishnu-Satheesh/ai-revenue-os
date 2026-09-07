import { z } from "zod";

/**
 * What an operator may ask a model to change about a plate, and where.
 *
 * An edit is bounded twice over. It is bounded in *area*, by the regions the
 * operator marked -- the compositor puts back every pixel outside them, so an
 * instruction that talks the model into redrawing the whole image still cannot
 * change one. And it is bounded in *scope*, by the caps here: a region too small
 * to be deliberate is a mis-click, and a union covering most of the plate is not
 * an edit at all, it is a regeneration wearing an edit's clothes.
 *
 * The second bound is the one that needs stating, because it is about honesty
 * rather than safety. Nothing breaks if someone marks 90% of a plate and asks
 * for something new. But the result is a new image being recorded as a small
 * correction to an approved one, and its provenance stops describing what
 * happened.
 */

/** Matches the eight-region cap the database enforces on `annotations`. */
export const MAX_PLATE_ANNOTATIONS = 8;

/**
 * A region smaller than this fraction of the plate is a stray drag, not a
 * decision. At 1080x1080 it is about 54px square -- smaller than anything a
 * person marks on purpose, and small enough that feathering would consume it.
 */
export const MIN_REGION_AREA_RATIO = 0.0025;

/**
 * Above this, the honest action is to regenerate. Composing most of a new image
 * into an approved one and filing it as an edit misdescribes what was done.
 */
export const MAX_UNION_COVERAGE_RATIO = 0.6;

export const plateRegionBoundsSchema = z
  .strictObject({
    xPx: z.number().int().nonnegative().max(20_000),
    yPx: z.number().int().nonnegative().max(20_000),
    widthPx: z.number().int().positive().max(20_000),
    heightPx: z.number().int().positive().max(20_000),
  })
  .describe("A rectangle on the parent plate, in its own pixel space.");

export type PlateRegionBounds = z.infer<typeof plateRegionBoundsSchema>;

export const plateAnnotationSchema = z.strictObject({
  /** Replay order. The database requires these to be exactly 1..n, in order. */
  ordinal: z.number().int().positive().max(MAX_PLATE_ANNOTATIONS),
  bounds: plateRegionBoundsSchema,
  /**
   * Operator-authored, and the one injection surface this feature adds. It is
   * carried to the model as data in a delimited block with the fixed
   * constraints after it -- and even a wholly successful injection cannot
   * change a pixel outside the union.
   */
  instruction: z.string().trim().min(1).max(500),
});

export type PlateAnnotation = z.infer<typeof plateAnnotationSchema>;

export const plateEditRequestSchema = z.strictObject({
  annotations: z.array(plateAnnotationSchema).min(1).max(MAX_PLATE_ANNOTATIONS),
});

export type PlateEditRequest = z.infer<typeof plateEditRequestSchema>;

export type PlateEditRefusalCode =
  | "ordinals_not_sequential"
  | "region_outside_plate"
  | "region_too_small"
  | "union_too_large";

export type PlateEditRefusal = {
  readonly code: PlateEditRefusalCode;
  readonly detail: string;
};

export type PlateEditAdmission =
  | {
      readonly admitted: true;
      /** Exact union area over plate area, for `union_coverage_ratio`. */
      readonly unionCoverageRatio: number;
    }
  | { readonly admitted: false; readonly refusals: readonly PlateEditRefusal[] };

export function admitPlateEdit(input: {
  readonly annotations: readonly PlateAnnotation[];
  readonly plateWidthPx: number;
  readonly plateHeightPx: number;
}): PlateEditAdmission {
  const refusals: PlateEditRefusal[] = [];
  const plateArea = input.plateWidthPx * input.plateHeightPx;

  // The database requires ordinals to be exactly 1..n in array order, so a
  // request that would be rejected there is rejected here in words first.
  const ordinals = input.annotations.map((annotation) => annotation.ordinal);
  const sequential = ordinals.every((ordinal, index) => ordinal === index + 1);
  if (!sequential) {
    refusals.push({
      code: "ordinals_not_sequential",
      detail: `Regions must be numbered 1 to ${input.annotations.length} in order; got ${ordinals.join(", ")}.`,
    });
  }

  for (const annotation of input.annotations) {
    const { xPx, yPx, widthPx, heightPx } = annotation.bounds;

    if (xPx + widthPx > input.plateWidthPx || yPx + heightPx > input.plateHeightPx) {
      refusals.push({
        code: "region_outside_plate",
        detail: `Region ${annotation.ordinal} extends past the plate, which is ${input.plateWidthPx}x${input.plateHeightPx}.`,
      });
      continue;
    }

    if (widthPx * heightPx < plateArea * MIN_REGION_AREA_RATIO) {
      refusals.push({
        code: "region_too_small",
        detail: `Region ${annotation.ordinal} is too small to be deliberate; mark an area of at least ${Math.ceil(plateArea * MIN_REGION_AREA_RATIO)} pixels.`,
      });
    }
  }

  // Computed before the coverage check so an out-of-bounds region cannot inflate
  // it, and computed as a true union so overlapping marks are not double
  // counted into a refusal.
  const unionArea = rectangleUnionArea(
    input.annotations
      .map((annotation) => annotation.bounds)
      .filter(
        (bounds) =>
          bounds.xPx + bounds.widthPx <= input.plateWidthPx &&
          bounds.yPx + bounds.heightPx <= input.plateHeightPx,
      ),
  );

  const unionCoverageRatio = plateArea === 0 ? 0 : unionArea / plateArea;

  if (unionCoverageRatio > MAX_UNION_COVERAGE_RATIO) {
    refusals.push({
      code: "union_too_large",
      detail: `The marked regions cover ${(unionCoverageRatio * 100).toFixed(1)}% of the plate. Above ${MAX_UNION_COVERAGE_RATIO * 100}%, generate a new plate rather than recording this as an edit.`,
    });
  }

  if (refusals.length > 0) return { admitted: false, refusals };
  return { admitted: true, unionCoverageRatio };
}

/**
 * Exact area of a union of rectangles, by coordinate compression.
 *
 * Summing areas would double count every overlap, which matters in both
 * directions: it would refuse an edit whose marks merely overlap, and it would
 * mis-record the coverage ratio that the provenance rests on. With at most eight
 * rectangles the grid is tiny, so exactness is free.
 */
export function rectangleUnionArea(rectangles: readonly PlateRegionBounds[]): number {
  if (rectangles.length === 0) return 0;

  const xs = [...new Set(rectangles.flatMap((r) => [r.xPx, r.xPx + r.widthPx]))].sort(
    (left, right) => left - right,
  );
  const ys = [...new Set(rectangles.flatMap((r) => [r.yPx, r.yPx + r.heightPx]))].sort(
    (left, right) => left - right,
  );

  let area = 0;

  for (let column = 0; column < xs.length - 1; column += 1) {
    for (let row = 0; row < ys.length - 1; row += 1) {
      const covered = rectangles.some(
        (rectangle) =>
          rectangle.xPx <= xs[column] &&
          rectangle.xPx + rectangle.widthPx >= xs[column + 1] &&
          rectangle.yPx <= ys[row] &&
          rectangle.yPx + rectangle.heightPx >= ys[row + 1],
      );
      if (covered) area += (xs[column + 1] - xs[column]) * (ys[row + 1] - ys[row]);
    }
  }

  return area;
}
