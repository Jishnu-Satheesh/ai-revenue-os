// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CampaignCoverFigure } from "@/components/campaigns/campaign-cover-figure";

afterEach(cleanup);

describe("CampaignCoverFigure", () => {
  it("renders the image with the requested object fit", () => {
    const { container, rerender } = render(
      <CampaignCoverFigure
        src="https://signed.example/cover"
        alt="Campaign artwork"
        fit="contain"
        fallback={<span>No art</span>}
      />,
    );
    const img = container.querySelector("img");
    expect(img).toHaveAttribute("src", "https://signed.example/cover");
    expect(img).toHaveAttribute("alt", "Campaign artwork");
    expect(img?.className).toContain("object-contain");

    rerender(
      <CampaignCoverFigure
        src="https://signed.example/cover"
        alt=""
        fit="cover"
        fallback={<span>No art</span>}
      />,
    );
    expect(container.querySelector("img")?.className).toContain("object-cover");
  });

  it("overlays the chip label on the artwork when provided", () => {
    const { container } = render(
      <CampaignCoverFigure
        src="https://signed.example/cover"
        alt="Campaign artwork"
        fit="contain"
        chip="Finished render"
        fallback={<span>No art</span>}
      />,
    );
    const chip = screen.getByText("Finished render");
    expect(chip.tagName).toBe("SPAN");
    // The chip shares its parent with the artwork image: it overlays the art
    // instead of rendering as a separate line elsewhere.
    expect(chip.parentElement?.querySelector("img")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeInTheDocument();
  });

  it("renders no chip element when the label is absent", () => {
    const { container } = render(
      <CampaignCoverFigure
        src="https://signed.example/cover"
        alt=""
        fit="cover"
        fallback={<span>No art</span>}
      />,
    );
    expect(container.querySelector("img")).toBeInTheDocument();
    expect(screen.queryByText("No art")).not.toBeInTheDocument();
  });

  it("renders the caller fallback verbatim when there is no source", () => {
    const { container } = render(
      <CampaignCoverFigure
        src={null}
        alt=""
        fit="cover"
        fallback={<span>Preview unavailable</span>}
      />,
    );
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });
});
