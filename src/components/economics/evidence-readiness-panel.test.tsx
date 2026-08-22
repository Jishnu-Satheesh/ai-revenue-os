// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EvidenceReadinessPanel } from "@/components/economics/evidence-readiness-panel";
import type {
  EvidenceReadinessView,
  ReadinessTupleView,
} from "@/modules/economics/application/readiness-service";

const COST_HREF = "/organizations/org-1/onboarding?section=cost_structure";
const REPORTS_HREF = "/organizations/org-1/integrations?tab=data-sources";

function tuple(overrides: Partial<ReadinessTupleView> = {}): ReadinessTupleView {
  return {
    channelId: "channel-1",
    branchId: "branch-1",
    periodStart: "2026-08-03",
    periodEnd: "2026-08-29",
    periodTimezone: "Asia/Dubai",
    currency: "AED",
    state: "ready_for_economics",
    reasons: [],
    rolesPresent: ["gross_revenue", "transaction_count"],
    observationIds: ["obs-1"],
    reportPackageIds: ["pkg-1"],
    channelName: "Talabat",
    branchName: "Jumeirah",
    stateLabel: "Ready",
    stateSummary: "The evidence for this period is current, complete, and safe to work from.",
    blockers: [],
    ...overrides,
  };
}

function view(overrides: Partial<EvidenceReadinessView> = {}): EvidenceReadinessView {
  return {
    readModelVersion: 1,
    digest: "a".repeat(64),
    tuples: [tuple()],
    costCoverage: { outcome: "checked", components: [] },
    costSummary: "",
    ...overrides,
  };
}

function renderPanel(overrides: Partial<EvidenceReadinessView> = {}) {
  return render(
    <EvidenceReadinessPanel
      view={view(overrides)}
      costStructureHref={COST_HREF}
      reportsHref={REPORTS_HREF}
    />,
  );
}

afterEach(() => cleanup());

describe("EvidenceReadinessPanel", () => {
  it("says plainly that it calculates nothing", () => {
    renderPanel();

    expect(screen.getByText(/calculates nothing on its own/i)).toBeInTheDocument();
  });

  it("shows the exact recorded dates rather than a calendar month", () => {
    renderPanel();

    expect(screen.getByText(/2026-08-03 to 2026-08-29/)).toBeInTheDocument();
    expect(screen.queryByText(/August/i)).not.toBeInTheDocument();
  });

  it("names the channel, outlet, timezone, and currency as recorded", () => {
    renderPanel();

    expect(screen.getByText("Talabat · Jumeirah")).toBeInTheDocument();
    expect(screen.getByText(/Asia\/Dubai/)).toBeInTheDocument();
    expect(screen.getByText(/AED/)).toBeInTheDocument();
  });

  it("answers what prevents an honest contribution margin", () => {
    renderPanel({
      costSummary:
        "Contribution margin is not calculated because commission, delivery cost and food cost evidence is missing.",
    });

    expect(
      screen.getByText(
        "Contribution margin is not calculated because commission, delivery cost and food cost evidence is missing.",
      ),
    ).toBeInTheDocument();
  });

  it("lists every reason and its next step", () => {
    renderPanel({
      tuples: [
        tuple({
          state: "needs_data",
          stateLabel: "Needs data",
          blockers: [
            {
              explanation: "No order count has arrived for this period.",
              nextStep: "Upload the report that states order counts for these exact dates.",
            },
          ],
        }),
      ],
    });

    expect(screen.getByText("No order count has arrived for this period.")).toBeInTheDocument();
    expect(
      screen.getByText("Upload the report that states order counts for these exact dates."),
    ).toBeInTheDocument();
  });

  it("offers no action for a gap nobody can close", () => {
    renderPanel({
      tuples: [
        tuple({
          state: "ready_for_economics",
          blockers: [
            { explanation: "Comes from provider reports rather than a rate you can enter.", nextStep: null },
          ],
        }),
      ],
      costCoverage: {
        outcome: "checked",
        components: [
          {
            key: "promotion_funding",
            label: "Promotion funding",
            covered: false,
            tier: null,
            operatorCanResolve: false,
          },
        ],
      },
    });

    expect(screen.getByText("Not yet possible")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Add cost structure/i })).not.toBeInTheDocument();
  });

  it("sends a blocked period to the reports it came from", () => {
    renderPanel({
      tuples: [
        tuple({
          state: "blocked",
          stateLabel: "Blocked",
          blockers: [{ explanation: "Two reports cover overlapping dates.", nextStep: "Choose one." }],
        }),
      ],
    });

    expect(screen.getByRole("link", { name: /Open reports/i })).toHaveAttribute(
      "href",
      REPORTS_HREF,
    );
  });

  it("sends a period missing costs to the cost structure", () => {
    renderPanel({ tuples: [tuple({ state: "needs_data", stateLabel: "Needs data" })] });

    expect(screen.getByRole("link", { name: /Add cost structure/i })).toHaveAttribute(
      "href",
      COST_HREF,
    );
  });

  it("reports an unavailable cost read as unchecked, never as all clear", () => {
    renderPanel({ costCoverage: { outcome: "unchecked" } });

    expect(screen.getByText(/could not be read/i)).toBeInTheDocument();
    expect(screen.queryByText(/Every cost the platform knows about/i)).not.toBeInTheDocument();
  });

  it("names a missing cost without ever showing what it costs", () => {
    const { container } = renderPanel({
      costCoverage: {
        outcome: "checked",
        components: [
          { key: "commission", label: "Commission", covered: false, tier: null, operatorCanResolve: true },
        ],
      },
    });

    expect(screen.getByText("Commission")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/\d+(\.\d+)?\s*%/);
    expect(container.textContent).not.toMatch(/AED\s*\d/);
  });

  it("says nothing has been checked when there is no evidence at all", () => {
    renderPanel({ tuples: [] });

    expect(screen.getByText(/No governed report evidence yet/i)).toBeInTheDocument();
    expect(screen.getByText(/not the same as nothing being wrong/i)).toBeInTheDocument();
  });

  it("never calls a partial period trusted", () => {
    renderPanel({
      tuples: [
        tuple({
          state: "partial_evidence",
          stateLabel: "Partial",
          stateSummary: "The evidence for this period is usable but incomplete.",
        }),
      ],
    });

    const list = screen.getByRole("list");
    expect(within(list).queryByText(/\btrusted\b/i)).not.toBeInTheDocument();
    expect(within(list).queryByText(/\bReady\b/)).not.toBeInTheDocument();
  });

  it("renders no workbook value, filename, link to storage, or model output", () => {
    const { container } = renderPanel({
      tuples: [tuple({ state: "partial_evidence", stateLabel: "Partial" })],
    });

    expect(container.textContent).not.toMatch(/\.csv|\.xlsx|https?:\/\/|value_numerator/i);
  });
});
