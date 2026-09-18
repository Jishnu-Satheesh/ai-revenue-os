// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  bracketLabelAnchor,
  buildGrowthChartRows,
  describeGrowthTooltip,
  formatAsOfDay,
  formatCompactMoney,
  formatFooterDay,
  formatShortDate,
  GROWTH_CURRENT,
  GROWTH_CURRENT_TEXT,
  GROWTH_PROJECTED,
  growthNiceTicks,
  growthTooltipForDate,
  HomeGrowthChart,
  placeEndpointLabels,
  placeGrowthPairLabels,
  selectGrowthLabelDates,
} from "@/components/organizations/home/home-growth-chart";
import { buildAheadGrowthView, buildBehindGrowthView } from "@/components/organizations/home/home-growth-fixtures";

afterEach(() => {
  cleanup();
});

const ORG_ID = "11111111-1111-4111-8111-111111111111";

function circles(container: HTMLElement, className: string): SVGCircleElement[] {
  // CSS modules hash class names in tests; match the stable substring.
  return [...container.querySelectorAll(`circle[class*="${className}"]`)] as SVGCircleElement[];
}

function numberAttribute(element: Element, name: string): number {
  return Number(element.getAttribute(name));
}

describe("formatCompactMoney", () => {
  it("uses k labels for thousands and M labels for millions", () => {
    expect(formatCompactMoney(1_800_000, "AED")).toBe("18k");
    expect(formatCompactMoney(6_000_000, "AED")).toBe("60k");
    expect(formatCompactMoney(12_000_000, "AED")).toBe("120k");
    expect(formatCompactMoney(150_000_000, "AED")).toBe("1.5M");
    expect(formatCompactMoney(90_000, "AED")).toBe("900");
    expect(formatCompactMoney(-2_400_000, "AED")).toBe("−24k");
  });
});

describe("date labels", () => {
  it("prints short, footer and eyebrow forms without timezone drift", () => {
    expect(formatShortDate("2026-09-21")).toBe("21 Sep");
    expect(formatFooterDay("2026-09-01")).toBe("1 Sep");
    expect(formatAsOfDay("2026-09-21")).toBe("21 SEP");
  });
});

describe("growthNiceTicks", () => {
  it("yields the fixture 0/40k/80k/120k scale on the shared domain", () => {
    // Plotted values only: 18k lowest actual through the 120k central point.
    const { domain, ticks } = growthNiceTicks(1_800_000, 12_000_000, "AED");
    expect(domain).toEqual([0, 120_000]);
    expect(ticks).toEqual([0, 40_000, 80_000, 120_000]);
  });

  it("expands below zero for negative actual adjustments instead of clipping", () => {
    const { domain, ticks } = growthNiceTicks(-500_000, 12_000_000, "AED");
    expect(domain[0]).toBeLessThan(0);
    expect(ticks[0]).toBeLessThanOrEqual(-500_000 / 100);
    expect(domain[1]).toBeGreaterThanOrEqual(120_000);
  });
});

describe("placeGrowthPairLabels", () => {
  it("puts projected above and current below while blue runs lower", () => {
    expect(placeGrowthPairLabels(6_000_000, 8_400_000)).toEqual({
      current: "below",
      projected: "above",
    });
  });

  it("swaps the sides while blue runs higher", () => {
    expect(placeGrowthPairLabels(9_800_000, 8_400_000)).toEqual({
      current: "above",
      projected: "below",
    });
  });

  it("hides the current label on exact equality", () => {
    expect(placeGrowthPairLabels(8_400_000, 8_400_000)).toEqual({
      current: "hidden",
      projected: "above",
    });
  });

  it("hides whichever series has no value", () => {
    expect(placeGrowthPairLabels(null, 8_400_000).projected).toBe("above");
    expect(placeGrowthPairLabels(null, 8_400_000).current).toBe("hidden");
    expect(placeGrowthPairLabels(6_000_000, null).projected).toBe("hidden");
  });
});

