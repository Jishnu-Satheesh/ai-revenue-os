// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SourceEvidenceDrawer } from "@/components/growth-intelligence/source-evidence-drawer";
import type { MarketWatchSignalSource } from "@/modules/growth-intelligence/application/market-watch";

const sources: MarketWatchSignalSource[] = [
  {
    url: "https://tourism.example/dubai-notice",
    publisher: "Dubai Tourism",
    sourceClass: "official",
    retrievedAt: "2026-09-01T10:00:00Z",
    publishedAt: null,
    observedAt: "2026-09-01T09:00:00Z",
  },
];

afterEach(() => {
  cleanup();
});

describe("SourceEvidenceDrawer", () => {
  it("opens a citation drawer with source metadata but no page content", () => {
    render(<SourceEvidenceDrawer sources={sources} />);

    expect(screen.queryByText("Dubai Tourism")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /view sources \(1\)/i }));

    expect(screen.getByText("Dubai Tourism")).toBeTruthy();
    const citation = screen.getByRole("link", { name: "Dubai Tourism" });
    expect(citation.getAttribute("href")).toBe("https://tourism.example/dubai-notice");
    expect(citation.getAttribute("rel")).toContain("noopener");
    expect(screen.getByText(/official/i)).toBeTruthy();
  });

  it("stays closed and quiet when there is nothing to cite", () => {
    render(<SourceEvidenceDrawer sources={[]} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders every citation when two sources share a URL", () => {
    const sharedUrl = "https://tourism.example/dubai-notice";
    render(
      <SourceEvidenceDrawer
        sources={[
          { ...sources[0]!, url: sharedUrl, publisher: "Dubai Tourism" },
          {
            ...sources[0]!,
            url: sharedUrl,
            publisher: "Dubai Tourism Mirror",
            retrievedAt: "2026-09-01T11:00:00Z",
          },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /view sources \(2\)/i }));

    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByText("Dubai Tourism")).toBeTruthy();
    expect(screen.getByText("Dubai Tourism Mirror")).toBeTruthy();
  });
});
