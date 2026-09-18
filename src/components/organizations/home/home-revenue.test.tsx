// @vitest-environment jsdom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import {
  buildRevenueChartRows,
  growthFooterLine,
  growthHorizonAnnouncement,
  growthPeriodSubtitle,
  HomeRevenue,
  PulsingTipDot,
} from "@/components/organizations/home/home-revenue";
import {
  buildAheadGrowthSection,
  buildAheadGrowthView,
  buildBehindGrowthSection,
  buildBehindGrowthView,
} from "@/components/organizations/home/home-growth-fixtures";
import {
  buildRevenueScenario,
  type RevenueScenarioInput,
} from "@/domain/organizations/revenue-scenario";
import type { OrganizationHomeView } from "@/modules/organizations/application/home-types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const FINDING_A = "22222222-2222-4222-8222-222222222221";
const FINDINGS_4 = [
  "33333333-3333-4333-8333-333333333331",
  "33333333-3333-4333-8333-333333333332",
  "33333333-3333-4333-8333-333333333333",
  "33333333-3333-4333-8333-333333333334",
] as const;
const RECOMMENDATIONS_HREF = `/organizations/${ORG_ID}/growth-intelligence#recommendations`;

function scenarioInput(overrides: Partial<RevenueScenarioInput> = {}): RevenueScenarioInput {
  return {
    organizationId: ORG_ID,
    grain: "week",
    history: [
      { label: "2026-08-04", minorUnits: 800_00, currency: "AED" },
      { label: "2026-08-11", minorUnits: 700_00, currency: "AED" },
    ],
    losses: [{ findingId: FINDING_A, minorUnits: 200_00, currency: "AED" }],
    actions: [
      {
        id: "rec-1",
        title: "Recover avoidable cancellations",
        kind: "recommendation",
        status: "Planned",
        href: `/organizations/${ORG_ID}/growth-intelligence`,
        citedFindingId: FINDING_A,
        citedBasisMinorUnits: 200_00,
        citedCurrency: "AED",
        assumptionLow: 0.1,
        assumptionHigh: 0.3,
      },
      {
        id: "ins-9",
        title: "Unpriced idea",
        kind: "insight",
        status: "Acknowledged",
        href: null,
        citedFindingId: null,
        citedBasisMinorUnits: null,
        citedCurrency: null,
        assumptionLow: null,
        assumptionHigh: null,
      },
    ],
    lastObservationDate: "2026-08-17",
    today: "2026-08-20",
    cutoffNote: "Reports through 2026-08-17.",
    coverageNote: "2 reporting channels · weekly buckets.",
    ...overrides,
  };
}

function readySection(): OrganizationHomeView["revenue"] {
  const scenario = buildRevenueScenario(scenarioInput());
  if (scenario.state !== "ready") throw new Error("fixture must be ready");
  return { status: "ready", data: scenario, fetchedAt: "2026-08-20T00:00:00.000Z" };
}

describe("buildRevenueChartRows", () => {
  it("keeps one row per bucket plus one future point, never daily interpolation", () => {
    const section = readySection();
    if (section.status !== "ready" || section.data.state !== "ready") {
      throw new Error("fixture must be ready");
    }
    const { rows } = buildRevenueChartRows(section.data, 1, "2026-08-20");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ label: "2026-08-04" });
    expect(rows[1]?.current).not.toBeNull();
    expect(rows[2]?.label).toBe("20 Sept");
    expect(rows[2]?.actual).toBeNull();
  });

  it("accumulates cumulative horizon points with named end dates", () => {
    const section = readySection();
    if (section.status !== "ready" || section.data.state !== "ready") {
      throw new Error("fixture must be ready");
    }
    const { rows, points } = buildRevenueChartRows(section.data, 3, "2026-08-20");
    expect(rows).toHaveLength(5);
    expect(points.map((point) => point.label)).toEqual(["20 Sept", "20 Oct", "20 Nov"]);
    expect(rows[4]?.current).toBe((rows[2]?.current ?? 0) * 3);
    expect(rows[4]?.high).toBe((rows[2]?.high ?? 0) * 3);
  });
});