describe("placeEndpointLabels", () => {
  it("keeps both endpoint words on their rows when the series end apart", () => {
    expect(
      placeEndpointLabels({
        currentEndDate: "2026-09-21",
        currentEndMinor: 6_000_000,
        projectedEndDate: "2026-09-30",
        projectedEndMinor: 12_000_000,
        domainSpanMinor: 12_000_000,
      }),
    ).toEqual({ currentDy: 4, projectedDy: 4 });
  });

  it("steps the current word up a row when both series end together", () => {
    const placed = placeEndpointLabels({
      currentEndDate: "2026-09-30",
      currentEndMinor: 11_900_000,
      projectedEndDate: "2026-09-30",
      projectedEndMinor: 12_000_000,
      domainSpanMinor: 12_000_000,
    });
    expect(placed.currentDy).toBeLessThan(placed.projectedDy);
  });
});

describe("bracketLabelAnchor", () => {
  it("sits right of an interior bracket and left at the right edge", () => {
    expect(bracketLabelAnchor(50, 0, 100)).toBe("right");
    expect(bracketLabelAnchor(90, 0, 100)).toBe("left");
  });
});

describe("buildGrowthChartRows", () => {
  it("keeps current null at future dates so the blue line stops", () => {
    const rows = buildGrowthChartRows(buildBehindGrowthView(ORG_ID).points, "AED");
    expect(rows.map((row) => row.date)).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-30",
    ]);
    expect(rows[2]).toMatchObject({ current: 60_000, projected: 84_000 });
    expect(rows[3]?.current).toBeNull();
    expect(rows[3]?.projected).toBe(120_000);
  });

  it("treats incomplete coverage as missing rather than a comparable zero", () => {
    const view = buildBehindGrowthView(ORG_ID);
    const points = view.points.map((point, index) =>
      index === 0 ? { ...point, currentCoverage: "missing" as const } : point,
    );
    const rows = buildGrowthChartRows(points, "AED");
    expect(rows[0]?.current).toBeNull();
    expect(rows[0]?.currentMinor).toBeNull();
  });
});

