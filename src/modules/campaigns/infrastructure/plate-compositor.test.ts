import { createCanvas, loadImage } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import { compositeMaskedEdit } from "@/modules/campaigns/infrastructure/plate-compositor";
import type { PlateRegionBounds } from "@/domain/campaigns/plate-edit";

const WIDTH = 200;
const HEIGHT = 200;

/** A plate with structure, so a wrongly copied pixel is a different colour. */
function parentPlate(): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      context.fillStyle = `rgb(${x % 256}, ${y % 256}, ${(x + y) % 256})`;
      context.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toBuffer("image/png");
}

/** A wholly unrelated image, which is the adversarial case that matters. */
function unrelatedChild(): Buffer {
  const canvas = createCanvas(WIDTH, HEIGHT);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ff00ff";
  context.fillRect(0, 0, WIDTH, HEIGHT);
  return canvas.toBuffer("image/png");
}

async function pixels(png: Buffer): Promise<Uint8ClampedArray> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, image.width, image.height).data;
}

function inAnyRegion(x: number, y: number, regions: readonly PlateRegionBounds[]): boolean {
  return regions.some(
    (region) =>
      x >= region.xPx &&
      x < region.xPx + region.widthPx &&
      y >= region.yPx &&
      y < region.yPx + region.heightPx,
  );
}

/**
 * The rule the whole feature rests on.
 *
 * Not "the model usually behaves" and not "the prompt holds", but arithmetic:
 * outside the marked regions the blend weight is exactly zero, so the output
 * byte is exactly the parent byte. It is asserted against a model that returned
 * a completely different image, because that is the case a guarantee has to
 * survive.
 */
