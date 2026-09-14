import type { SupportedScript } from "@/domain/campaigns/font-manifest";
import { SHAPING_CONTROL_CODEPOINTS } from "@/domain/campaigns/glyph-coverage";

/**
 * Which writing systems a string actually uses.
 *
 * This exists to catch one specific, expensive mistake before a render is
 * spent: choosing to draw Malayalam copy with the Latin face. The renderer
 * spike showed exactly what that produces — seven empty boxes, no exception,
 * and a plausible measured width. `findUncoveredGlyphs` catches it from the
 * font's cmap, but only once the render has been queued and the bytes read.
 * The Studio can see it the moment the operator picks a language.
 *
 * **This is a mismatch detector, never a coverage check.** It answers "are
 * there Malayalam characters in here", which Unicode block membership settles
 * on its own. It cannot answer "does the font have a glyph for this", which is
 * a cmap question and belongs to `glyph-coverage.ts` with a real font behind
 * it. Keeping the two apart matters: a block-range approximation that returned
 * "covered" would be a green tick nobody earned, and green ticks nobody earned
 * are worse than no tick at all.
 *
 * So the only thing built on this is a warning. It can fire, and it can stay
 * silent; it can never clear anything.
 */

/** Inclusive codepoint ranges, from the Unicode block definitions. */
const BLOCKS: Readonly<Record<SupportedScript, readonly (readonly [number, number])[]>> = {
  Mlym: [[0x0d00, 0x0d7f]],
  Arab: [
    [0x0600, 0x06ff],
    [0x0750, 0x077f],
    [0x08a0, 0x08ff],
    [0xfb50, 0xfdff],
    [0xfe70, 0xfeff],
  ],
  Latn: [
    [0x0041, 0x005a],
    [0x0061, 0x007a],
    [0x00c0, 0x024f],
  ],
};

function scriptOf(codepoint: number): SupportedScript | null {
  for (const [script, ranges] of Object.entries(BLOCKS) as [
    SupportedScript,
    readonly (readonly [number, number])[],
  ][]) {
    for (const [start, end] of ranges) {
      if (codepoint >= start && codepoint <= end) return script;
    }
  }
  return null;
}

/**
 * The scripts this text contains.
 *
 * Digits, spaces and punctuation belong to no script in particular and are
 * ignored rather than guessed at — "11pm" is not a claim about a writing
 * system, and counting it as Latin would make every Malayalam string mixed.
 * Shaping controls are excluded for the same reason they are excluded from
 * coverage: they carry joining behaviour, not a picture.
 */
export function scriptsPresentIn(text: string): ReadonlySet<SupportedScript> {
  const found = new Set<SupportedScript>();
  for (const character of text) {
    const codepoint = character.codePointAt(0);
    if (codepoint === undefined) continue;
    if (SHAPING_CONTROL_CODEPOINTS.has(codepoint)) continue;
    const script = scriptOf(codepoint);
    if (script) found.add(script);
  }
  return found;
}

export type ScriptMismatch = {
  /** The face the operator chose to render with. */
  readonly selected: SupportedScript;
  /** Scripts present in the text that the selected face is not declared for. */
  readonly unexpected: readonly SupportedScript[];
};

/**
 * Whether rendering this text with this face would ask a font to draw a script
 * it is not the declared face for.
 *
 * Null means no mismatch was found, which is emphatically not the same as "this
 * will render". A string of characters this module knows nothing about returns
 * null too.
 */
export function detectScriptMismatch(
  text: string,
  selected: SupportedScript,
): ScriptMismatch | null {
  const unexpected = [...scriptsPresentIn(text)].filter((script) => script !== selected);
  if (unexpected.length === 0) return null;
  return { selected, unexpected };
}