describe("HomeGrowthChart behind fixture", () => {
  it("pins both summaries to the latest comparable date with full amounts", () => {
    render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    expect(screen.getByText("Current · 21 Sep")).toBeTruthy();
    expect(screen.getByText("AED 60,000")).toBeTruthy();
    expect(screen.getByText("Projected · 21 Sep")).toBeTruthy();
    expect(screen.getByText("AED 84,000")).toBeTruthy();
    expect(screen.getByText("Estimate")).toBeTruthy();
    expect(screen.getByText("Revenue so far (AED)")).toBeTruthy();
  });

  it("draws independent coloured and marked series", () => {
    const { container } = render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    const currentDots = circles(container, "growthCurrentDot");
    const projectedDots = circles(container, "growthProjectedDot");
    expect(currentDots).toHaveLength(3);
    expect(projectedDots).toHaveLength(4);
    for (const dot of currentDots) {
      expect(dot.getAttribute("fill")).toBe(GROWTH_CURRENT);
      expect(dot.getAttribute("r")).toBe("5");
    }
    for (const dot of projectedDots) {
      expect(dot.getAttribute("fill")).toBe("#ffffff");
      expect(dot.getAttribute("stroke")).toBe(GROWTH_PROJECTED);
    }
    const paths = [...container.querySelectorAll(".recharts-line-curve")] as SVGPathElement[];
    expect(paths).toHaveLength(2);
    const dashArrays = paths.map((path) => path.getAttribute("stroke-dasharray"));
    expect(dashArrays).toContain("7 6");
    expect(dashArrays).toContain(null);
  });

  it("labels every sparse point and both endpoints", () => {
    const { container } = render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    for (const label of ["18k", "38k", "60k", "24k", "52k", "84k", "120k"]) {
      expect(container.textContent).toContain(label);
    }
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("Projected")).toBeTruthy();
    const currentLabels = container.querySelectorAll('[class*="growthCurrentLabel"]');
    expect(currentLabels[0]?.getAttribute("fill")).toBe(GROWTH_CURRENT_TEXT);
  });

  it("marks the latest report and brackets the same-date gap", () => {
    const { container } = render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    expect(screen.getByText("Latest report")).toBeTruthy();
    expect(screen.getByText("AED 24k gap")).toBeTruthy();
    expect(container.textContent).not.toContain("ahead");
  });

  it("gives a money difference its proportional y distance on the shared domain", () => {
    const { container } = render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    const projected = circles(container, "growthProjectedDot");
    const current = circles(container, "growthCurrentDot");
    const perUnitFromProjected =
      Math.abs(numberAttribute(projected[0] as Element, "cy") - numberAttribute(projected[3] as Element, "cy")) /
      (120_000 - 24_000);
    // The same-date bracket pair (60k current vs 84k projected on 21 Sep).
    const bracketSpan = Math.abs(
      numberAttribute(current[2] as Element, "cy") - numberAttribute(projected[2] as Element, "cy"),
    );
    const expected24k = perUnitFromProjected * 24_000;
    expect(bracketSpan / expected24k).toBeCloseTo(1, 1);
    // Same domain, same scale: the current pair must agree with the projected pair.
    const perUnitFromCurrent =
      Math.abs(numberAttribute(current[0] as Element, "cy") - numberAttribute(current[2] as Element, "cy")) /
      (60_000 - 18_000);
    expect(perUnitFromCurrent / perUnitFromProjected).toBeCloseTo(1, 1);
  });

  it("renders an exact 30,000 difference at its proportional y distance", () => {
    const view = buildBehindGrowthView(ORG_ID);
    const points = view.points.map((point) =>
      point.date === "2026-09-07" ? { ...point, currentMinor: 3_000_000 } : point,
    );
    const { container } = render(<HomeGrowthChart view={{ ...view, points }} />);
    const projected = circles(container, "growthProjectedDot");
    const current = circles(container, "growthCurrentDot");
    const perUnit =
      Math.abs(numberAttribute(projected[0] as Element, "cy") - numberAttribute(projected[3] as Element, "cy")) /
      (120_000 - 24_000);
    // 7 Sep current is now 30,000 and 21 Sep current is 60,000: exactly 30k apart.
    const thirtyKaySpan = Math.abs(
      numberAttribute(current[0] as Element, "cy") - numberAttribute(current[2] as Element, "cy"),
    );
    expect(thirtyKaySpan / (perUnit * 30_000)).toBeCloseTo(1, 2);
  });

  it("spaces unequal date intervals proportionally on the time scale", () => {
    const { container } = render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    const dots = circles(container, "growthProjectedDot").map((dot) =>
      numberAttribute(dot, "cx"),
    );
    const firstWeek = dots[1] as number - (dots[0] as number);
    const secondWeek = dots[2] as number - (dots[1] as number);
    const nineDays = dots[3] as number - (dots[2] as number);
    expect(secondWeek / firstWeek).toBeCloseTo(1, 1);
    expect(nineDays / secondWeek).toBeCloseTo(9 / 7, 1);
  });
});

describe("growthTooltipForDate", () => {
  it("reports values, range and signed difference for a historical date", () => {
    const model = growthTooltipForDate(buildBehindGrowthView(ORG_ID), "2026-09-21");
    expect(model).toMatchObject({
      date: "2026-09-21",
      currentMinor: 6_000_000,
      projectedCentralMinor: 8_400_000,
      projectedLowMinor: 8_000_000,
      projectedHighMinor: 8_800_000,
      differenceMinor: -2_400_000,
    });
    expect(describeGrowthTooltip(model as never, "AED")).toMatch(/24,000 behind/);
  });

  it("never fabricates a current value for a future date", () => {
    const model = growthTooltipForDate(buildBehindGrowthView(ORG_ID), "2026-09-30");
    expect(model?.currentMinor).toBeNull();
    expect(model?.differenceMinor).toBeNull();
    expect(model?.projectedCentralMinor).toBe(12_000_000);
  });

  it("treats incomplete coverage as unavailable, not as a comparable zero", () => {
    const view = buildBehindGrowthView(ORG_ID);
    const points = view.points.map((point) =>
      point.date === "2026-09-14"
        ? { ...point, currentMinor: 3_800_000, currentCoverage: "missing" as const, reasonCode: "COVERAGE_GAP" as const }
        : point,
    );
    const model = growthTooltipForDate({ ...view, points }, "2026-09-14");
    expect(model?.currentMinor).toBeNull();
    expect(model?.differenceMinor).toBeNull();
    expect(describeGrowthTooltip(model as never, "AED")).toContain("Current not reported");
  });

  it("returns null for a date outside the view", () => {
    expect(growthTooltipForDate(buildBehindGrowthView(ORG_ID), "2026-10-05")).toBeNull();
  });
});

