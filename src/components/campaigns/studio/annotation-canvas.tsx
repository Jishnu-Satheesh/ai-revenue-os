"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Loader2, ShieldAlert, Trash2 } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MAX_PLATE_ANNOTATIONS } from "@/domain/campaigns/plate-edit";
import type { PosterStudioPlate } from "@/modules/campaigns/infrastructure/poster-studio-reader";

/**
 * Marking the parts of a picture a model may change, and only those.
 *
 * The canvas is drawn over the plate at whatever size the screen gives it, and
 * every region is converted back to the plate's own pixels before it leaves the
 * browser. That conversion matters: the platform rasterises the mask from these
 * numbers, and a region measured in CSS pixels would move the moment somebody
 * resized their window.
 *
 * Nothing here is a security boundary and it is not written as one. The regions
 * are re-admitted by the route and again by the worker, and the compositor
 * copies the parent back over every pixel outside them regardless. This is the
 * part that has to be *usable*; the part that has to be *safe* is three layers
 * down and does not trust anything this file sends it.
 */

type Region = {
  ordinal: number;
  xPct: number;
  yPct: number;
  widthPct: number;
  heightPct: number;
  instruction: string;
};

export type AnnotationCanvasProps = {
  readonly organizationId: string;
  readonly campaignId: string;
  readonly bundleVersionId: string;
  readonly bundleDigest: string;
  readonly plate: PosterStudioPlate;
};

