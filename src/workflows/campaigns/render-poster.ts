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
  isCancelled: () => boolean;
};

export type RenderPosterResult =
  | {
      status: "rendered";
      renderId: string;
      replayed: boolean;
      renderDigest: string;
      outputStoragePath: string;
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
      reason: "context_unavailable" | "plate_unavailable" | "cancelled" | "upload_failed";
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

  const resolution = resolvePosterSlots({
    manifest: context.manifest,
    directionId: payload.directionId,
    channel: payload.channel,
    placement: context.template.placement,
    extra: payload.extra,
    legalLine: context.legalLine,
  });

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

  const plate = await dependencies.plates.read(context.plateStoragePath);
  if (plate === null) return { status: "skipped", reason: "plate_unavailable" };

  const textValues = drawableTextValues(context.template, resolution.slots);

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

  return {
    status: "rendered",
    renderId: saved.renderId,
    replayed: saved.replayed,
    renderDigest: composed.renderDigest,
    outputStoragePath: path,
  };
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
