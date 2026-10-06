import type { CampaignPlacement, CampaignPosterPlan } from "@/domain/campaigns/schemas";
import type { RenderableScript } from "@/domain/campaigns/poster-template";

/**
 * Which finished-output slot a Studio render request names.
 *
 * A deliverable is "the English feed post for this campaign" -- channel,
 * placement, language, format, ordinal -- and a render worker must never guess
 * any of it. The Studio request carries a template key, a template version and
 * a script; this module resolves those against the approved poster plan into
 * the identity the render records verbatim.
 *
 * Two closed maps do the translating, and both are total over their enums, so
 * there is no default to fall back on and nothing to guess:
 *
 * - the script picker is already labelled "Language" in the Studio, and each
 *   renderable script draws one language;
 * - each campaign placement has one short format name, matching the
 *   format/language/count vocabulary the proposal plan already uses.
 *
 * The placement itself is the plan entry's own value, not a re-derivation: the
 * plan pairs each placement with its pinned template, so a request naming a
 * template names its placement exactly once, or names nothing the plan holds.
 */

export const SCRIPT_LANGUAGE: Readonly<Record<RenderableScript, string>> = {
  Latn: "en",
  Mlym: "ml",
  Arab: "ar",
};

export const PLACEMENT_FORMAT: Readonly<Record<CampaignPlacement, string>> = {
  feed_image: "feed",
  image_story: "story",
};

export const POSTER_DELIVERABLE_ORDINAL = 1 as const;

export type PosterDeliverableIdentityReason =
  | "poster_plan_missing"
  | "template_not_in_poster_plan"
  | "script_not_in_poster_plan";

export class PosterDeliverableIdentityError extends Error {
  readonly reason: PosterDeliverableIdentityReason;

  constructor(reason: PosterDeliverableIdentityReason, message: string) {
    super(message);
    this.name = "PosterDeliverableIdentityError";
    this.reason = reason;
  }
}

export type PosterDeliverableIdentity = {
  readonly placement: string;
  readonly language: string;
  readonly format: string;
  readonly ordinal: number;
};

/**
 * Resolves the deliverable identity for one render request.
 *
 * Throws a named error rather than returning a best guess. An unknown template
 * or script means the request drifted from what was approved -- a stale tab, a
 * retired template, a hand-built call -- and rendering it under a neighbouring
 * identity would file the output where nobody will review it.
 */
export function resolvePosterDeliverableIdentity(input: {
  posterPlan: CampaignPosterPlan | null | undefined;
  templateKey: string;
  templateVersion: number;
  script: RenderableScript;
}): PosterDeliverableIdentity {
  const plan = input.posterPlan ?? null;
  if (plan === null) {
    throw new PosterDeliverableIdentityError(
      "poster_plan_missing",
      "This version names no poster plan, so there is nothing to render against. Save a poster plan first, then render again.",
    );
  }

  const entry = plan.placements.find(
    (placement) =>
      placement.templateKey === input.templateKey &&
      placement.templateVersion === input.templateVersion,
  );
  if (!entry) {
    throw new PosterDeliverableIdentityError(
      "template_not_in_poster_plan",
      `Template ${input.templateKey} version ${input.templateVersion} is not in this version's poster plan. Reload the Studio and pick a planned template.`,
    );
  }

  if (!plan.scripts.includes(input.script)) {
    throw new PosterDeliverableIdentityError(
      "script_not_in_poster_plan",
      `Script ${input.script} is not in this version's poster plan. Render in a planned script instead.`,
    );
  }

  return {
    placement: entry.placement,
    language: SCRIPT_LANGUAGE[input.script],
    format: PLACEMENT_FORMAT[entry.placement],
    ordinal: POSTER_DELIVERABLE_ORDINAL,
  };
}
