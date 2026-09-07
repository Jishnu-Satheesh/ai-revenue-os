"use client";

import { useMemo, useState, useTransition } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Download,
  Link2,
  Loader2,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import { AnnotationCanvas } from "@/components/campaigns/studio/annotation-canvas";
import { VerificationPanel } from "@/components/campaigns/studio/verification-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { RenderableScript } from "@/domain/campaigns/poster-template";
import type {
  PosterStudioOffer,
  PosterStudioRender,
  PosterStudioView,
} from "@/modules/campaigns/application/poster-studio-view";
import type { PosterStudioPlate } from "@/modules/campaigns/infrastructure/poster-studio-reader";

/**
 * The Creative Studio.
 *
 * Two rules shape the whole surface.
 *
 * **Nothing usable is hidden, and nothing unusable is silent.** Every template
 * this campaign could carry is listed, and the ones it cannot are shown greyed
 * out with the reason attached. An operator who cannot find a template
 * concludes the platform is broken; one who reads "this campaign has no
 * governed offer line" learns what is actually missing.
 *
 * **The words are shown before the picture is made.** Every string a poster
 * will draw is quoted from the approved manifest, so the slot list is the
 * poster's content, and an operator can check it without spending a render.
 */

const SCRIPT_LABEL: Readonly<Record<RenderableScript, string>> = {
  Latn: "English",
  Mlym: "മലയാളം",
  Arab: "العربية",
};

/** Right to left, so the preview and the slot text read the way they will print. */
const SCRIPT_DIRECTION: Readonly<Record<RenderableScript, "ltr" | "rtl">> = {
  Latn: "ltr",
  Mlym: "ltr",
  Arab: "rtl",
};

const PLACEMENT_LABEL: Readonly<Record<string, string>> = {
  feed_image: "the feed",
  image_story: "stories",
};

const SLOT_LABEL: Readonly<Record<string, string>> = {
  caption: "Headline",
  body: "Offer line",
  footer: "Call to action",
  extra: "Free line",
};

/**
 * Written for an operator, not a log reader. Every refusal a render can record
 * is named here; an unrecognised code falls through to the code itself rather
 * than to a shrug, because a code an operator can quote is more useful than
 * "something went wrong".
 */
const REFUSAL_COPY: Readonly<Record<string, string>> = {
  text_does_not_fit:
    "The words are too long for this template's box, even at its smallest size. Nothing was truncated — shorten the copy or choose a roomier template.",
  glyph_not_covered:
    "The font for this script has no glyph for one of the characters, so it would print as an empty box. This usually means Latin letters inside Malayalam or Arabic copy.",
  template_unavailable: "That template is no longer available at the version this plan pinned.",
  region_outside_plate: "A marked region runs off the edge of the picture.",
  region_too_small: "A marked region is too small to have been meant.",
  union_too_large:
    "The marked regions cover most of the picture. That is a regeneration rather than an edit, and it is recorded as one.",
  dimensions_differ: "The model returned a picture of a different size, so it was not composited.",
  verification_unavailable:
    "A required check could not run, so the poster is held. An unknown answer is not a pass.",
};

export type PosterStudioProps = {
  readonly view: PosterStudioView;
  readonly plates: readonly PosterStudioPlate[];
  readonly renderPreviews: Readonly<Record<string, string>>;
  readonly organizationId: string;
  readonly campaignId: string;
  /** False for a viewer, who may read the Studio and produce nothing. */
  readonly canRender: boolean;
  readonly canEdit: boolean;
};

