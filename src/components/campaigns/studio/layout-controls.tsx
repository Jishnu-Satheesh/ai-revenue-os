"use client";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { RenderableScript } from "@/domain/campaigns/poster-template";
import type { PosterStudioOffer } from "@/modules/campaigns/application/poster-studio-view";

/**
 * Which approved template draws this, and in which language.
 *
 * Templates this campaign cannot use are listed and dimmed with the reason
 * attached, never hidden. An operator who cannot find a story template
 * concludes the platform lost it; one who reads "this campaign wrote no story
 * copy" learns the thing that would have to change. Hiding is easier and worse.
 *
 * There is no freeform canvas here on purpose — no arbitrary layers, no
 * uploaded fonts, no free positioning. A template is an approved layout, and
 * the point of approving one is that what publishes is the shape somebody
 * signed off rather than whatever the last editor dragged around.
 */

const SCRIPT_LABEL: Readonly<Record<RenderableScript, string>> = {
  Latn: "English",
  Mlym: "മലയാളം",
  Arab: "العربية",
};

const PLACEMENT_LABEL: Readonly<Record<string, string>> = {
  feed_image: "the feed",
  image_story: "stories",
};

const SLOT_LABEL: Readonly<Record<string, string>> = {
  caption: "a headline",
  body: "an offer line",
  footer: "a call to action",
  extra: "a free line",
};

/** Why this template cannot draw this campaign, in the operator's terms. */
function unavailableReason(offer: PosterStudioOffer): string | null {
  if (offer.availability.available) return null;
  if (offer.availability.reason === "placement_not_in_campaign") {
    return `This campaign wrote no copy for ${PLACEMENT_LABEL[offer.availability.placement] ?? offer.availability.placement}.`;
  }
  return `Needs ${offer.availability.missingSlots
    .map((missing) => SLOT_LABEL[missing.slot] ?? missing.slot)
    .join(" and ")}, which this campaign does not supply.`;
}

export function LayoutControls({
  offers,
  selected,
  scripts,
  script,
  onSelectTemplate,
  onSelectScript,
}: Readonly<{
  offers: readonly PosterStudioOffer[];
  selected: PosterStudioOffer | null;
  scripts: readonly RenderableScript[];
  script: RenderableScript;
  onSelectTemplate: (templateKey: string) => void;
  onSelectScript: (script: RenderableScript) => void;
}>) {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label>Language</Label>
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={script}
          onValueChange={(value) => {
            if (value) onSelectScript(value as RenderableScript);
          }}
          className="flex-wrap justify-start"
        >
          {scripts.map((entry) => (
            <ToggleGroupItem key={entry} value={entry} aria-label={SCRIPT_LABEL[entry]}>
              {SCRIPT_LABEL[entry]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-2">
        <Label>Template</Label>
        {offers.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No template matches the placements this direction has copy for.
          </p>
        ) : null}

        <ul className="flex flex-col gap-2">
          {offers.map((offer) => {
            const reason = unavailableReason(offer);
            const isSelected = selected?.templateKey === offer.templateKey;

            return (
              <li key={`${offer.templateKey}:${offer.templateVersion}`}>
                <button
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => onSelectTemplate(offer.templateKey)}
                  className={[
                    "flex w-full flex-col items-start gap-1 rounded-lg border p-3 text-left transition",
                    isSelected ? "border-primary ring-1 ring-primary" : "border-border",
                    // Dimmed and still selectable, so the reason can be read.
                    reason ? "opacity-60" : "",
                  ].join(" ")}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-medium">
                      {offer.templateKey.replaceAll("_", " ")}
                    </span>
                    <Badge variant={reason ? "outline" : "secondary"} className="shrink-0">
                      {reason ? "Unavailable" : "Ready"}
                    </Badge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {offer.canvasWidthPx} × {offer.canvasHeightPx}
                    {offer.channel ? ` · ${offer.channel}` : ""} · {offer.placement}
                  </span>
                  {reason ? (
                    <span className="text-xs text-muted-foreground">{reason}</span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected ? (
        <p className="text-xs text-muted-foreground">
          Text sits where this template puts it. Alignment and crop belong to the approved layout,
          so they are shown on the canvas rather than offered as free controls here.
        </p>
      ) : null}
    </div>
  );
}
