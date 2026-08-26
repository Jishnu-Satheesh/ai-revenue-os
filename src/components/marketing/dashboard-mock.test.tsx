// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { DashboardMock } from "./dashboard-mock";
import { dashboardMock } from "./content";

afterEach(cleanup);

describe("DashboardMock", () => {
  it("renders the cockpit chrome, KPIs and chart", () => {
    render(<DashboardMock />);

    expect(screen.getByText(dashboardMock.orgName)).toBeTruthy();
    expect(screen.getByText(dashboardMock.branch)).toBeTruthy();
    expect(screen.getByText(dashboardMock.chartTitle)).toBeTruthy();
    for (const kpi of dashboardMock.kpis) {
      expect(screen.getByText(kpi.label)).toBeTruthy();
      expect(screen.getByText(kpi.value)).toBeTruthy();
    }
    expect(screen.getByText(dashboardMock.activeRange)).toBeTruthy();
  });

  it("renders the opportunity feed with both approval states", () => {
    render(<DashboardMock />);

    expect(screen.getByText(dashboardMock.feedTitle)).toBeTruthy();
    for (const item of dashboardMock.feed) {
      expect(screen.getByText(item.title)).toBeTruthy();
      expect(screen.getByText(item.status)).toBeTruthy();
    }
    expect(screen.getByText(dashboardMock.feedNote)).toBeTruthy();
  });

  it("keeps money figures estimate-labeled", () => {
    render(<DashboardMock />);
    expect(screen.getByText(dashboardMock.kpis[0].label).textContent).toMatch(/est/i);
  });
});
