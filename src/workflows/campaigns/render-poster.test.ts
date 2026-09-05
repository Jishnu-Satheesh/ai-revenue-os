import { createCanvas } from "@napi-rs/canvas";
import { describe, expect, it } from "vitest";

import { posterTemplateSchema, type PosterTemplate } from "@/domain/campaigns/poster-template";
import { compositePoster } from "@/modules/campaigns/infrastructure/poster-compositor";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";
import {
  renderCampaignPoster,
  type PosterRenderContext,
  type RenderPosterDependencies,
} from "@/workflows/campaigns/render-poster";
import type { CampaignPosterRenderPayload } from "@/workflows/campaigns/contracts";

const ORGANIZATION_ID = "3f1d5e2a-0000-4000-8000-000000000001";
const CAMPAIGN_ID = "3f1d5e2a-0000-4000-8000-000000000002";
const BUNDLE_VERSION_ID = "3f1d5e2a-0000-4000-8000-000000000003";
const PLATE_ASSET_ID = "3f1d5e2a-0000-4000-8000-000000000004";
const CORRELATION_ID = "3f1d5e2a-0000-4000-8000-000000000005";

/** A plate with no text on it, which is what spec 019 produces. */
function plateBytes(): Uint8Array {
  const canvas = createCanvas(600, 400);
  const context = canvas.getContext("2d");
  context.fillStyle = "#8a5a2b";
  context.fillRect(0, 0, 600, 400);
  return new Uint8Array(canvas.toBuffer("image/png"));
}

function template(overrides: Record<string, unknown> = {}): PosterTemplate {
  return posterTemplateSchema.parse({
    key: "worker_probe",
    version: 1,
    placement: "feed_image",
    canvasWidthPx: 600,
    canvasHeightPx: 400,
    ownerScope: "core",
    packSlug: null,
    organizationId: null,
    state: "active",
    layout: {
      safeArea: { topPx: 32, rightPx: 32, bottomPx: 32, leftPx: 32 },
      logoSlot: null,
      plateCropFocus: "center",
      textBoxes: [
        {
          slot: "caption",
          xPx: 40,
          yPx: 40,
          widthPx: 520,
          heightPx: 140,
          maxLines: 2,
          minFontSizePx: 20,
          maxFontSizePx: 48,
          fontSizeStepPx: 4,
          lineHeightRatio: 1.25,
          alignment: "start",
          required: true,
        },
      ],
    },
    ...overrides,
  });
}

function payload(
  overrides: Partial<CampaignPosterRenderPayload> = {},
): CampaignPosterRenderPayload {
  return {
    organizationId: ORGANIZATION_ID,
    campaignId: CAMPAIGN_ID,
    bundleVersionId: BUNDLE_VERSION_ID,
    plateAssetId: PLATE_ASSET_ID,
    correlationId: CORRELATION_ID,
    templateKey: "worker_probe",
    templateVersion: 1,
    script: "Latn",
    directionId: manifestIds.control,
    channel: "instagram",
    extra: null,
    ...overrides,
  };
}

function context(overrides: Partial<PosterRenderContext> = {}): PosterRenderContext {
  return {
    manifest: validManifest(),
    template: template(),
    plateStoragePath: `${ORGANIZATION_ID}/${CAMPAIGN_ID}/${BUNDLE_VERSION_ID}/${PLATE_ASSET_ID}.png`,
    plateContentHash: "b".repeat(64),
    plateGenerationRunId: null,
    legalLine: null,
    evidence: {
      offer: null,
      factKeys: [],
      factText: "al noor kitchen serves kerala food in deira",
      restrictedTerms: [],
    },
    ...overrides,
  };
}

type Recorded = Parameters<RenderPosterDependencies["renders"]["record"]>[0];

function dependencies(overrides: Partial<RenderPosterDependencies> = {}) {
  const uploaded: { path: string; bytes: Uint8Array }[] = [];
  const recorded: Recorded[] = [];

  const base: RenderPosterDependencies = {
    context: { read: async () => context() },
    plates: { read: async () => plateBytes() },
    // The real compositor, so these tests exercise the fonts and the shaping
    // rather than a stub that would agree with whatever the worker did.
    composite: compositePoster,
    storage: {
      async upload(input) {
        uploaded.push({ path: input.path, bytes: input.bytes });
        return { ok: true };
      },
    },
    renders: {
      async record(input) {
        recorded.push(input);
        return { renderId: "render-1", state: input.state, replayed: false };
      },
    },
    isCancelled: () => false,
    ...overrides,
  };

  return { dependencies: base, uploaded, recorded };
}

