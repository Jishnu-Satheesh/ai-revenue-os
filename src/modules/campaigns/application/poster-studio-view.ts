import { templateAvailability, resolvePosterSlots } from "@/domain/campaigns/poster-slots";
import type {
  PosterTemplateAvailability,
  ResolvedPosterSlot,
} from "@/domain/campaigns/poster-slots";
import { RENDERABLE_SCRIPTS, type RenderableScript } from "@/domain/campaigns/poster-template";
import type { PosterTemplate } from "@/domain/campaigns/poster-template";
import type {
  CampaignBundleManifest,
  CampaignChannel,
  CampaignPlacement,
} from "@/domain/campaigns/schemas";

/**
 * What the Studio can offer for one version, and what it cannot.
 *
 * Composed from the manifest and the template catalogue and nothing else, so it
 * is the same answer whoever asks and whenever. Deliberately pure: the reader
 * that fetches rows is separate, and this file can be reasoned about without a
 * database.
 *
 * **Unavailable templates are returned, not filtered out.** An operator who
 * cannot find a template learns nothing from its absence and concludes the
 * platform is broken; one who sees it greyed out with "this campaign has no
 * governed offer line" learns what is actually missing. Hiding is the easier
 * implementation and the worse product, and the shape here makes hiding the
 * harder option.
 */

export type PosterStudioRender = {
  readonly id: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly script: RenderableScript;
  readonly state: "rendered" | "refused";
  readonly renderDigest: string;
  readonly textValues: Readonly<Record<string, string>>;
  readonly refusalCode: string | null;
  readonly outputStoragePath: string | null;
  readonly outputWidthPx: number | null;
  readonly outputHeightPx: number | null;
  readonly renderedAt: string;
};

/**
 * One thing an operator can actually ask for: this direction, drawn by this
 * template, for the channel whose copy fits the template's placement.
 *
 * The channel is derived rather than chosen. A template declares a placement,
 * and the manifest's copy declares which channel carries that placement, so
 * offering a channel the campaign wrote no copy for would be offering a render
 * that can only refuse.
 */
export type PosterStudioOffer = {
  readonly directionId: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  readonly channel: CampaignChannel;
  readonly placement: CampaignPlacement;
  readonly canvasWidthPx: number;
  readonly canvasHeightPx: number;
  readonly availability: PosterTemplateAvailability;
  /** Exactly what would be drawn, so the picker can show it before rendering. */
  readonly slots: readonly ResolvedPosterSlot[];
};

export type PosterStudioDirection = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** The manifest asset key of the plate this direction composes over. */
  readonly plateAssetKey: string;
};

export type PosterStudioView = {
  readonly campaignId: string;
  readonly bundleVersionId: string;
  readonly version: number;
  readonly digest: string;
  /**
   * The scripts this version's poster plan names, or every renderable script
   * when it names none. A version without a plan is not "no scripts" -- nobody
   * chose, so nothing is excluded.
   */
  readonly scripts: readonly RenderableScript[];
  readonly hasPosterPlan: boolean;
  readonly directions: readonly PosterStudioDirection[];
  readonly offers: readonly PosterStudioOffer[];
  readonly renders: readonly PosterStudioRender[];
  /**
   * Templates the database returned that this code could not read. Surfaced
   * rather than dropped: a catalogue row the application cannot parse means the
   * two disagree, and silence would turn that into "the template vanished".
   */
  readonly unreadableTemplates: readonly { readonly key: string; readonly version: number }[];
};

export type PosterStudioViewInput = {
  readonly manifest: CampaignBundleManifest;
  readonly bundleVersionId: string;
  readonly digest: string;
  readonly templates: readonly PosterTemplate[];
  readonly renders: readonly PosterStudioRender[];
  readonly unreadableTemplates?: readonly { key: string; version: number }[];
  /** Appended under the call to action when the organization supplies one. */
  readonly legalLine?: string | null;
};

export function toPosterStudioView(input: PosterStudioViewInput): PosterStudioView {
  const { manifest } = input;

  const offers: PosterStudioOffer[] = [];

  for (const direction of manifest.directions) {
    for (const template of input.templates) {
      // A retired template still serves a plan that already pinned it, but it
      // is never offered as a new choice.
      if (template.state !== "active") continue;

      for (const copy of direction.copy) {
        if (copy.placement !== template.placement) continue;

        const { slots } = resolvePosterSlots({
          manifest,
          directionId: direction.id,
          channel: copy.channel,
          placement: copy.placement,
          extra: null,
          legalLine: input.legalLine ?? null,
        });

        offers.push({
          directionId: direction.id,
          templateKey: template.key,
          templateVersion: template.version,
          channel: copy.channel,
          placement: copy.placement,
          canvasWidthPx: template.canvasWidthPx,
          canvasHeightPx: template.canvasHeightPx,
          availability: templateAvailability(template, slots),
          slots,
        });
      }
    }
  }

  return {
    campaignId: manifest.campaignId,
    bundleVersionId: input.bundleVersionId,
    version: manifest.version,
    digest: input.digest,
    scripts: manifest.posterPlan ? manifest.posterPlan.scripts : [...RENDERABLE_SCRIPTS],
    hasPosterPlan: manifest.posterPlan !== undefined,
    directions: manifest.directions.map((direction) => ({
      id: direction.id,
      name: direction.name,
      kind: direction.kind,
      plateAssetKey: direction.assetIds[0],
    })),
    offers,
    renders: input.renders,
    unreadableTemplates: input.unreadableTemplates ?? [],
  };
}
