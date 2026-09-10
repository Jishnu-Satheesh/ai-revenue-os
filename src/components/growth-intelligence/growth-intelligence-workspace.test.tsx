// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh, push }),
  usePathname: () => `/organizations/org-1/growth-intelligence`,
  useSearchParams: () => new URLSearchParams("month=2026-09"),
}));

import { GrowthIntelligenceWorkspace } from "@/components/growth-intelligence/growth-intelligence-workspace";
import type { GrowthIntelligenceView } from "@/modules/growth-intelligence/application/read-model";
import type {
  BusinessPerformanceCardView,
  PerformanceFilterState,
} from "@/modules/analysis/application/channels-overview";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";

function view(overrides: Partial<GrowthIntelligenceView> = {}): GrowthIntelligenceView {
  return {
    activityMonth: "2026-09",
    timeZone: "Asia/Dubai",
    priorityActions: { opportunities: [], recommendations: [] },
    insights: [],
    dataGaps: [],
    timeline: [],
    counts: { opportunities: 0, recommendations: 0, insights: 0, dataGaps: 0 },
    ...overrides,
  };
}

function defaultFilters(overrides: Partial<PerformanceFilterState> = {}): PerformanceFilterState {
  return {
    from: "2026-02-01",
    to: "2026-02-28",
    resolved: { windowStart: "2026-02-01", windowEnd: "2026-02-28", grain: "month" },
    channelId: null,
    branchId: null,
    channels: [{ id: "ch-1", displayName: "Talabat" }],
    branches: [{ id: "br-1", name: "Downtown" }],
    segments: [{ start: "2026-01-01", end: "2026-02-28" }],
    coverageWindows: [
      {
        windowStart: "2026-01-01",
        windowEnd: "2026-02-28",
        grain: "month",
        governedRowCount: 12,
      },
    ],
    today: "2026-09-09",
    ...overrides,
  };
}

function workspace(
  currentView = view(),
  isCurrentMonth = true,
  filters: PerformanceFilterState | null = defaultFilters(),
) {
  return render(
    <GrowthIntelligenceWorkspace
      view={currentView}
      organizationId={ORGANIZATION}
      canManage
      isCurrentMonth={isCurrentMonth}
      marketWatch={<section aria-label="Market Watch" />}
      performanceCard={null}
      fetchedAt="2026-09-07T09:00:00.000Z"
      performanceFilters={filters}
    />,
  );
}

const card: BusinessPerformanceCardView = {
  month: { from: "2026-02-01", to: "2026-02-28" },
  previous: { from: "2026-01-01", to: "2026-01-31" },
  channelCount: 1,
  headline: "Sales are up. Cancellations still need attention.",
  tiles: {
    sales: {
      id: "sales",
      value: { kind: "money", money: { minorUnits: 10_000_00, currency: "AED" } },
      unavailableReason: null,
      deltaPercent: 10,
      deltaLabel: "vs January",
      deltaAbsentReason: null,
      footnote: null,
    },
    orders: {
      id: "orders",
      value: { kind: "count", value: 240 },
      unavailableReason: null,
      deltaPercent: 10,
      deltaLabel: "vs January",
      deltaAbsentReason: null,
      footnote: "1 channel",
    },
    views: {
      id: "views",
      value: null,
      unavailableReason: "No approved report carried menu views for this month.",
      deltaPercent: null,
      deltaLabel: null,
      deltaAbsentReason: null,
      footnote: null,
    },
    cancelled: {
      id: "cancelled",
      value: { kind: "count", value: 12 },
      unavailableReason: null,
      deltaPercent: 0,
      deltaLabel: "vs January",
      deltaAbsentReason: null,
      footnote: "Review the reasons",
    },
  },
  cancelledShare: { percent: 5, pointChange: 0 },
  trend: {
    state: "empty",
    reason: "Fewer than two weeks of this month have a completed analysis.",
    weeks: ["2–8 Feb", "9–15 Feb", "16–22 Feb"],
  },
  shares: {
    rows: [
      {
        channelId: "ch-1",
        displayName: "Talabat",
        minorUnits: 10_000_00,
        currency: "AED",
        sharePercent: 100,
      },
    ],
    totalMinorUnits: 10_000_00,
    currency: "AED",
  },
  sharesAbsentReason: null,
  footer: "Sales and orders: 1 channel · 1 location. Menu views were not reported.",
  sources: {
    reportingPeriod: "2026-02-01 to 2026-02-28",
    scope: "all channels · all locations",
    salesOrdersNote: "Comparable channel reports for the selected period and locations.",
    menuViewsNote: "No approved report carried menu views for this month.",
    costNote:
      "Cost reports are missing, so this screen shows reported sales without claiming profit.",
    reportFiles: [],
  },
  fulfillment: {
    ordersPlaced: 240,
    ordersAbsentReason: null,
    cancelled: 12,
    cancelledAbsentReason: null,
  },
};

