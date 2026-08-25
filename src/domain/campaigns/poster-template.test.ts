import { describe, expect, it } from "vitest";

import { FONT_MANIFEST } from "@/domain/campaigns/font-manifest";
import {
  POSTER_TEXT_ALIGNMENTS,
  POSTER_TEXT_SLOTS,
  RENDERABLE_SCRIPTS,
  posterTemplateSchema,
  posterTextBoxSchema,
} from "@/domain/campaigns/poster-template";

function box(overrides: Record<string, unknown> = {}) {
  return {
    slot: "caption",
    xPx: 64,
    yPx: 64,
    widthPx: 952,
    heightPx: 200,
    maxLines: 2,
    minFontSizePx: 32,
    maxFontSizePx: 96,
    fontSizeStepPx: 2,
    lineHeightRatio: 1.2,
    alignment: "start",
    required: true,
    ...overrides,
  };
}

function template(overrides: Record<string, unknown> = {}) {
  return {
    key: "kerala_feed",
    version: 1,
    placement: "feed_image",
    canvasWidthPx: 1080,
    canvasHeightPx: 1080,
    ownerScope: "core",
    packSlug: null,
    organizationId: null,
    state: "active",
    layout: {
      safeArea: { topPx: 64, rightPx: 64, bottomPx: 64, leftPx: 64 },
      logoSlot: null,
      plateCropFocus: "center",
      textBoxes: [box()],
    },
    ...overrides,
  };
}

describe("the named slot vocabulary", () => {
  /**
   * These four names are also enforced by `private.poster_template_layout_valid`
   * in migration 20260826090000. If they drift, a template seeded by migration
   * would be refused at insert or -- worse -- accepted here and rejected there.
   */
  it("is exactly the four the database enforces", () => {
    expect([...POSTER_TEXT_SLOTS]).toEqual(["caption", "body", "footer", "extra"]);
  });

  /**
   * Alignment is start/end rather than left/right on purpose. In Arabic, start
   * is the right-hand edge. A template declaring `left` would silently mis-align
   * every Arabic poster, and it would look deliberate.
   */
  it("aligns by start and end rather than left and right, because of Arabic", () => {
    expect([...POSTER_TEXT_ALIGNMENTS]).toEqual(["start", "center", "end"]);
    expect(POSTER_TEXT_ALIGNMENTS).not.toContain("left");
    expect(POSTER_TEXT_ALIGNMENTS).not.toContain("right");
  });
});

describe("the renderable script vocabulary", () => {
  /**
   * A script is renderable only if a font was vendored for it. If these two
   * lists drift, the platform either offers a script it cannot draw -- the empty
   * box failure, arriving by a different door -- or ships a font nothing can
   * use.
   */
  it("matches the fonts actually vendored, in both directions", () => {
    const scriptsWithFonts = new Set(FONT_MANIFEST.flatMap((font) => font.scripts));

    expect([...RENDERABLE_SCRIPTS].sort()).toEqual([...scriptsWithFonts].sort());
  });
});

describe("posterTextBoxSchema", () => {
  it("accepts a well-formed box", () => {
    expect(posterTextBoxSchema.parse(box())).toMatchObject({ slot: "caption" });
  });

  it("refuses a minimum font size above its maximum", () => {
    expect(() =>
      posterTextBoxSchema.parse(box({ minFontSizePx: 100, maxFontSizePx: 96 })),
    ).toThrow();
  });

  /**
   * Shrink-to-fit walks down from the maximum in steps. A zero step would never
   * terminate, and a step larger than the range would jump past every size the
   * template said was acceptable.
   */
  it("refuses a shrink step that cannot make progress", () => {
    expect(() => posterTextBoxSchema.parse(box({ fontSizeStepPx: 0 }))).toThrow();
  });

  it("refuses a box that declares no lines", () => {
    expect(() => posterTextBoxSchema.parse(box({ maxLines: 0 }))).toThrow();
  });

  it("refuses an unknown slot name", () => {
    expect(() => posterTextBoxSchema.parse(box({ slot: "headline" }))).toThrow();
  });

  it("refuses an unknown property, so a typo is a failure and not a silent drop", () => {
    expect(() => posterTextBoxSchema.parse({ ...box(), colour: "red" })).toThrow();
  });
});

describe("posterTemplateSchema", () => {
  it("accepts a well-formed template", () => {
    expect(posterTemplateSchema.parse(template())).toMatchObject({ key: "kerala_feed" });
  });

  it("refuses two boxes bound to the same slot", () => {
    const layout = {
      ...template().layout,
      textBoxes: [box(), box({ yPx: 400 })],
    };

    expect(() => posterTemplateSchema.parse(template({ layout }))).toThrow(/slot/i);
  });

  it("accepts distinct slots in one template", () => {
    const layout = {
      ...template().layout,
      textBoxes: [box(), box({ slot: "body", yPx: 400 })],
    };

    expect(posterTemplateSchema.parse(template({ layout })).layout.textBoxes).toHaveLength(2);
  });

  /**
   * A box outside the canvas renders nothing an operator can see, and a box
   * outside the safe area renders text a platform may crop. Both are template
   * defects, and both are cheaper to catch here than in a client's feed.
   */
  it("refuses a box that leaves the canvas", () => {
    const layout = {
      ...template().layout,
      textBoxes: [box({ xPx: 900, widthPx: 400 })],
    };

    expect(() => posterTemplateSchema.parse(template({ layout }))).toThrow(/canvas/i);
  });

  it("refuses a box that leaves the safe area", () => {
    const layout = {
      ...template().layout,
      textBoxes: [box({ xPx: 8, widthPx: 200 })],
    };

    expect(() => posterTemplateSchema.parse(template({ layout }))).toThrow(/safe area/i);
  });

  it("refuses a safe area larger than the canvas it sits in", () => {
    const layout = {
      ...template().layout,
      safeArea: { topPx: 600, rightPx: 64, bottomPx: 600, leftPx: 64 },
    };

    expect(() => posterTemplateSchema.parse(template({ layout }))).toThrow(/safe area/i);
  });

  it("refuses a pack template with no pack, and an organization template with no owner", () => {
    expect(() => posterTemplateSchema.parse(template({ ownerScope: "pack" }))).toThrow();
    expect(() => posterTemplateSchema.parse(template({ ownerScope: "organization" }))).toThrow();
  });

  it("accepts a pack template that names its pack", () => {
    expect(
      posterTemplateSchema.parse(template({ ownerScope: "pack", packSlug: "restaurant" })).packSlug,
    ).toBe("restaurant");
  });

  it("refuses a template with no text boxes at all", () => {
    const layout = { ...template().layout, textBoxes: [] };

    expect(() => posterTemplateSchema.parse(template({ layout }))).toThrow();
  });
});