describe("compositeMaskedEdit keeps the edit inside the lines", () => {
  const shapes: { name: string; regions: readonly PlateRegionBounds[] }[] = [
    { name: "one small region", regions: [{ xPx: 40, yPx: 40, widthPx: 40, heightPx: 40 }] },
    {
      name: "two disjoint regions",
      regions: [
        { xPx: 10, yPx: 10, widthPx: 30, heightPx: 30 },
        { xPx: 150, yPx: 150, widthPx: 40, heightPx: 40 },
      ],
    },
    {
      name: "two overlapping regions",
      regions: [
        { xPx: 50, yPx: 50, widthPx: 60, heightPx: 60 },
        { xPx: 80, yPx: 80, widthPx: 60, heightPx: 60 },
      ],
    },
    {
      name: "a region touching the top-left corner",
      regions: [{ xPx: 0, yPx: 0, widthPx: 60, heightPx: 60 }],
    },
    {
      name: "a region touching the bottom-right corner",
      regions: [{ xPx: 140, yPx: 140, widthPx: 60, heightPx: 60 }],
    },
    {
      name: "a band touching every edge",
      regions: [
        { xPx: 0, yPx: 0, widthPx: WIDTH, heightPx: 20 },
        { xPx: 0, yPx: HEIGHT - 20, widthPx: WIDTH, heightPx: 20 },
        { xPx: 0, yPx: 0, widthPx: 20, heightPx: HEIGHT },
        { xPx: WIDTH - 20, yPx: 0, widthPx: 20, heightPx: HEIGHT },
      ],
    },
  ];

  it.each(shapes)(
    "leaves every pixel outside $name byte-identical to the parent",
    async ({ regions }) => {
      const parent = parentPlate();
      const result = await compositeMaskedEdit({
        parent,
        child: unrelatedChild(),
        regions,
      });

      expect(result.composited).toBe(true);
      if (!result.composited) return;

      const [before, after] = await Promise.all([pixels(parent), pixels(result.png)]);

      let checked = 0;
      for (let y = 0; y < HEIGHT; y += 1) {
        for (let x = 0; x < WIDTH; x += 1) {
          if (inAnyRegion(x, y, regions)) continue;
          const index = (y * WIDTH + x) * 4;
          for (let channel = 0; channel < 4; channel += 1) {
            if (after[index + channel] !== before[index + channel]) {
              throw new Error(
                `Pixel ${x},${y} channel ${channel} changed outside the marked regions: ${before[index + channel]} became ${after[index + channel]}.`,
              );
            }
          }
          checked += 1;
        }
      }

      // Proves the loop actually examined something rather than skipping all.
      expect(checked).toBeGreaterThan(0);
    },
  );

  it("does take the model's pixels well inside a marked region", async () => {
    const regions = [{ xPx: 50, yPx: 50, widthPx: 80, heightPx: 80 }];
    const result = await compositeMaskedEdit({
      parent: parentPlate(),
      child: unrelatedChild(),
      regions,
    });

    expect(result.composited).toBe(true);
    if (!result.composited) return;

    const after = await pixels(result.png);
    // Dead centre, far beyond the feather, so the child shows fully.
    const index = (90 * WIDTH + 90) * 4;
    expect([after[index], after[index + 1], after[index + 2]]).toEqual([255, 0, 255]);
  });

  /** A hard-edged mask must not leak either. */
  it("holds the guarantee with feathering switched off", async () => {
    const regions = [{ xPx: 20, yPx: 20, widthPx: 40, heightPx: 40 }];
    const parent = parentPlate();
    const result = await compositeMaskedEdit({
      parent,
      child: unrelatedChild(),
      regions,
      featherPx: 0,
    });

    expect(result.composited).toBe(true);
    if (!result.composited) return;

    const [before, after] = await Promise.all([pixels(parent), pixels(result.png)]);
    const outside = (10 * WIDTH + 10) * 4;
    expect(after[outside]).toBe(before[outside]);

    // With no feather the region is taken wholesale, including its edge pixel.
    const edge = (20 * WIDTH + 20) * 4;
    expect([after[edge], after[edge + 1], after[edge + 2]]).toEqual([255, 0, 255]);
  });

  it("refuses a model image of a different size rather than guessing a scale", async () => {
    const small = createCanvas(100, 100);
    small.getContext("2d").fillRect(0, 0, 100, 100);

    const result = await compositeMaskedEdit({
      parent: parentPlate(),
      child: small.toBuffer("image/png"),
      regions: [{ xPx: 10, yPx: 10, widthPx: 40, heightPx: 40 }],
    });

    expect(result.composited).toBe(false);
    if (result.composited) return;
    expect(result.refusalCode).toBe("dimensions_differ");
  });

  it("refuses an edit with no marked region", async () => {
    const result = await compositeMaskedEdit({
      parent: parentPlate(),
      child: unrelatedChild(),
      regions: [],
    });

    expect(result.composited).toBe(false);
    if (result.composited) return;
    expect(result.refusalCode).toBe("no_regions");
  });

  it("reports the marked coverage, matching what the domain measured", async () => {
    const result = await compositeMaskedEdit({
      parent: parentPlate(),
      child: unrelatedChild(),
      regions: [{ xPx: 0, yPx: 0, widthPx: 40, heightPx: 40 }],
    });

    expect(result.composited).toBe(true);
    if (!result.composited) return;
    expect(result.unionCoverageRatio).toBeCloseTo(1600 / 40_000, 6);
  });

  it("is deterministic, so the same edit twice is the same bytes", async () => {
    const request = {
      parent: parentPlate(),
      child: unrelatedChild(),
      regions: [{ xPx: 30, yPx: 30, widthPx: 50, heightPx: 50 }],
    };

    const [first, second] = await Promise.all([
      compositeMaskedEdit(request),
      compositeMaskedEdit(request),
    ]);

    expect(first.composited && second.composited).toBe(true);
    if (!first.composited || !second.composited) return;
    expect(first.contentHash).toBe(second.contentHash);
    expect(first.maskContentHash).toBe(second.maskContentHash);
  });
});
