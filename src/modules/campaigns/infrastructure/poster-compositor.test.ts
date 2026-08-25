import { createCanvas } from "@napi-rs/canvas";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { posterTemplateSchema, type PosterTemplate } from "@/domain/campaigns/poster-template";
import {
  compositePoster,
  pixelDigest,
  type PosterCompositionRequest,
} from "@/modules/campaigns/infrastructure/poster-compositor";

const GOLDEN_DIR = resolve(process.cwd(), "src/modules/campaigns/infrastructure/__golden__");
const FAILURE_DIR = resolve(process.cwd(), "node_modules/.cache/poster-golden-actual");

/** A plain plate with no text on it, which is what spec 019 produces. */
function plate(widthPx = 600, heightPx = 400): Buffer {
  const canvas = createCanvas(widthPx, heightPx);
  const context = canvas.getContext("2d");
  context.fillStyle = "#20303a";
  context.fillRect(0, 0, widthPx, heightPx);
  context.fillStyle = "#8a5a2b";
  context.fillRect(40, 40, widthPx - 80, heightPx - 80);
  return canvas.toBuffer("image/png");
}

function template(overrides: Record<string, unknown> = {}): PosterTemplate {
  return posterTemplateSchema.parse({
    key: "golden_probe",
    version: 1,
    placement: "feed_image",
    canvasWidthPx: 600,
    canvasHeightPx: 400,
    ownerScope: "core",
    packSlug: null,
    organizationId: null,
    state: "active",
    layout: {
      safeArea: { topPx: 32, rightPx: 32, bottomPx: 32, leftPx: 32 },
      logoSlot: null,
      plateCropFocus: "center",
      textBoxes: [
        {
          slot: "caption",
          xPx: 40,
          yPx: 60,
          widthPx: 520,
          heightPx: 160,
          maxLines: 2,
          minFontSizePx: 20,
          maxFontSizePx: 56,
          fontSizeStepPx: 4,
          lineHeightRatio: 1.25,
          alignment: "start",
          required: true,
        },
        {
          slot: "footer",
          xPx: 40,
          yPx: 260,
          widthPx: 520,
          heightPx: 90,
          maxLines: 2,
          minFontSizePx: 16,
          maxFontSizePx: 32,
          fontSizeStepPx: 2,
          lineHeightRatio: 1.25,
          alignment: "start",
          required: false,
        },
      ],
    },
    ...overrides,
  });
}

function request(overrides: Partial<PosterCompositionRequest> = {}): PosterCompositionRequest {
  return {
    template: template(),
    script: "Latn",
    plate: plate(),
    plateContentHash: "a".repeat(64),
    textValues: [{ slot: "caption", text: "Kerala fish curry" }],
    ...overrides,
  };
}

