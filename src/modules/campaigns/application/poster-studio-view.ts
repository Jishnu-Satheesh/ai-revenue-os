import { templateAvailability, resolvePosterSlots } from "@/domain/campaigns/poster-slots";
import type {
  PosterTemplateAvailability,
  ResolvedPosterSlot,
} from "@/domain/campaigns/poster-slots";
import { RENDERABLE_SCRIPTS, type RenderableScript } from "@/domain/campaigns/poster-template";
import type { PosterLayout, PosterTemplate } from "@/domain/campaigns/poster-template";
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
  /**
   * Exactly what `evaluateCreativeVerification` recorded, passed through
   * untouched. The surface reports it rather than summarising it: a panel that
   * decided for itself what "verified" meant would be a second opinion nobody
   * asked for, sitting where the first one belongs.
   */
  readonly verification: Readonly<Record<string, unknown>>;
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
export type PosterStudioAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly reason: "missing_slots";
      readonly missingSlots: readonly {
        readonly slot: string;
        readonly reason: string;
      }[];
    }
  | {
      /**
       * The template draws a placement this campaign wrote no copy for -- a
       * story template against a campaign that only has feed copy.
       *
       * Returned rather than filtered out, which is the harder implementation
       * and the better product. A story template that simply vanishes leaves an
       * operator hunting for it; one that says "this campaign has no story
       * copy" tells them what would have to change.
       */
      readonly available: false;
      readonly reason: "placement_not_in_campaign";
      readonly placement: CampaignPlacement;
    };

export type PosterStudioOffer = {
  readonly directionId: string;
  readonly templateKey: string;
  readonly templateVersion: number;
  /** Null when no copy exists for this template's placement. */
  readonly channel: CampaignChannel | null;
  readonly placement: CampaignPlacement;
  readonly canvasWidthPx: number;
  readonly canvasHeightPx: number;
  readonly availability: PosterStudioAvailability;
  /** Exactly what would be drawn, so the picker can show it before rendering. */
  readonly slots: readonly ResolvedPosterSlot[];
  /**
   * The template's own geometry — text boxes, safe area, plate crop.
   *
   * Carried to the client so the Studio preview can place text using the same
   * boxes and the same fitting rule the compositor uses, rather than a second
   * layout invented in the browser. It stays a preview: the browser measures
   * text with its own rasterizer, so sizes land close but not identical, and
   * the surface says so. Two layout implementations that drift silently would
   * be worse than no preview at all.
   */
  readonly layout: PosterLayout;
  /**
   * Which record in this direction's `copy` array the slots were resolved from,
   * and the words it holds.
   *
   * Carried because editing a poster's headline is not a poster operation — it
   * is an edit to the approved copy the poster quotes, and `operatorEditSchema`
   * takes the whole record rather than a patch. Without the index the Studio
   * could show the words but not offer to change them, which would mean an
   * operator reading a headline they must go somewhere else to fix.
   *
   * Null for a template whose placement this campaign wrote no copy for; there
   * is no record to point at.
   */
  readonly copyIndex: number | null;
  readonly copy: PosterStudioCopy | null;
};

/** The editable words behind a poster's slots, as `operatorEditSchema` wants them. */
export type PosterStudioCopy = {
  readonly hook: string;
  readonly caption: string;
  readonly callToAction: string;
  readonly timingRationale: string;
};

export type PosterStudioDirection = {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  /** The manifest asset key of the plate this direction composes over. */
  readonly plateAssetKey: string;
  /** Why this treatment could move the registered outcome. */
  readonly rationale: string;
  /**
   * Soft brand conventions this direction knowingly departs from.
   *
   * The nearest thing the manifest holds to a written negative rule, and it is
   * governed: a departure nobody wrote down is a departure nobody reviewed.
   */
  readonly softConventionDepartures: readonly string[];
};

export type PosterStudioView = {
  readonly campaignId: string;
  readonly bundleVersionId: string;
  readonly version: number;
  readonly digest: string;
  /**
   * The approved terms this poster is composed under, quoted from the manifest.
   *
   * The Studio shows them because composing creative without the objective and
   * the measure in view is how a poster drifts away from the thing it was
   * approved to do.
   */
  readonly objective: string;
  readonly measurement: {
    readonly primaryMetricKey: string;
    readonly outcomeWindowDays: number;
    readonly baselineSource: string;
  };
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

/** The domain's answer, widened with the reason only this layer can see. */
function toStudioAvailability(availability: PosterTemplateAvailability): PosterStudioAvailability {
  return availability.available
    ? { available: true }
    : {
        available: false,
        reason: "missing_slots",
        missingSlots: availability.missingSlots.map((missing) => ({
          slot: missing.slot,
          reason: missing.reason,
        })),
      };
}

export function toPosterStudioView(input: PosterStudioViewInput): PosterStudioView {
  const { manifest } = input;

  const offers: PosterStudioOffer[] = [];

  for (const direction of manifest.directions) {
    for (const template of input.templates) {
      // A retired template still serves a plan that already pinned it, but it
      // is never offered as a new choice.
      if (template.state !== "active") continue;

      const matching = direction.copy.filter((copy) => copy.placement === template.placement);

      if (matching.length === 0) {
        offers.push({
          directionId: direction.id,
          templateKey: template.key,
          templateVersion: template.version,
          channel: null,
          placement: template.placement,
          canvasWidthPx: template.canvasWidthPx,
          canvasHeightPx: template.canvasHeightPx,
          availability: {
            available: false,
            reason: "placement_not_in_campaign",
            placement: template.placement,
          },
          slots: [],
          layout: template.layout,
          copyIndex: null,
          copy: null,
        });
        continue;
      }

      for (const copy of matching) {
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
          availability: toStudioAvailability(templateAvailability(template, slots)),
          slots,
          layout: template.layout,
          // The index into the direction's own array, not into the filtered
          // subset -- an edit addresses the record the manifest holds.
          copyIndex: direction.copy.indexOf(copy),
          copy: {
            hook: copy.hook,
            caption: copy.caption,
            callToAction: copy.callToAction,
            timingRationale: copy.timingRationale,
          },
        });
      }
    }
  }

  return {
    campaignId: manifest.campaignId,
    bundleVersionId: input.bundleVersionId,
    version: manifest.version,
    digest: input.digest,
    objective: manifest.objective,
    measurement: {
      primaryMetricKey: manifest.measurementPlan.primaryMetricKey,
      outcomeWindowDays: manifest.measurementPlan.outcomeWindowDays,
      baselineSource: manifest.measurementPlan.baselineSource,
    },
    scripts: manifest.posterPlan ? manifest.posterPlan.scripts : [...RENDERABLE_SCRIPTS],
    hasPosterPlan: manifest.posterPlan !== undefined,
    directions: manifest.directions.map((direction) => ({
      id: direction.id,
      name: direction.name,
      kind: direction.kind,
      plateAssetKey: direction.assetIds[0],
      rationale: direction.rationale,
      softConventionDepartures: direction.softConventionDepartures,
    })),
    offers,
    renders: input.renders,
    unreadableTemplates: input.unreadableTemplates ?? [],
  };
}
