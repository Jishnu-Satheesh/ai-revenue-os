import { createCanvas } from "@napi-rs/canvas";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { posterTemplateSchema, type PosterTemplate } from "@/domain/campaigns/poster-template";
import { fontManifestDigest } from "@/domain/campaigns/font-manifest";
import { compositePoster } from "@/modules/campaigns/infrastructure/poster-compositor";
import { manifestIds, validManifest } from "@/domain/campaigns/test-manifest";
import {
  renderCampaignPoster,
  type PosterExistingRender,
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
    // Resolved by the renders route from the approved poster plan; the worker
    // records these verbatim and never re-derives them.
    placement: "feed_image",
    language: "en",
    format: "feed",
    ordinal: 1,
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
type RecordedDeliverable = Parameters<RenderPosterDependencies["deliverables"]["recordVersion"]>[0];

function dependencies(overrides: Partial<RenderPosterDependencies> = {}) {
  const uploaded: { path: string; bytes: Uint8Array }[] = [];
  const recorded: Recorded[] = [];
  const deliverables: RecordedDeliverable[] = [];

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
      // No previous attempt by default: every render is new work.
      async findByDigest() {
        return null;
      },
    },
    // The deliverable record RPC, mocked at the store boundary: the real
    // function is service_role-only and has no caller outside the worker.
    deliverables: {
      async recordVersion(input) {
        deliverables.push(input);
        return {
          deliverableId: "deliverable-1",
          deliverableVersionId: "deliverable-version-1",
          version: 1,
          outcome: "saved",
        };
      },
    },
    isCancelled: () => false,
    ...overrides,
  };

  return { dependencies: base, uploaded, recorded, deliverables };
}

