import type { SupportedScript } from "@/domain/campaigns/font-manifest";

/**
 * Does the registered font actually have a glyph for every character?
 *
 * This is the check that makes the empty-box failure impossible rather than
 * unlikely, and it is deterministic where inspecting the finished image would
 * be probabilistic.
 *
 * The renderer spike is why it exists in this form. Malayalam drawn in a Latin
 * font produced seven empty boxes and the renderer **said nothing** -- no
 * exception, and `measureText` returned 285, a completely plausible width.
 * Nothing downstream could have told that from a real render. A `fontkit` cmap
 * lookup named all seven codepoints before anything was drawn.
 *
 * Coverage is a cmap question, not a renderer question, so this module is
 * independent of whichever renderer is chosen. It is also pure: the caller
 * supplies the oracle, which keeps the decision testable without a font file on
 * disk, exactly as `verifyFontHashes` takes observed hashes rather than reading
 * them.
 */

/** Answers whether the font for a script has a glyph for one codepoint. */
export type GlyphCoverageOracle = (codepoint: number) => boolean;

export type PosterTextValue = {
  /** Which named box the text belongs to, so a refusal can say where. */
  readonly slot: string;
  readonly text: string;
};

export type GlyphCoverageProblem = {
  readonly slot: string;
  readonly script: SupportedScript;
  readonly codepoint: number;
  /** `U+0D7B`. The form a refusal shows an operator. */
  readonly codepointLabel: string;
  readonly character: string;
};

/**
 * Codepoints that carry shaping or direction rather than a picture.
 *
 * Fonts do not map these to glyphs, so a cmap lookup reports them missing --
 * for text that is entirely correct. Zero-width joiners are how Malayalam forms
 * a chillu and how Arabic is held together or broken apart; the bidi isolates
 * are how Latin digits sit inside an Arabic sentence without reordering the
 * sentence around them.
 *
 * Refusing them would refuse the pilot client's own language. Over-refusal is a
 * failure too -- quieter than an empty box, and just as much of a broken
 * promise -- so these are excluded from the question rather than answered
 * wrongly.
 */
export const SHAPING_CONTROL_CODEPOINTS: ReadonlySet<number> = new Set([
  0x00ad, // soft hyphen
  0x034f, // combining grapheme joiner
  0x200b, // zero width space
  0x200c, // zero width non-joiner
  0x200d, // zero width joiner
  0x200e, // left-to-right mark
  0x200f, // right-to-left mark
  0x061c, // Arabic letter mark
  0x202a, // left-to-right embedding
  0x202b, // right-to-left embedding
  0x202c, // pop directional formatting
  0x202d, // left-to-right override
  0x202e, // right-to-left override
  0x2060, // word joiner
  0x2066, // left-to-right isolate
  0x2067, // right-to-left isolate
  0x2068, // first strong isolate
  0x2069, // pop directional isolate
  0xfeff, // zero width no-break space
  // Variation selectors 1-16: they choose a form, they are not a form.
  ...Array.from({ length: 16 }, (_, index) => 0xfe00 + index),
]);

/** `U+0D7B`. At least four hex digits, never truncated above them. */
export function describeCodepoint(codepoint: number): string {
  return `U+${codepoint.toString(16).toUpperCase().padStart(4, "0")}`;
}

function isSkippable(codepoint: number): boolean {
  if (SHAPING_CONTROL_CODEPOINTS.has(codepoint)) return true;

  // Ordinary whitespace is a layout decision, not a glyph the font must draw.
  // Asking about it would make a line break look like a missing character.
  return codepoint === 0x20 || codepoint === 0x09 || codepoint === 0x0a || codepoint === 0x0d;
}

/**
 * Every codepoint the font cannot draw, in the order they first appear.
 *
 * Every problem is reported rather than only the first: an operator fixing one
 * character at a time, discovering the next refusal each round, is being made
 * to do the machine's work. A codepoint that repeats is reported once, against
 * the slot where it first appeared.
 */
export function findUncoveredGlyphs(
  values: readonly PosterTextValue[],
  script: SupportedScript,
  hasGlyph: GlyphCoverageOracle,
): readonly GlyphCoverageProblem[] {
  const problems: GlyphCoverageProblem[] = [];
  const seen = new Set<number>();

  for (const value of values) {
    for (const character of value.text) {
      const codepoint = character.codePointAt(0);
      if (codepoint === undefined) continue;
      if (seen.has(codepoint) || isSkippable(codepoint)) continue;

      seen.add(codepoint);
      if (hasGlyph(codepoint)) continue;

      problems.push({
        slot: value.slot,
        script,
        codepoint,
        codepointLabel: describeCodepoint(codepoint),
        character,
      });
    }
  }

  return problems;
}
