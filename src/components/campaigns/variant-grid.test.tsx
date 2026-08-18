// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { VariantGrid, type VariantCard } from "@/components/campaigns/variant-grid";

afterEach(cleanup);

function variant(overrides: Partial<VariantCard> = {}): VariantCard {
  return {
    id: "aa000000-0000-4000-8000-000000000001",
    directionId: "d0000000-0000-4000-8000-000000000002",
    directionName: "Contribution-led",
    directionKind: "evidence_led",
    ordinal: 1,
    state: "draft",
    hook: "Two courses, one price",
    caption: "Lunch that pays for itself.",
    callToAction: "Book a table",
    hashtags: ["#lunchdeal"],
    channel: "instagram",
    placement: "feed_image",
    previewUrl: "https://example.test/a.png",
    ...overrides,
  };
}

function renderGrid(variants: readonly VariantCard[], remaining: Record<string, number> = {}) {
  return render(<VariantGrid variants={variants} remaining={remaining} />);
}

describe("the grid shows what an approval actually produced", () => {
  it("says nothing has been produced rather than showing an empty grid", () => {
    renderGrid([]);

    expect(screen.getByText(/no variants yet/i)).toBeInTheDocument();
  });

  it("groups variants under the direction they vary", () => {
    renderGrid([variant(), variant({ id: "aa000000-0000-4000-8000-000000000002", ordinal: 2 })]);

    expect(screen.getByText("Contribution-led")).toBeInTheDocument();
    expect(screen.getByText(/2 produced/i)).toBeInTheDocument();
  });

  it("states the room left rather than leaving it to be inferred", () => {
    renderGrid([variant()], { "d0000000-0000-4000-8000-000000000002": 3 });

    expect(screen.getByText(/3 more allowed/i)).toBeInTheDocument();
  });

  it("says plainly when an approval has no room left", () => {
    renderGrid([variant()], { "d0000000-0000-4000-8000-000000000002": 0 });

    expect(screen.getByText(/no more allowed under this approval/i)).toBeInTheDocument();
  });

  it("labels an image that cannot be shown instead of rendering a broken one", () => {
    renderGrid([variant({ previewUrl: null })]);

    expect(screen.getByText(/preview unavailable/i)).toBeInTheDocument();
  });

  it("uses the hook as alt text, so the picture is described by its own words", () => {
    renderGrid([variant()]);

    expect(screen.getByAltText("Two courses, one price")).toBeInTheDocument();
  });
});

describe("a state that will carry provider truth never reads as success", () => {
  it("does not present an unpublished variant as published", () => {
    renderGrid([variant({ state: "draft" })]);
    const card = within(screen.getByRole("listitem"));

    expect(card.getByText("Draft")).toBeInTheDocument();
    expect(card.queryByText("Published")).not.toBeInTheDocument();
  });

  it("distinguishes an unknown outcome from a failure", () => {
    // A retry here is how something publishes twice. The wording has to send
    // an operator to reconciliation, not to a retry button.
    renderGrid([variant({ state: "provider_outcome_unknown" })]);
    const card = within(screen.getByRole("listitem"));

    expect(card.getByText(/outcome unknown/i)).toBeInTheDocument();
    expect(card.getByText(/not known whether this reached the provider/i)).toBeInTheDocument();
    expect(card.queryByText(/^Failed$/)).not.toBeInTheDocument();
  });

  it("says an automatic pause can only be undone by a person", () => {
    renderGrid([variant({ state: "paused_by_agent" })]);
    const card = within(screen.getByRole("listitem"));

    expect(card.getByText(/paused automatically/i)).toBeInTheDocument();
    expect(card.getByText(/only a person can start it again/i)).toBeInTheDocument();
  });

  it("gives every state its own words rather than falling back to raw text", () => {
    const states: VariantCard["state"][] = [
      "draft",
      "scheduled",
      "published",
      "paused_by_agent",
      "paused_by_operator",
      "failed",
      "provider_outcome_unknown",
    ];

    for (const state of states) {
      cleanup();
      renderGrid([variant({ state })]);
      // A state missing from the map would render as a database string.
      expect(screen.queryByText(state)).not.toBeInTheDocument();
    }
  });
});
