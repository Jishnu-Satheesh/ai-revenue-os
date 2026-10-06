// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { StudioPreview } from "@/components/campaigns/studio/studio-preview";
import type { ResolvedPosterSlot } from "@/domain/campaigns/poster-slots";
import type { PosterLayout, PosterTextBox } from "@/domain/campaigns/poster-template";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * jsdom has no text shaping, so `measureText` returns 0 unless it is given one.
 * A width per character is enough to exercise the real decision: the preview
 * must place text using the template's boxes and the renderer's fitting rule,
 * and must report a slot that cannot fit rather than drawing it overflowing.
 */
function stubMeasurement(widthPerCharAtSize1: number) {
  const measureText = vi.fn((text: string) => {
    const size = Number(/^(\d+(?:\.\d+)?)px/.exec(context.font)?.[1] ?? 0);
    return { width: text.length * widthPerCharAtSize1 * size };
  });
  const context = { font: "", measureText } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as RenderingContext,
  );
}

function box(overrides: Partial<PosterTextBox> = {}): PosterTextBox {
  return {
    slot: "caption",
    xPx: 100,
    yPx: 100,
    widthPx: 880,
    heightPx: 300,
    maxLines: 3,
    minFontSizePx: 24,
    maxFontSizePx: 72,
    fontSizeStepPx: 8,
    lineHeightRatio: 1.2,
    alignment: "start",
    required: true,
    ...overrides,
  };
}

function layout(boxes: readonly PosterTextBox[]): PosterLayout {
  return {
    safeArea: { topPx: 40, rightPx: 40, bottomPx: 40, leftPx: 40 },
    logoSlot: null,
    plateCropFocus: "center",
    textBoxes: [...boxes],
  };
}

function slot(value: string | null, name: PosterTextBox["slot"] = "caption"): ResolvedPosterSlot {
  return value === null
    ? { slot: name, value: null, reason: "not_supplied" }
    : { slot: name, value, source: "copy.hook", governed: true };
}

function renderPreview(props: Partial<Parameters<typeof StudioPreview>[0]> = {}) {
  return render(
    <StudioPreview
      canvasWidthPx={1080}
      canvasHeightPx={1080}
      layout={layout([box()])}
      slots={[slot("Feed the whole family")]}
      extra=""
      script="Latn"
      plateUrl="https://example.test/plate.png"
      renderedUrl={null}
      {...props}
    />,
  );
}

describe("the preview never claims to be the render", () => {
  it("labels itself a preview and says what that means", () => {
    stubMeasurement(0.5);
    renderPreview();

    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText(/not identical to it/i)).toBeInTheDocument();
  });

  it("offers before / after only once a real render exists", () => {
    stubMeasurement(0.5);
    const { rerender } = renderPreview();

    expect(screen.queryByRole("button", { name: /before \/ after/i })).not.toBeInTheDocument();

    rerender(
      <StudioPreview
        canvasWidthPx={1080}
        canvasHeightPx={1080}
        layout={layout([box()])}
        slots={[slot("Feed the whole family")]}
        extra=""
        script="Latn"
        plateUrl="https://example.test/plate.png"
        renderedUrl="https://example.test/render.png"
      />,
    );

    expect(screen.getByRole("button", { name: /before \/ after/i })).toBeInTheDocument();
  });
});

describe("the preview uses the template's own boxes", () => {
  it("places a slot at the box's position, as a share of the canvas", () => {
    stubMeasurement(0.5);
    const { container } = renderPreview({
      layout: layout([box({ xPx: 108, yPx: 216, widthPx: 540, heightPx: 108 })]),
    });

    const placed = container.querySelector<HTMLElement>('[dir="ltr"]');
    expect(placed).not.toBeNull();
    // 108/1080 and 216/1080 — the template's geometry, not a browser guess.
    expect(placed!.style.left).toBe("10%");
    expect(placed!.style.top).toBe("20%");
    expect(placed!.style.width).toBe("50%");
  });

  it("draws the free line from the field being typed, not from the saved slot", () => {
    stubMeasurement(0.5);
    renderPreview({
      layout: layout([box({ slot: "extra" })]),
      slots: [slot(null, "extra")],
      extra: "Open until 11pm",
    });

    expect(screen.getByText("Open until 11pm")).toBeInTheDocument();
  });
});

describe("text that cannot fit is reported, not drawn overflowing", () => {
  it("names the slot and the smallest size that was tried", () => {
    // Very wide glyphs: even the minimum size cannot wrap this into the box.
    stubMeasurement(4);
    renderPreview({ slots: [slot("An offer far too long for any box this template declares")] });

    expect(screen.getByText(/does not fit its box, even at 24px/i)).toBeInTheDocument();
    expect(screen.getByText(/refuses rather than\s+trimming/i)).toBeInTheDocument();
  });

  it("does not render the overflowing words as if they were laid out", () => {
    stubMeasurement(4);
    const { container } = renderPreview({ slots: [slot("An offer far too long to fit")] });

    const canvas = container.querySelector('[data-testid="studio-preview-canvas"]')!;
    expect(within(canvas as HTMLElement).queryByText(/An offer far too long/)).not.toBeInTheDocument();
    expect(within(canvas as HTMLElement).getByText("Does not fit")).toBeInTheDocument();
  });
});

describe("an unsignable picture is said to be unsignable", () => {
  it("places the text anyway and says the picture could not be signed", () => {
    stubMeasurement(0.5);
    renderPreview({ plateUrl: null });

    expect(screen.getByText(/could not be signed for viewing/i)).toBeInTheDocument();
    expect(screen.getByText("Feed the whole family")).toBeInTheDocument();
  });
});

describe("the safe area is a deliberate overlay", () => {  it("is off until asked for", () => {
    stubMeasurement(0.5);
    const { container } = renderPreview();

    expect(container.querySelector(".border-dashed")).toBeNull();
    expect(screen.getByRole("button", { name: /safe area/i })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