export function PosterStudio(props: PosterStudioProps) {
  const { view, plates, renderPreviews } = props;

  const [script, setScript] = useState<RenderableScript>(view.scripts[0] ?? "Latn");
  const [directionId, setDirectionId] = useState(view.directions[0]?.id ?? "");
  const [templateKey, setTemplateKey] = useState<string | null>(null);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();

  const plateByKey = useMemo(
    () => new Map(plates.map((plate) => [plate.assetKey, plate])),
    [plates],
  );

  const direction = view.directions.find((candidate) => candidate.id === directionId) ?? null;
  const plate = direction ? (plateByKey.get(direction.plateAssetKey) ?? null) : null;

  const offers = useMemo(
    () => view.offers.filter((offer) => offer.directionId === directionId),
    [view.offers, directionId],
  );

  const selected =
    offers.find((offer) => offer.templateKey === templateKey) ??
    offers.find((offer) => offer.availability.available) ??
    offers[0] ??
    null;

  const renders = useMemo(
    () =>
      view.renders.filter(
        (render) =>
          render.script === script &&
          (selected === null || render.templateKey === selected.templateKey),
      ),
    [view.renders, script, selected],
  );

  async function queueRender() {
    if (!selected || !plate) return;
    setBusy(true);
    try {
      const response = await fetch(
        `/api/organizations/${props.organizationId}/campaigns/${props.campaignId}/renders`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bundleVersionId: view.bundleVersionId,
            bundleDigest: view.digest,
            plateAssetId: plate.assetId,
            directionId: selected.directionId,
            channel: selected.channel,
            templateKey: selected.templateKey,
            templateVersion: selected.templateVersion,
            script,
            extra: extra.trim() === "" ? null : extra.trim(),
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        // The server's own words. It knows why it refused; paraphrasing here
        // would lose the reason an operator needs to act on.
        toast.error(body?.error?.message ?? "The poster could not be queued.");
        return;
      }
      // Not "this updates when it lands". Nothing here polls, and a promise the
      // page does not keep teaches an operator to distrust the rest of it.
      toast.success("Queued. Use Refresh above the posters when it lands.");
    } catch {
      toast.error("The poster could not be queued. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const shareUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}/organizations/${props.organizationId}/campaigns/${props.campaignId}/studio`;

  return (
    <div className="flex min-h-0 flex-col gap-6 lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col gap-6">
        {view.unreadableTemplates.length > 0 ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Some templates could not be read</AlertTitle>
            <AlertDescription>
              {view.unreadableTemplates.map((entry) => `${entry.key} v${entry.version}`).join(", ")}{" "}
              — the catalogue and this version of the platform disagree about what a template is.
              They are named rather than hidden so the gap is visible.
            </AlertDescription>
          </Alert>
        ) : null}

        <section aria-labelledby="direction-heading" className="flex flex-col gap-3">
          <h2 id="direction-heading" className="text-sm font-medium">
            Direction
          </h2>
          <div className="flex flex-wrap gap-2">
            {view.directions.map((entry) => (
              <Button
                key={entry.id}
                type="button"
                size="sm"
                variant={entry.id === directionId ? "default" : "outline"}
                onClick={() => setDirectionId(entry.id)}
              >
                {entry.name}
              </Button>
            ))}
          </div>
        </section>

        <section aria-labelledby="template-heading" className="flex flex-col gap-3">
          <h2 id="template-heading" className="text-sm font-medium">
            Template
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {offers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No template matches the placements this direction has copy for.
              </p>
            ) : null}
            {offers.map((offer) => (
              <TemplateCard
                key={`${offer.templateKey}:${offer.templateVersion}`}
                offer={offer}
                selected={selected?.templateKey === offer.templateKey}
                onSelect={() => setTemplateKey(offer.templateKey)}
              />
            ))}
          </div>
        </section>

        <Tabs value={script} onValueChange={(value) => setScript(value as RenderableScript)}>
          <TabsList>
            {view.scripts.map((entry) => (
              <TabsTrigger key={entry} value={entry}>
                {SCRIPT_LABEL[entry]}
              </TabsTrigger>
            ))}
          </TabsList>

          {view.scripts.map((entry) => (
            <TabsContent key={entry} value={entry} className="flex flex-col gap-4 pt-4">
              <SlotList offer={selected} script={entry} extra={extra} />

              {selected && selected.availability.available === false ? (
                <Alert>
                  <ShieldAlert />
                  <AlertTitle>This template cannot render for this campaign</AlertTitle>
                  <AlertDescription>
                    {selected.availability.reason === "placement_not_in_campaign"
                      ? `This campaign wrote no copy for ${PLACEMENT_LABEL[selected.availability.placement]}, so there are no words for this template to draw.`
                      : `${selected.availability.missingSlots
                          .map(
                            (missing) =>
                              `${SLOT_LABEL[missing.slot] ?? missing.slot}: ${
                                missing.reason === "no_governed_source"
                                  ? "nothing in the approved campaign can supply it"
                                  : "not supplied"
                              }`,
                          )
                          .join(". ")}.`}
                  </AlertDescription>
                </Alert>
              ) : null}

              <div className="flex flex-col gap-2">
                <Label htmlFor="extra">Free line (optional)</Label>
                <Input
                  id="extra"
                  value={extra}
                  maxLength={200}
                  dir={SCRIPT_DIRECTION[entry]}
                  placeholder="Open until 11pm"
                  onChange={(event) => setExtra(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  The one line you write yourself. It is checked against this campaign&apos;s
                  evidence before it can be drawn, so it cannot promise an offer the campaign never
                  recorded.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  disabled={
                    !props.canRender ||
                    busy ||
                    !plate ||
                    selected === null ||
                    selected.channel === null ||
                    selected.availability.available === false
                  }
                  onClick={queueRender}
                >
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Render this poster
                </Button>
                {!props.canRender ? (
                  <span className="text-xs text-muted-foreground">
                    Your role can read the Studio but not produce a poster.
                  </span>
                ) : null}
                {selected ? (
                  <span className="text-xs text-muted-foreground">
                    {selected.canvasWidthPx} × {selected.canvasHeightPx} · {selected.placement}
                  </span>
                ) : null}
              </div>
            </TabsContent>
          ))}
        </Tabs>

        {plate && props.canEdit ? (
          <AnnotationCanvas
            organizationId={props.organizationId}
            campaignId={props.campaignId}
            bundleVersionId={view.bundleVersionId}
            bundleDigest={view.digest}
            plate={plate}
          />
        ) : null}
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-96">
        <section aria-labelledby="renders-heading" className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 id="renders-heading" className="text-sm font-medium">
              Posters
            </h2>
            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={refreshing}
                onClick={() => startRefresh(() => router.refresh())}
              >
                {refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                Refresh
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  void navigator.clipboard?.writeText(shareUrl);
                  toast.success("Link to this campaign copied.");
                }}
              >
                <Link2 />
                Share
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Sharing links to the campaign, never to the picture. A poster URL is a signed,
            short-lived key to one file and is not a link to give anybody.
          </p>

          {renders.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing rendered for this script and template yet.
            </p>
          ) : null}

          {renders.map((render) => (
            <RenderCard
              key={render.id}
              render={render}
              previewUrl={renderPreviews[render.id] ?? null}
            />
          ))}
        </section>

        <VerificationPanel renders={renders} />
      </aside>
    </div>
  );
}

function TemplateCard(props: {
  offer: PosterStudioOffer;
  selected: boolean;
  onSelect: () => void;
}) {
  const usable = props.offer.availability.available;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      aria-pressed={props.selected}
      className={[
        "flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition",
        props.selected ? "border-primary ring-1 ring-primary" : "border-border",
        // Shown, not hidden. Dimmed and still selectable, so an operator can
        // read why it cannot be used rather than wondering where it went.
        usable ? "" : "opacity-60",
      ].join(" ")}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className="font-medium">{props.offer.templateKey.replaceAll("_", " ")}</span>
        {usable ? (
          <Badge variant="secondary">Ready</Badge>
        ) : (
          <Badge variant="outline">Unavailable</Badge>
        )}
      </span>
      <span className="text-xs text-muted-foreground">
        {props.offer.canvasWidthPx} × {props.offer.canvasHeightPx}
        {props.offer.channel ? ` · ${props.offer.channel}` : ""}
      </span>
      {props.offer.availability.available === false ? (
        <span className="text-xs text-muted-foreground">
          {props.offer.availability.reason === "placement_not_in_campaign"
            ? `No ${PLACEMENT_LABEL[props.offer.availability.placement]} copy in this campaign.`
            : `Needs ${props.offer.availability.missingSlots
                .map((missing) => SLOT_LABEL[missing.slot] ?? missing.slot)
                .join(", ")}, which this campaign does not supply.`}
        </span>
      ) : null}
    </button>
  );
}

