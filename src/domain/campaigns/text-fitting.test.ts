import { describe, expect, it } from "vitest";

import { posterTextBoxSchema } from "@/domain/campaigns/poster-template";
import { candidateFontSizes, fitTextToBox } from "@/domain/campaigns/text-fitting";

/** Every glyph half an em wide. Crude, deterministic, and enough to test the rule. */
const halfEm = (text: string, fontSizePx: number) => text.length * fontSizePx * 0.5;

function box(overrides: Record<string, unknown> = {}) {
  return posterTextBoxSchema.parse({
    slot: "caption",
    xPx: 64,
    yPx: 64,
    widthPx: 480,
    heightPx: 240,
    maxLines: 3,
    minFontSizePx: 20,
    maxFontSizePx: 60,
    fontSizeStepPx: 4,
    lineHeightRatio: 1.2,
    alignment: "start",
    required: true,
    ...overrides,
  });
}

describe("candidateFontSizes", () => {
  it("walks down from the maximum in declared steps", () => {
    expect(
      candidateFontSizes(box({ maxFontSizePx: 60, minFontSizePx: 48, fontSizeStepPx: 4 })),
    ).toEqual([60, 56, 52, 48]);
  });

  /**
   * The template declared the minimum acceptable, so it must actually be tried.
   * A step that does not land on it would otherwise refuse text that fits at a
   * size the template said was fine.
   */
  it("tries the declared minimum even when the step does not land on it", () => {
    expect(
      candidateFontSizes(box({ maxFontSizePx: 60, minFontSizePx: 47, fontSizeStepPx: 4 })),
    ).toEqual([60, 56, 52, 48, 47]);
  });

  it("offers one size when the range is a single point", () => {
    expect(candidateFontSizes(box({ maxFontSizePx: 40, minFontSizePx: 40 }))).toEqual([40]);
  });
});

describe("fitTextToBox", () => {
  it("uses the largest size that fits", () => {
    const outcome = fitTextToBox("Fish curry", box(), halfEm);

    expect(outcome).toMatchObject({ fitted: true, fontSizePx: 60, lines: ["Fish curry"] });
  });

  it("shrinks rather than overflowing", () => {
    // Sixty characters needs five lines at the maximum size and only three are
    // allowed, so the only way to render it whole is smaller.
    const outcome = fitTextToBox(
      "Kerala fish curry, two for one on Fridays at Al Noor Kitchen",
      box(),
      halfEm,
    );

    expect(outcome.fitted).toBe(true);
    if (!outcome.fitted) return;
    expect(outcome.fontSizePx).toBeLessThan(60);
    expect(outcome.fontSizePx).toBeGreaterThanOrEqual(20);
    expect(outcome.lines.length).toBeLessThanOrEqual(3);
  });

  /**
   * The rule the whole feature rests on. Text is shrunk within declared bounds
   * and then refused. Nothing is truncated, ellipsised or overflowed, because a
   * poster that quietly drops half an offer is worse than one that never
   * rendered.
   */
  it("refuses at the declared minimum rather than truncating", () => {
    // Three lines at the smallest declared size hold about 144 characters.
    // This is comfortably past that, so no acceptable size renders it whole.
    const outcome = fitTextToBox(
      "Kerala fish curry cooked the way it is cooked at home, in a red clay pot with tamarind and fresh coconut, served with rice and a plantain on the side, every Friday at Al Noor Kitchen in Dubai",
      box(),
      halfEm,
    );

    expect(outcome).toMatchObject({ fitted: false, code: "text_does_not_fit", slot: "caption" });
  });

  it("never loses a word when it does fit", () => {
    const text = "Two for one on Fridays at Al Noor Kitchen";
    const outcome = fitTextToBox(text, box(), halfEm);

    expect(outcome.fitted).toBe(true);
    if (!outcome.fitted) return;
    expect(outcome.lines.join(" ")).toBe(text);
  });

  it("refuses a single word wider than the box rather than breaking it", () => {
    const outcome = fitTextToBox(
      "Thiruvananthapuramkarikkakomvilakkumaram",
      box({ widthPx: 80 }),
      halfEm,
    );

    expect(outcome).toMatchObject({ fitted: false, code: "text_does_not_fit" });
  });

  it("respects the line cap even when the height would allow more", () => {
    const tall = box({ maxLines: 1, heightPx: 2_000 });
    const outcome = fitTextToBox("Kerala fish curry two for one", tall, halfEm);

    expect(outcome.fitted).toBe(true);
    if (!outcome.fitted) return;
    expect(outcome.lines).toHaveLength(1);
  });

  it("respects the box height even when the line cap would allow more", () => {
    // Six lines are permitted and the text needs three, so nothing here is
    // capped by lines. Three lines at the smallest size need 72px of height and
    // the box has 30, so height is what refuses it.
    const short = box({
      widthPx: 200,
      maxLines: 6,
      heightPx: 30,
      minFontSizePx: 20,
      maxFontSizePx: 24,
    });
    const outcome = fitTextToBox("Kerala fish curry two for one on Fridays", short, halfEm);

    expect(outcome).toMatchObject({ fitted: false, code: "text_does_not_fit" });
  });

  it("collapses runs of whitespace into single breaks rather than blank lines", () => {
    const outcome = fitTextToBox("Fish    curry", box(), halfEm);

    expect(outcome).toMatchObject({ fitted: true, lines: ["Fish curry"] });
  });

  /** A render is a pure function of its inputs, and fitting is part of that. */
  it("is deterministic for identical inputs", () => {
    const text = "Kerala fish curry, two for one on Fridays";
    expect(fitTextToBox(text, box(), halfEm)).toEqual(fitTextToBox(text, box(), halfEm));
  });

  it("treats empty text as a caller defect rather than an empty render", () => {
    expect(() => fitTextToBox("   ", box(), halfEm)).toThrow(/empty/i);
  });

  it("reports the minimum it reached, so a refusal can explain itself", () => {
    const outcome = fitTextToBox("x".repeat(400), box(), halfEm);

    expect(outcome).toMatchObject({ fitted: false, minFontSizePx: 20 });
  });
});
