import { logger } from "@/lib/logger";
import { FONT_MANIFEST, fontManifestDigest } from "@/domain/campaigns/font-manifest";
import {
  checkOperatorSlotText,
  resolvePosterSlots,
  templateAvailability,
} from "@/domain/campaigns/poster-slots";
import type { PosterTemplate } from "@/domain/campaigns/poster-template";
import type { PosterTextSlot } from "@/domain/campaigns/poster-template";
import type { CampaignBundleManifest } from "@/domain/campaigns/schemas";
import type { VariantEvidence } from "@/domain/campaigns/derivation";
import { renderDigest } from "@/domain/campaigns/render-digest";
import type {
  PosterCompositionRequest,
  PosterCompositionResult,
  PosterTextInput,
} from "@/modules/campaigns/infrastructure/poster-compositor";
import type { CampaignPosterRenderPayload } from "@/workflows/campaigns/contracts";

/**
 * Drawing the approved words onto the plate the model drew.
 *
 * The division this workflow enforces is the whole point of spec 020: the model
 * produced an image with no text on it, and every character that reaches the
 * poster is quoted here from the approved manifest. Nothing in this file asks a
 * model anything.
 *
 * Two consequences shape the code. A render is a pure function of its inputs,
 * so the digest is computable before a pixel is drawn and an identical
 * re-render is the same render rather than a second one. And a refusal is an
 * outcome worth storing: an operator who asked for a poster and got nothing
 * needs to read why, so a creative refusal is recorded with its reason while an
 * infrastructure fault is not recorded at all -- a missing plate is not a
 * judgement about anybody's creative.
 */

export type PosterRenderContext = {
  /** The approved version whose words the poster quotes. */
  readonly manifest: CampaignBundleManifest;
  readonly template: PosterTemplate;
  readonly plateStoragePath: string;
  readonly plateContentHash: string;
  /** Null for a client's own photograph and for an edited plate. */
  readonly plateGenerationRunId: string | null;
  readonly legalLine: string | null;
  /** What the operator's own words must trace back to. */
  readonly evidence: VariantEvidence;
};

export type PosterRenderContextReader = {
  read(input: {
    organizationId: string;
    campaignId: string;
    bundleVersionId: string;
    plateAssetId: string;
    templateKey: string;
    templateVersion: number;
  }): Promise<PosterRenderContext | null>;
};

export type PosterPlateReader = {
  read(storagePath: string): Promise<Uint8Array | null>;
};

