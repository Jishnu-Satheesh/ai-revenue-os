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