export function AnnotationCanvas(props: AnnotationCanvasProps) {
  const surface = useRef<HTMLDivElement | null>(null);
  /**
   * The size the browser decoded, which is the size the worker will composite
   * in. `campaign_assets` records a size too, and it has not always been a
   * measurement -- generated assets declared 1080x1080 for bytes that are
   * 1024x1024 -- so scaling by the row would hand the worker regions in a
   * coordinate space the image does not have. The row is the fallback for the
   * moment before the picture loads, not the authority.
   */
  const [natural, setNatural] = useState<{ widthPx: number; heightPx: number } | null>(null);
  const [regions, setRegions] = useState<Region[]>([]);
  const [drawing, setDrawing] = useState<{ xPct: number; yPct: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  function pointAt(event: React.PointerEvent): { xPct: number; yPct: number } | null {
    const box = surface.current?.getBoundingClientRect();
    if (!box || box.width === 0 || box.height === 0) return null;
    return {
      xPct: (event.clientX - box.left) / box.width,
      yPct: (event.clientY - box.top) / box.height,
    };
  }

  function start(event: React.PointerEvent) {
    if (regions.length >= MAX_PLATE_ANNOTATIONS) {
      setWarning(`An edit may mark at most ${MAX_PLATE_ANNOTATIONS} regions.`);
      return;
    }
    const point = pointAt(event);
    if (point) setDrawing(point);
  }

  function finish(event: React.PointerEvent) {
    const from = drawing;
    setDrawing(null);
    if (!from) return;
    const to = pointAt(event);
    if (!to) return;

    const xPct = Math.min(from.xPct, to.xPct);
    const yPct = Math.min(from.yPct, to.yPct);
    const widthPct = Math.abs(to.xPct - from.xPct);
    const heightPct = Math.abs(to.yPct - from.yPct);

    // A click is not a region. Refusing it here saves a round trip to a route
    // that would refuse it anyway with `region_too_small`.
    if (widthPct < 0.02 || heightPct < 0.02) return;

    setWarning(null);
    setRegions((current) => [
      ...current,
      { ordinal: current.length + 1, xPct, yPct, widthPct, heightPct, instruction: "" },
    ]);
  }

  function remove(ordinal: number) {
    // Ordinals must stay 1..n with no gaps: the database replays an edit in
    // that order, and a gap is refused rather than renumbered silently.
    setRegions((current) =>
      current
        .filter((region) => region.ordinal !== ordinal)
        .map((region, index) => ({ ...region, ordinal: index + 1 })),
    );
  }

  const plateWidthPx = natural?.widthPx ?? props.plate.widthPx;
  const plateHeightPx = natural?.heightPx ?? props.plate.heightPx;

  async function submit() {
    if (regions.length === 0) return;
    if (regions.some((region) => region.instruction.trim() === "")) {
      setWarning("Every marked region needs an instruction, or it asks the model for nothing.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(
        `/api/organizations/${props.organizationId}/campaigns/${props.campaignId}/plate-edits`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            bundleVersionId: props.bundleVersionId,
            bundleDigest: props.bundleDigest,
            parentPlateAssetId: props.plate.assetId,
            annotations: regions.map((region) => ({
              ordinal: region.ordinal,
              // Back to the plate's own pixels. The mask is rasterised from
              // these, so a browser-sized number here would move the mask.
              bounds: {
                xPx: Math.round(region.xPct * plateWidthPx),
                yPx: Math.round(region.yPct * plateHeightPx),
                widthPx: Math.max(1, Math.round(region.widthPct * plateWidthPx)),
                heightPx: Math.max(1, Math.round(region.heightPct * plateHeightPx)),
              },
              instruction: region.instruction.trim(),
            })),
            idempotencyKey: `edit-${props.plate.assetId}-${Date.now()}`,
          }),
        },
      );
      const body = await response.json();
      if (!response.ok) {
        toast.error(body?.error?.message ?? "The edit could not be queued.");
        return;
      }
      if (body.invalidatesApproval) {
        toast.warning("This edit withdraws the approval that stood against this version.");
      } else {
        toast.success("Editing. A new version will carry the result.");
      }
      setRegions([]);
    } catch {
      toast.error("The edit could not be queued. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="edit-heading" className="flex flex-col gap-3">
      <h2 id="edit-heading" className="text-sm font-medium">
        Edit the picture
      </h2>

      <Alert>
        <ShieldAlert />
        <AlertTitle>An edit makes a new version</AlertTitle>
        <AlertDescription>
          The edited picture is a different thing to publish, so it becomes a new version with a new
          digest. Any approval standing against this version stops applying — you will be told
          before it happens, not after.
        </AlertDescription>
      </Alert>

      <div
        ref={surface}
        onPointerDown={start}
        onPointerUp={finish}
        className="relative w-full max-w-xl touch-none overflow-hidden rounded-lg border select-none"
      >
        {props.plate.previewUrl ? (
          <Image
            src={props.plate.previewUrl}
            alt="The picture this campaign composes over. Drag to mark a region to change."
            width={props.plate.widthPx}
            height={props.plate.heightPx}
            className="pointer-events-none h-auto w-full"
            unoptimized
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                setNatural({ widthPx: img.naturalWidth, heightPx: img.naturalHeight });
              }
            }}
          />
        ) : (
          <div className="flex aspect-square items-center justify-center p-6 text-center text-sm text-muted-foreground">
            The picture could not be signed for viewing, so it cannot be marked up here.
          </div>
        )}

        {regions.map((region) => (
          <span
            key={region.ordinal}
            aria-hidden
            className="pointer-events-none absolute border-2 border-primary bg-primary/20"
            style={{
              left: `${region.xPct * 100}%`,
              top: `${region.yPct * 100}%`,
              width: `${region.widthPct * 100}%`,
              height: `${region.heightPct * 100}%`,
            }}
          >
            <span className="absolute -top-px -left-px bg-primary px-1 text-xs text-primary-foreground">
              {region.ordinal}
            </span>
          </span>
        ))}
      </div>

      <p className="text-xs text-muted-foreground">
        Drag a box over the part you want changed. Nothing outside your boxes can change — the
        platform copies the original back over every other pixel, whatever the model returns.
      </p>

      {warning ? (
        <Alert variant="destructive">
          <ShieldAlert />
          <AlertDescription>{warning}</AlertDescription>
        </Alert>
      ) : null}

      {regions.map((region) => (
        <div key={region.ordinal} className="flex items-end gap-2">
          <div className="flex flex-1 flex-col gap-1">
            <Label htmlFor={`region-${region.ordinal}`}>Region {region.ordinal}</Label>
            <Input
              id={`region-${region.ordinal}`}
              value={region.instruction}
              maxLength={500}
              placeholder="Make the curry look less orange."
              onChange={(event) =>
                setRegions((current) =>
                  current.map((entry) =>
                    entry.ordinal === region.ordinal
                      ? { ...entry, instruction: event.target.value }
                      : entry,
                  ),
                )
              }
            />
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove region ${region.ordinal}`}
            onClick={() => remove(region.ordinal)}
          >
            <Trash2 />
          </Button>
        </div>
      ))}

      <div>
        <Button type="button" disabled={busy || regions.length === 0} onClick={submit}>
          {busy ? <Loader2 className="animate-spin" /> : null}
          Apply this edit
        </Button>
      </div>
    </section>
  );
}
