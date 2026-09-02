import { GlobalFonts, createCanvas } from "@napi-rs/canvas";

import {
  FONT_MANIFEST,
  fontForScript,
  vendoredFontPath,
  type VendoredFont,
} from "@/domain/campaigns/font-manifest";
import type { RenderableScript } from "@/domain/campaigns/poster-template";
import type { TextMeasure } from "@/domain/campaigns/text-fitting";

/**
 * Register the vendored fonts, and only the vendored fonts.
 *
 * `@napi-rs/canvas` loads the host's font configuration at import: on this
 * machine that is **336 families** before a single line of our code runs. None
 * of them is an input anybody approved, none is pinned by hash, and they differ
 * between machines -- which is precisely the dependency spec 020 section 7.5
 * and the renderer spike both refused to accept.
 *
 * So registration begins by clearing them. Measured today, this library draws
 * tofu rather than silently substituting another family, so nothing is known to
 * be broken without the clear -- but that is a *library behaviour*, and one an
 * upgrade could change without telling us. `removeAll()` makes "only approved
 * fonts exist in this process" true by construction instead of true by the
 * renderer's current fallback policy.
 *
 * Families are registered under a deterministic alias rather than the name
 * inside the file, so what a template asks for cannot accidentally match
 * something the host happened to have.
 */

/** `Studio Mlym`. Deterministic, and no host font is plausibly called this. */
export function studioFamilyFor(script: RenderableScript): string {
  return `Studio ${script}`;
}

let registered = false;

export function ensureVendoredFontsRegistered(): void {
  if (registered) return;

  GlobalFonts.removeAll();

  for (const font of FONT_MANIFEST) {
    for (const script of font.scripts) {
      const ok = GlobalFonts.registerFromPath(vendoredFontPath(font.file), studioFamilyFor(script));
      if (!ok) {
        throw new Error(
          `Could not register the vendored font ${font.file}; rendering would fall back to nothing.`,
        );
      }
    }
  }

  registered = true;
}

/** Test seam: forget the registration so the next call re-runs it. */
export function resetFontRegistrationForTests(): void {
  registered = false;
}

export function vendoredFontForScript(script: RenderableScript): VendoredFont {
  const font = fontForScript(script);
  if (font === null) {
    throw new Error(`No vendored font covers ${script}, so nothing may be rendered in it.`);
  }
  return font;
}

/**
 * How wide the renderer will actually draw this string.
 *
 * Fitting decides *which* sizes to try; this answers what a size costs. Keeping
 * them apart is what lets the fitting rule be tested without a font on disk,
 * and lets this be swapped if the renderer ever is.
 */
export function createTextMeasure(script: RenderableScript): TextMeasure {
  ensureVendoredFontsRegistered();
  const family = studioFamilyFor(script);
  // A one-pixel scratch surface. Measurement needs a context, not a canvas of
  // the real size, and allocating a poster to ask how wide a word is would be
  // wasteful on every shrink-to-fit step.
  const context = createCanvas(8, 8).getContext("2d");

  return (text, fontSizePx) => {
    context.font = `${fontSizePx}px "${family}"`;
    return context.measureText(text).width;
  };
}
