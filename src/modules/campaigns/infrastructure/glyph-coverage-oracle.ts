import * as fontkit from "fontkit";

import { vendoredFontPath } from "@/domain/campaigns/font-manifest";
import type { GlyphCoverageOracle } from "@/domain/campaigns/glyph-coverage";
import type { RenderableScript } from "@/domain/campaigns/poster-template";
import { vendoredFontForScript } from "@/modules/campaigns/infrastructure/font-registry";

/**
 * Ask the font that will actually draw, and no other.
 *
 * This is the whole subtlety. It would be friendlier to answer "yes" when *any*
 * vendored face covers a codepoint -- more text would pass. It would also be
 * wrong: `fillText` draws a run with one family, so a character covered only by
 * a different face still comes out as an empty box. Coverage would report a
 * pass and the render would be broken, which is worse than refusing outright,
 * because nobody would be looking any more.
 *
 * The consequence is a real product limit and is not hidden. Measured against
 * the vendored faces: Latin digits, space, comma and hyphen are covered by all
 * three, so prices and numbers render in any script. Latin **letters** are
 * covered only by the Latin face -- so a Malayalam poster containing a Latin
 * word, such as the restaurant's own name, is refused rather than drawn with
 * boxes. Lifting that needs per-run font selection, which is a change to how
 * text is drawn rather than to how it is checked.
 */

const cache = new Map<RenderableScript, fontkit.Font>();

function openFace(script: RenderableScript): fontkit.Font {
  const cached = cache.get(script);
  if (cached !== undefined) return cached;

  const vendored = vendoredFontForScript(script);
  const opened = fontkit.openSync(vendoredFontPath(vendored.file));

  // A collection would make "which face draws this" ambiguous, and the vendored
  // files are single faces. Refusing here beats guessing at render time.
  if (!("hasGlyphForCodePoint" in opened)) {
    throw new Error(
      `The vendored font ${vendored.file} is not a single face and cannot be checked.`,
    );
  }

  const font = opened as fontkit.Font;
  cache.set(script, font);
  return font;
}

export function createGlyphCoverageOracle(script: RenderableScript): GlyphCoverageOracle {
  const font = openFace(script);
  return (codepoint) => font.hasGlyphForCodePoint(codepoint);
}

/** Test seam: drop the opened faces so a changed file is re-read. */
export function resetGlyphCoverageCacheForTests(): void {
  cache.clear();
}
