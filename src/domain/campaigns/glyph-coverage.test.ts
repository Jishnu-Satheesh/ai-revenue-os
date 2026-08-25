import { describe, expect, it } from "vitest";

import {
  SHAPING_CONTROL_CODEPOINTS,
  describeCodepoint,
  findUncoveredGlyphs,
} from "@/domain/campaigns/glyph-coverage";

/**
 * A coverage oracle standing in for a font's cmap. The real one is `fontkit`
 * in Task 4's infrastructure; the decision being tested is which codepoints
 * must be asked about, and what happens to the ones that come back missing.
 */
function coveringOnly(allowed: string): (codepoint: number) => boolean {
  const covered = new Set([...allowed].map((character) => character.codePointAt(0)));
  return (codepoint) => covered.has(codepoint);
}

const coversEverything = () => true;

describe("describeCodepoint", () => {
  it("names a codepoint the way a refusal has to name it", () => {
    expect(describeCodepoint(0x0d7b)).toBe("U+0D7B");
    expect(describeCodepoint(0x41)).toBe("U+0041");
  });

  it("pads to at least four digits and does not truncate above them", () => {
    expect(describeCodepoint(0x1f600)).toBe("U+1F600");
  });
});

describe("findUncoveredGlyphs", () => {
  it("returns nothing when every codepoint is covered", () => {
    const problems = findUncoveredGlyphs(
      [{ slot: "caption", text: "കേരള മീൻ കറി" }],
      "Mlym",
      coversEverything,
    );

    expect(problems).toEqual([]);
  });

  it("names the uncovered codepoint, its character and its slot", () => {
    const problems = findUncoveredGlyphs(
      [{ slot: "caption", text: "കറി" }],
      "Mlym",
      coveringOnly("കറ"),
    );

    expect(problems).toEqual([
      {
        slot: "caption",
        script: "Mlym",
        codepoint: 0x0d3f,
        codepointLabel: "U+0D3F",
        character: "ി",
      },
    ]);
  });

  /**
   * The failure this module exists to prevent. In the renderer spike, Malayalam
   * drawn in a Latin font produced seven empty boxes silently -- no error, and
   * `measureText` returned a completely plausible 285. Nothing downstream could
   * tell that from a real render, so the check has to happen here, before
   * anything is drawn.
   */
  it("names every uncovered codepoint rather than stopping at the first", () => {
    const problems = findUncoveredGlyphs(
      [{ slot: "caption", text: "കേരള" }],
      "Mlym",
      coveringOnly(""),
    );

    expect(problems.map((problem) => problem.codepointLabel)).toEqual([
      "U+0D15",
      "U+0D47",
      "U+0D30",
      "U+0D33",
    ]);
  });

  it("reports a codepoint once however often it repeats", () => {
    const problems = findUncoveredGlyphs(
      [
        { slot: "caption", text: "aaa" },
        { slot: "body", text: "aa" },
      ],
      "Latn",
      coveringOnly(""),
    );

    expect(problems).toHaveLength(1);
    expect(problems[0]?.slot).toBe("caption");
  });

  it("walks by codepoint, so a character outside the basic plane is one problem", () => {
    const problems = findUncoveredGlyphs([{ slot: "extra", text: "😀" }], "Latn", coveringOnly(""));

    expect(problems).toEqual([
      {
        slot: "extra",
        script: "Latn",
        codepoint: 0x1f600,
        codepointLabel: "U+1F600",
        character: "😀",
      },
    ]);
  });

  /**
   * Zero-width joiners are how Malayalam forms a chillu and how Arabic is kept
   * joined or broken. Fonts do not map them to glyphs, so asking a cmap about
   * them returns "missing" for text that is perfectly correct. Flagging them
   * would refuse the client's own language -- over-refusal is a failure too,
   * just a quieter one.
   */
  it("ignores shaping controls, which no cmap maps and correct text needs", () => {
    const withJoiner = "ന‍യ";

    expect(
      findUncoveredGlyphs([{ slot: "caption", text: withJoiner }], "Mlym", coveringOnly("നയ")),
    ).toEqual([]);
  });

  it("ignores bidi controls, which mixed Arabic and Latin depends on", () => {
    const isolated = "⁦" + "49" + "⁩";

    expect(
      findUncoveredGlyphs([{ slot: "body", text: isolated }], "Arab", coveringOnly("49")),
    ).toEqual([]);
  });

  it("keeps the shaping-control set honest about what it claims to hold", () => {
    for (const codepoint of [0x200c, 0x200d, 0x200e, 0x200f, 0x2066, 0x2069, 0x00ad, 0xfe0f]) {
      expect(SHAPING_CONTROL_CODEPOINTS.has(codepoint)).toBe(true);
    }

    // A real character must never be waved through as a control.
    expect(SHAPING_CONTROL_CODEPOINTS.has(0x0d7b)).toBe(false);
    expect(SHAPING_CONTROL_CODEPOINTS.has(0x0041)).toBe(false);
  });

  it("does not ask about ordinary whitespace, which is not a shaping decision", () => {
    expect(
      findUncoveredGlyphs([{ slot: "caption", text: "a b\nc" }], "Latn", coveringOnly("abc")),
    ).toEqual([]);
  });

  it("treats an empty value as nothing to check rather than as a refusal", () => {
    expect(findUncoveredGlyphs([{ slot: "extra", text: "" }], "Latn", coveringOnly(""))).toEqual(
      [],
    );
  });
});
