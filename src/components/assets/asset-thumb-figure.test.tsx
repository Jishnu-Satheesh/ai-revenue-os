// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssetLibraryGrid, type LibraryReference } from "@/components/assets/asset-library-grid";
import { AssetThumbFigure } from "@/components/assets/asset-thumb-figure";

afterEach(cleanup);

function renderFigure(props: {
  src?: string | null;
  alt?: string;
  width?: number;
  height?: number;
  loading?: "lazy" | "eager";
  imgClassName?: string;
  forgetFailureOnSrcChange?: boolean;
} = {}) {
  return render(
    <AssetThumbFigure
      src="https://signed.example/thumb.png"
      alt="Ramadan poster render"
      width={1200}
      height={800}
      fallback={<span>Preview unavailable</span>}
      {...props}
    />,
  );
}

describe("AssetThumbFigure", () => {
  it("renders the signed preview with its dimensions, lazily, and no wrapper of its own", () => {
    const { container } = renderFigure({ imgClassName: "size-full object-contain" });

    const image = screen.getByRole("img", { name: "Ramadan poster render" });
    expect(image).toHaveAttribute("src", "https://signed.example/thumb.png");
    expect(image).toHaveAttribute("width", "1200");
    expect(image).toHaveAttribute("height", "800");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("class", "size-full object-contain");
    // The caller owns the frame: the primitive returns the img itself, so it
    // is the render container's only child.
    expect(container.firstChild?.nodeName).toBe("IMG");
    expect(screen.queryByText("Preview unavailable")).not.toBeInTheDocument();
  });

  it("renders the caller fallback — never an img — when there is no src", () => {
    renderFigure({ src: null });

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  });

  it("flips a broken URL to the fallback on error", () => {
    renderFigure();

    fireEvent.error(screen.getByRole("img", { name: "Ramadan poster render" }));

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  });

  it("renders a refreshed src after a failure by default (home's renewed signed URLs)", () => {
    const { rerender } = renderFigure();

    fireEvent.error(screen.getByRole("img", { name: "Ramadan poster render" }));
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();

    rerender(
      <AssetThumbFigure
        src="https://signed.example/thumb-refreshed"
        alt="Ramadan poster render"
        width={1200}
        height={800}
        fallback={<span>Preview unavailable</span>}
      />,
    );

    expect(screen.getByRole("img", { name: "Ramadan poster render" })).toHaveAttribute(
      "src",
      "https://signed.example/thumb-refreshed",
    );
  });

  it("keeps a sticky failure for a refreshed src when opted out (the library's prior behavior)", () => {
    const { rerender } = renderFigure({ forgetFailureOnSrcChange: false });

    fireEvent.error(screen.getByRole("img", { name: "Ramadan poster render" }));

    rerender(
      <AssetThumbFigure
        src="https://signed.example/thumb-refreshed"
        alt="Ramadan poster render"
        width={1200}
        height={800}
        forgetFailureOnSrcChange={false}
        fallback={<span>Preview unavailable</span>}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("Preview unavailable")).toBeInTheDocument();
  });

  it("omits the loading attribute when eager", () => {
    renderFigure({ loading: "eager", imgClassName: undefined });

    expect(screen.getByRole("img", { name: "Ramadan poster render" })).not.toHaveAttribute(
      "loading",
    );
  });
});

describe("AssetLibraryGrid adoption (donor zero-change pin)", () => {
  function reference(overrides: Partial<LibraryReference> = {}): LibraryReference {
    return {
      brandAssetId: "a0000000-0000-4000-8000-000000000001",
      brandAssetVersionId: "b0000000-0000-4000-8000-000000000001",
      label: "Kingfish curry, clay pot",
      assetRole: "product",
      conditioningRoles: [],
      tags: [],
      scripts: ["Latn"],
      ownership: "owned",
      archivedAt: null,
      version: 2,
      previewUrl: "https://signed.example/curry.png",
      currentVerdict: null,
      currentReasonCodes: [],
      currentReviewedAt: null,
      ...overrides,
    };
  }

  it("renders the library preview img with the exact prior attributes", () => {
    render(<AssetLibraryGrid references={[reference()]} />);

    const image = screen.getByRole("img", { name: "Kingfish curry, clay pot" });
    expect(image).toHaveAttribute("src", "https://signed.example/curry.png");
    expect(image).toHaveAttribute("loading", "lazy");
    expect(image).toHaveAttribute("class", "size-full object-contain");
    expect(image).not.toHaveAttribute("width");
    expect(image).not.toHaveAttribute("height");
  });

  it("keeps the library's own unavailable fallback when there is no preview URL", () => {
    render(<AssetLibraryGrid references={[reference({ previewUrl: null })]} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/preview unavailable/i)).toBeInTheDocument();
  });
});