describe("selectGrowthLabelDates", () => {
  it("keeps every sparse label", () => {
    const dates = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-30"];
    expect(selectGrowthLabelDates(dates, "2026-09-21", 6)).toEqual(dates);
  });

  it("thins dense series to the cap while keeping first, latest and last", () => {
    const dates = Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, "0")}`);
    const picked = selectGrowthLabelDates(dates, "2026-09-21", 6);
    expect(picked.length).toBeLessThanOrEqual(6);
    expect(picked[0]).toBe("2026-09-01");
    expect(picked).toContain("2026-09-21");
    expect(picked[picked.length - 1]).toBe("2026-09-30");
    expect([...picked].sort()).toEqual(picked);
  });
});

describe("HomeGrowthChart keyboard and touch interaction", () => {
  function chartGroup(): HTMLElement {
    return screen.getByRole("group", { name: /Growth chart/ });
  }

  it("walks dates with arrows, jumps with Home/End and announces each selection", () => {
    render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    const group = chartGroup();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip").textContent).toContain("7 Sep");
    expect(screen.getByRole("tooltip").textContent).toMatch(/18,000/);
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    expect(screen.getByRole("tooltip").textContent).toContain("21 Sep");
    expect(screen.getByRole("status").textContent).toContain("21 Sep");
    fireEvent.keyDown(group, { key: "Home" });
    expect(screen.getByRole("tooltip").textContent).toContain("7 Sep");
    fireEvent.keyDown(group, { key: "End" });
    const tip = screen.getByRole("tooltip").textContent ?? "";
    expect(tip).toContain("30 Sep");
    expect(tip).toContain("Current: not reported");
    expect(tip).not.toContain("Difference");
  });

  it("pins on Enter, keeps summaries at the latest report, and clears on Escape", () => {
    render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    const group = chartGroup();
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "Enter" });
    expect(screen.getByRole("tooltip").textContent).toContain("Pinned");
    // Pointer leave dismisses only the transient hover: the pin survives.
    fireEvent.mouseLeave(group);
    expect(screen.getByRole("tooltip").textContent).toContain("7 Sep");
    // The right-panel evidence never follows exploration.
    expect(screen.getByText("Current · 21 Sep")).toBeTruthy();
    expect(screen.getByText("AED 60,000")).toBeTruthy();
    fireEvent.keyDown(group, { key: "Escape" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("cleared");
  });

  it("pins on tap and dismisses on a second tap", () => {
    const { container } = render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    const dotAt = (): Element =>
      [...container.querySelectorAll('circle[class*="growthCurrentDot"]')][0] as Element;
    fireEvent.click(dotAt());
    expect(screen.getByRole("tooltip").textContent).toContain("7 Sep");
    // Re-query: pinning re-renders the chart, so the first node is detached.
    fireEvent.click(dotAt());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows a transient hover tooltip that leaves the pin alone", () => {
    const { container } = render(<HomeGrowthChart view={buildBehindGrowthView(ORG_ID)} />);
    const dots = [...container.querySelectorAll('circle[class*="growthProjectedDot"]')];
    fireEvent.mouseEnter(dots[3] as Element);
    expect(screen.getByRole("tooltip").textContent).toContain("30 Sep");
    fireEvent.mouseLeave(chartGroup());
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("HomeGrowthChart ahead fixture", () => {
  it("swaps the label sides and brackets the lead", () => {
    const { container } = render(<HomeGrowthChart view={buildAheadGrowthView(ORG_ID)} />);
    expect(screen.getByText("AED 98,000")).toBeTruthy();
    expect(screen.getByText("AED 14k ahead")).toBeTruthy();
    const current = circles(container, "growthCurrentDot");
    const latestCurrent = current[2] as Element;
    const latestLabel = container.querySelectorAll('[class*="growthCurrentLabel"]')[2] as Element;
    // Blue runs higher: its label prints above its dot.
    expect(numberAttribute(latestLabel, "y")).toBeLessThan(numberAttribute(latestCurrent, "cy"));
    expect(container.textContent).not.toContain("gap");
  });
});