export type PosterOutputStorage = {
  upload(input: {
    path: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;
};

export type PosterRenderRecord = {
  readonly organizationId: string;
  readonly campaignId: string;
  readonly bundleVersionId: string;
  readonly plateAssetId: string;
  readonly plateGenerationRunId: string | null;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly script: "Latn" | "Mlym" | "Arab";
  readonly textValues: Readonly<Record<string, string>>;
  readonly fontManifest: Readonly<Record<string, unknown>>;
  readonly renderDigest: string;
  readonly state: "rendered" | "refused";
  readonly refusalCode: string | null;
  readonly refusalDetail: Readonly<Record<string, unknown>> | null;
  readonly outputStoragePath: string | null;
  readonly outputContentHash: string | null;
  readonly outputMimeType: string | null;
  readonly outputWidthPx: number | null;
  readonly outputHeightPx: number | null;
};

export type PosterRenderStore = {
  record(input: PosterRenderRecord): Promise<{
    renderId: string;
    state: "rendered" | "refused";
    replayed: boolean;
  }>;
  /**
   * The row a previous attempt already wrote for this exact digest, if any.
   *
   * The digest covers every input that changes the pixels, so a hit means the
   * output already exists and drawing it again would only spend a second
   * upload for the same bytes. Null means nothing was recorded yet.
   */
  findByDigest(input: {
    organizationId: string;
    campaignId: string;
    bundleVersionId: string;
    renderDigest: string;
  }): Promise<PosterExistingRender | null>;
};

export type PosterExistingRender = {
  readonly renderId: string;
  readonly state: "rendered" | "refused";
  readonly refusalCode: string | null;
  readonly textValues: Readonly<Record<string, string>>;
  readonly outputStoragePath: string | null;
  readonly outputContentHash: string | null;
  readonly outputMimeType: string | null;
  readonly outputWidthPx: number | null;
  readonly outputHeightPx: number | null;
};

/**
 * Recording the finished output as a reviewable deliverable version.
 *
 * This is the narrow worker side of `record_campaign_deliverable_version`: the
 * service-role RPC that files one exact set of finished bytes under the
 * deliverable identity the route resolved. The payload is the render's own
 * values, verbatim -- nothing here re-derives identity, rehashes bytes, or
 * invents copy. An identical retry reuses the recorded version rather than
 * asking a second review of the same picture; that reuse is the database's
 * decision, surfaced here as the outcome.
 */
export type PosterDeliverableStore = {
  recordVersion(input: { organizationId: string; payload: Record<string, unknown> }): Promise<{
    deliverableId: string;
    deliverableVersionId: string;
    version: number;
    outcome: "saved" | "replayed";
  }>;
};

/**
 * The compositor, injected rather than imported.
 *
 * It is the one genuinely native thing in this path -- a Skia binding with
 * explicitly registered fonts -- and injecting it keeps this workflow a plain
 * function that a test can drive without the Trigger runtime.
 */
export type PosterCompositor = (
  request: PosterCompositionRequest,
) => Promise<PosterCompositionResult>;

export type RenderPosterDependencies = {
  context: PosterRenderContextReader;
  plates: PosterPlateReader;
  composite: PosterCompositor;
  storage: PosterOutputStorage;
  renders: PosterRenderStore;
  deliverables: PosterDeliverableStore;
  isCancelled: () => boolean;
};

export type RecordedPosterDeliverable = {
  readonly deliverableId: string;
  readonly deliverableVersionId: string;
  readonly version: number;
  readonly outcome: "saved" | "replayed";
};

export type RenderPosterResult =
  | {
      status: "rendered";
      renderId: string;
      replayed: boolean;
      renderDigest: string;
      outputStoragePath: string;
      deliverable: RecordedPosterDeliverable;
    }
  | {
      status: "refused";
      renderId: string;
      replayed: boolean;
      renderDigest: string;
      refusalCode: string;
    }
  | {
      status: "skipped";
      reason:
        | "context_unavailable"
        | "copy_unavailable"
        | "plate_unavailable"
        | "cancelled"
        | "upload_failed";
    };

/**
 * Content-addressed, so an identical re-render overwrites its own object rather
 * than accumulating a second copy under a new name.
 */
export function posterRenderPath(input: {
  organizationId: string;
  campaignId: string;
  bundleVersionId: string;
  renderDigest: string;
}): string {
  return `${input.organizationId}/${input.campaignId}/${input.bundleVersionId}/posters/${input.renderDigest}.png`;
}

function fontManifestRecord(): Readonly<Record<string, unknown>> {
  return {
    digest: fontManifestDigest(),
    fonts: FONT_MANIFEST.map((font) => ({
      file: font.file,
      family: font.family,
      version: font.version,
      sha256: font.sha256,
    })),
  };
}

export async function renderCampaignPoster(
  payload: CampaignPosterRenderPayload,
  dependencies: RenderPosterDependencies,
): Promise<RenderPosterResult> {
  if (dependencies.isCancelled()) return { status: "skipped", reason: "cancelled" };

  const context = await dependencies.context.read({
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    bundleVersionId: payload.bundleVersionId,
    plateAssetId: payload.plateAssetId,
    templateKey: payload.templateKey,
    templateVersion: payload.templateVersion,
  });

  if (context === null) return { status: "skipped", reason: "context_unavailable" };

  const record = (
    fields: Pick<
      PosterRenderRecord,
      | "textValues"
      | "renderDigest"
      | "state"
      | "refusalCode"
      | "refusalDetail"
      | "outputStoragePath"
      | "outputContentHash"
      | "outputMimeType"
      | "outputWidthPx"
      | "outputHeightPx"
    >,
  ): PosterRenderRecord => ({
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    bundleVersionId: payload.bundleVersionId,
    plateAssetId: payload.plateAssetId,
    plateGenerationRunId: context.plateGenerationRunId,
    templateKey: payload.templateKey,
    templateVersion: payload.templateVersion,
    script: payload.script,
    fontManifest: fontManifestRecord(),
    ...fields,
  });

  /**
   * `resolvePosterSlots` throws when the direction is unknown, or has no copy
   * for this channel and placement. Both are reachable from a payload that is
   * valid in shape -- a direction dropped by a newer version, a placement the
   * campaign never wrote copy for -- so both decline like any other missing
   * input. Letting the throw escape would spend the retry budget re-running work
   * that cannot succeed, and leave the operator watching a spinner instead of
   * reading a reason.
   */
  let resolution;
  try {
    resolution = resolvePosterSlots({
      manifest: context.manifest,
      directionId: payload.directionId,
      channel: payload.channel,
      placement: context.template.placement,
      extra: payload.extra,
      legalLine: context.legalLine,
    });
  } catch {
    logger.warn("campaign.poster_copy_unavailable", {
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
      correlationId: payload.correlationId,
    });
    return { status: "skipped", reason: "copy_unavailable" };
  }

  // The one ungoverned string on the poster, checked before it is drawn rather
  // than after it is published.
  if (payload.extra !== null && payload.extra.trim() !== "") {
    const admission = checkOperatorSlotText(payload.extra, context.evidence);
    if (!admission.admitted) {
      const digest = refusalDigest(context, payload, resolution.slots);
      const stored = await dependencies.renders.record(
        record({
          textValues: {},
          renderDigest: digest,
          state: "refused",
          refusalCode: "operator_text_refused",
          refusalDetail: {
            failures: admission.failures.map((failure) => ({
              code: failure.code,
              detail: failure.detail,
            })),
          },
          outputStoragePath: null,
          outputContentHash: null,
          outputMimeType: null,
          outputWidthPx: null,
          outputHeightPx: null,
        }),
      );

      return {
        status: "refused",
        renderId: stored.renderId,
        replayed: stored.replayed,
        renderDigest: digest,
        refusalCode: "operator_text_refused",
      };
    }
  }

  const availability = templateAvailability(context.template, resolution.slots);
  if (!availability.available) {
    const digest = refusalDigest(context, payload, resolution.slots);
    const stored = await dependencies.renders.record(
      record({
        textValues: {},
        renderDigest: digest,
        state: "refused",
        refusalCode: "template_unavailable",
        refusalDetail: { missingSlots: availability.missingSlots },
        outputStoragePath: null,
        outputContentHash: null,
        outputMimeType: null,
        outputWidthPx: null,
        outputHeightPx: null,
      }),
    );

    return {
      status: "refused",
      renderId: stored.renderId,
      replayed: stored.replayed,
      renderDigest: digest,
      refusalCode: "template_unavailable",
    };
  }

  if (dependencies.isCancelled()) return { status: "skipped", reason: "cancelled" };

  const textValues = drawableTextValues(context.template, resolution.slots);

  /**
   * The digest is computable before a pixel is drawn -- over the same inputs
   * the compositor hashes -- so a retry can ask whether the output already
   * exists before paying to draw it again. A hit short-circuits the composite
   * and the upload entirely: the bytes are already stored, and the row below
   * replays them rather than stacking a second one.
   */
  const prospectiveDigest = renderDigest({
    plateContentHash: context.plateContentHash,
    templateKey: context.template.key,
    templateVersion: context.template.version,
    script: payload.script,
    textValues: Object.fromEntries(textValues.map((value) => [value.slot, value.text])),
    fontManifestDigest: fontManifestDigest(),
  });

  const existing = await dependencies.renders.findByDigest({
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    bundleVersionId: payload.bundleVersionId,
    renderDigest: prospectiveDigest,
  });

  if (
    existing !== null &&
    existing.state === "rendered" &&
    existing.outputStoragePath !== null &&
    existing.outputContentHash !== null
  ) {
    const replayed = await dependencies.renders.record(
      record({
        textValues: { ...existing.textValues },
        renderDigest: prospectiveDigest,
        state: "rendered",
        refusalCode: null,
        refusalDetail: null,
        outputStoragePath: existing.outputStoragePath,
        outputContentHash: existing.outputContentHash,
        outputMimeType: existing.outputMimeType,
        outputWidthPx: existing.outputWidthPx,
        outputHeightPx: existing.outputHeightPx,
      }),
    );

    const deliverable = await recordFinishedDeliverable(payload, dependencies, {
      plateContentHash: context.plateContentHash,
      renderId: replayed.renderId,
      textValues: existing.textValues,
      renderDigest: prospectiveDigest,
      outputContentHash: existing.outputContentHash,
    });

    return {
      status: "rendered",
      renderId: replayed.renderId,
      replayed: replayed.replayed,
      renderDigest: prospectiveDigest,
      outputStoragePath: existing.outputStoragePath,
      deliverable,
    };
  }

  /**
   * A refused poster replays the same way: the row already says what was
   * decided and why, so there is nothing to draw and -- refusals being
   * unfinished work rather than finished output -- nothing to file as a
   * deliverable.
   */
  if (existing !== null && existing.state === "refused" && existing.refusalCode !== null) {
    const replayed = await dependencies.renders.record(
      record({
        textValues: { ...existing.textValues },
        renderDigest: prospectiveDigest,
        state: "refused",
        refusalCode: existing.refusalCode,
        refusalDetail: null,
        outputStoragePath: null,
        outputContentHash: null,
        outputMimeType: null,
        outputWidthPx: null,
        outputHeightPx: null,
      }),
    );

    return {
      status: "refused",
      renderId: replayed.renderId,
      replayed: replayed.replayed,
      renderDigest: prospectiveDigest,
      refusalCode: existing.refusalCode,
    };
  }

  const plate = await dependencies.plates.read(context.plateStoragePath);
  if (plate === null) return { status: "skipped", reason: "plate_unavailable" };

  const composed = await dependencies.composite({
    template: context.template,
    script: payload.script,
    plate: Buffer.from(plate),
    plateContentHash: context.plateContentHash,
    textValues,
  });

  if (!composed.rendered) {
    const stored = await dependencies.renders.record(
      record({
        textValues: Object.fromEntries(textValues.map((value) => [value.slot, value.text])),
        renderDigest: composed.renderDigest,
        state: "refused",
        refusalCode: composed.refusalCode,
        refusalDetail: composed.detail,
        outputStoragePath: null,
        outputContentHash: null,
        outputMimeType: null,
        outputWidthPx: null,
        outputHeightPx: null,
      }),
    );

    return {
      status: "refused",
      renderId: stored.renderId,
      replayed: stored.replayed,
      renderDigest: composed.renderDigest,
      refusalCode: composed.refusalCode,
    };
  }

  const path = posterRenderPath({
    organizationId: payload.organizationId,
    campaignId: payload.campaignId,
    bundleVersionId: payload.bundleVersionId,
    renderDigest: composed.renderDigest,
  });

  // Stored before the row that points at it. A row claiming `rendered` is a
  // promise the poster can be downloaded, and it is only made once it is true.
  const stored = await dependencies.storage.upload({
    path,
    bytes: composed.png,
    contentType: "image/png",
  });

  if (!stored.ok) {
    logger.warn("campaign.poster_upload_failed", {
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
      correlationId: payload.correlationId,
      renderDigest: composed.renderDigest,
    });
    return { status: "skipped", reason: "upload_failed" };
  }

  const saved = await dependencies.renders.record(
    record({
      textValues: composed.drawnValues,
      renderDigest: composed.renderDigest,
      state: "rendered",
      refusalCode: null,
      refusalDetail: null,
      outputStoragePath: path,
      outputContentHash: composed.outputContentHash,
      outputMimeType: "image/png",
      outputWidthPx: composed.widthPx,
      outputHeightPx: composed.heightPx,
    }),
  );

  /**
   * The finished output is filed as a reviewable deliverable version only now
   * that the bytes exist in storage and the render row points at them. A
   * failure here throws rather than returning a half-done success: the run
   * retries, the probe above replays the render without drawing it again, and
   * the record call files what the first attempt could not. Returning success
   * instead would leave a downloadable poster nobody can review or publish.
   */
  const deliverable = await recordFinishedDeliverable(payload, dependencies, {
    plateContentHash: context.plateContentHash,
    renderId: saved.renderId,
    textValues: composed.drawnValues,
    renderDigest: composed.renderDigest,
    outputContentHash: composed.outputContentHash,
  });

  return {
    status: "rendered",
    renderId: saved.renderId,
    replayed: saved.replayed,
    renderDigest: composed.renderDigest,
    outputStoragePath: path,
    deliverable,
  };
}

/**
 * Files one exact set of finished bytes as a deliverable version.
 *
 * Every value is the render's own, carried verbatim: the render row id, its
 * content hash and digest, the words actually drawn, the inputs that produced
 * them, and the identity the route resolved from the approved poster plan.
 * Nothing is re-derived here -- the worker has no second opinion about which
 * slot a render belongs to. A failure throws so the run retries; the
 * idempotency fence is the database's natural key, which reuses the version an
 * earlier attempt already filed instead of asking a second review of it.
 */
async function recordFinishedDeliverable(
  payload: CampaignPosterRenderPayload,
  dependencies: RenderPosterDependencies,
  finished: {
    plateContentHash: string;
    renderId: string;
    textValues: Readonly<Record<string, string>>;
    renderDigest: string;
    outputContentHash: string;
  },
): Promise<RecordedPosterDeliverable> {
  try {
    return await dependencies.deliverables.recordVersion({
      organizationId: payload.organizationId,
      payload: {
        campaign_id: payload.campaignId,
        bundle_version_id: payload.bundleVersionId,
        direction_key: payload.directionId,
        channel: payload.channel,
        placement: payload.placement,
        language: payload.language,
        format: payload.format,
        ordinal: payload.ordinal,
        source_kind: "finished_poster",
        poster_render_id: finished.renderId,
        copy: { ...finished.textValues },
        render_inputs: {
          plateContentHash: finished.plateContentHash,
          templateKey: payload.templateKey,
          templateVersion: payload.templateVersion,
          script: payload.script,
          slotValues: { ...finished.textValues },
          freeLine: payload.extra,
          fontManifestDigest: fontManifestDigest(),
        },
        render_digest: finished.renderDigest,
        content_hash: finished.outputContentHash,
        verification: {},
      },
    });
  } catch (error) {
    logger.error("campaign.poster_deliverable_not_recorded", {
      organizationId: payload.organizationId,
      campaignId: payload.campaignId,
      correlationId: payload.correlationId,
      errorCode:
        typeof error === "object" && error !== null && "kind" in error
          ? String((error as { kind: unknown }).kind)
          : error instanceof Error
            ? error.name
            : "unknown",
    });
    throw new Error("The finished poster could not be recorded as a deliverable.");
  }
}

/**
 * The strings the template actually has a box for.
 *
 * A slot the manifest can fill but the template does not draw is not an error;
 * it simply is not on this poster.
 */
function drawableTextValues(
  template: PosterTemplate,
  slots: ReturnType<typeof resolvePosterSlots>["slots"],
): readonly PosterTextInput[] {
  const boxes = new Set<PosterTextSlot>(template.layout.textBoxes.map((box) => box.slot));
  const drawable: PosterTextInput[] = [];

  for (const slot of slots) {
    if (slot.value === null || !boxes.has(slot.slot)) continue;
    drawable.push({ slot: slot.slot, text: slot.value });
  }

  return drawable;
}

/**
 * A refusal reached before the compositor still needs a digest, because the
 * render table is content-addressed and a refusal is a row like any other.
 * Computed over the same inputs the compositor would have used, so re-asking
 * for the same refused poster replays rather than stacking rows.
 */
function refusalDigest(
  context: PosterRenderContext,
  payload: CampaignPosterRenderPayload,
  slots: ReturnType<typeof resolvePosterSlots>["slots"],
): string {
  return renderDigest({
    plateContentHash: context.plateContentHash,
    templateKey: payload.templateKey,
    templateVersion: payload.templateVersion,
    script: payload.script,
    textValues: Object.fromEntries(
      slots.filter((slot) => slot.value !== null).map((slot) => [slot.slot, slot.value as string]),
    ),
    fontManifestDigest: fontManifestDigest(),
  });
}
