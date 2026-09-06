import {
  POSTER_TEXT_SLOTS,
  type PosterTemplate,
  type PosterTextSlot,
} from "@/domain/campaigns/poster-template";
import { checkProseAgainstEvidence } from "@/domain/campaigns/derivation";
import type { VariantDerivationFailure, VariantEvidence } from "@/domain/campaigns/derivation";
import type {
  CampaignBundleManifest,
  CampaignChannel,
  CampaignPlacement,
} from "@/domain/campaigns/schemas";

/**
 * Which approved value each named box draws.
 *
 * Boxes are named the way a person composing a flyer names them -- caption,
 * body, footer, extra -- rather than by the manifest field they bind to. The
 * label is presentation; the value is governed.
 *
 * **The naming trap.** The poster slot called `caption` binds to the manifest's
 * `hook`, which is the headline. The manifest *also* has a field called
 * `caption`: the social post caption, up to 2,200 characters, which is never
 * drawn on a poster. Binding those two by name would put an entire Instagram
 * caption inside a headline box, and it would look like a deliberate choice.
 */

export type PosterSlotSource = "copy.hook" | "copy.callToAction" | "operator";

export type PosterSlotAbsenceReason =
  /** Nothing in the manifest can supply this slot. Not an operator mistake. */
  | "no_governed_source"
  /** The slot accepts operator text and none was given. */
  | "not_supplied";

export type ResolvedPosterSlot =
  | {
      readonly slot: PosterTextSlot;
      readonly value: string;
      readonly source: PosterSlotSource;
      /**
       * False only for operator-authored text. The compositor and the routes
       * must run `evaluateContentPolicy` over anything ungoverned before it is
       * drawn -- a free box that skipped content policy is where "50% off" gets
       * typed around the governance.
       */
      readonly governed: boolean;
    }
  | {
      readonly slot: PosterTextSlot;
      readonly value: null;
      readonly reason: PosterSlotAbsenceReason;
    };

export type PosterSlotResolution = {
  readonly slots: readonly ResolvedPosterSlot[];
};

export type PosterSlotInput = {
  readonly manifest: CampaignBundleManifest;
  readonly directionId: string;
  readonly channel: CampaignChannel;
  readonly placement: CampaignPlacement;
  /** Operator-authored text for the one free box. Ungoverned; policy it. */
  readonly extra?: string | null;
  /** Appended under the call to action when the organization supplies one. */
  readonly legalLine?: string | null;
};

export function resolvePosterSlots(input: PosterSlotInput): PosterSlotResolution {
  const direction = input.manifest.directions.find(
    (candidate) => candidate.id === input.directionId,
  );

  if (direction === undefined) {
    throw new Error(`No direction ${input.directionId} in this campaign version.`);
  }

  const copy = direction.copy.find(
    (candidate) => candidate.channel === input.channel && candidate.placement === input.placement,
  );

  if (copy === undefined) {
    throw new Error(
      `Direction ${input.directionId} has no copy for ${input.channel} ${input.placement}.`,
    );
  }

  const footer =
    input.legalLine === null || input.legalLine === undefined || input.legalLine.trim() === ""
      ? copy.callToAction
      : `${copy.callToAction}\n${input.legalLine.trim()}`;

  const extra = input.extra?.trim();

  const bySlot: Record<PosterTextSlot, ResolvedPosterSlot> = {
    caption: { slot: "caption", value: copy.hook, source: "copy.hook", governed: true },
    /**
     * No governed short offer line exists in the manifest today.
     * `generationPolicy.lockedOfferRef` is an internal reference key such as
     * `lunch-set-menu-2026-09`, not a sentence a customer reads, and drawing it
     * on a poster would be nonsense. `campaign_briefs.offer` is free text that
     * never reaches the manifest, and the only money-typed fields are spend
     * ceilings, which are advertising budget rather than a price.
     *
     * So the body says nothing rather than saying the wrong thing, and a
     * template that requires it is unavailable with the reason shown. Making
     * this renderable needs a governed offer line in the manifest, which is a
     * manifest change with its own approval consequences -- recorded as an open
     * item in spec 020 section 18.2 rather than improvised here.
     */
    body: { slot: "body", value: null, reason: "no_governed_source" },
    footer: { slot: "footer", value: footer, source: "copy.callToAction", governed: true },
    extra:
      extra === undefined || extra === ""
        ? { slot: "extra", value: null, reason: "not_supplied" }
        : { slot: "extra", value: extra, source: "operator", governed: false },
  };

  return { slots: POSTER_TEXT_SLOTS.map((slot) => bySlot[slot]) };
}