/** The exact strings the poster will draw, in the direction it will draw them. */
function SlotList(props: {
  offer: PosterStudioOffer | null;
  script: RenderableScript;
  extra: string;
}) {
  if (!props.offer) return null;
  const direction = SCRIPT_DIRECTION[props.script];

  return (
    <dl className="flex flex-col gap-2 rounded-lg border p-3">
      {props.offer.slots.map((slot) => (
        <div key={slot.slot} className="flex flex-col gap-0.5">
          <dt className="text-xs font-medium text-muted-foreground">
            {SLOT_LABEL[slot.slot] ?? slot.slot}
          </dt>
          {/*
            The direction goes on the value and never on the explanation. Both
            are text in the same list, but only one of them is the campaign's
            own words: forcing "Not supplied." right to left moved its full stop
            to the front of the sentence, which is a bug an Arabic reader sees
            immediately and an English one does not.
          */}
          <dd className="text-sm">
            {slot.value !== null ? (
              <span dir={direction} className="block whitespace-pre-line">
                {slot.value}
              </span>
            ) : slot.slot === "extra" && props.extra.trim() !== "" ? (
              <span dir={direction} className="block whitespace-pre-line">
                {props.extra}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {"reason" in slot && slot.reason === "no_governed_source"
                  ? "Nothing in the approved campaign supplies this."
                  : "Not supplied."}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RenderCard(props: { render: PosterStudioRender; previewUrl: string | null }) {
  const { render } = props;

  if (render.state === "refused") {
    return (
      <Alert>
        <AlertTriangle />
        <AlertTitle>Refused — nothing was drawn</AlertTitle>
        <AlertDescription>
          {render.refusalCode
            ? (REFUSAL_COPY[render.refusalCode] ?? `Refused with code ${render.refusalCode}.`)
            : "Refused without a code, which should not happen."}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <figure className="flex flex-col gap-2 rounded-lg border p-3">
      {props.previewUrl ? (
        <Image
          src={props.previewUrl}
          alt={`Poster in ${SCRIPT_LABEL[render.script]} using ${render.templateKey}`}
          width={render.outputWidthPx ?? 1080}
          height={render.outputHeightPx ?? 1080}
          className="h-auto w-full rounded"
          unoptimized
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          The artwork could not be signed for viewing. The record of this render is still here.
        </p>
      )}
      <figcaption className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="size-3" />
          {render.outputWidthPx} × {render.outputHeightPx}
        </span>
        {props.previewUrl ? (
          <Button asChild variant="ghost" size="sm">
            <a href={props.previewUrl} download={`poster-${render.script}.png`}>
              <Download />
              Download
            </a>
          </Button>
        ) : null}
      </figcaption>
    </figure>
  );
}
