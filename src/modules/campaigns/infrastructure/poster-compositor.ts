import { createCanvas, loadImage } from "@napi-rs/canvas";
import { createHash } from "node:crypto";

import { fontManifestDigest } from "@/domain/campaigns/font-manifest";
import { findUncoveredGlyphs, type GlyphCoverageProblem } from "@/domain/campaigns/glyph-coverage";
import type {
  PosterTemplate,
  PosterTextBox,
  PosterTextSlot,
  RenderableScript,
} from "@/domain/campaigns/poster-template";
import { renderDigest } from "@/domain/campaigns/render-digest";
import { fitTextToBox, type TextFitOutcome } from "@/domain/campaigns/text-fitting";
import {
  createTextMeasure,
  ensureVendoredFontsRegistered,
  studioFamilyFor,
} from "@/modules/campaigns/infrastructure/font-registry";
import { createGlyphCoverageOracle } from "@/modules/campaigns/infrastructure/glyph-coverage-oracle";

/**
 * Plate plus layers to final bytes.
 *
 * The model drew the plate and it carries no text. Every visible word is put
 * there by this function, from a value the manifest already approved, using a
 * font that was pinned by hash. That division is the whole of ADR 0042: an
 * image model draws food convincingly and spells badly, a layout engine spells
 * perfectly and cannot draw food, and asking either to do the other's job is
 * what produced *"Explore Our Mezza"*.
 *
 * Every refusal happens **before** any pixel is drawn. Checking afterwards
 * would mean inspecting an image to guess whether it is right, which is
 * probabilistic where this is exact.
 */

export type PosterTextInput = {
  readonly slot: PosterTextSlot;
  readonly text: string;
};

export type PosterCompositionRequest = {
  readonly template: PosterTemplate;
  readonly script: RenderableScript;
  /** The plate image bytes, with no text on them. */
  readonly plate: Buffer;
  readonly plateContentHash: string;
  readonly textValues: readonly PosterTextInput[];
};

export type PosterCompositionResult =
  | {
      readonly rendered: true;
      readonly renderDigest: string;
      readonly png: Buffer;
      readonly outputContentHash: string;
      readonly widthPx: number;
      readonly heightPx: number;
      /** What was actually drawn, by slot, for comparison against the manifest. */
      readonly drawnValues: Readonly<Record<string, string>>;
    }
  | {
      readonly rendered: false;
      readonly renderDigest: string;
      readonly refusalCode: "glyph_not_covered" | "text_does_not_fit";
      readonly detail: Readonly<Record<string, unknown>>;
    };

function textValuesRecord(values: readonly PosterTextInput[]): Record<string, string> {
  return Object.fromEntries(values.map((value) => [value.slot, value.text]));
}

function boxFor(template: PosterTemplate, slot: PosterTextSlot): PosterTextBox | undefined {
  return template.layout.textBoxes.find((box) => box.slot === slot);
}

export async function compositePoster(
  request: PosterCompositionRequest,
): Promise<PosterCompositionResult> {
  ensureVendoredFontsRegistered();

  const { template, script, textValues } = request;
  const drawnValues = textValuesRecord(textValues);

  // Computable before anything is drawn, which is what lets a refusal carry one
  // and stay idempotent.
  const digest = renderDigest({
    plateContentHash: request.plateContentHash,
    templateKey: template.key,
    templateVersion: template.version,
    script,
    textValues: drawnValues,
    fontManifestDigest: fontManifestDigest(),
  });

  const uncovered: readonly GlyphCoverageProblem[] = findUncoveredGlyphs(
    textValues.map((value) => ({ slot: value.slot, text: value.text })),
    script,
    createGlyphCoverageOracle(script),
  );

  if (uncovered.length > 0) {
    return {
      rendered: false,
      renderDigest: digest,
      refusalCode: "glyph_not_covered",
      detail: {
        script,
        codepoints: uncovered.map((problem) => ({
          slot: problem.slot,
          codepoint: problem.codepointLabel,
          character: problem.character,
        })),
      },
    };
  }

  const measure = createTextMeasure(script);
  const fitted: { box: PosterTextBox; outcome: Extract<TextFitOutcome, { fitted: true }> }[] = [];

  for (const value of textValues) {
    const box = boxFor(template, value.slot);
    if (box === undefined) continue;

    const outcome = fitTextToBox(value.text, box, measure);
    if (!outcome.fitted) {
      return {
        rendered: false,
        renderDigest: digest,
        refusalCode: "text_does_not_fit",
        detail: {
          slot: outcome.slot,
          templateKey: template.key,
          templateVersion: template.version,
          minFontSizePx: outcome.minFontSizePx,
        },
      };
    }

    fitted.push({ box, outcome });
  }

  const canvas = createCanvas(template.canvasWidthPx, template.canvasHeightPx);
  const context = canvas.getContext("2d");

  const plateImage = await loadImage(request.plate);
  context.drawImage(plateImage, 0, 0, template.canvasWidthPx, template.canvasHeightPx);

  const family = studioFamilyFor(script);
  // Arabic is laid out right to left, so `start` is its right-hand edge. The
  // canvas already understands `start` and `end` relative to direction, which is
  // exactly why the template vocabulary avoids left and right.
  context.direction = script === "Arab" ? "rtl" : "ltr";
  context.fillStyle = "#ffffff";
  context.textBaseline = "top";

  for (const { box, outcome } of fitted) {
    context.font = `${outcome.fontSizePx}px "${family}"`;
    context.textAlign = box.alignment;

    const anchorX =
      box.alignment === "start"
        ? context.direction === "rtl"
          ? box.xPx + box.widthPx
          : box.xPx
        : box.alignment === "end"
          ? context.direction === "rtl"
            ? box.xPx
            : box.xPx + box.widthPx
          : box.xPx + box.widthPx / 2;

    const lineHeight = outcome.fontSizePx * box.lineHeightRatio;
    for (const [index, line] of outcome.lines.entries()) {
      context.fillText(line, anchorX, box.yPx + index * lineHeight);
    }
  }

  const png = canvas.toBuffer("image/png");

  return {
    rendered: true,
    renderDigest: digest,
    png,
    outputContentHash: createHash("sha256").update(png).digest("hex"),
    widthPx: template.canvasWidthPx,
    heightPx: template.canvasHeightPx,
    drawnValues,
  };
}

/**
 * The pixels, not the file.
 *
 * Golden tests compare this rather than the PNG bytes. A PNG encoder is free to
 * change its compression between library versions without changing a single
 * pixel, and a golden suite that failed on that would train everyone to
 * regenerate it without looking -- which is exactly how a real shaping
 * regression would then get waved through.
 */
export async function pixelDigest(png: Buffer): Promise<string> {
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);

  const { data } = context.getImageData(0, 0, image.width, image.height);
  return createHash("sha256")
    .update(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    .digest("hex");
}
