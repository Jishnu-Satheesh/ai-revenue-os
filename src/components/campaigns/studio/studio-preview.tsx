"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Maximize2, SquareDashed, ZoomIn, ZoomOut } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import type { ResolvedPosterSlot } from "@/domain/campaigns/poster-slots";
import type {
  PosterLayout,
  PosterTextBox,
  RenderableScript,
} from "@/domain/campaigns/poster-template";
import { fitTextToBox, type TextMeasure } from "@/domain/campaigns/text-fitting";

/**
 * What the poster would look like, drawn in the browser.
 *
 * This is a preview and says so on its face. It is honest for one specific
 * reason: it does not invent a layout. The boxes come from the template the
 * compositor will use, and the text is placed by `fitTextToBox` — the same
 * shrink-to-fit rule, the same candidate sizes, the same refusal — rather than
 * by a second layout written for the browser. Two implementations of "where
 * does the headline go" would drift apart silently, and the operator would
 * discover it only after approving something.
 *
 * What it cannot promise is pixel parity. The renderer draws with the pinned
 * Noto faces from `src/domain/campaigns/font-manifest.ts`; the browser measures
 * with whatever it has. Sizes land close, not identical, and Arabic and
 * Malayalam shaping can differ more than Latin does. So the label is not
 * decoration — it is the accurate description of what is on screen.
 *
 * A slot whose text does not fit is reported, never clipped. Drawing a headline
 * with its second half outside the box would show the operator a poster that
 * the renderer is going to refuse.
 */

/**
 * The families the renderer registers, named here so the preview asks for the
 * closest thing the browser has. Kept as plain strings rather than imported
 * from the manifest, which reads the font bytes through `node:crypto` and
 * cannot cross to the client. The fallbacks matter: without the Noto face
 * installed the browser substitutes, which is exactly why this is a preview.
 */
const PREVIEW_FONT: Readonly<Record<RenderableScript, string>> = {
  Latn: '"Noto Sans", ui-sans-serif, system-ui, sans-serif',
  Mlym: '"Noto Sans Malayalam", "Noto Sans", ui-sans-serif, sans-serif',
  Arab: '"Noto Sans Arabic", "Noto Sans", ui-sans-serif, sans-serif',
};

const SCRIPT_DIRECTION: Readonly<Record<RenderableScript, "ltr" | "rtl">> = {
  Latn: "ltr",
  Mlym: "ltr",
  Arab: "rtl",
};

const ALIGN_ITEMS: Readonly<Record<string, string>> = {
  start: "flex-start",
  center: "center",
  end: "flex-end",
};

const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

type FittedBox = {
  readonly box: PosterTextBox;
  readonly outcome:
    | { readonly fitted: true; readonly fontSizePx: number; readonly lines: readonly string[] }
    | { readonly fitted: false; readonly minFontSizePx: number };
};

/**
 * Measures in the poster's own pixel space.
 *
 * `measureText` returns the advance width for the font size it was given, so a
 * size expressed in poster pixels yields a width in poster pixels, comparable
 * to `box.widthPx` directly. The scale the preview happens to be displayed at
 * never enters the calculation, which is what keeps the fit verdict the same
 * whether the panel is wide or narrow.
 */
function browserMeasure(
  context: CanvasRenderingContext2D,
  script: RenderableScript,
): TextMeasure {
  return (text, fontSizePx) => {
    context.font = `${fontSizePx}px ${PREVIEW_FONT[script]}`;
    return context.measureText(text).width;
  };
}

function valueFor(
  slots: readonly ResolvedPosterSlot[],
  box: PosterTextBox,
  extra: string,
): string | null {
  const slot = slots.find((candidate) => candidate.slot === box.slot);
  if (slot?.value != null && slot.value.trim() !== "") return slot.value;
  // The free line is the one box an operator types into, so it is read from the
  // live field rather than from the saved slots — otherwise the preview lags a
  // keystroke behind the thing it is previewing.
  if (box.slot === "extra" && extra.trim() !== "") return extra;
  return null;
}

