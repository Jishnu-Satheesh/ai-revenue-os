// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HomeGrowthInsight } from "@/components/organizations/home/home-growth-insight";
import {
  buildAheadGrowthView,
  buildBehindGrowthView,
} from "@/components/organizations/home/home-growth-fixtures";
import type { GrowthProgressView } from "@/modules/organizations/application/growth-progress-view";

afterEach(() => {
  cleanup();
});

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const RECOMMENDATIONS_HREF = `/organizations/${ORG_ID}/growth-intelligence#recommendations`;

describe("HomeGrowthInsight behind fixture", () => {
  it("states the verdict, the gap and the supporting rows", () => {
    render(
      <HomeGrowthInsight
        view={buildBehindGrowthView(ORG_ID)}
        recommendationsHref={RECOMMENDATIONS_HREF}
      />,
    );
    expect(screen.getByText("AS OF 21 SEP")).toBeTruthy();
    expect(screen.getByText("Below the projection")).toBeTruthy();
    expect(screen.getByText("AED 24,000 behind")).toBeTruthy();
    expect(screen.getByText("29% below the projected revenue")).toBeTruthy();
    expect(screen.getByText("What to look at")).toBeTruthy();
    expect(screen.getByText("Missed orders have increased")).toBeTruthy();
    expect(screen.getByText("Review cancellation findings")).toBeTruthy();
    expect(screen.getByText("Repeat-customer action is still planned")).toBeTruthy();
    expect(screen.getByText("Review the recommended action")).toBeTruthy();
    const footer = screen.getByRole("link", { name: /View recommendations/ });
    expect(footer.getAttribute("href")).toBe(RECOMMENDATIONS_HREF);
  });

  it("links each row to its source-owned destination", () => {
    render(
      <HomeGrowthInsight
        view={buildBehindGrowthView(ORG_ID)}
        recommendationsHref={RECOMMENDATIONS_HREF}
      />,
    );
    const list = screen.getByText("What to look at").nextElementSibling;
    expect(list?.tagName).toBe("UL");
    const links = within(list as HTMLElement).getAllByRole("link");
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toContain(`/organizations/${ORG_ID}/growth-intelligence`);
    }
  });
});

describe("HomeGrowthInsight ahead fixture", () => {
  it("celebrates without claiming attribution", () => {
    const { container } = render(
      <HomeGrowthInsight
        view={buildAheadGrowthView(ORG_ID)}
        recommendationsHref={RECOMMENDATIONS_HREF}
      />,
    );
    expect(screen.getByText("Above the projection")).toBeTruthy();
    expect(screen.getByText("AED 14,000 ahead")).toBeTruthy();
    expect(screen.getByText("17% above the projected revenue")).toBeTruthy();
    expect(screen.getByText("Build on this progress")).toBeTruthy();
    expect(screen.getByText("Expand the strongest channel")).toBeTruthy();
    expect(screen.getByText("Build on repeat purchases")).toBeTruthy();
    expect(container.textContent).not.toMatch(/earned/i);
  });
});