export type PosterTemplateAvailability =
  | { readonly available: true }
  | {
      readonly available: false;
      readonly missingSlots: readonly {
        readonly slot: PosterTextSlot;
        readonly reason: PosterSlotAbsenceReason;
      }[];
    };

/**
 * Whether this template can be offered for this campaign.
 *
 * An unavailable template is shown with its reason rather than hidden. An
 * operator wondering where a template went learns nothing from its absence, and
 * guesses -- usually wrongly -- that the platform is broken.
 */
export function templateAvailability(
  template: PosterTemplate,
  slots: readonly ResolvedPosterSlot[],
): PosterTemplateAvailability {
  const missingSlots: { slot: PosterTextSlot; reason: PosterSlotAbsenceReason }[] = [];

  for (const box of template.layout.textBoxes) {
    if (!box.required) continue;

    const resolved = slots.find((candidate) => candidate.slot === box.slot);
    if (resolved === undefined || resolved.value === null) {
      missingSlots.push({
        slot: box.slot,
        reason: resolved?.value === null ? resolved.reason : "not_supplied",
      });
    }
  }

  return missingSlots.length === 0 ? { available: true } : { available: false, missingSlots };
}

/**
 * What the one free slot is allowed to say.
 *
 * `resolvePosterSlots` marks operator text `governed: false`, which is a label,
 * not a fence. This is the fence. Spec 020 section 7.3 promises the free box
 * "passes through `evaluateContentPolicy` exactly like every other piece of
 * campaign copy" -- but that function walks a manifest's directions and hashtag
 * sets and has nothing to say about a loose string, so it cannot keep the
 * promise. The check that can is the one variant copy already answers to, and
 * it is reused here rather than reinvented.
 *
 * Without this, "50% off" typed into the free box renders onto a poster no
 * approval ever covered -- which is precisely the loophole the spec says the
 * box is not.
 */
export function checkOperatorSlotText(
  text: string,
  evidence: VariantEvidence,
): { admitted: true } | { admitted: false; failures: readonly VariantDerivationFailure[] } {
  const failures = [...checkProseAgainstEvidence(text, evidence)];

  /**
   * The free box is held to a stricter offer rule than generated copy, and the
   * difference is deliberate.
   *
   * `checkProseAgainstEvidence` refuses offer-ish language only when the
   * campaign records no offer at all. That is right for generated variant copy,
   * which is derived from the manifest and checked against it phrase by phrase.
   * It is not enough here: `lockedOfferRef` is an internal key such as
   * `lunch-set-menu-2026-09`, not a sentence a customer reads, so its mere
   * presence says nothing about whether "50% off" was ever agreed. Under the
   * shared rule alone, any campaign that records any offer would let an
   * operator type any discount onto artwork nobody approved -- which is exactly
   * the loophole this function exists to close.
   *
   * So the *words* have to be supported, by the pinned facts or by the offer
   * itself. The offer stays in the haystack because the field genuinely holds
   * a readable phrase sometimes -- "free delivery" -- and refusing that would
   * make the governed path unusable for the campaigns most likely to want a
   * poster. What no longer counts is a slug: `lunch-set-menu-2026-09` supports
   * the words "lunch set menu" and nothing else, which is exactly right.
   */
  const offerish = OPERATOR_OFFER.exec(text);
  const supported = `${evidence.factText} ${evidence.offer ?? ""}`.toLowerCase();
  if (offerish && !supported.includes(offerish[0].toLowerCase())) {
    failures.push({
      code: "invented_offer",
      detail: `The free line promises "${offerish[0]}", which neither the campaign's pinned evidence nor its recorded offer states.`,
    });
  }

  return failures.length === 0 ? { admitted: true } : { admitted: false, failures };
}

/**
 * Offer-shaped language in operator prose.
 *
 * Kept beside the check that uses it rather than shared with `derivation.ts`:
 * this list may tighten as operators find new ways to phrase a discount, and
 * tightening it must not silently start refusing generated copy that a
 * different set of guarantees already covers.
 */
const OPERATOR_OFFER =
  /\b(half[- ]price|free|discount|\d+\s*%\s*off|\d+\s*(?:aed|usd|inr)\b|bogo|buy one|two for one|complimentary|special offer|deal)\b/i;
