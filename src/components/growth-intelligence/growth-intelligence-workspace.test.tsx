// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

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
