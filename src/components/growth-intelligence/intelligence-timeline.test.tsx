// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { IntelligenceTimeline } from "@/components/growth-intelligence/intelligence-timeline";
import type { TimelineEvent } from "@/modules/growth-intelligence/application/read-model";

function event(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    type: "acknowledged",
    source: {
      kind: "channel_recommendation",
      id: "60000000-0000-4000-8000-000000000006",
    },
    occurredAt: "2026-09-02T08:00:00.000Z",
    reason: null,
    ...overrides,
    title: overrides.title ?? "Extend Friday hours",
  };
}

describe("IntelligenceTimeline", () => {
  afterEach(() => cleanup());

  it("renders events newest-first as handed over, with icon and text state", () => {
    render(
      <IntelligenceTimeline
        events={[
          event({ type: "snoozed", occurredAt: "2026-09-03T08:00:00.000Z" }),
          event({ type: "generated", occurredAt: "2026-09-01T08:00:00.000Z" }),
        ]}
        timeZone="Asia/Dubai"
      />,
    );
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain("Snoozed");
    expect(rows[1]!.textContent).toContain("Generated");
  });

  it("names an empty month instead of rendering a bare rail", () => {
    render(<IntelligenceTimeline events={[]} timeZone="Asia/Dubai" />);
    expect(screen.getByText(/No activity this month/)).toBeTruthy();
  });
});

describe("IntelligenceTimeline research rows", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows one row when workspace and research reads name the same transition", () => {
    const started = event({
      type: "research-started",
      source: { kind: "research_pipeline", id: "40000000-0000-4000-8000-000000000004" },
      occurredAt: "2026-09-08T06:00:00.000Z",
      title: "Market research started — Downtown",
    });
    render(<IntelligenceTimeline events={[started, { ...started }]} timeZone="Asia/Dubai" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
    expect(screen.getByText("Market research started — Downtown")).toBeTruthy();
  });

  it("labels a retried analysis without inventing progress", () => {
    render(
      <IntelligenceTimeline
        events={[
          event({
            type: "research-retried",
            source: { kind: "research_pipeline", id: "40000000-0000-4000-8000-000000000004" },
            title: "Market analysis retried — Downtown",
          }),
        ]}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText("Market analysis retried — Downtown")).toBeTruthy();
    expect(screen.getByText("Analysis retried · Market research")).toBeTruthy();
  });
});
