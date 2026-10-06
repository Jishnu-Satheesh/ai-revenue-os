// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

import { BrandAssetsSection } from "@/components/onboarding/sections/brand-assets-section";

afterEach(() => cleanup());

describe("BrandAssetsSection", () => {
  it("no longer asks where assets live", () => {
    // `assetSources` was free text naming a drive folder. Nothing read it, and
    // the Asset Library is where assets actually live.
    render(<BrandAssetsSection onSave={vi.fn(async () => {})} />);

    expect(screen.queryByText(/asset sources/i)).not.toBeInTheDocument();
    expect(screen.getByText("Brand colours")).toBeInTheDocument();
    expect(screen.getByText("Brand rules")).toBeInTheDocument();
  });

  it("sends the palette, rules and terms generation reads", async () => {
    const onSave = vi.fn<(payload: Record<string, unknown>, status: string) => Promise<void>>(
      async () => {},
    );
    render(<BrandAssetsSection onSave={onSave} />);

    fireEvent.change(screen.getByLabelText("Primary"), { target: { value: "#C8102E" } });
    fireEvent.change(screen.getByLabelText("Rule"), {
      target: { value: "Never imply a medical benefit" },
    });
    fireEvent.click(screen.getByLabelText(/absolute/i));
    fireEvent.click(screen.getByRole("button", { name: /add rule/i }));
    fireEvent.change(screen.getByLabelText("Words never to use"), {
      target: { value: "best in dubai" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add words never to use/i }));
    fireEvent.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [payload] = onSave.mock.calls[0];
    // The exact keys `guidelinesFromBrandAssets` promotes. A rename here
    // silently stops the promotion without failing anything else.
    expect(payload.palette).toEqual({ primary: "#c8102e" });
    expect(payload.brandRules).toEqual([
      { text: "Never imply a medical benefit", strength: "hard" },
    ]);
    expect(payload.restrictedTerms).toEqual(["best in dubai"]);
  });

  it("shows a failed save beside the button that was pressed", async () => {
    // The alert used to render at the top of the scrolling body. On a form
    // this long the operator is at the footer and sees nothing, so a refused
    // save reads as a save that worked.
    const onSave = vi.fn(async () => {
      throw new Error("Brand colours and rules could not be saved.");
    });
    render(<BrandAssetsSection onSave={onSave} />);

    const footer = screen.getByRole("button", { name: /save draft/i }).closest("div")
      ?.parentElement as HTMLElement;
    fireEvent.click(screen.getByRole("button", { name: /save draft/i }));

    await waitFor(() => expect(screen.getByText("Save failed")).toBeInTheDocument());
    expect(footer).toContainElement(screen.getByText("Save failed"));
    expect(screen.getByText(/could not be saved/i)).toBeInTheDocument();
  });
});
