// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildRevenueChartRows,
  HomeRevenue,
  PulsingTipDot,
} from "@/components/organizations/home/home-revenue";
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

  it("shows the three figures, the share, and the unquantified row with its status", () => {
    render(<HomeRevenue organizationId={ORG_ID} section={readySection()} />);

    expect(screen.getByRole("heading", { name: "Current vs projected growth" })).toBeTruthy();
    expect(screen.getByText("Rough estimate")).toBeTruthy();
    expect(screen.getByText("Latest reported revenue")).toBeTruthy();
    expect(screen.getByText("Current course · 1 month")).toBeTruthy();
    expect(screen.getByText("With the included actions")).toBeTruthy();
    expect(screen.getByText(/33\.3–100% of estimated upside/)).toBeTruthy();
    expect(screen.getByText("Not yet quantified")).toBeTruthy();
    expect(screen.getByText("Acknowledged")).toBeTruthy();
    expect(screen.getByText("Planned")).toBeTruthy();
    expect(screen.getByText(/Reports through 2026-08-17/)).toBeTruthy();
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
    const { container } = render(<HomeRevenue organizationId={ORG_ID} section={readySection()} />);

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
