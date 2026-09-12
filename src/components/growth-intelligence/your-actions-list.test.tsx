// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { YourActionsList } from "@/components/growth-intelligence/your-actions-list";
import type { TimelineEvent } from "@/modules/growth-intelligence/application/read-model";

function event(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    type: "planned",
    source: {
      kind: "channel_recommendation",
      id: "60000000-0000-4000-8000-000000000006",
    },
    title: "Review the lunch menu descriptions",
    occurredAt: "2026-03-03T08:00:00.000Z",
    reason: null,
    channelId: "61000000-0000-4000-8000-000000000061",
    branchId: "62000000-0000-4000-8000-000000000062",
    snoozedUntil: null,
    ...overrides,
  };
}

const channels = new Map([["61000000-0000-4000-8000-000000000061", "Delivery A"]]);
const branches = new Map([["62000000-0000-4000-8000-000000000062", "Downtown"]]);

describe("YourActionsList", () => {
  afterEach(() => cleanup());

  it("names the item first with its scope and activity date", () => {
    render(
      <YourActionsList
        events={[event()]}
        timeZone="Asia/Dubai"
        channelNames={channels}
        branchNames={branches}
      />,
    );
    expect(screen.getByText("Review the lunch menu descriptions")).toBeTruthy();
    expect(screen.getByText(/Delivery A · Downtown/)).toBeTruthy();
    expect(screen.getByText("Marked planned")).toBeTruthy();
  });

  it("falls back to all channels and locations when the source has no single channel", () => {
    render(
      <YourActionsList
        events={[
          event({
            type: "acknowledged",
            source: { kind: "synthesized_item", id: "70000000-0000-4000-8000-000000000007" },
            title: "Review the January sales summary",
            channelId: null,
            branchId: null,
          }),
        ]}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText(/All channels · all locations/)).toBeTruthy();
    expect(screen.getByText("Acknowledged")).toBeTruthy();
  });

  it("shows the snooze horizon alongside the activity date", () => {
    render(
      <YourActionsList
        events={[
          event({
            type: "snoozed",
            title: "Compare weekend opening hours",
            occurredAt: "2026-03-04T08:00:00.000Z",
            snoozedUntil: "2026-03-10T00:00:00.000Z",
          }),
        ]}
        timeZone="Asia/Dubai"
        channelNames={channels}
        branchNames={branches}
      />,
    );
    expect(screen.getByText(/returns/)).toBeTruthy();
    expect(screen.getByText("Snoozed")).toBeTruthy();
  });

  it("keeps research rows to their own date without inventing a channel scope", () => {
    render(
      <YourActionsList
        events={[
          event({
            type: "research-started",
            source: { kind: "research_pipeline", id: "30000000-0000-4000-8000-000000000003" },
            title: "Market research started — Deira",
            channelId: null,
            branchId: null,
          }),
        ]}
        timeZone="Asia/Dubai"
      />,
    );
    expect(screen.getByText("Market research started — Deira")).toBeTruthy();
    expect(screen.queryByText(/All channels/)).toBeNull();
  });

  it("names an empty slice instead of rendering a bare card", () => {
    render(<YourActionsList events={[]} timeZone="Asia/Dubai" />);
    expect(screen.getByText(/No actions with this status yet/)).toBeTruthy();
  });
});
