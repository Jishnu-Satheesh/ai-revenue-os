// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const searchState = vi.hoisted(() => ({ query: "month=2026-09" }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => `/organizations/org-1/growth-intelligence`,
  useSearchParams: () => new URLSearchParams(searchState.query),
}));

import { YourActionsTab } from "@/components/growth-intelligence/your-actions-tab";
import type { TimelineEvent } from "@/modules/growth-intelligence/application/read-model";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";

function event(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    type: "planned",
    source: {
      kind: "channel_recommendation",
      id: "60000000-0000-4000-8000-000000000006",
    },
    title: "Review the lunch menu descriptions",
    occurredAt: "2026-09-03T08:00:00.000Z",
    reason: null,
    channelId: null,
    branchId: null,
    snoozedUntil: null,
    ...overrides,
  };
}

const EVENTS: TimelineEvent[] = [
  event(),
  event({
    type: "snoozed",
    source: { kind: "channel_recommendation", id: "60000000-0000-4000-8000-000000000007" },
    title: "Compare weekend opening hours",
    occurredAt: "2026-09-04T08:00:00.000Z",
    snoozedUntil: "2026-09-10T00:00:00.000Z",
  }),
  event({
    type: "research-started",
    source: { kind: "research_pipeline", id: "30000000-0000-4000-8000-000000000003" },
    title: "Market research started — Deira",
    occurredAt: "2026-09-01T08:00:00.000Z",
  }),
];

function tab(isCurrentMonth = true) {
  return render(
    <YourActionsTab
      events={EVENTS}
      opportunities={[]}
      organizationId={ORGANIZATION}
      timeZone="Asia/Dubai"
      performanceFilters={null}
      activityMonth="2026-09"
      isCurrentMonth={isCurrentMonth}
    />,
  );
}

describe("YourActionsTab", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    searchState.query = "month=2026-09";
  });

  it("opens on the header, month navigation, and decision filters", () => {
    tab();
    expect(screen.getByRole("heading", { name: "Your actions" })).toBeTruthy();
    expect(screen.getByText(/Planned records your intention to act/)).toBeTruthy();
    expect(screen.getByText(/Activity 2026-09/)).toBeTruthy();
    for (const name of ["All", "Planned", "Acknowledged", "Snoozed", "Dismissed"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("filters the list by decision while All keeps research rows", () => {
    tab();
    expect(screen.getByText("Market research started — Deira")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Snoozed" }));
    expect(screen.getByText("Compare weekend opening hours")).toBeTruthy();
    expect(screen.queryByText("Review the lunch menu descriptions")).toBeNull();
    expect(screen.queryByText("Market research started — Deira")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(screen.getByText("Market research started — Deira")).toBeTruthy();
  });

  it("keeps the decision filter in month navigation links", () => {
    tab();
    fireEvent.click(screen.getByRole("button", { name: "Planned" }));
    expect(screen.getByRole("link", { name: "Previous month" })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/growth-intelligence?month=2026-08&decision=planned#actions`,
    );
  });

  it("offers a way back only while viewing a past month", () => {
    tab(true);
    expect(screen.queryByRole("link", { name: "Back to current month" })).toBeNull();
    cleanup();
    tab(false);
    expect(screen.getByRole("link", { name: "Back to current month" })).toBeTruthy();
  });

  it("opens on the decision named in the URL", () => {
    searchState.query = "month=2026-09&decision=snoozed";
    tab();
    expect(screen.getByRole("button", { name: "Snoozed" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Compare weekend opening hours")).toBeTruthy();
    expect(screen.queryByText("Review the lunch menu descriptions")).toBeNull();
  });

  it("falls back to All for an unknown decision in the URL", () => {
    searchState.query = "month=2026-09&decision=research-started";
    tab();
    expect(screen.getByRole("button", { name: "All" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("Market research started — Deira")).toBeTruthy();
  });
});
