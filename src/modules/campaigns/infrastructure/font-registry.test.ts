import { GlobalFonts } from "@napi-rs/canvas";
import { beforeEach, describe, expect, it } from "vitest";

import { FONT_MANIFEST } from "@/domain/campaigns/font-manifest";
import {
  createTextMeasure,
  ensureVendoredFontsRegistered,
  resetFontRegistrationForTests,
  studioFamilyFor,
  vendoredFontForScript,
} from "@/modules/campaigns/infrastructure/font-registry";
import {
  createGlyphCoverageOracle,
  resetGlyphCoverageCacheForTests,
} from "@/modules/campaigns/infrastructure/glyph-coverage-oracle";

beforeEach(() => {
  resetFontRegistrationForTests();
  resetGlyphCoverageCacheForTests();
});

describe("ensureVendoredFontsRegistered", () => {
  /**
   * The guarantee this exists for. `@napi-rs/canvas` loads the host's font
   * configuration at import -- 336 families on this machine -- and not one of
   * them is pinned, approved, or the same on another machine.
   *
   * Measured today the library draws tofu rather than silently substituting,
   * so nothing is known to be broken without the clear. But that is a library
   * behaviour an upgrade could change quietly, and this assertion is what makes
   * "only approved fonts exist here" a property of our code instead.
   */
  it("leaves only the vendored faces registered", () => {
    ensureVendoredFontsRegistered();

    const families = new Set(GlobalFonts.families.map((font) => font.family));
    for (const script of ["Latn", "Mlym", "Arab"] as const) {
      expect(families.has(studioFamilyFor(script))).toBe(true);
    }

    // Whatever the host had is gone. Registering a file also exposes the name
    // inside it, so the count is the aliases plus those, and nothing else.
    expect(families.size).toBeLessThanOrEqual(FONT_MANIFEST.length * 2);
  });

  it("is idempotent, so calling it per render costs nothing", () => {
    ensureVendoredFontsRegistered();
    const first = GlobalFonts.families.length;
    ensureVendoredFontsRegistered();

    expect(GlobalFonts.families.length).toBe(first);
  });

  it("names a deterministic family that no host font would collide with", () => {
    expect(studioFamilyFor("Mlym")).toBe("Studio Mlym");
  });

  it("knows which vendored file draws each script", () => {
    expect(vendoredFontForScript("Mlym").file).toContain("Malayalam");
    expect(vendoredFontForScript("Arab").file).toContain("Arabic");
  });
});

describe("createTextMeasure", () => {
  it("measures wider text as wider, and a larger size as larger", () => {
    const measure = createTextMeasure("Latn");

    expect(measure("Kerala fish curry", 40)).toBeGreaterThan(measure("Kerala", 40));
    expect(measure("Kerala", 80)).toBeGreaterThan(measure("Kerala", 40));
  });

  /**
   * The spike's control case, kept as a standing test. Malayalam measured in the
   * Latin face returns a perfectly plausible number while drawing empty boxes --
   * which is exactly why width can never be the coverage check.
   */
  it("returns a plausible width even for text the face cannot draw", () => {
    const inLatin = createTextMeasure("Latn")("കേരള മീൻ കറി", 48);

    expect(inLatin).toBeGreaterThan(0);
  });
});

describe("createGlyphCoverageOracle", () => {
  it("answers from the face that will actually draw", () => {
    const malayalam = createGlyphCoverageOracle("Mlym");

    expect(malayalam(0x0d15)).toBe(true); // Malayalam ka
    expect(malayalam(0x0d7b)).toBe(true); // chillu n
  });

  /**
   * The product limit, asserted rather than left as a comment. Latin digits,
   * space, comma and hyphen are in all three faces, so prices and numbers render
   * in any script. Latin *letters* are in the Latin face alone -- so a Malayalam
   * poster carrying a Latin word is refused rather than drawn with boxes.
   */
  it("covers digits and punctuation in every script, but Latin letters in only one", () => {
    const [latin, malayalam, arabic] = (["Latn", "Mlym", "Arab"] as const).map(
      createGlyphCoverageOracle,
    );

    for (const shared of [0x34, 0x20, 0x2c, 0x2d]) {
      expect([latin?.(shared), malayalam?.(shared), arabic?.(shared)]).toEqual([true, true, true]);
    }

    expect(latin?.(0x41)).toBe(true);
    expect(malayalam?.(0x41)).toBe(false);
    expect(arabic?.(0x41)).toBe(false);
  });

  it("does not claim one script's glyphs for another", () => {
    expect(createGlyphCoverageOracle("Latn")(0x0d15)).toBe(false);
    expect(createGlyphCoverageOracle("Mlym")(0x0627)).toBe(false);
  });
});