describe("HomeGrowthInsight comparison states", () => {
  function viewWith(
    state: NonNullable<GrowthProgressView["latestComparison"]>["state"],
    differenceMinor: number | null,
    differencePercent: number | null,
  ): GrowthProgressView {
    const base = buildBehindGrowthView(ORG_ID);
    return {
      ...base,
      latestComparison:
        differenceMinor === null && differencePercent === null && state === "unavailable"
          ? null
          : { state, differenceMinor, differencePercent, reasonCode: null },
    };
  }

  it("stays calm inside the scenario range", () => {
    render(
      <HomeGrowthInsight
        view={viewWith("within_range", -2_000_000, -2)}
        recommendationsHref={RECOMMENDATIONS_HREF}
      />,
    );
    expect(screen.getByText("Within the projected range")).toBeTruthy();
    expect(screen.getByText("Tracking within the estimate")).toBeTruthy();
    expect(screen.queryByText(/behind/)).toBeNull();
  });

  it("names exact equality without a gap label", () => {
    const { container } = render(
      <HomeGrowthInsight
        view={viewWith("equal", 0, 0)}
        recommendationsHref={RECOMMENDATIONS_HREF}
      />,
    );
    expect(screen.getByText("In line with the projection")).toBeTruthy();
    expect(screen.getByText("Current revenue matches this estimate.")).toBeTruthy();
    expect(container.textContent).not.toMatch(/behind|ahead/);
  });

  it("compares in money only when the central estimate is zero", () => {
    render(
      <HomeGrowthInsight
        view={viewWith("behind", -2_400_000, null)}
        recommendationsHref={RECOMMENDATIONS_HREF}
      />,
    );
    expect(screen.getByText("AED 24,000 behind")).toBeTruthy();
    expect(screen.queryByText(/projected revenue/)).toBeNull();
  });

  it("admits an evidence gap instead of inventing an explanation", () => {
    const base = buildBehindGrowthView(ORG_ID);
    render(
      <HomeGrowthInsight
        view={{ ...base, adviceRows: [] }}
        recommendationsHref={RECOMMENDATIONS_HREF}
      />,
    );
    expect(
      screen.getByText(
        "We can see the difference, but do not yet have enough evidence to explain it.",
      ),
    ).toBeTruthy();
  });

  it("caps the rail at two rows and omits the footer link when unpermitted", () => {
    const base = buildBehindGrowthView(ORG_ID);
    const third = { ...base.adviceRows[0] } as (typeof base.adviceRows)[number];
    render(
      <HomeGrowthInsight
        view={{ ...base, adviceRows: [...base.adviceRows, { ...third, id: "third-row" }] }}
        recommendationsHref={null}
      />,
    );
    expect(screen.queryByRole("link", { name: /View recommendations/ })).toBeNull();
    const list = screen.getByText("What to look at").nextElementSibling;
    expect(list?.querySelectorAll(":scope > li")).toHaveLength(2);
  });

  it("raises no alarm for a below-midpoint actual inside the range", () => {
    const { container } = render(
      <HomeGrowthInsight
        view={viewWith("within_range", -5_000_000, -6)}
        recommendationsHref={RECOMMENDATIONS_HREF}
      />,
    );
    expect(screen.getByText("Within the projected range")).toBeTruthy();
    expect(container.textContent).not.toMatch(/behind|ahead/);
  });

  it("renders negative adjustments in full without implying execution", () => {
    const base = buildBehindGrowthView(ORG_ID);
    const points = base.points.map((point) =>
      point.date === "2026-09-07" ? { ...point, currentMinor: -500_000 } : point,
    );
    const { container } = render(
      <HomeGrowthInsight view={{ ...base, points }} recommendationsHref={RECOMMENDATIONS_HREF} />,
    );
    expect(screen.getByText("Below the projection")).toBeTruthy();
    expect(container.textContent).not.toMatch(/execut|earn|complet/i);
  });

  it("keeps long recommendation titles readable with the full title accessible", () => {
    const base = buildBehindGrowthView(ORG_ID);
    const longTitle =
      "Revisit every open cancellation thread across both channels and agree who follows up before the weekend planning session";
    const rows = base.adviceRows.map((row, index) =>
      index === 0 ? { ...row, title: longTitle } : row,
    );
    render(
      <HomeGrowthInsight
        view={{ ...base, adviceRows: rows }}
        recommendationsHref={RECOMMENDATIONS_HREF}
      />,
    );
    const link = screen.getByRole("link", { name: new RegExp(longTitle.slice(0, 24)) });
    expect(link.getAttribute("aria-label")).toContain(longTitle);
    expect(screen.getByText(longTitle)).toBeTruthy();
  });

  it("renders plain text for rows without a link", () => {
    const base = buildBehindGrowthView(ORG_ID);
    const rows = base.adviceRows.map((row) => ({ ...row, href: null }));
    render(<HomeGrowthInsight view={{ ...base, adviceRows: rows }} recommendationsHref={null} />);
    expect(screen.getByText("Missed orders have increased").closest("a")).toBeNull();
  });
});