describe("HomeRevenue", () => {
  it("renders nothing while disabled", () => {
    const { container } = render(
      <HomeRevenue organizationId={ORG_ID} section={{ status: "disabled" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the three figures, the top recommendation, and the unquantified row with its status", () => {
    render(<HomeRevenue organizationId={ORG_ID} section={readySection()} />);

    expect(screen.getByRole("heading", { name: "Current vs projected growth" })).toBeTruthy();
    expect(screen.getByText("Rough estimate")).toBeTruthy();
    expect(screen.getByText("Latest reported revenue")).toBeTruthy();
    expect(screen.getByText("Current course · 1 month")).toBeTruthy();
    expect(screen.getByText("With the included actions")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Top 3 AI recommendations" })).toBeTruthy();
    expect(screen.getByText(/33\.3–100% of estimated upside/)).toBeTruthy();
    expect(screen.getByText("Not yet quantified")).toBeTruthy();
    expect(screen.getByText("Acknowledged")).toBeTruthy();
    expect(screen.getByText("Planned")).toBeTruthy();
    expect(screen.getByText(/Reports through 2026-08-17/)).toBeTruthy();
    expect(screen.getByRole("link", { name: /View more/ }).getAttribute("href")).toBe(
      RECOMMENDATIONS_HREF,
    );
  });

  it("ranks quantified shares by uplift money and shows only the top 3", () => {
    const ranked = [
      { id: "rec-small", title: "Small win", basis: 100_00 },
      { id: "rec-large", title: "Large win", basis: 400_00 },
      { id: "rec-mid", title: "Mid win", basis: 200_00 },
      { id: "rec-mid-high", title: "Mid-high win", basis: 300_00 },
    ];
    const section: OrganizationHomeView["revenue"] = {
      status: "ready",
      fetchedAt: "2026-08-20T00:00:00.000Z",
      data: buildRevenueScenario(
        scenarioInput({
          losses: ranked.map((entry, index) => ({
            findingId: FINDINGS_4[index] as string,
            minorUnits: entry.basis,
            currency: "AED",
          })),
          actions: ranked.map((entry, index) => ({
            id: entry.id,
            title: entry.title,
            kind: "recommendation" as const,
            status: "Planned",
            href: null,
            citedFindingId: FINDINGS_4[index] as string,
            citedBasisMinorUnits: entry.basis,
            citedCurrency: "AED",
            assumptionLow: 0.5,
            assumptionHigh: 1,
          })),
        }),
      ),
    };
    if (section.status !== "ready" || section.data.state !== "ready") {
      throw new Error("fixture must be ready");
    }
    expect(section.data.shares).toHaveLength(4);

    render(<HomeRevenue organizationId={ORG_ID} section={section} />);

    const heading = screen.getByRole("heading", { name: "Top 3 AI recommendations" });
    const list = heading.nextElementSibling;
    expect(list?.tagName).toBe("UL");
    const text = list?.textContent ?? "";
    for (const title of ["Large win", "Mid-high win", "Mid win"]) {
      expect(text).toContain(title);
    }
    expect(text).not.toContain("Small win");
    const order = ["Large win", "Mid-high win", "Mid win"].map((title) => text.indexOf(title));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(screen.getByRole("link", { name: /View more/ }).getAttribute("href")).toBe(
      RECOMMENDATIONS_HREF,
    );
  });

  it("caps the not-yet-quantified list at 3 rows", () => {
    const section: OrganizationHomeView["revenue"] = {
      status: "ready",
      fetchedAt: "2026-08-20T00:00:00.000Z",
      data: buildRevenueScenario(
        scenarioInput({
          actions: [
            {
              id: "rec-1",
              title: "Recover avoidable cancellations",
              kind: "recommendation",
              status: "Planned",
              href: `/organizations/${ORG_ID}/growth-intelligence`,
              citedFindingId: FINDING_A,
              citedBasisMinorUnits: 200_00,
              citedCurrency: "AED",
              assumptionLow: 0.1,
              assumptionHigh: 0.3,
            },
            ...["First gap", "Second gap", "Third gap", "Fourth gap", "Fifth gap"].map(
              (title, index) => ({
                id: `ins-${index + 1}`,
                title,
                kind: "insight" as const,
                status: "Acknowledged",
                href: null,
                citedFindingId: null,
                citedBasisMinorUnits: null,
                citedCurrency: null,
                assumptionLow: null,
                assumptionHigh: null,
              }),
            ),
          ],
        }),
      ),
    };
    if (section.status !== "ready" || section.data.state !== "ready") {
      throw new Error("fixture must be ready");
    }
    expect(section.data.shares).toHaveLength(1);
    expect(section.data.unquantified).toHaveLength(5);

    render(<HomeRevenue organizationId={ORG_ID} section={section} />);

    const heading = screen.getByRole("heading", { name: "Not yet quantified" });
    const list = heading.nextElementSibling;
    expect(list?.tagName).toBe("UL");
    expect(list?.querySelectorAll(":scope > li")).toHaveLength(3);
    const text = list?.textContent ?? "";
    for (const title of ["First gap", "Second gap", "Third gap"]) {
      expect(text).toContain(title);
    }
    expect(text).not.toContain("Fourth gap");
    expect(text).not.toContain("Fifth gap");
    expect(screen.getByRole("link", { name: /View more/ }).getAttribute("href")).toBe(
      RECOMMENDATIONS_HREF,
    );
  });

  it("keeps unquantified reasons collapsed with an Estimate pending placeholder", () => {
    render(<HomeRevenue organizationId={ORG_ID} section={readySection()} />);

    expect(screen.queryByText(/no cited monetary basis/)).toBeNull();
    const toggle = screen.getByRole("button", { name: "Show details for Unpriced idea" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).not.toBeNull();
    const regionId = toggle.getAttribute("aria-controls") as string;
    expect(document.getElementById(regionId)).toBeNull();
    expect(screen.getByText("Estimate pending")).toBeTruthy();
  });

  it("reveals the exact server reason on tap and collapses on second tap", () => {
    render(<HomeRevenue organizationId={ORG_ID} section={readySection()} />);

    const toggle = screen.getByRole("button", { name: "Show details for Unpriced idea" });
    fireEvent.click(toggle);
    const expandedToggle = screen.getByRole("button", { name: "Hide details for Unpriced idea" });
    expect(expandedToggle.getAttribute("aria-expanded")).toBe("true");
    const reason = screen.getByText(
      "Not yet quantified: no cited monetary basis with a supported response range yet.",
    );
    expect(reason.getAttribute("id")).toBe(expandedToggle.getAttribute("aria-controls"));
    expect(reason).toBeTruthy();
    fireEvent.click(expandedToggle);
    expect(
      screen
        .getByRole("button", { name: "Show details for Unpriced idea" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(screen.queryByText(/no cited monetary basis/)).toBeNull();
  });

  it("renders plain title text for unquantified rows without href", () => {
    render(<HomeRevenue organizationId={ORG_ID} section={readySection()} />);

    const title = screen.getByText("Unpriced idea");
    expect(title.tagName).toBe("SPAN");
    expect(title.closest("a")).toBeNull();
  });

  it("keeps View more visible when no recommended actions are on file", () => {
    const empty: OrganizationHomeView["revenue"] = {
      status: "ready",
      fetchedAt: "2026-08-20T00:00:00.000Z",
      data: buildRevenueScenario(scenarioInput({ losses: [], actions: [] })),
    };
    if (empty.status !== "ready" || empty.data.state !== "ready") {
      throw new Error("fixture must be ready");
    }
    render(<HomeRevenue organizationId={ORG_ID} section={empty} />);

    expect(screen.getByText("No recommended actions are on file yet.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Top 3 AI recommendations" })).toBeNull();
    expect(screen.getByRole("link", { name: /View more/ }).getAttribute("href")).toBe(
      RECOMMENDATIONS_HREF,
    );
  });

  it("states the refusal reason with no chart", () => {
    const refused = buildRevenueScenario(scenarioInput({ history: [] }));
    if (refused.state !== "refused") throw new Error("fixture must refuse");
    render(
      <HomeRevenue
        organizationId={ORG_ID}
        section={{ status: "ready", data: refused, fetchedAt: "2026-08-20T00:00:00.000Z" }}
      />,
    );
    expect(screen.getByText(refused.reason)).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("marks staleness as an explicit gap", () => {
    render(
      <HomeRevenue
        organizationId={ORG_ID}
        section={{
          status: "ready",
          data: buildRevenueScenario(
            scenarioInput({ lastObservationDate: "2026-08-01", today: "2026-08-20" }),
          ),
          fetchedAt: "2026-08-20T00:00:00.000Z",
        }}
      />,
    );
    expect(screen.getByText(/Shown as a gap, not hidden/)).toBeTruthy();
  });

  it("swaps in the proposed scenario after the button posts", async () => {
    const proposed = buildRevenueScenario(
      scenarioInput({
        actions: [
          {
            id: "rec-1",
            title: "Recover avoidable cancellations",
            kind: "recommendation",
            status: "Planned",
            href: null,
            citedFindingId: FINDING_A,
            citedBasisMinorUnits: 200_00,
            citedCurrency: "AED",
            assumptionLow: 0.5,
            assumptionHigh: 0.8,
          },
        ],
      }),
    );
    const seen: unknown[][] = [];
    const fetchMock = vi.fn(async (...args: unknown[]) => {
      seen.push(args);
      return Response.json({ scenario: proposed, aiNote: "Model-proposed ranges applied." });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<HomeRevenue organizationId={ORG_ID} section={readySection()} />);

    fireEvent.click(screen.getByRole("button", { name: /Propose rough estimates/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(String(seen[0]?.[0])).toContain(`/api/organizations/${ORG_ID}/revenue/proposals`);
    await waitFor(() => expect(screen.getByText("Model-proposed ranges applied.")).toBeTruthy());
  });

  it("switches horizons and keeps the pulse tip on the current course", () => {
    render(<HomeRevenue organizationId={ORG_ID} section={readySection()} />);

    expect(screen.getByText("Current course · 1 month")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "3M" }));
    expect(screen.getByText("Current course · 3 months")).toBeTruthy();
    expect(screen.getByText(/Cumulative to 20 Nov/)).toBeTruthy();
  });

  it("renders the racing tip only on the latest current-course point", () => {
    const { container, rerender } = render(
      <PulsingTipDot cx={10} cy={20} index={4} lastIndex={4} />,
    );
    expect(container.querySelector('circle[class*="revenuePulse"]')).not.toBeNull();
    rerender(<PulsingTipDot cx={10} cy={20} index={2} lastIndex={4} />);
    expect(container.querySelector('circle[class*="revenuePulse"]')).toBeNull();
  });

  it("keeps the current course when proposals fail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "busy" }, { status: 503 })),
    );
    render(<HomeRevenue organizationId={ORG_ID} section={readySection()} />);

    fireEvent.click(screen.getByRole("button", { name: /Propose rough estimates/ }));
    await waitFor(() =>
      expect(screen.getByText(/Rough estimates are unavailable right now/)).toBeTruthy(),
    );
    expect(screen.getByText(/Latest reported revenue/)).toBeTruthy();
  });
});

describe("growthPeriodSubtitle", () => {
  it("names a whole calendar month", () => {
    expect(growthPeriodSubtitle(buildBehindGrowthView(ORG_ID))).toBe(
      "Revenue this month · September 2026",
    );
  });

  it("prints exact start and end dates for longer fixed periods", () => {
    const section = buildBehindGrowthSection(ORG_ID);
    if (section.state !== "ready") throw new Error("fixture must be ready");
    expect(growthPeriodSubtitle(section.views[3])).toBe(
      "Revenue over this period · 1 Sep–30 Nov 2026",
    );
  });
});

describe("growthFooterLine", () => {
  it("states projection, reports and scope on one line", () => {
    expect(growthFooterLine(buildBehindGrowthView(ORG_ID))).toBe(
      "Projection set 1 Sep · Reports through 21 Sep · 2 channels",
    );
  });
});

describe("HomeRevenue growth section", () => {
  it("renders the behind fixture with its stable identity, header and rail", () => {
    render(
      <HomeRevenue
        organizationId={ORG_ID}
        section={{ status: "disabled" }}
        growth={buildBehindGrowthSection(ORG_ID)}
      />,
    );
    const section = screen.getByRole("region", { name: "Current vs projected growth" });
    expect(section.getAttribute("id")).toBe("home-revenue");
    expect(screen.getByRole("heading", { name: "Current vs projected growth" })).toBeTruthy();
    expect(screen.getByText("Revenue this month · September 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 month" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByText("Current · 21 Sep")).toBeTruthy();
    expect(screen.getByText("AED 60,000")).toBeTruthy();
    expect(screen.getByText("Below the projection")).toBeTruthy();
    expect(screen.getByText("AED 24,000 behind")).toBeTruthy();
    expect(
      screen.getByText("Projection set 1 Sep · Reports through 21 Sep · 2 channels"),
    ).toBeTruthy();
    expect(screen.getByText(/How this is estimated/)).toBeTruthy();
  });

  it("renders the ahead fixture with its own verdict", () => {
    render(
      <HomeRevenue
        organizationId={ORG_ID}
        section={{ status: "disabled" }}
        growth={buildAheadGrowthSection(ORG_ID)}
      />,
    );
    expect(screen.getByText("Above the projection")).toBeTruthy();
    expect(screen.getByText("AED 98,000")).toBeTruthy();
    expect(screen.getByText("AED 14,000 ahead")).toBeTruthy();
    expect(screen.getByText("AED 14k ahead")).toBeTruthy();
  });

  it("switches horizons to the stored view without reforecasting", () => {
    render(
      <HomeRevenue
        organizationId={ORG_ID}
        section={{ status: "disabled" }}
        growth={buildBehindGrowthSection(ORG_ID)}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "3 months" }));
    expect(screen.getByText("Projection not set for this period")).toBeTruthy();
    expect(screen.queryByText("Below the projection")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "1 month" }));
    expect(screen.getByText("Below the projection")).toBeTruthy();
  });

  it("shows a shaped failure with retry when growth reads fail", () => {
    render(
      <HomeRevenue
        organizationId={ORG_ID}
        section={{ status: "disabled" }}
        growth={{ state: "failed", reasonCode: "SOURCE_READ_FAILED" }}
      />,
    );
    expect(screen.getByText("Growth outlook is unavailable right now")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("falls back to the legacy section while growth is disabled", () => {
    render(
      <HomeRevenue
        organizationId={ORG_ID}
        section={readySection()}
        growth={{ state: "disabled" }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Top 3 AI recommendations" })).toBeTruthy();
  });

  it("keeps the frozen projection byte-identical between behind and ahead", () => {
    const behind = buildBehindGrowthView(ORG_ID);
    const ahead = buildAheadGrowthView(ORG_ID);
    expect(behind.projectionId).toBe(ahead.projectionId);
    expect(behind.projectionDigest).toBe(ahead.projectionDigest);
    const projectedOf = (view: typeof behind) =>
      view.points.map((point) => [
        point.date,
        point.projectedLowMinor,
        point.projectedCentralMinor,
        point.projectedHighMinor,
      ]);
    expect(projectedOf(behind)).toEqual(projectedOf(ahead));
    expect(behind.latestComparison).toMatchObject({ state: "behind" });
    expect(ahead.latestComparison).toMatchObject({ state: "ahead" });
  });
});

describe("growthHorizonAnnouncement", () => {
  it("announces period plus the latest comparison for a ready view", () => {
    expect(growthHorizonAnnouncement(buildBehindGrowthView(ORG_ID))).toMatch(
      /Revenue this month · September 2026 — .*behind as of 21 Sep/,
    );
  });

  it("announces the state title when no comparison exists", () => {
    const section = buildBehindGrowthSection(ORG_ID);
    if (section.state !== "ready") throw new Error("fixture must be ready");
    expect(growthHorizonAnnouncement(section.views[3])).toMatch(
      /Revenue over this period.*Projection not set for this period/,
    );
  });
});

describe("HomeRevenue growth horizon switching", () => {
  function growthHome() {
    return (
      <HomeRevenue
        organizationId={ORG_ID}
        section={{ status: "disabled" }}
        growth={buildBehindGrowthSection(ORG_ID)}
      />
    );
  }

  it("clears the pinned tooltip, announces politely and keeps the projection identity", () => {
    render(growthHome());
    const section = screen.getByRole("region", { name: "Current vs projected growth" });
    expect(section.getAttribute("data-projection-digest")).toBe("fixture-digest-september-2026-v1");
    const group = screen.getByRole("group", { name: /Growth chart/ });
    fireEvent.keyDown(group, { key: "ArrowRight" });
    fireEvent.keyDown(group, { key: "Enter" });
    expect(screen.getByRole("tooltip").textContent).toContain("Pinned");

    fireEvent.click(screen.getByRole("button", { name: "3 months" }));
    expect(screen.queryByRole("tooltip")).toBeNull();
    expect(screen.getByTestId("growth-horizon-announcement").textContent).toMatch(
      /Revenue over this period.*Projection not set for this period/,
    );
    // Atomic switch: no stale advice under the new period label.
    expect(screen.queryByText("Below the projection")).toBeNull();
    expect(screen.getByText("Projection not set for this period")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "1 month" }));
    expect(screen.getByText("Below the projection")).toBeTruthy();
    expect(
      screen
        .getByRole("region", { name: "Current vs projected growth" })
        .getAttribute("data-projection-digest"),
    ).toBe("fixture-digest-september-2026-v1");
  });

  it("leaves the right panel at the latest report while the chart is explored", () => {
    render(growthHome());
    const group = screen.getByRole("group", { name: /Growth chart/ });
    fireEvent.keyDown(group, { key: "End" });
    fireEvent.keyDown(group, { key: "Enter" });
    expect(screen.getByText("AS OF 21 SEP")).toBeTruthy();
    expect(screen.getByText("AED 24,000 behind")).toBeTruthy();
  });

  it("opens the method dialog from the footer with the accessible value table", () => {
    render(growthHome());
    fireEvent.click(screen.getByRole("button", { name: /How this is estimated/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
  });
});

describe("HomeRevenue growth degraded states", () => {
  function renderGrowthView(view: ReturnType<typeof buildBehindGrowthView>) {
    const section = buildBehindGrowthSection(ORG_ID);
    if (section.state !== "ready") throw new Error("fixture must be ready");
    render(
      <HomeRevenue
        organizationId={ORG_ID}
        section={{ status: "disabled" }}
        growth={{ ...section, views: { ...section.views, 1: view } }}
      />,
    );
  }

  it("plots the green outlook beside the panel for an upcoming period", () => {
    const base = buildBehindGrowthView(ORG_ID);
    renderGrowthView({
      ...base,
      state: "upcoming",
      reasonCode: null,
      latestComparableDate: null,
      latestComparison: null,
    });
    expect(screen.getByText(/Tracking starts 1 Sep/)).toBeTruthy();
    expect(screen.queryByText("Below the projection")).toBeNull();
    expect(screen.queryByText("Above the projection")).toBeNull();
    // Green outlook still plotted, blue absent.
    expect(screen.getByRole("img", { name: /Projected \(frozen estimate\)/ })).toBeTruthy();
  });

  it("waits for reports without inventing current values", () => {
    const base = buildBehindGrowthView(ORG_ID);
    renderGrowthView({
      ...base,
      state: "awaiting_reports",
      reasonCode: null,
      latestComparableDate: null,
      latestComparison: null,
    });
    expect(screen.getByText("Waiting for reported revenue")).toBeTruthy();
  });

  it("keeps partial points plotted with a missing-scope explanation", () => {
    const base = buildBehindGrowthView(ORG_ID);
    renderGrowthView({
      ...base,
      state: "unavailable",
      reasonCode: "COVERAGE_GAP",
      latestComparableDate: null,
      latestComparison: null,
    });
    expect(screen.getByText("Comparison unavailable for the latest reports")).toBeTruthy();
    expect(screen.getByRole("img", { name: /Current \(reported revenue\)/ })).toBeTruthy();
  });

  it("never plots a combined amount for mixed currency and offers the permitted review link", () => {
    const base = buildBehindGrowthView(ORG_ID);
    renderGrowthView({
      ...base,
      state: "unavailable",
      reasonCode: "CURRENCY_MISMATCH",
      points: [],
      latestComparableDate: null,
      latestComparison: null,
    });
    expect(screen.getByText(/mixed currency/)).toBeTruthy();
    expect(screen.getByText(/no combined amount is plotted/)).toBeTruthy();
    const link = screen.getByRole("link", { name: /Review the source reports/ });
    expect(link.getAttribute("href")).toContain(`/organizations/${ORG_ID}/`);
  });

  it("names overlapping reports instead of picking a side", () => {
    const base = buildBehindGrowthView(ORG_ID);
    renderGrowthView({
      ...base,
      state: "unavailable",
      reasonCode: "OVERLAP_CONFLICT",
      points: [],
      latestComparableDate: null,
      latestComparison: null,
    });
    expect(screen.getByText(/overlapping reports/)).toBeTruthy();
  });

  it("labels a stale complete observation with its date, never as today", () => {
    const base = buildBehindGrowthView(ORG_ID);
    renderGrowthView({
      ...base,
      freshness: { status: "stale", note: "Latest complete report: 21 Sep." },
    });
    expect(screen.getByText("Latest complete report: 21 Sep.")).toBeTruthy();
    expect(screen.queryByText(/today/i)).toBeNull();
  });

  it("renders only permitted source labels — denied titles stay out of the DOM", () => {
    const base = buildBehindGrowthView(ORG_ID);
    renderGrowthView(base);
    fireEvent.click(screen.getByRole("button", { name: /How this is estimated/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("2 reporting channels");
    expect(dialog.textContent).not.toMatch(/confidential|restricted|hidden/i);
  });
});

describe("growth fixture boundary", () => {
  function sourceFiles(directory: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) {
        found.push(...sourceFiles(full));
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      found.push(full);
    }
    return found;
  }

  it("is never imported by production source files", () => {
    const offenders = sourceFiles("src").filter((path) => {
      if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return false;
      if (path.endsWith("home-growth-fixtures.ts")) return false;
      return readFileSync(path, "utf8").includes("home-growth-fixtures");
    });
    expect(offenders).toEqual([]);
  });

  it("ships no growth-fixture render route under src/app", () => {
    // Scoped to this slice's harness names: an unrelated pre-existing
    // integrations-connections fixture route owns the bare word already.
    const routes = sourceFiles("src/app").filter((path) => {
      if (path.endsWith(".test.ts") || path.endsWith(".test.tsx")) return false;
      return /overview-growth|growth-harness|growth-fixture/i.test(path);
    });
    expect(routes).toEqual([]);
  });
});