describe("compositePoster", () => {
  it("draws a poster and reports what it drew", async () => {
    const result = await compositePoster(request());

    expect(result.rendered).toBe(true);
    if (!result.rendered) return;
    expect(result.widthPx).toBe(600);
    expect(result.png.subarray(1, 4).toString()).toBe("PNG");
    expect(result.drawnValues).toEqual({ caption: "Kerala fish curry" });
  });

  /**
   * The claim the whole feature rests on: a render is a pure function of its
   * inputs. If this ever fails, what was approved is no longer what publishes.
   */
  it("renders byte-identically twice", async () => {
    const [first, second] = await Promise.all([
      compositePoster(request()),
      compositePoster(request()),
    ]);

    expect(first.rendered && second.rendered).toBe(true);
    if (!first.rendered || !second.rendered) return;
    expect(first.outputContentHash).toBe(second.outputContentHash);
    expect(first.renderDigest).toBe(second.renderDigest);
  });

  it("gives one render digest exactly one output hash", async () => {
    const changed = await compositePoster(
      request({ textValues: [{ slot: "caption", text: "Chicken biriyani" }] }),
    );
    const original = await compositePoster(request());

    expect(original.rendered && changed.rendered).toBe(true);
    if (!original.rendered || !changed.rendered) return;
    expect(changed.renderDigest).not.toBe(original.renderDigest);
    expect(changed.outputContentHash).not.toBe(original.outputContentHash);
  });

  /**
   * Refusals carry a digest because it is computed from the inputs, before
   * anything is drawn. That is what lets a refused render be recorded, counted
   * per script, and replayed idempotently.
   */
  it("refuses an uncovered codepoint before drawing, naming it", async () => {
    const result = await compositePoster(
      request({ script: "Mlym", textValues: [{ slot: "caption", text: "Al Noor" }] }),
    );

    expect(result.rendered).toBe(false);
    if (result.rendered) return;
    expect(result.refusalCode).toBe("glyph_not_covered");
    expect(result.renderDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result.detail)).toContain("U+0041");
  });

  it("refuses text that will not fit, rather than truncating it", async () => {
    const result = await compositePoster(
      request({
        textValues: [
          {
            slot: "caption",
            text: "Kerala fish curry cooked the way it is cooked at home in a red clay pot with tamarind and fresh coconut and served with rice and a plantain",
          },
        ],
      }),
    );

    expect(result.rendered).toBe(false);
    if (result.rendered) return;
    expect(result.refusalCode).toBe("text_does_not_fit");
    expect(result.detail).toMatchObject({ slot: "caption" });
  });

  it("renders Malayalam and Arabic when the font covers them", async () => {
    const malayalam = await compositePoster(
      request({ script: "Mlym", textValues: [{ slot: "caption", text: "കേരള മീൻ കറി" }] }),
    );
    const arabic = await compositePoster(
      request({ script: "Arab", textValues: [{ slot: "caption", text: "برياني الدجاج" }] }),
    );

    expect(malayalam.rendered).toBe(true);
    expect(arabic.rendered).toBe(true);
  });

  it("draws nothing for a slot the template has no box for", async () => {
    const result = await compositePoster(
      request({
        textValues: [
          { slot: "caption", text: "Kerala fish curry" },
          { slot: "extra", text: "Open until 11pm" },
        ],
      }),
    );

    expect(result.rendered).toBe(true);
  });
});

/**
 * Golden images, per script.
 *
 * Shaping is a library behaviour. An upgrade that changes how a Malayalam
 * conjunct is formed would otherwise be discovered on a client's feed, by
 * someone who reads Malayalam, after it published.
 *
 * These compare **pixels**, not PNG bytes. An encoder is free to change its
 * compression between versions without moving a single pixel, and a suite that
 * failed on that would train everyone to regenerate goldens without looking --
 * which is precisely how a real regression would then get waved through.
 */
describe("golden renderings", () => {
  const cases = [
    { name: "malayalam-conjunct", script: "Mlym" as const, text: "ചിക്കൻ ബിരിയാണി" },
    { name: "malayalam-vowel-reorder", script: "Mlym" as const, text: "കേരള മീൻ കറി" },
    { name: "arabic-joined", script: "Arab" as const, text: "برياني الدجاج" },
    { name: "arabic-with-digits", script: "Arab" as const, text: "عرض خاص ٤٩ درهم" },
    { name: "latin", script: "Latn" as const, text: "Two for one on Fridays" },
  ];

  beforeAll(() => {
    mkdirSync(GOLDEN_DIR, { recursive: true });
    mkdirSync(FAILURE_DIR, { recursive: true });
  });

  it.each(cases)("$name renders exactly as it was approved", async ({ name, script, text }) => {
    const result = await compositePoster(
      request({ script, textValues: [{ slot: "caption", text }] }),
    );

    expect(result.rendered).toBe(true);
    if (!result.rendered) return;

    const goldenPath = resolve(GOLDEN_DIR, `${name}.png`);
    let golden: Buffer;
    try {
      golden = readFileSync(goldenPath);
    } catch {
      // First run: record what the approved renderer produces. A human judges
      // the image before it is committed -- the file is the record of that
      // judgement, not a shortcut around it.
      writeFileSync(goldenPath, result.png);
      golden = result.png;
    }

    const [expected, actual] = await Promise.all([pixelDigest(golden), pixelDigest(result.png)]);

    if (expected !== actual) {
      const actualPath = resolve(FAILURE_DIR, `${name}.png`);
      writeFileSync(actualPath, result.png);
      throw new Error(
        `Shaping changed for ${name}. Compare ${goldenPath} against ${actualPath} before regenerating.`,
      );
    }

    expect(actual).toBe(expected);
  });
});
