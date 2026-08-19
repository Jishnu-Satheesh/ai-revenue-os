// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  AllocationLedger,
  type AllocationLedgerEvent,
} from "@/components/campaigns/allocation-ledger";

afterEach(cleanup);

function event(overrides: Partial<AllocationLedgerEvent> = {}): AllocationLedgerEvent {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    variantId: "f0000000-0000-4000-8000-000000000001",
    ruleKey: "diagnostic.spend_ceiling",
    ruleVersion: "v1",
    observedValue: 12_000,
    threshold: 10_000,
    resolvedMarginMinor: null,
    resolvedMarginGrade: null,
    action: "pause",
    reasonCode: "spend_ceiling_exceeded",
    actor: "agent",
    occurredAt: "2026-08-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("AllocationLedger", () => {
  it("says plainly when nothing has been decided yet", () => {
    render(<AllocationLedger events={[]} />);
    expect(screen.getByText(/no allocation decisions yet/i)).toBeInTheDocument();
  });

  it("shows, per pause, the rule, observed value, threshold, and time", () => {
    render(<AllocationLedger events={[event()]} />);

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText(/diagnostic\.spend_ceiling/i)).toBeInTheDocument();
    expect(screen.getByText("12000")).toBeInTheDocument();
    expect(screen.getByText("10000")).toBeInTheDocument();
    expect(screen.getByText(/2026-08-19T12:00:00\.000Z/i)).toBeInTheDocument();
    expect(screen.getByText(/spend_ceiling_exceeded/i)).toBeInTheDocument();
  });

  it("shows the resolved margin and its grade where a margin rule fired", () => {
    render(
      <AllocationLedger
        events={[
          event({
            ruleKey: "margin.contribution_floor",
            observedValue: 4_200,
            threshold: 5_000,
            resolvedMarginMinor: 4_200,
            resolvedMarginGrade: "measured",
            reasonCode: "margin_below_floor",
          }),
        ]}
      />,
    );

    expect(screen.getByText(/margin\.contribution_floor/i)).toBeInTheDocument();
    expect(screen.getByText(/4200 \(measured\)/i)).toBeInTheDocument();
  });

  it("renders a no_action decision as a visible choice, not an absence", () => {
    render(
      <AllocationLedger
        events={[
          event({
            action: "no_action",
            observedValue: 5_000,
            threshold: 10_000,
            reasonCode: "no_threshold_breached",
          }),
        ]}
      />,
    );

    expect(screen.getByText("No action")).toBeInTheDocument();
    expect(screen.getByText(/no_threshold_breached/i)).toBeInTheDocument();
  });

  it("shows a placeholder rather than a fabricated number when a value is missing", () => {
    render(
      <AllocationLedger
        events={[
          event({
            action: "no_action",
            observedValue: null,
            threshold: null,
            reasonCode: "margin_grade_insufficient",
          }),
        ]}
      />,
    );

    // Two em dashes: one for observed, one for threshold.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });
});
