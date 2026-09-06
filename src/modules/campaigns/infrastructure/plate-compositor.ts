import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createHash } from "node:crypto";

import { rectangleUnionArea, type PlateRegionBounds } from "@/domain/campaigns/plate-edit";

/**
 * Putting a model's edit back inside the lines.
 *
 * This is the fence that makes annotated editing safe to offer at all. The model
 * is handed a marked-up plate and an operator's instruction, and it may return
 * anything -- a beautifully edited plate, a subtly different one, or an entirely
 * unrelated image. It does not matter. Only the pixels inside the marked regions
 * are taken from what came back; every other pixel is copied from the parent
 * byte for byte.
 *
 * So the guarantee does not depend on the model behaving, on the instruction
 * being benign, or on a prompt holding. It is arithmetic: outside the union the
 * blend weight is exactly zero, so the output byte is exactly the parent byte.
 * That is why the operator's instruction can be free text at all.
 *
 * The mask is rasterised here rather than accepted from anywhere. A caller-
 * supplied mask would be another thing to validate, and the regions are already
 * validated by `admitPlateEdit`.
 */

export const DEFAULT_FEATHER_PX = 8;

export type MaskedEditRequest = {
  /** The approved plate. Every pixel outside the union survives from here. */
  readonly parent: Buffer;
  /** Whatever the model returned. Trusted for nothing except its pixels. */
  readonly child: Buffer;
  readonly regions: readonly PlateRegionBounds[];
  /** Softens the seam. Applied strictly inward, never outside a region. */
  readonly featherPx?: number;
};

export type MaskedEditResult =
  | {
      readonly composited: true;
      readonly png: Buffer;
      readonly contentHash: string;
      /** The rasterised union, stored so an edit can be re-checked later. */
      readonly maskPng: Buffer;
      readonly maskContentHash: string;
      readonly unionCoverageRatio: number;
      readonly widthPx: number;
      readonly heightPx: number;
    }
  | {
      readonly composited: false;
      readonly refusalCode: "dimensions_differ" | "no_regions";
      readonly detail: string;
    };

export async function compositeMaskedEdit(request: MaskedEditRequest): Promise<MaskedEditResult> {
  if (request.regions.length === 0) {
    return {
      composited: false,
      refusalCode: "no_regions",
      detail: "An edit with no marked region would replace the whole plate.",
    };
  }

  const [parentImage, childImage] = await Promise.all([
    loadImage(request.parent),
    loadImage(request.child),
  ]);

  // Regions are in the parent's pixel space. A child of a different size cannot
  // be mapped into it without a scaling decision nobody made, and guessing one
  // would move the edit somewhere the operator did not mark.
  if (parentImage.width !== childImage.width || parentImage.height !== childImage.height) {
    return {
      composited: false,
      refusalCode: "dimensions_differ",
      detail: `The model returned ${childImage.width}x${childImage.height} against a plate of ${parentImage.width}x${parentImage.height}.`,
    };
  }

  const widthPx = parentImage.width;
  const heightPx = parentImage.height;
  const featherPx = request.featherPx ?? DEFAULT_FEATHER_PX;

  const parentPixels = pixelsOf(parentImage, widthPx, heightPx);
  const childPixels = pixelsOf(childImage, widthPx, heightPx);

  const output = createCanvas(widthPx, heightPx);
  const outputContext = output.getContext("2d");
  const outputData = outputContext.createImageData(widthPx, heightPx);

  const mask = createCanvas(widthPx, heightPx);
  const maskContext = mask.getContext("2d");
  const maskData = maskContext.createImageData(widthPx, heightPx);

  for (let y = 0; y < heightPx; y += 1) {
    for (let x = 0; x < widthPx; x += 1) {
      const weight = blendWeight(x, y, request.regions, featherPx);
      const index = (y * widthPx + x) * 4;

      // The load-bearing line. At weight 0 this is exactly the parent byte, so
      // every pixel outside the union survives untouched by construction rather
      // than by a check performed afterwards.
      for (let channel = 0; channel < 4; channel += 1) {
        const from = parentPixels[index + channel];
        const to = childPixels[index + channel];
        outputData.data[index + channel] = Math.round(from + (to - from) * weight);
      }

      const shade = Math.round(weight * 255);
      maskData.data[index] = shade;
      maskData.data[index + 1] = shade;
      maskData.data[index + 2] = shade;
      maskData.data[index + 3] = 255;
    }
  }

  outputContext.putImageData(outputData, 0, 0);
  maskContext.putImageData(maskData, 0, 0);

  const png = output.toBuffer("image/png");
  const maskPng = mask.toBuffer("image/png");

  return {
    composited: true,
    png,
    contentHash: createHash("sha256").update(png).digest("hex"),
    maskPng,
    maskContentHash: createHash("sha256").update(maskPng).digest("hex"),
    // The marked area, not the feathered area. This is what the operator drew
    // and what `admitPlateEdit` measured, so the two always agree.
    unionCoverageRatio: rectangleUnionArea(request.regions) / (widthPx * heightPx),
    widthPx,
    heightPx,
  };
}

/**
 * How much of the child shows through at this pixel.
 *
 * Zero everywhere outside every region, which is the whole guarantee. Inside,
 * it ramps from the region's own edge inward across `featherPx`, so the softened
 * seam is spent on pixels the operator marked rather than on pixels they did
 * not.
 */
function blendWeight(
  x: number,
  y: number,
  regions: readonly PlateRegionBounds[],
  featherPx: number,
): number {
  let weight = 0;

  for (const region of regions) {
    const right = region.xPx + region.widthPx - 1;
    const bottom = region.yPx + region.heightPx - 1;
    if (x < region.xPx || x > right || y < region.yPx || y > bottom) continue;

    if (featherPx <= 0) return 1;

    const distance = Math.min(x - region.xPx, right - x, y - region.yPx, bottom - y);
    const local = Math.min(1, (distance + 1) / featherPx);
    if (local > weight) weight = local;
    if (weight >= 1) return 1;
  }

  return weight;
}

function pixelsOf(
  image: Awaited<ReturnType<typeof loadImage>>,
  widthPx: number,
  heightPx: number,
): Uint8ClampedArray {
  const canvas = createCanvas(widthPx, heightPx);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, widthPx, heightPx).data;
}

/**
 * The real pixel size of an image, decoded.
 *
 * Beside the compositor deliberately: it is the same decoder, so the size this
 * reports is exactly the size the composite will work in. Measuring somewhere
 * else with something else would reintroduce the disagreement it exists to
 * close.
 *
 * Returns `null` for bytes that will not decode, which the caller treats as an
 * unreadable plate rather than as a zero-sized one.
 */
export async function measureImage(
  bytes: Uint8Array,
): Promise<{ widthPx: number; heightPx: number } | null> {
  try {
    const image = await loadImage(Buffer.from(bytes));
    if (image.width <= 0 || image.height <= 0) return null;
    return { widthPx: image.width, heightPx: image.height };
  } catch {
    return null;
  }
}
