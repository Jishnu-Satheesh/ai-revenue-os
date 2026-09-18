// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  growthDateComparability,
  growthStateCopy,
  HomeGrowthFailed,
  HomeGrowthLoading,
  HomeGrowthMethodDialog,
} from "@/components/organizations/home/home-growth-details";
import { buildBehindGrowthView } from "@/components/organizations/home/home-growth-fixtures";
import type { GrowthProgressView } from "@/modules/organizations/application/growth-progress-view";

afterEach(() => {
  cleanup();
});

const ORG_ID = "11111111-1111-4111-8111-111111111111";

describe("growthDateComparability", () => {
  it("names reported, future, gap, overlap and currency states", () => {
    const base = {
      currentMinor: 6_000_000,
      currentCoverage: "complete" as const,
      reasonCode: null,
    };
    expect(growthDateComparability(base)).toBe("Reported");
    expect(
      growthDateComparability({ ...base, currentMinor: null, currentCoverage: "missing" as const, reasonCode: "FUTURE_DATE" }),
    ).toBe("Future date — no current value");
    expect(
      growthDateComparability({ ...base, currentMinor: null, currentCoverage: "missing" as const, reasonCode: "COVERAGE_GAP" }),
    ).toBe("Not reported — incomplete coverage");
    expect(
      growthDateComparability({ ...base, currentMinor: null, currentCoverage: "conflict" as const, reasonCode: "OVERLAP_CONFLICT" }),
    ).toBe("Not comparable — overlapping reports");
    expect(
      growthDateComparability({ ...base, currentMinor: null, currentCoverage: "incomparable" as const, reasonCode: "CURRENCY_MISMATCH" }),
    ).toBe("Not comparable — mixed currency");
  });
});

describe("growthStateCopy", () => {
  function stateView(state: GrowthProgressView["state"], reasonCode: string | null): GrowthProgressView {
    return { ...buildBehindGrowthView(ORG_ID), state, reasonCode };
  }

  it("covers upcoming, awaiting, missing and every unavailable reason", () => {
    expect(growthStateCopy(stateView("upcoming", null)).title).toMatch(/Tracking starts/);
    expect(growthStateCopy(stateView("awaiting_reports", null)).title).toMatch(
      /Waiting for reported revenue/,
    );
    expect(growthStateCopy(stateView("missing", "PROJECTION_MISSING")).title).toMatch(
      /Projection not set/,
    );
    const mixed = growthStateCopy(stateView("unavailable", "CURRENCY_MISMATCH"));
    expect(mixed.title).toMatch(/mixed currency/);
    expect(mixed.body).toMatch(/no combined amount is plotted/);
    const overlap = growthStateCopy(stateView("unavailable", "OVERLAP_CONFLICT"));
    expect(overlap.title).toMatch(/overlapping reports/);
    const gap = growthStateCopy(stateView("unavailable", "COVERAGE_GAP"));
    expect(gap.title).toMatch(/Comparison unavailable for the latest reports/);
  });
});

describe("HomeGrowthMethodDialog", () => {
  it("opens on trigger and shows assumptions, coverage, issue time and the value table", () => {
    render(<HomeGrowthMethodDialog view={buildBehindGrowthView(ORG_ID)} />);
    fireEvent.click(screen.getByRole("button", { name: /How this is estimated/ }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/Estimate fixed/)).toBeTruthy();
    expect(screen.getByText(/1 Sep \(fixed at publication\)/)).toBeTruthy();
    expect(screen.getByText(/2 channels/)).toBeTruthy();
    expect(screen.getByText(/Even-pace assumption/)).toBeTruthy();
    expect(screen.getByText(/planned\s*means intent, not completed work/i)).toBeTruthy();
    expect(screen.getByText(/never a promise/i)).toBeTruthy();
    const table = screen.getByRole("table");
    for (const header of ["Date", "Current", "Projected low", "Projected central", "Projected high", "Comparability"]) {
      expect(within(table).getByText(header)).toBeTruthy();
    }
    // Full amounts with currency, low/central/high and comparability per date.
    expect(within(table).getByText("AED 60,000")).toBeTruthy();
    expect(within(table).getByText("AED 80,000")).toBeTruthy();
    expect(within(table).getByText("AED 84,000")).toBeTruthy();
    expect(within(table).getByText("AED 88,000")).toBeTruthy();
    expect(within(table).getByText("Future date — no current value")).toBeTruthy();
  });

  it("returns focus to the trigger on close", async () => {
    render(<HomeGrowthMethodDialog view={buildBehindGrowthView(ORG_ID)} />);
    const trigger = screen.getByRole("button", { name: /How this is estimated/ });
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it("renders only permitted sources and rows — denied titles never reach the DOM", () => {
    const view = buildBehindGrowthView(ORG_ID);
    render(<HomeGrowthMethodDialog view={view} />);
    fireEvent.click(screen.getByRole("button", { name: /How this is estimated/ }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.textContent).toContain("2 reporting channels");
    expect(dialog.textContent).not.toMatch(/confidential|restricted/i);
  });
});

describe("HomeGrowthLoading", () => {
  it("reserves space with blanks and no example amounts", () => {
    const { container } = render(<HomeGrowthLoading />);
    expect(screen.getByRole("status", { name: "Loading growth outlook" })).toBeTruthy();
    expect(container.textContent).not.toMatch(/AED|60,000/);
  });
});

describe("HomeGrowthFailed", () => {
  it("keeps the retained view labelled with its report date and offers retry", () => {
    const onRetry = vi.fn();
    render(<HomeGrowthFailed retainedView={buildBehindGrowthView(ORG_ID)} onRetry={onRetry} />);
    expect(screen.getByText(/Showing the last readable view/)).toBeTruthy();
    expect(screen.getByText(/reports through 21 Sep/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("uses the shaped failure copy with no retained view", () => {
    render(<HomeGrowthFailed retainedView={null} onRetry={() => {}} />);
    expect(screen.getByText(/could not be read/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });
});
