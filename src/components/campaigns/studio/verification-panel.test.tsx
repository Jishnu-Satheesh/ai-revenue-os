// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { VerificationPanel } from "@/components/campaigns/studio/verification-panel";
import type { PosterStudioRender } from "@/modules/campaigns/application/poster-studio-view";

afterEach(cleanup);

function baseRender(overrides: Partial<PosterStudioRender> = {}): PosterStudioRender {
  return {
    id: "d0000000-0000-4000-8000-000000000001",
    templateKey: "core_feed_centred",
    templateVersion: 1,
    script: "Latn",
    state: "rendered",
    renderDigest: "c".repeat(64),
    textValues: { caption: "Feed the whole family" },
    refusalCode: null,
    verification: {},
    outputStoragePath: "org/campaign/posters/abc.png",
    outputWidthPx: 1080,
    outputHeightPx: 1080,
    renderedAt: "2026-09-06T10:00:00.000Z",
    ...overrides,
  };
}

function refusedRender(refusalCode: string | null): PosterStudioRender {
  return baseRender({
    state: "refused",
    refusalCode,
    outputStoragePath: null,
    outputWidthPx: null,
    outputHeightPx: null,
  });
}

describe("a refused render names its reason", () => {
  it("names an overflow refusal", () => {
    render(<VerificationPanel renders={[refusedRender("text_does_not_fit")]} />);

    expect(screen.getByText("Refused before verification")).toBeInTheDocument();
    expect(screen.getByText("text_does_not_fit")).toBeInTheDocument();
    expect(screen.getByText(/do not fit their box/i)).toBeInTheDocument();
  });

  it("names a glyph refusal", () => {
    render(<VerificationPanel renders={[refusedRender("glyph_not_covered")]} />);

    expect(screen.getByText("glyph_not_covered")).toBeInTheDocument();
    expect(screen.getByText(/no letter in the selected script's font/i)).toBeInTheDocument();
  });

  it("names the free-line and template refusals", () => {
    const { rerender } = render(
      <VerificationPanel renders={[refusedRender("operator_text_refused")]} />,
    );
    expect(screen.getByText("operator_text_refused")).toBeInTheDocument();

    rerender(<VerificationPanel renders={[refusedRender("template_unavailable")]} />);
    expect(screen.getByText("template_unavailable")).toBeInTheDocument();
  });

  it("shows an unknown code verbatim rather than guessing", () => {
    render(<VerificationPanel renders={[refusedRender("some_future_code")]} />);

    expect(screen.getByText("some_future_code")).toBeInTheDocument();
    expect(screen.getByText(/does not describe further/i)).toBeInTheDocument();
  });

  it("says so when the refusal carries no code", () => {
    render(<VerificationPanel renders={[refusedRender(null)]} />);

    expect(screen.getByText(/recorded without a code/i)).toBeInTheDocument();
  });
});

describe("empty is not a pass", () => {
  it("says nothing is checked when nothing rendered", () => {
    render(<VerificationPanel renders={[]} />);

    expect(screen.getByText("Nothing checked yet")).toBeInTheDocument();
  });

  it("says no verification was recorded rather than passing", () => {
    render(<VerificationPanel renders={[baseRender({ verification: {} })]} />);

    expect(screen.getByText("No verification recorded")).toBeInTheDocument();
    expect(screen.queryByText("Checked and clear")).not.toBeInTheDocument();
  });

  it("passes a verified render", () => {
    render(
      <VerificationPanel
        renders={[
          baseRender({
            verification: {
              verified: true,
              checks: { glyphCoverage: { ran: true } },
              blocks: [],
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Checked and clear")).toBeInTheDocument();
  });
});
