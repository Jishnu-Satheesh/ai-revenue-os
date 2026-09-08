// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WindowRangePicker } from "@/components/analysis/window-range-picker";

afterEach(cleanup);

const segments = [
  { start: "2026-01-01", end: "2026-02-28" },
  { start: "2026-05-01", end: "2026-08-31" },
];
const dailyWindow = {
  windowStart: "2026-01-01",
  windowEnd: "2026-02-28",
  grain: "day" as const,
  governedRowCount: 554,
};
const monthlyWindow = {
  windowStart: "2026-05-01",
  windowEnd: "2026-08-31",
  grain: "month" as const,
  governedRowCount: 16,
};

function setup(overrides: Partial<React.ComponentProps<typeof WindowRangePicker>> = {}) {
  const onApply = vi.fn();
  render(
    <WindowRangePicker
      segments={segments}
      windows={[dailyWindow, monthlyWindow]}
      selected={{ from: "2026-01-01", to: "2026-01-04" }}
      today="2026-09-07"
      onApply={onApply}
      {...overrides}
    />,
  );
  return { onApply, user: userEvent.setup() };
}

describe("the window range picker", () => {
  it("names the selected range on its trigger", async () => {
    setup();

    // `formatWindow` renders exact recorded dates, never a month name -- its
    // own comment says so, and every other date on this workspace reads the
    // same way. A picker with a second date language would be worse than a
    // verbose label.
    expect(screen.getByRole("button", { name: /2026-01-01 to 2026-01-04/ })).toBeInTheDocument();
  });

  it("offers Last 7 days disabled, and says why", async () => {
    // This client's reports cover January-February and May-August while today
    // is September, so the most natural preset is the one that cannot work.
    // Hiding it would leave an operator wondering; showing it disabled answers
    // the question before it is asked.
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));

    const preset = screen.getByRole("button", { name: /last 7 days/i });
    expect(preset).toBeDisabled();
    expect(preset).toHaveAccessibleDescription(/no approved report covers/i);
  });

  it("applies a preset that does fall inside coverage", async () => {
    const { onApply, user } = setup();
    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));
    await user.click(screen.getByRole("button", { name: /all reported/i }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    // "All reported" is the stretch containing the current selection, not the
    // union across a gap: a range bridging March and April is unanswerable.
    expect(onApply).toHaveBeenCalledWith({ from: "2026-01-01", to: "2026-02-28" });
  });

  it("warns before applying a range the reports cannot resolve", async () => {
    const { user } = setup({ selected: { from: "2026-08-01", to: "2026-08-04" } });
    await user.click(screen.getByRole("button", { name: /2026-08-01/ }));

    const warning = screen.getByRole("status");
    expect(within(warning).getByText(/one figure per month/i)).toBeInTheDocument();
    expect(within(warning).getByText(/2026-05-01.*2026-08-31/)).toBeInTheDocument();
  });

  it("widens to the range that works in one click", async () => {
    const { onApply, user } = setup({ selected: { from: "2026-08-01", to: "2026-08-04" } });
    await user.click(screen.getByRole("button", { name: /2026-08-01/ }));
    await user.click(screen.getByRole("button", { name: /use 2026-08-01 to 2026-08-31/i }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(onApply).toHaveBeenCalledWith({ from: "2026-08-01", to: "2026-08-31" });
  });

  it("does not warn when one of several reports can answer", async () => {
    const { user } = setup({ selected: { from: "2026-01-01", to: "2026-01-04" } });
    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("does not apply anything while the workspace is busy", async () => {
    const { onApply, user } = setup({ disabled: true });
    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));

    expect(onApply).not.toHaveBeenCalled();
  });

  // Not in the brief's seven -- added because none of them exercise the
  // calendar grid itself. Every test above disables a *preset button*; this
  // is the only one that opens the actual day grid and checks a day outside
  // coverage is a genuinely disabled control, not merely a greyed-out one. A
  // styled-but-clickable day would pass every other test in this file.
  it("disables a calendar day that no report covers", async () => {
    // March sits in the gap between the Jan-Feb and May-Aug segments, so
    // every day the grid shows for this month is out of coverage.
    const { user } = setup({ selected: { from: "2026-03-10", to: "2026-03-10" } });
    await user.click(screen.getByRole("button", { name: /2026-03-10/ }));

    expect(screen.getByRole("button", { name: /March 15/ })).toBeDisabled();
  });
});
