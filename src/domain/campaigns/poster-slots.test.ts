import { describe, expect, it } from "vitest";

import { posterTemplateSchema } from "@/domain/campaigns/poster-template";
import {
  checkOperatorSlotText,
  resolvePosterSlots,
  templateAvailability,
} from "@/domain/campaigns/poster-slots";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";

function resolve(overrides: Record<string, unknown> = {}) {
  return resolvePosterSlots({
    manifest: validManifest(),
    directionId: manifestIds.control,
    channel: "instagram",
    placement: "feed_image",
    extra: null,
    legalLine: null,
    ...overrides,
  });
}

function templateRequiring(slots: readonly string[]) {
  return posterTemplateSchema.parse({
    key: "availability_probe",
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
  });
}

describe("resolvePosterSlots", () => {
  /**
   * The trap in this module. The poster slot called `caption` binds to the
   * manifest's `hook` -- the headline. The manifest *also* has a field called
   * `caption`, which is the social post caption of up to 2,200 characters and is
   * never drawn on a poster. Binding the two by name would put an entire
   * Instagram caption inside a headline box.
   */
  it("binds the caption slot to the hook, not to the manifest field of the same name", () => {
    const caption = resolve().slots.find((slot) => slot.slot === "caption");

    expect(caption).toMatchObject({
      value: "The lunch you keep meaning to book",
      source: "copy.hook",
      governed: true,
    });
  });

  it("binds the footer slot to the call to action", () => {
    expect(resolve().slots.find((slot) => slot.slot === "footer")).toMatchObject({
      value: "Book a table",
      source: "copy.callToAction",
      governed: true,
    });
  });

  /**
   * There is no governed short offer line in the manifest today. `lockedOfferRef`
   * is an internal key -- "lunch-set-menu-2026-09" -- not a sentence a customer
   * reads, and drawing it on a poster would be nonsense. So the body slot
   * resolves to nothing and says why, rather than rendering a reference key or
   * quietly borrowing ungoverned prose.
   */
  it("leaves the body slot empty, because no governed offer line exists yet", () => {
    expect(resolve().slots.find((slot) => slot.slot === "body")).toMatchObject({
      value: null,
      reason: "no_governed_source",
    });
  });

  it("never renders the internal offer reference key", () => {
    const values = resolve().slots.map((slot) => slot.value);

    expect(values).not.toContain("lunch-set-menu-2026-09");
  });

  /**
   * `extra` is the one genuinely free box. It is not a loophole -- it must pass
   * content policy exactly like every other piece of campaign copy -- so it is
   * marked ungoverned in the type, which makes forgetting to check it a
   * compile-time visible omission rather than a silent one.
   */
  it("marks operator text as ungoverned so the caller cannot forget to police it", () => {
    const extra = resolve({ extra: "Open until 11pm" }).slots.find((slot) => slot.slot === "extra");

    expect(extra).toMatchObject({
      value: "Open until 11pm",
      source: "operator",
      governed: false,
    });
  });

  it("treats an unsupplied extra as absent rather than empty", () => {
    expect(resolve().slots.find((slot) => slot.slot === "extra")).toMatchObject({
      value: null,
      reason: "not_supplied",
    });
  });

  it("appends a legal line to the footer when one is supplied", () => {
    const footer = resolve({ legalLine: "Terms apply." }).slots.find(
      (slot) => slot.slot === "footer",
    );

    expect(footer?.value).toBe("Book a table\nTerms apply.");
  });

  it("resolves every named slot exactly once", () => {
    const slots = resolve().slots.map((slot) => slot.slot);

    expect(slots).toEqual(["caption", "body", "footer", "extra"]);
  });

  it("refuses a direction that is not in this manifest", () => {
    expect(() => resolve({ directionId: manifestIds.brief })).toThrow(/direction/i);
  });

  it("refuses a placement the direction has no copy for", () => {
    expect(() => resolve({ placement: "image_story" })).toThrow(/copy/i);
  });
});

describe("templateAvailability", () => {
  it("makes a template available when every required slot has a value", () => {
    const { slots } = resolve();

    expect(templateAvailability(templateRequiring(["caption", "footer"]), slots)).toEqual({
      available: true,
    });
  });

  /**
   * Spec 020 section 7.2: a template that requires a field the manifest cannot
   * supply is unavailable and says which field is missing. It is not hidden --
   * an operator wondering where a template went learns nothing from its absence.
   */
  it("makes a template unavailable and names the slot it cannot fill", () => {
    const { slots } = resolve();

    expect(templateAvailability(templateRequiring(["caption", "body"]), slots)).toEqual({
      available: false,
      missingSlots: [{ slot: "body", reason: "no_governed_source" }],
    });
  });

  it("ignores an empty slot the template does not require", () => {
    const template = templateRequiring(["caption", "body"]);
    const optionalBody = posterTemplateSchema.parse({
      ...template,
      layout: {
        ...template.layout,
        textBoxes: template.layout.textBoxes.map((box) =>
          box.slot === "body" ? { ...box, required: false } : box,
        ),
      },
    });

    expect(templateAvailability(optionalBody, resolve().slots)).toEqual({ available: true });
  });
});

/**
 * The free box is the one place operator prose reaches a poster, and spec 020
 * section 7.3 promises it is policed like every other piece of campaign copy.
 * `evaluateContentPolicy` cannot keep that promise -- it walks a manifest's
 * directions and hashtag sets and has nothing to say about a loose string -- so
 * the check the spec describes lives here, reusing the vocabulary
 * `checkVariantDerivation` already refuses generated copy on.
 */
describe("checkOperatorSlotText", () => {
  const evidence = {
    offer: null,
    factKeys: [],
    factText: "al noor kitchen serves kerala food in deira",
    restrictedTerms: ["authentic"],
  };

  it("admits ordinary operator text", () => {
    expect(checkOperatorSlotText("Open until 11pm", evidence)).toEqual({ admitted: true });
  });

  it("refuses the discount the spec names, on a campaign with no offer", () => {
    const result = checkOperatorSlotText("50% off today", evidence);

    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.failures.map((failure) => failure.code)).toContain("invented_offer");
  });

  it("refuses a ranking claim the pinned evidence never made", () => {
    const result = checkOperatorSlotText("Voted best restaurant in Deira", evidence);

    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.failures.map((failure) => failure.code)).toContain("unsourced_claim");
  });

  it("refuses a restricted term the organization forbids", () => {
    const result = checkOperatorSlotText("Authentic Kerala flavours", evidence);

    expect(result.admitted).toBe(false);
    if (result.admitted) return;
    expect(result.failures.map((failure) => failure.code)).toContain("restricted_term");
  });

  /**
   * An offer the campaign actually recorded is not an invention. Refusing it
   * would make the governed path unusable for the campaigns most likely to want
   * a poster.
   */
  it("admits offer wording when the campaign records an offer", () => {
    expect(
      checkOperatorSlotText("Free delivery this week", { ...evidence, offer: "free delivery" }),
    ).toEqual({ admitted: true });
  });

  it("admits a ranking claim the pinned evidence supports", () => {
    expect(
      checkOperatorSlotText("Voted best restaurant in Deira", {
        ...evidence,
        factText: "voted best restaurant in deira by gulf news 2026",
      }),
    ).toEqual({ admitted: true });
  });
});