export function StudioPreview({
  canvasWidthPx,
  canvasHeightPx,
  layout,
  slots,
  extra,
  script,
  plateUrl,
  renderedUrl,
}: Readonly<{
  canvasWidthPx: number;
  canvasHeightPx: number;
  layout: PosterLayout;
  slots: readonly ResolvedPosterSlot[];
  /** The free line as it is being typed, before any save. */
  extra: string;
  script: RenderableScript;
  /** The base picture. Null when it could not be signed for viewing. */
  plateUrl: string | null;
  /** The authoritative render, when one exists, for before/after. */
  renderedUrl: string | null;
}>) {
  const [safeArea, setSafeArea] = useState(false);
  const [showRendered, setShowRendered] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [fitted, setFitted] = useState<readonly FittedBox[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const boxes = useMemo(
    () =>
      layout.textBoxes.map((box) => ({ box, value: valueFor(slots, box, extra) })),
    [layout.textBoxes, slots, extra],
  );

  /**
   * Measurement needs a canvas, so it happens after mount rather than during
   * render. The server has no `measureText`, and guessing one there would
   * produce a first paint that disagrees with the second.
   */
  useEffect(() => {
    const canvas = (canvasRef.current ??= document.createElement("canvas"));
    const context = canvas.getContext("2d");
    if (!context) {
      setFitted(null);
      return;
    }
    const measure = browserMeasure(context, script);

    setFitted(
      boxes
        .filter((entry) => entry.value !== null)
        .map(({ box, value }) => {
          const outcome = fitTextToBox(value as string, box, measure);
          return {
            box,
            outcome: outcome.fitted
              ? { fitted: true as const, fontSizePx: outcome.fontSizePx, lines: outcome.lines }
              : { fitted: false as const, minFontSizePx: outcome.minFontSizePx },
          };
        }),
    );
  }, [boxes, script]);

  const overflowing = (fitted ?? []).flatMap((entry) =>
    entry.outcome.fitted ? [] : [{ slot: entry.box.slot, minFontSizePx: entry.outcome.minFontSizePx }],
  );
  const showing = showRendered && renderedUrl ? "rendered" : "preview";
  const zoomIndex = ZOOM_STEPS.indexOf(zoom as (typeof ZOOM_STEPS)[number]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setZoom(1)}
          disabled={zoom === 1}
        >
          <Maximize2 aria-hidden="true" />
          Fit
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Zoom in"
          disabled={zoomIndex >= ZOOM_STEPS.length - 1}
          onClick={() => setZoom(ZOOM_STEPS[Math.min(zoomIndex + 1, ZOOM_STEPS.length - 1)]!)}
        >
          <ZoomIn aria-hidden="true" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Zoom out"
          disabled={zoomIndex <= 0}
          onClick={() => setZoom(ZOOM_STEPS[Math.max(zoomIndex - 1, 0)]!)}
        >
          <ZoomOut aria-hidden="true" />
        </Button>

        <Toggle
          size="sm"
          variant="outline"
          pressed={safeArea}
          onPressedChange={setSafeArea}
          aria-label="Safe area"
        >
          <SquareDashed aria-hidden="true" />
          Safe area
        </Toggle>

        {/* Offered only when there is something to compare against. A
            before/after with no "after" is a control that does nothing. */}
        {renderedUrl ? (
          <Toggle
            size="sm"
            variant="outline"
            pressed={showRendered}
            onPressedChange={setShowRendered}
            aria-label="Before / after"
          >
            <Eye aria-hidden="true" />
            {showRendered ? "Showing the render" : "Before / after"}
          </Toggle>
        ) : null}
      </div>

      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline">
          {showing === "rendered" ? "Authoritative render" : "Preview"}
        </Badge>
        {showing === "rendered"
          ? "The file the renderer produced, exactly as it was drawn."
          : "Drawn in your browser using this template's boxes and the renderer's own fitting rule. Sizes land close to the finished poster, not identical to it."}
      </p>

      {/* A neutral ground, and the poster kept upright and contained inside it
          at its own aspect ratio, so nothing is cropped by the panel. */}
      <div className="overflow-auto rounded-lg border bg-muted/40 p-4">
        <div
          className="relative mx-auto bg-background shadow-sm"
          style={{
            aspectRatio: `${canvasWidthPx} / ${canvasHeightPx}`,
            width: `${100 * zoom}%`,
            maxWidth: zoom === 1 ? "100%" : "none",
            containerType: "inline-size",
          }}
          data-testid="studio-preview-canvas"
        >
          {showing === "rendered" && renderedUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a signed,
            // short-lived Storage URL; the optimizer would cache it past expiry.
            <img
              src={renderedUrl}
              alt="The poster as the renderer drew it"
              className="absolute inset-0 size-full object-contain"
            />
          ) : (
            <>
              {plateUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- as above.
                <img
                  src={plateUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center px-4 text-center text-xs text-muted-foreground">
                  The picture could not be signed for viewing. The text below is still placed
                  where this template puts it.
                </span>
              )}

              {safeArea ? (
                <span
                  aria-hidden="true"
                  className="absolute border border-dashed border-primary/70"
                  style={{
                    left: `${(layout.safeArea.leftPx / canvasWidthPx) * 100}%`,
                    right: `${(layout.safeArea.rightPx / canvasWidthPx) * 100}%`,
                    top: `${(layout.safeArea.topPx / canvasHeightPx) * 100}%`,
                    bottom: `${(layout.safeArea.bottomPx / canvasHeightPx) * 100}%`,
                  }}
                />
              ) : null}

              {(fitted ?? []).map(({ box, outcome }) => (
                <span
                  key={box.slot}
                  dir={SCRIPT_DIRECTION[script]}
                  className="absolute flex flex-col justify-center"
                  style={{
                    left: `${(box.xPx / canvasWidthPx) * 100}%`,
                    top: `${(box.yPx / canvasHeightPx) * 100}%`,
                    width: `${(box.widthPx / canvasWidthPx) * 100}%`,
                    height: `${(box.heightPx / canvasHeightPx) * 100}%`,
                    alignItems: ALIGN_ITEMS[box.alignment] ?? "center",
                    // Container query units, so the text scales with the poster
                    // rather than needing the panel to be measured in JS.
                    fontSize: outcome.fitted
                      ? `${(outcome.fontSizePx / canvasWidthPx) * 100}cqw`
                      : undefined,
                    lineHeight: box.lineHeightRatio,
                    fontFamily: PREVIEW_FONT[script],
                  }}
                >
                  {outcome.fitted ? (
                    outcome.lines.map((line, index) => (
                      <span key={index} className="block text-white drop-shadow-sm">
                        {line}
                      </span>
                    ))
                  ) : (
                    // Not drawn at its overflowing length. The renderer will
                    // refuse this, and showing it laid out would promise a
                    // poster that is not going to exist.
                    <span className="block rounded bg-destructive/90 px-1 text-[2.5cqw] text-white">
                      Does not fit
                    </span>
                  )}
                </span>
              ))}
            </>
          )}
        </div>
      </div>

      {overflowing.length > 0 ? (
        <p className="text-xs text-destructive">
          {overflowing.length === 1
            ? `The ${overflowing[0]!.slot} does not fit its box, even at ${overflowing[0]!.minFontSizePx}px.`
            : `${overflowing.length} slots do not fit their boxes at the smallest size this template allows.`}{" "}
          Shorten the words or choose a roomier template — the renderer refuses rather than
          trimming them.
        </p>
      ) : null}
    </div>
  );
}
