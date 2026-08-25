import type { PosterTextBox, PosterTextSlot } from "@/domain/campaigns/poster-template";

/**
 * Shrink to fit, then refuse. Never truncate.
 *
 * A poster that quietly drops the second half of an offer is worse than one
 * that never rendered: the operator approved the whole sentence, the client
 * publishes half of it, and nobody finds out until a customer asks. So the only
 * two outcomes here are "it fits at this size" and "it does not fit, and here is
 * the size we got down to".
 *
 * Measurement is injected. The domain owns the algorithm -- which sizes to try,
 * in what order, and when to give up -- while the renderer owns the question of
 * how wide a shaped string actually is. That keeps the rule testable without a
 * font, and keeps the rule identical whichever renderer measures.
 */

/** Width in pixels of `text` shaped at `fontSizePx`. Supplied by the renderer. */
export type TextMeasure = (text: string, fontSizePx: number) => number;

export type TextFitOutcome =
  | {
      readonly fitted: true;
      readonly fontSizePx: number;
      readonly lines: readonly string[];
    }
  | {
      readonly fitted: false;
      readonly code: "text_does_not_fit";
      readonly slot: PosterTextSlot;
      /** The smallest size tried, so the refusal can say what was attempted. */
      readonly minFontSizePx: number;
    };

/**
 * The sizes to try, largest first.
 *
 * The declared minimum is always tried, even when the step does not land on it.
 * The template said that size was acceptable, and refusing text that fits at an
 * acceptable size because of arithmetic would be a defect wearing a rule's
 * clothes.
 */
export function candidateFontSizes(box: PosterTextBox): readonly number[] {
  const sizes: number[] = [];

  for (let size = box.maxFontSizePx; size > box.minFontSizePx; size -= box.fontSizeStepPx) {
    sizes.push(size);
  }

  sizes.push(box.minFontSizePx);
  return sizes;
}

/**
 * Greedy wrap on whitespace.
 *
 * Returns null when a single word cannot fit the width at this size: the honest
 * response is a smaller size, and failing that a refusal. Breaking mid-word
 * would be a form of corruption, not a form of fitting -- and in Malayalam it
 * would break a conjunct that has to stay whole.
 */
function wrap(
  words: readonly string[],
  widthPx: number,
  fontSizePx: number,
  measure: TextMeasure,
): readonly string[] | null {
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (measure(word, fontSizePx) > widthPx) return null;

    const candidate = current === "" ? word : `${current} ${word}`;
    if (measure(candidate, fontSizePx) <= widthPx) {
      current = candidate;
      continue;
    }

    lines.push(current);
    current = word;
  }

  if (current !== "") lines.push(current);
  return lines;
}

export function fitTextToBox(
  text: string,
  box: PosterTextBox,
  measure: TextMeasure,
): TextFitOutcome {
  const words = text.trim().split(/\s+/u).filter(Boolean);

  if (words.length === 0) {
    // A slot with no value is not rendered at all, and a template that requires
    // it is unavailable. Reaching the fitter with nothing is a caller defect.
    throw new Error("Cannot fit empty text; a slot with no value is not rendered.");
  }

  for (const fontSizePx of candidateFontSizes(box)) {
    const lines = wrap(words, box.widthPx, fontSizePx, measure);
    if (lines === null || lines.length > box.maxLines) continue;

    const usedHeight = lines.length * fontSizePx * box.lineHeightRatio;
    if (usedHeight > box.heightPx) continue;

    return { fitted: true, fontSizePx, lines };
  }

  return {
    fitted: false,
    code: "text_does_not_fit",
    slot: box.slot,
    minFontSizePx: box.minFontSizePx,
  };
}
