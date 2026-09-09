// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { GrowthIntelligenceWorkspace } from "@/components/growth-intelligence/growth-intelligence-workspace";
import type { GrowthIntelligenceView } from "@/modules/growth-intelligence/application/read-model";

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

describe("GrowthIntelligenceWorkspace", () => {
  afterEach(() => cleanup());

  it("lays action left and evidence right with every section named", () => {
    const { container } = render(
      <GrowthIntelligenceWorkspace
        view={view()}
        organizationId={ORGANIZATION}
        canManage
        isCurrentMonth
        marketWatch={<section aria-label="Market Watch" />}
      />,
    );
    for (const name of [
      "Priority actions",
      "Data gaps",
      "Insights",
      "Market Watch",
      "Activity timeline",
    ]) {
      expect(screen.getByRole("region", { name })).toBeTruthy();
    }
    // Two lanes on desktop, one stacked column below: the grid carries the
    // two-column template only at large widths.
    expect(container.querySelector('[class*="lg:grid-cols"]')).toBeTruthy();
  });

  it("navigates months without relabeling evidence", () => {
    render(
      <GrowthIntelligenceWorkspace
        view={view({ activityMonth: "2026-08" })}
        organizationId={ORGANIZATION}
        canManage
        isCurrentMonth={false}
        marketWatch={null}
      />,
    );
    expect(screen.getByText(/Activity: 2026-08/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Previous month" })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/growth-intelligence?month=2026-07`,
    );
    expect(screen.getByRole("link", { name: "Back to current month" })).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION}/growth-intelligence`,
    );
  });

  it("hides the way back while on the current month", () => {
    render(
      <GrowthIntelligenceWorkspace
        view={view()}
        organizationId={ORGANIZATION}
        canManage
        isCurrentMonth
        marketWatch={null}
      />,
    );
    expect(screen.queryByRole("link", { name: "Back to current month" })).toBeNull();
  });
});

describe("GrowthIntelligenceWorkspace market monitoring", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
  });

  it("opens the Review dialog from the Market monitoring header entry", async () => {
    render(
      <GrowthIntelligenceWorkspace
        view={view()}
        organizationId={ORGANIZATION}
        canManage
        isCurrentMonth
        marketWatch={<section aria-label="Market Watch" />}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^market monitoring$/i }));
    expect(
      await screen.findByRole("dialog", { name: "Review market monitoring" }),
    ).toBeTruthy();
    expect(screen.getByText(/no active branch/i)).toBeTruthy();
  });

  it("opens the same dialog from the Market Watch entry point", async () => {
    render(
      <GrowthIntelligenceWorkspace
        view={view()}
        organizationId={ORGANIZATION}
        canManage
        isCurrentMonth
        marketWatch={<section aria-label="Market Watch" />}
      />,
    );
    window.dispatchEvent(new CustomEvent("growth-intelligence:open-market-monitoring"));
    expect(
      await screen.findByRole("dialog", { name: "Review market monitoring" }),
    ).toBeTruthy();
  });

  it("invites a branch choice in Insights & market while branchless", () => {
    render(
      <GrowthIntelligenceWorkspace
        view={view()}
        organizationId={ORGANIZATION}
        canManage
        isCurrentMonth
        marketWatch={<section aria-label="Market Watch" />}
      />,
    );
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
