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
    occurredAt: "2026-08-19T10:00:00.000Z",
    ...overrides,
  };
}

describe("AllocationLedger", () => {
  it("says plainly when nothing has been decided yet", () => {
    render(<AllocationLedger events={[]} />);
    expect(screen.getByText(/no allocation decisions yet/i)).toBeInTheDocument();
  });

  it("shows a pause in plain words, with money and a local time", () => {
    render(<AllocationLedger events={[event()]} timeZone="Asia/Dubai" currency="AED" />);

    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText(/spend ceiling/i)).toBeInTheDocument();
    expect(screen.getByText(/stops a variant the moment it spends more/i)).toBeInTheDocument();
    expect(screen.getByText("AED 120.00")).toBeInTheDocument();
    expect(screen.getByText("AED 100.00")).toBeInTheDocument();
    expect(screen.getByText(/spend went above the approved ceiling/i)).toBeInTheDocument();
    expect(screen.getByText(/decided automatically/i)).toBeInTheDocument();
    // 2026-08-19T10:00Z is 14:00 in Dubai, and renders as words, not raw UTC.
    expect(screen.getByText(/19 Aug 2026, 14:00/i)).toBeInTheDocument();

    // The backend vocabulary never reaches the screen.
    expect(screen.queryByText(/diagnostic\.spend_ceiling/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/spend_ceiling_exceeded/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/2026-08-19T10:00:00\.000Z/i)).not.toBeInTheDocument();
  });

  it("names the margin rule and its quality in words", () => {
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
        currency="AED"
      />,
    );

    expect(screen.getByText(/contribution margin floor/i)).toBeInTheDocument();
    expect(screen.getByText(/contribution margin fell below the floor/i)).toBeInTheDocument();
    expect(screen.getByText("Measured")).toBeInTheDocument();
    expect(screen.queryByText(/margin\.contribution_floor/i)).not.toBeInTheDocument();
  });

  it("shows a click-through rate as a percentage", () => {
    render(
      <AllocationLedger
        events={[
          event({
            ruleKey: "diagnostic.ctr_floor",
            observedValue: 0.042,
            threshold: 0.05,
            action: "no_action",
            reasonCode: "no_threshold_breached",
          }),
        ]}
      />,
    );

    expect(screen.getByText("4.2%")).toBeInTheDocument();
    expect(screen.getByText("5.0%")).toBeInTheDocument();
  });

  it("renders a no_action decision as a visible choice, not an absence", () => {
    render(
      <AllocationLedger
        events={[event({ action: "no_action", reasonCode: "no_threshold_breached" })]}
        currency="AED"
      />,
    );

    expect(screen.getByText("No action")).toBeInTheDocument();
    expect(screen.getByText(/every threshold held/i)).toBeInTheDocument();
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
