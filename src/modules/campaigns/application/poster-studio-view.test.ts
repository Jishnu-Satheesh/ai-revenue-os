import { describe, expect, it } from "vitest";

import { posterTemplateSchema, type PosterTemplate } from "@/domain/campaigns/poster-template";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";
import {
  toPosterStudioView,
  type PosterStudioRender,
} from "@/modules/campaigns/application/poster-studio-view";

function template(overrides: Record<string, unknown> = {}): PosterTemplate {
  const slots = (overrides.slots as string[] | undefined) ?? ["caption", "footer"];
  return posterTemplateSchema.parse({
    key: "probe_feed",
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
      textBoxes: slots.map((slot, index) => ({
        slot,
        xPx: 64,
        yPx: 64 + index * 200,
        widthPx: 952,
        heightPx: 160,
        maxLines: 2,
        minFontSizePx: 24,
        maxFontSizePx: 72,
        fontSizeStepPx: 4,
        lineHeightRatio: 1.2,
        alignment: "start",
        required: true,
      })),
    },
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== "slots")),
  });
}

type ViewInput = Parameters<typeof toPosterStudioView>[0];

function view(overrides: Partial<ViewInput> = {}) {
  return toPosterStudioView({
    manifest: validManifest(),
    bundleVersionId: "e0000000-0000-4000-8000-000000000001",
    digest: "f".repeat(64),
    templates: [template()],
    renders: [],
    ...overrides,
  });
}

describe("toPosterStudioView", () => {
  it("offers each direction the templates whose placement it has copy for", () => {
    const result = view();

    expect(result.offers).toHaveLength(validManifest().directions.length);
    expect(result.offers.every((offer) => offer.placement === "feed_image")).toBe(true);
    expect(result.offers.every((offer) => offer.channel === "instagram")).toBe(true);
  });

  /**
   * The point of the whole shape. A template an operator cannot use is returned
   * with the reason attached, because absence teaches nothing.
   */
  it("returns an unusable template with its reason rather than dropping it", () => {
    const result = view({ templates: [template({ slots: ["caption", "body"] })] });

    expect(result.offers.length).toBeGreaterThan(0);
    const [offer] = result.offers;
    expect(offer.availability.available).toBe(false);
    if (offer.availability.available) return;
    expect(offer.availability.missingSlots).toEqual([
      { slot: "body", reason: "no_governed_source" },
    ]);
  });

  it("carries the words that would be drawn, so the picker need not guess", () => {
    const [offer] = view().offers;
    const caption = offer.slots.find((slot) => slot.slot === "caption");

    expect(caption).toBeDefined();
    expect(caption?.value).toBe(validManifest().directions[0].copy[0].hook);
  });

  /** A retired template still serves a pinned plan; it is never a new choice. */
  it("does not offer a retired template", () => {
    const result = view({ templates: [template({ state: "retired" })] });

    expect(result.offers).toEqual([]);
  });

  it("offers nothing for a placement the campaign wrote no copy for", () => {
    const result = view({ templates: [template({ placement: "image_story" })] });

    expect(result.offers).toEqual([]);
  });

  describe("scripts", () => {
    it("uses the poster plan's scripts when the version pinned one", () => {
      const manifest = {
        ...validManifest(),
        posterPlan: {
          placements: [
            { placement: "feed_image" as const, templateKey: "probe_feed", templateVersion: 1 },
          ],
          scripts: ["Mlym" as const],
        },
      };

      const result = view({ manifest });

      expect(result.scripts).toEqual(["Mlym"]);
      expect(result.hasPosterPlan).toBe(true);
    });

    /**
     * No plan is "nobody chose", not "no scripts". Returning an empty list
     * would make a version without a plan silently unrenderable.
     */
    it("offers every renderable script when the version pinned none", () => {
      const result = view();

      expect([...result.scripts]).toEqual(["Latn", "Mlym", "Arab"]);
      expect(result.hasPosterPlan).toBe(false);
    });
  });

  it("names the plate each direction composes over", () => {
    const result = view();

    expect(result.directions[0]).toMatchObject({
      id: manifestIds.control,
      plateAssetKey: manifestIds.assetControl,
    });
  });

  it("surfaces a catalogue row it could not read rather than swallowing it", () => {
    const result = view({ unreadableTemplates: [{ key: "broken_feed", version: 2 }] });

    expect(result.unreadableTemplates).toEqual([{ key: "broken_feed", version: 2 }]);
  });

  it("passes the render history through untouched", () => {
    const render: PosterStudioRender = {
      id: "aa000000-0000-4000-8000-000000000001",
      templateKey: "probe_feed",
      templateVersion: 1,
      script: "Latn",
      state: "refused",
      renderDigest: "a".repeat(64),
      textValues: { caption: "Lunch that pays for itself." },
      refusalCode: "text_does_not_fit",
      verification: {},
      outputStoragePath: null,
      outputWidthPx: null,
      outputHeightPx: null,
      renderedAt: "2026-09-06T10:00:00.000Z",
    };

    expect(view({ renders: [render] }).renders).toEqual([render]);
  });
});
