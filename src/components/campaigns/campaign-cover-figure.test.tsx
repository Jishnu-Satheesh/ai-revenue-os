// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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

  it("flips a broken URL to the fallback when the error path is kept", () => {
    const { container } = render(
      <CampaignCoverFigure
        src="https://signed.example/broken"
        alt="Campaign artwork"
        fit="contain"
        fallback={<span>Preview unavailable</span>}
      />,
    );
    const img = container.querySelector("img");
    expect(img).toBeInTheDocument();
    fireEvent.error(img!);
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
  });

  it("threads intrinsic dimensions to the img when known", () => {
    const { container } = render(
      <CampaignCoverFigure
        src="https://signed.example/cover"
        alt="Campaign artwork"
        fit="contain"
        width={1200}
        height={800}
        fallback={<span>No art</span>}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute("width", "1200");
    expect(container.querySelector("img")).toHaveAttribute("height", "800");
  });

  describe("portfolio opt-outs (exact prior output)", () => {
    it("renders the caller img classes verbatim with no loading attribute when eager", () => {
      const { container } = render(
        <CampaignCoverFigure
          src="https://signed.example/cover"
          alt=""
          fit="cover"
          imgClassName="block h-44 w-full object-cover"
          loading="eager"
          errorFallback={false}
          fallback={<span>Preview unavailable</span>}
        />,
      );
      const img = container.querySelector("img");
      expect(img?.getAttribute("class")).toBe("block h-44 w-full object-cover");
      expect(img?.hasAttribute("loading")).toBe(false);
    });

    it("keeps rendering the img after an error when the error path is opted out", () => {
      const { container } = render(
        <CampaignCoverFigure
          src="https://signed.example/broken"
          alt=""
          fit="cover"
          imgClassName="block h-44 w-full object-cover"
          loading="eager"
          errorFallback={false}
          fallback={<span>Preview unavailable</span>}
        />,
      );
      const img = container.querySelector("img");
      expect(img).toBeInTheDocument();
      fireEvent.error(img!);
      expect(container.querySelector("img")).toBeInTheDocument();
      expect(screen.queryByText("Preview unavailable")).not.toBeInTheDocument();
    });
  });
});
