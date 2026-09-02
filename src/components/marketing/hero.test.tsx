// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { Hero } from "./hero";
import { announcement, dashboardMock, hero, nav, WALKTHROUGH_MAILTO } from "./content";

afterEach(cleanup);

describe("Hero", () => {
  it("renders eyebrow, headline, subhead and both CTAs", () => {
    render(<Hero />);

    expect(screen.getByText(hero.eyebrow)).toBeTruthy();
    expect(screen.getByText(hero.headline)).toBeTruthy();
    expect(screen.getByText(hero.subhead)).toBeTruthy();

    const primary = screen.getByRole("link", { name: hero.primaryCta });
    expect(primary.getAttribute("href")).toBe(WALKTHROUGH_MAILTO);
    const signIn = screen.getByRole("link", { name: nav.signInLabel });
    expect(signIn.getAttribute("href")).toBe(nav.signInHref);
  });

  it("shows the cockpit dashboard with its floating proof chips", () => {
    render(<Hero />);

    expect(screen.getByText(dashboardMock.orgName)).toBeTruthy();
    expect(screen.getByText(dashboardMock.chartTitle)).toBeTruthy();
    expect(screen.getByText(dashboardMock.feedTitle)).toBeTruthy();
    expect(screen.getByText(dashboardMock.floatApproval)).toBeTruthy();
    expect(screen.getByText(dashboardMock.floatImpact)).toBeTruthy();
    expect(screen.getByText(dashboardMock.caption)).toBeTruthy();
    expect(screen.getByText(announcement.text)).toBeTruthy();
  });
});