describe("renderCampaignPoster", () => {
  /**
   * The claim the whole feature rests on: the words on the poster are the words
   * the approval bound, quoted from the manifest rather than passed in by
   * whoever pressed the button.
   */
  it("draws the manifest's approved words and records what it drew", async () => {
    const { dependencies: deps, uploaded, recorded, deliverables } = dependencies();

    const result = await renderCampaignPoster(payload(), deps);

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;

    expect(uploaded).toHaveLength(1);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].state).toBe("rendered");
    expect(recorded[0].textValues.caption).toBe(validManifest().directions[0].copy[0].hook);
    expect(recorded[0].outputStoragePath).toBe(uploaded[0].path);
    expect(deliverables).toHaveLength(1);
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
        async findByDigest() {
          return null;
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
        async findByDigest() {
          return null;
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

  /**
   * The render-to-deliverable wire this slice exists for: a finished render is
   * filed as a reviewable deliverable version carrying the render's own bytes,
   * words, inputs and route-resolved identity -- verbatim, exactly once.
   */
  it("records the finished output with its exact bytes, words, inputs and identity", async () => {
    const { dependencies: deps, uploaded, recorded, deliverables } = dependencies();

    const result = await renderCampaignPoster(payload(), deps);

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;
    expect(deliverables).toHaveLength(1);

    const filed = deliverables[0].payload as Record<string, unknown>;
    const render = recorded[0];

    // Identity threaded from the Studio request, recorded verbatim.
    expect(deliverables[0].organizationId).toBe(ORGANIZATION_ID);
    expect(filed.campaign_id).toBe(CAMPAIGN_ID);
    expect(filed.bundle_version_id).toBe(BUNDLE_VERSION_ID);
    expect(filed.direction_key).toBe(manifestIds.control);
    expect(filed.channel).toBe("instagram");
    expect(filed.placement).toBe("feed_image");
    expect(filed.language).toBe("en");
    expect(filed.format).toBe("feed");
    expect(filed.ordinal).toBe(1);

    // The exact finished output, not a re-derivation of it.
    expect(filed.source_kind).toBe("finished_poster");
    expect(filed.poster_render_id).toBe(result.renderId);
    expect(filed.render_digest).toBe(result.renderDigest);
    expect(filed.render_digest).toBe(render.renderDigest);
    expect(filed.content_hash).toBe(render.outputContentHash);
    expect(filed.copy).toEqual(render.textValues);

    // The stored bytes hash to the filed content hash: the review that later
    // binds to this version binds to what is actually downloadable.
    const storedHash = createHash("sha256").update(uploaded[0].bytes).digest("hex");
    expect(filed.content_hash).toBe(storedHash);

    const renderInputs = filed.render_inputs as Record<string, unknown>;
    expect(renderInputs.templateKey).toBe("worker_probe");
    expect(renderInputs.templateVersion).toBe(1);
    expect(renderInputs.script).toBe("Latn");
    expect(renderInputs.fontManifestDigest).toBe(fontManifestDigest());
    expect(renderInputs.slotValues).toEqual(render.textValues);

    expect(result.deliverable).toEqual({
      deliverableId: "deliverable-1",
      deliverableVersionId: "deliverable-version-1",
      version: 1,
      outcome: "saved",
    });
  });

  /**
   * A refusal is unfinished work, not a finished output: the render row keeps
   * its refusal code and nothing is filed for review.
   */
  it("files nothing when the render is refused", async () => {
    const { dependencies: deps, recorded, deliverables } = dependencies();

    const result = await renderCampaignPoster(payload({ extra: "50% off today" }), deps);

    expect(result.status).toBe("refused");
    if (result.status !== "refused") return;
    expect(recorded).toHaveLength(1);
    expect(recorded[0].refusalCode).toBe("operator_text_refused");
    expect(deliverables).toHaveLength(0);
  });

  /**
   * The failure this slice is named for: the picture is done and stored, but
   * filing it as a deliverable fails. The run must throw so Trigger retries --
   * and the retry must reuse the stored output (no second composite, no second
   * upload) and then file it, because the render row it replays already exists.
   */
  it("throws when filing fails, then reuses the output and files it on retry", async () => {
    const { dependencies: deps, uploaded, recorded, deliverables } = dependencies();
    let composites = 0;
    const drawing = deps.composite;
    deps.composite = async (request) => {
      composites += 1;
      return drawing(request);
    };

    let filings = 0;
    deps.deliverables = {
      async recordVersion(input) {
        filings += 1;
        if (filings === 1) throw { kind: "unavailable" };
        deliverables.push(input);
        return {
          deliverableId: "deliverable-1",
          deliverableVersionId: "deliverable-version-1",
          version: 1,
          outcome: "saved",
        };
      },
    };

    // A previous attempt's render row, as the probe finds it: same digest,
    // same stored bytes, same drawn words.
    deps.renders = {
      async record(input) {
        recorded.push(input);
        return { renderId: "render-1", state: input.state, replayed: recorded.length > 1 };
      },
      async findByDigest(input): Promise<PosterExistingRender | null> {
        const prior = recorded.find((entry) => entry.renderDigest === input.renderDigest);
        if (!prior || prior.state !== "rendered") return null;
        return {
          renderId: "render-1",
          state: "rendered",
          refusalCode: null,
          textValues: { ...prior.textValues },
          outputStoragePath: prior.outputStoragePath,
          outputContentHash: prior.outputContentHash,
          outputMimeType: prior.outputMimeType,
          outputWidthPx: prior.outputWidthPx,
          outputHeightPx: prior.outputHeightPx,
        };
      },
    };

    await expect(renderCampaignPoster(payload(), deps)).rejects.toThrow(
      "could not be recorded as a deliverable",
    );
    expect(composites).toBe(1);
    expect(uploaded).toHaveLength(1);
    expect(recorded).toHaveLength(1);
    expect(deliverables).toHaveLength(0);

    const retry = await renderCampaignPoster(payload(), deps);

    expect(retry.status).toBe("rendered");
    if (retry.status !== "rendered") return;
    // The picture was not paid for twice: same composite, same upload.
    expect(composites).toBe(1);
    expect(uploaded).toHaveLength(1);
    expect(retry.replayed).toBe(true);
    // ...and the filing the first attempt dropped is now recorded, against the
    // same render row and the same bytes.
    expect(deliverables).toHaveLength(1);
    const filed = deliverables[0].payload as Record<string, unknown>;
    expect(filed.poster_render_id).toBe("render-1");
    expect(filed.content_hash).toBe(recorded[0].outputContentHash);
    expect(filed.render_digest).toBe(recorded[0].renderDigest);
    expect(filed.copy).toEqual(recorded[0].textValues);
    expect(retry.outputStoragePath).toBe(recorded[0].outputStoragePath);
  });

  /**
   * The database owns idempotency: an identical retry reuses the filed version
   * rather than minting a second one, and the worker surfaces that instead of
   * hiding it. No second review is ever asked for the same picture.
   */
  it("surfaces the database's reuse when the identical version is filed twice", async () => {
    const { dependencies: deps } = dependencies({
      deliverables: {
        async recordVersion() {
          return {
            deliverableId: "deliverable-1",
            deliverableVersionId: "deliverable-version-1",
            version: 1,
            outcome: "replayed",
          };
        },
      },
    });

    const result = await renderCampaignPoster(payload(), deps);

    expect(result.status).toBe("rendered");
    if (result.status !== "rendered") return;
    expect(result.deliverable.outcome).toBe("replayed");
  });
});
