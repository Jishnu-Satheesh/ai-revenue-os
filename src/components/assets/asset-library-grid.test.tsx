// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { AssetLibraryGrid, type LibraryReference } from "@/components/assets/asset-library-grid";

afterEach(cleanup);

function reference(overrides: Partial<LibraryReference> = {}): LibraryReference {
  return {
    brandAssetId: "a0000000-0000-4000-8000-000000000001",
    brandAssetVersionId: "b0000000-0000-4000-8000-000000000001",
    label: "Kingfish curry, clay pot",
    assetRole: "product",
    conditioningRoles: ["subject"],
    tags: ["fish curry"],
    scripts: ["Latn"],
    ownership: "owned",
    archivedAt: null,
    version: 2,
    previewUrl: null,
    currentVerdict: null,
    currentReasonCodes: [],
    currentReviewedAt: null,
    ...overrides,
  };
}

describe("the empty state", () => {
  it("names the one useful next action instead of describing the feature", () => {
    render(<AssetLibraryGrid references={[]} />);

    expect(screen.getByRole("heading", { name: /no references yet/i })).toBeTruthy();
    expect(screen.getByText(/upload/i)).toBeTruthy();
  });
});

describe("text the operator wrote", () => {
  it("lets Malayalam and Arabic pick their own direction", () => {
    render(
      <AssetLibraryGrid
        references={[
          reference({
            label: "കേരള മീൻ കറി",
            tags: ["മീൻ", "عرض خاص"],
            scripts: ["Mlym", "Arab"],
          }),
        ]}
      />,
    );

    // `dir="auto"` is what makes an Arabic tag read right-to-left inside an
    // otherwise left-to-right page. Hard-coding a direction breaks one script
    // or the other.
    expect(screen.getByText("കേരള മീൻ കറി").getAttribute("dir")).toBe("auto");
    expect(screen.getByText("عرض خاص").getAttribute("dir")).toBe("auto");
    expect(screen.getByText("മീൻ").getAttribute("dir")).toBe("auto");
  });
});

describe("what each card states", () => {
  it("shows the review verdict in words, and its reasons as labels", () => {
    render(
      <AssetLibraryGrid
        references={[
          reference({
            currentVerdict: "rejected",
            currentReasonCodes: ["wrong_subject", "alcohol_visible"],
            currentReviewedAt: "2026-08-25T10:00:00.000Z",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Rejected")).toBeTruthy();
    expect(screen.getByText("This is not the dish")).toBeTruthy();
    expect(screen.getByText("Alcohol is visible")).toBeTruthy();
    expect(screen.queryByText("wrong_subject")).toBeNull();
  });

  it("says a rejected reference still teaches, so it does not read as deleted", () => {
    render(<AssetLibraryGrid references={[reference({ currentVerdict: "rejected" })]} />);

    expect(screen.getByText(/still used.*what to avoid|teach|avoid/i)).toBeTruthy();
  });

  it("distinguishes work we own from a reference we admire", () => {
    render(
      <AssetLibraryGrid
        references={[
          reference({ ownership: "owned" }),
          reference({
            brandAssetId: "a0000000-0000-4000-8000-000000000002",
            brandAssetVersionId: "b0000000-0000-4000-8000-000000000002",
            ownership: "third_party",
          }),
        ]}
      />,
    );

    expect(screen.getByText("This is our own work")).toBeTruthy();
    expect(screen.getByText("A reference we admire")).toBeTruthy();
  });

  it("marks an unreviewed reference as awaiting a look, not as approved", () => {
    render(<AssetLibraryGrid references={[reference({ currentVerdict: null })]} />);

    expect(screen.getByText(/not reviewed yet/i)).toBeTruthy();
    expect(screen.queryByText("Approved")).toBeNull();
  });

  it("shows an archived reference as archived rather than hiding what it was", () => {
    render(
      <AssetLibraryGrid references={[reference({ archivedAt: "2026-08-25T10:00:00.000Z" })]} />,
    );

    expect(screen.getByText(/archived/i)).toBeTruthy();
  });
});

describe("seeing what the reference actually is", () => {
  it("shows the picture, not only its name and version", () => {
    // The signed preview reached this component and was never rendered, so a
    // card showed a label, a version number and taxonomy chips — nothing that
    // tells an operator which image they are approving.
    render(
      <AssetLibraryGrid
        references={[reference({ previewUrl: "https://signed.example/curry.png" })]}
      />,
    );

    const image = screen.getByRole("img", { name: "Kingfish curry, clay pot" });
    expect(image).toHaveAttribute("src", "https://signed.example/curry.png");
  });

  it("says the preview is unavailable rather than showing a broken image", () => {
    // A signed URL that could not be minted costs the picture and nothing
    // else, and the card must say so instead of rendering a torn-page icon.
    render(<AssetLibraryGrid references={[reference({ previewUrl: null })]} />);

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText(/preview unavailable/i)).toBeInTheDocument();
  });

  it("still shows a rejected reference's picture", () => {
    // Spec 019: rejection is not deletion. A rejected reference is routed into
    // the bounded `avoid` slot, so it is still teaching — hiding the image
    // would make an operator delete the very thing doing the work.
    render(
      <AssetLibraryGrid
        references={[
          reference({
            previewUrl: "https://signed.example/curry.png",
            currentVerdict: "rejected",
            currentReasonCodes: ["wrong_subject"],
          }),
        ]}
      />,
    );

    expect(screen.getByRole("img", { name: "Kingfish curry, clay pot" })).toBeInTheDocument();
  });

  it("keeps the platform's own wording out of one industry", () => {
    // AGENTS.md: restaurant concepts do not belong in platform-core UI. This
    // empty state told every organization to photograph a dish.
    render(<AssetLibraryGrid references={[]} />);

    expect(screen.queryByText(/dish/i)).not.toBeInTheDocument();
  });
});