describe("renderCampaignPoster", () => {
  /**
   * The claim the whole feature rests on: the words on the poster are the words
   * the approval bound, quoted from the manifest rather than passed in by
   * whoever pressed the button.
   */
  it("draws the manifest's approved words and records what it drew", async () => {
    const { dependencies: deps, uploaded, recorded } = dependencies();

    const result = await renderCampaignPoster(payload(), deps);

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;

    expect(uploaded).toHaveLength(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].state).toBe("rendered");
    expect(recorded[0].textValues.caption).toBe(validManifest().directions[0].copy[0].hook);
    expect(recorded[0].outputStoragePath).toBe(uploaded[0].path);
  });

  /** The object has to exist before a row claims it does. */
  it("stores the image before recording the row that points at it", async () => {
    const order: string[] = [];
    const { dependencies: deps } = dependencies({
      storage: {
        async upload() {
          order.push("upload");
          return { ok: true };
        },
      },
      renders: {
        async record(input) {
          order.push("record");
          return { renderId: "render-1", state: input.state, replayed: false };
        },
      },
    });

    await renderCampaignPoster(payload(), deps);

    expect(order).toEqual(["upload", "record"]);
  });

  /**
   * A row saying `rendered` is a promise that the poster is downloadable. A
   * failed upload that still recorded one would break that promise silently.
   */
  it("records nothing when the image could not be stored", async () => {
    const { dependencies: deps, recorded } = dependencies({
      storage: { upload: async () => ({ ok: false, reason: "upload_failed" }) },
    });

    const result = await renderCampaignPoster(payload(), deps);

    expect(result).toEqual({ status: "skipped", reason: "upload_failed" });
    expect(recorded).toHaveLength(0);
  });

  /**
   * The free box is the one place operator prose reaches a poster. An offer the
   * campaign never recorded is refused, and the refusal is stored so the
   * operator can read why rather than watching a spinner end in nothing.
   */
  it("refuses an unapproved offer typed into the free box, and records the refusal", async () => {
    const { dependencies: deps, uploaded, recorded } = dependencies();

    const result = await renderCampaignPoster(payload({ extra: "50% off today" }), deps);

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusalCode).toBe("operator_text_refused");
    expect(uploaded).toHaveLength(0);
    expect(recorded[0].state).toBe("refused");
    expect(recorded[0].refusalCode).toBe("operator_text_refused");
  });

  it("refuses a template whose required slot the manifest cannot fill", async () => {
    const bodyRequired = template();
    const { dependencies: deps, uploaded } = dependencies({
      context: {
        read: async () =>
          context({
            template: posterTemplateSchema.parse({
              ...bodyRequired,
              layout: {
                ...bodyRequired.layout,
                textBoxes: [
                  ...bodyRequired.layout.textBoxes,
                  {
                    slot: "body",
                    xPx: 40,
                    yPx: 200,
                    widthPx: 520,
                    heightPx: 120,
                    maxLines: 2,
                    minFontSizePx: 18,
                    maxFontSizePx: 32,
                    fontSizeStepPx: 2,
                    lineHeightRatio: 1.25,
                    alignment: "start",
                    required: true,
                  },
                ],
              },
            }),
          }),
      },
    });

    const result = await renderCampaignPoster(payload(), deps);

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(result.refusalCode).toBe("template_unavailable");
    expect(uploaded).toHaveLength(0);
  });

  /**
   * An identical re-render is the same render. The store owns that decision --
   * the table is content-addressed and append-only -- and the worker surfaces
   * it rather than treating a replay as new work.
   */
  it("reports a replay as a replay", async () => {
    const { dependencies: deps } = dependencies({
      renders: {
        async record(input) {
          return { renderId: "render-1", state: input.state, replayed: true };
        },
      },
    });

    const result = await renderCampaignPoster(payload(), deps);

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;
    expect(result.replayed).toBe(true);
  });

  /**
   * A missing plate is an infrastructure fault, not a creative judgement.
   * Recording it as a refusal would tell the operator their creative was
   * rejected when nothing was ever examined.
   */
  it("skips without recording when the plate bytes are unavailable", async () => {
    const { dependencies: deps, recorded } = dependencies({
      plates: { read: async () => null },
    });

    const result = await renderCampaignPoster(payload(), deps);

    expect(result).toEqual({ status: "skipped", reason: "plate_unavailable" });
    expect(recorded).toHaveLength(0);
  });

  it("skips without recording when the campaign context cannot be read", async () => {
    const { dependencies: deps, recorded } = dependencies({
      context: { read: async () => null },
    });

    const result = await renderCampaignPoster(payload(), deps);

    expect(result).toEqual({ status: "skipped", reason: "context_unavailable" });
    expect(recorded).toHaveLength(0);
  });

  /**
   * `resolvePosterSlots` throws when the direction is unknown or has no copy for
   * this channel and placement. Both are reachable from a payload that is
   * perfectly valid in shape -- a direction removed by a newer version, a
   * placement the campaign never wrote copy for -- so they must decline like any
   * other missing input. Letting the throw escape burns the retry budget
   * re-running work that cannot succeed, and leaves the operator watching a
   * spinner rather than reading a reason.
   */
  it("declines a direction the version does not have, rather than throwing", async () => {
    const { dependencies: deps, recorded } = dependencies();

    const result = await renderCampaignPoster(
      payload({ directionId: "3f2504e0-0000-0000-0000-000000000000" }),
      deps,
    );

    expect(result).toEqual({ status: "skipped", reason: "copy_unavailable" });
    expect(recorded).toHaveLength(0);
  });

  it("declines a placement the direction wrote no copy for", async () => {
    const { dependencies: deps, recorded } = dependencies();

    const result = await renderCampaignPoster(payload({ channel: "facebook" }), deps);

    expect(result).toEqual({ status: "skipped", reason: "copy_unavailable" });
    expect(recorded).toHaveLength(0);
  });

  it("stops on cancellation without drawing or recording anything", async () => {
    const {
      dependencies: deps,
      uploaded,
      recorded,
    } = dependencies({
      isCancelled: () => true,
    });

    const result = await renderCampaignPoster(payload(), deps);

    expect(result).toEqual({ status: "skipped", reason: "cancelled" });
    expect(uploaded).toHaveLength(0);
    expect(recorded).toHaveLength(0);
  });

  /** Same inputs, same digest -- which is what makes the storage path stable. */
  it("gives identical inputs the same render digest and storage path", async () => {
    const first = await renderCampaignPoster(payload(), dependencies().dependencies);
    const second = await renderCampaignPoster(payload(), dependencies().dependencies);

    expect(first.status).toBe("rendered");
    expect(second.status).toBe("rendered");
    if (first.status !== "rendered" || second.status !== "rendered") return;
    expect(first.renderDigest).toBe(second.renderDigest);
    expect(first.outputStoragePath).toBe(second.outputStoragePath);
  });

  /**
   * A different script is a different poster, not the same one relabelled.
   *
   * The Malayalam pass refuses here, and that is the correct answer rather than
   * an inconvenience: this manifest's words are Latin, the Malayalam face does
   * not cover them, and drawing them would mean falling back to some other font
   * nobody pinned. The refusal still carries a digest, because a refusal is a
   * row like any other and re-asking must replay rather than stack.
   */
  it("gives a different script a different digest", async () => {
    const latin = await renderCampaignPoster(payload(), dependencies().dependencies);
    const malayalam = await renderCampaignPoster(
      payload({ script: "Mlym" }),
      dependencies().dependencies,
    );

    expect(latin.status).toBe("rendered");
    expect(malayalam.status).toBe("refused");
    if (latin.status !== "rendered" || malayalam.status !== "refused") return;
    expect(malayalam.refusalCode).toBe("glyph_not_covered");
    expect(malayalam.renderDigest).not.toBe(latin.renderDigest);
  });
});