describe("GrowthIntelligenceWorkspace", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    refresh.mockClear();
    push.mockClear();
  });

  it("opens on the filter row, previous actions, and Top Recommendations in that order", () => {
    const { container } = workspace();
    const text = container.textContent ?? "";
    expect(text.indexOf("Last fetched")).toBeLessThan(text.indexOf("Previous actions"));
    expect(text.indexOf("Previous actions")).toBeLessThan(text.indexOf("Top Recommendations"));
    expect(screen.getByRole("group", { name: "Performance filters" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Reporting month" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Channel" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Location" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /More/ }).getAttribute("href")).toBe(
      "#recommendations",
    );
  });

  it("names an unmatched month instead of showing another month", () => {
    workspace(view(), true, defaultFilters({ resolved: null }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /No completed analysis matches 2026-02-01 to 2026-02-28/,
    );
  });

  it("says so when the filters exclude every channel", () => {
    workspace(view(), true, defaultFilters({ channelId: "ch-1" }));
    expect(screen.getByText("No channels match the selected filters.")).toBeTruthy();
  });

  it("keeps freshness and refresh when no range is reported at all", () => {
    workspace(view(), true, null);
    expect(screen.queryByRole("group", { name: "Performance filters" })).toBeNull();
    expect(screen.getByText(/Last fetched/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("shows the four plain-language tabs and navigates to the full sections", () => {
    workspace();
    for (const name of ["Overview", "Recommendations", "Your actions", "Insights & market"]) {
      expect(screen.getByRole("tab", { name: new RegExp(name) })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("tab", { name: /Insights & market/ }));
    expect(screen.getByRole("region", { name: "Market Watch" })).toBeTruthy();
  });

  it("keeps activity-month navigation inside Your actions", () => {
    workspace(view({ activityMonth: "2026-08" }), false);
    fireEvent.click(screen.getByRole("tab", { name: /Your actions/ }));
    expect(screen.getByText(/Activity 2026-08/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Previous month" })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/growth-intelligence?month=2026-07#actions`,
    );
    expect(screen.getByRole("link", { name: "Back to current month" })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/growth-intelligence#actions`,
    );
  });

  it("refreshes manually while leaving the current figures mounted", () => {
    workspace();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Performance reporting is not available yet/)).toBeTruthy();
  });

  it("keeps the last successful performance when a refresh fails", async () => {
    const props = {
      view: view(),
      organizationId: ORGANIZATION,
      canManage: true,
      isCurrentMonth: true,
      marketWatch: null,
      performanceCard: card,
      fetchedAt: "2026-09-07T09:00:00.000Z",
      performanceFilters: defaultFilters(),
    };
    const rendered = render(<GrowthIntelligenceWorkspace {...props} />);
    expect(screen.getAllByText(/AED.*10,000|10,000.*AED/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    rendered.rerender(
      <GrowthIntelligenceWorkspace {...props} performanceCard={null} fetchedAt={null} />,
    );
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getAllByText(/AED.*10,000|10,000.*AED/).length).toBeGreaterThan(0);
  });
});

describe("GrowthIntelligenceWorkspace header and tabs", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("keeps the title and Market monitoring on one header row", () => {
    const { container } = workspace();
    const heading = screen.getByRole("heading", { name: "Growth Intelligence", level: 1 });
    const button = screen.getByRole("button", { name: /^market monitoring$/i });
    expect(heading.parentElement?.parentElement).toBe(button.parentElement);
    expect(container.textContent).toContain("follow earlier decisions");
  });

  it("uses the shared line tab variant", () => {
    workspace();
    expect(screen.getByRole("tablist").getAttribute("data-variant")).toBe("line");
  });
});

describe("GrowthIntelligenceWorkspace market monitoring", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("opens the Review dialog from the Market monitoring header entry", async () => {
    workspace();
    fireEvent.click(screen.getByRole("button", { name: /^market monitoring$/i }));
    expect(await screen.findByRole("dialog", { name: "Review market monitoring" })).toBeTruthy();
    expect(screen.getByText(/no active branch/i)).toBeTruthy();
  });

  it("opens the same dialog from the Market Watch entry point", async () => {
    workspace();
    window.dispatchEvent(new CustomEvent("growth-intelligence:open-market-monitoring"));
    expect(await screen.findByRole("dialog", { name: "Review market monitoring" })).toBeTruthy();
  });

  it("invites a branch choice in Insights & market while branchless", () => {
    workspace();
    fireEvent.click(screen.getByRole("tab", { name: /insights/i }));
    expect(screen.getByText(/follows one branch at a time/i)).toBeTruthy();
  });

  it("observes the selected branch pipeline without branchless copy", async () => {
    const fetchMock = vi.fn(
      async (_url: string) => new Response(JSON.stringify({ research: null }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <GrowthIntelligenceWorkspace
          view={view()}
          organizationId={ORGANIZATION}
          canManage
          isCurrentMonth
          marketWatch={<section aria-label="Market Watch" />}
          performanceCard={null}
          fetchedAt={null}
          performanceFilters={null}
          branches={[
            {
              id: "20000000-0000-4000-8000-00000000000a",
              name: "Downtown",
              serviceArea: null,
              isActive: true,
            },
          ]}
          selectedBranchId="20000000-0000-4000-8000-00000000000a"
        />,
      );
      expect(screen.queryByText(/follows one branch at a time/i)).toBeNull();
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const url = String(fetchMock.mock.calls[0]?.[0] ?? "");
      expect(url).toContain("branchId=20000000-0000-4000-8000-00000000000a");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
