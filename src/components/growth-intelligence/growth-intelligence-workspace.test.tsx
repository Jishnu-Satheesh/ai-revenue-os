// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";

import { mswServer } from "@/test/msw/server";

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
    campaignProposals: [],
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
  build: {
    buildPending?: boolean;
    buildFailed?: boolean;
    buildRefused?: boolean;
    canRequestBuild?: boolean;
  } = {},
) {
  return render(
    <GrowthIntelligenceWorkspace
      view={currentView}
      organizationId={ORGANIZATION}
      canManage
      isCurrentMonth={isCurrentMonth}
      performanceCard={null}
      fetchedAt="2026-09-07T09:00:00.000Z"
      performanceFilters={filters}
      buildPending={build.buildPending ?? false}
      buildFailed={build.buildFailed ?? false}
      buildRefused={build.buildRefused ?? false}
      canRequestBuild={build.canRequestBuild ?? true}
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

// Slice 4: the Market Watch projects section reads its list over fetch. An
// empty list keeps every assertion below on the pre-existing sections. The
// global MSW server fails unhandled requests, so the handler lives here at
// file scope covering all three describe blocks below.
beforeEach(() => {
  mswServer.use(
    http.get("*/growth-intelligence/monitoring/projects", () =>
      HttpResponse.json({ projects: [], reportsByProject: {}, revisionsByProject: {} }),
    ),
  );
});

describe("GrowthIntelligenceWorkspace", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    refresh.mockClear();
    push.mockClear();
    vi.unstubAllGlobals();
  });

  it("opens on the filter row and the merged recommendations grid", () => {
    const { container } = workspace();
    const text = container.textContent ?? "";
    expect(text.indexOf("Last fetched")).toBeLessThan(
      text.indexOf("Top AI recommendations"),
    );
    expect(
      screen.queryByRole("region", { name: "Previous actions" }),
    ).toBeNull();
    expect(container.textContent).not.toContain("Previous actions");
    expect(
      screen.getByRole("region", { name: "Top AI recommendations & Campaign opportunities" }),
    ).toBeTruthy();
    expect(screen.getByRole("group", { name: "Performance filters" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "2026-02-01 to 2026-02-28" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Channel" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Location" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /More/ }).getAttribute("href")).toBe(
      "#recommendations",
    );
    expect(screen.getByText(/Best next moves, scored by impact and freshness/)).toBeTruthy();
  });

  it("names an unmatched range instead of showing another range", () => {
    workspace(view(), true, defaultFilters({ resolved: null }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /No completed analysis matches 2026-02-01 to 2026-02-28/,
    );
  });

  it("holds the card's shape as skeleton blocks while a build is outstanding", () => {
    const { container } = workspace(view(), true, defaultFilters(), {
      buildPending: true,
    });
    expect(container.querySelector('[data-slot="performance-skeleton"]')).toBeTruthy();
    expect(container.querySelector('[data-slot="page-content-loader"]')).toBeNull();
  });

  it("states a failed build plainly with a retry path", () => {
    workspace(view(), true, defaultFilters(), { buildFailed: true });
    expect(screen.getByRole("alert")).toHaveTextContent(/could not complete/);
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("refuses an over-wide automatic build and names the Channel Audit", () => {
    workspace(view(), true, defaultFilters(), { buildRefused: true });
    expect(screen.getByRole("status")).toHaveTextContent(/more channels than one automatic build/);
  });

  it("tells viewers without the run permission who can build", () => {
    workspace(view(), true, defaultFilters(), { canRequestBuild: false });
    expect(screen.getByRole("status")).toHaveTextContent(/Someone with analysis permission/);
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
    expect(screen.getByRole("region", { name: "Market Watch projects" })).toBeTruthy();
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

  it("keeps the title and New research on one header row", () => {
    const { container } = workspace();
    const heading = screen.getByRole("heading", { name: "Growth Intelligence", level: 1 });
    const button = screen.getByRole("button", { name: /^new research$/i });
    expect(heading.parentElement?.parentElement).toBe(button.parentElement);
    expect(container.textContent).toContain("follow earlier decisions");
  });

  it("uses the shared line tab variant", () => {
    workspace();
    expect(screen.getByRole("tablist").getAttribute("data-variant")).toBe("line");
  });
});

describe("GrowthIntelligenceWorkspace market research entry", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("opens the New research dialog from the single header entry", async () => {
    workspace();
    fireEvent.click(screen.getByRole("button", { name: /^new research$/i }));
    expect(await screen.findByRole("dialog", { name: "New research" })).toBeTruthy();
  });

  it("switches to the Insights tab before opening from the header", async () => {
    workspace();
    fireEvent.click(screen.getByRole("button", { name: /^new research$/i }));
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: /insights/i }).getAttribute("aria-selected")).toBe(
        "true",
      ),
    );
    expect(await screen.findByRole("dialog", { name: "New research" })).toBeTruthy();
  });

  it("shows Market Watch without requiring a branch choice", async () => {
    workspace();
    fireEvent.click(screen.getByRole("tab", { name: /insights/i }));
    expect(screen.queryByText(/follows one branch at a time/i)).toBeNull();
    expect(
      await screen.findByRole("region", { name: "Market Watch projects" }),
    ).toBeTruthy();
  });

  it("heads Insights & market without the intro card, tabs ordered Overview first", () => {
    workspace();
    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.replace(/[0-9]+$/, "").trim());
    expect(tabs).toEqual(["Overview", "Insights & market", "Recommendations", "Your actions"]);
    fireEvent.click(screen.getByRole("tab", { name: /insights/i }));
    expect(screen.queryByText(/what your evidence says, what is missing/i)).toBeNull();
    expect(screen.getByRole("heading", { name: "Business insights" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Improve the next report" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Market Watch projects" })).toBeTruthy();
  });

  it("makes no branch-scoped research requests for a selected branch", async () => {
    const fetchMock: Mock<(url: string) => Promise<Response>> = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ projects: [], reportsByProject: {}, revisionsByProject: {} }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <GrowthIntelligenceWorkspace
            view={view()}
            organizationId={ORGANIZATION}
            canManage
            isCurrentMonth
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
          />
        </QueryClientProvider>,
      );
      fireEvent.click(screen.getByRole("tab", { name: /insights/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      for (const call of fetchMock.mock.calls) {
        expect(String(call[0] ?? "")).not.toMatch(/[?&]branchId=/);
      }
      expect(screen.queryByText(/follows one branch at a time/i)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
