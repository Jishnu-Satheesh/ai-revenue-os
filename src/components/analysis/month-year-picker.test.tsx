// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { MonthYearPicker } from "@/components/analysis/month-year-picker";

/** Opens a pill-style select, whose options live in a Radix portal. */
async function openPicker(label: string) {
  fireEvent.pointerDown(screen.getByLabelText(label), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  return within(await screen.findByRole("listbox")).getAllByRole("option");
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

const MONTHS = ["2025-12", "2026-01", "2026-02"];

describe("MonthYearPicker", () => {
  it("carries the same Year and Month labels as the audit picker", () => {
    render(<MonthYearPicker months={MONTHS} selectedMonth="2026-01" onSelectMonth={() => {}} />);

    expect(screen.getByLabelText("Year to analyse")).toBeTruthy();
    expect(screen.getByLabelText("Month to analyse")).toBeTruthy();
  });

  it("offers only the years the months cover", async () => {
    render(<MonthYearPicker months={MONTHS} selectedMonth="2026-01" onSelectMonth={() => {}} />);

    const options = await openPicker("Year to analyse");
    expect(options.map((option) => option.textContent)).toEqual(["2025", "2026"]);
  });

  it("disables months outside the reported horizon rather than hiding them", async () => {
    render(<MonthYearPicker months={MONTHS} selectedMonth="2026-01" onSelectMonth={() => {}} />);

    const options = await openPicker("Month to analyse");
    expect(options.map((option) => option.textContent)).toEqual([
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ]);
    const march = options.find((option) => option.textContent === "March");
    expect(march?.getAttribute("aria-disabled")).toBe("true");
  });

  it("follows the selection when the month changes underneath it", async () => {
    // Browser Back is exactly this: new props, no remount. The Year control
    // used to keep the year last clicked, which left the Month control with no
    // matching option and therefore blank.
    const { rerender } = render(
      <MonthYearPicker months={MONTHS} selectedMonth="2026-01" onSelectMonth={() => {}} />,
    );

    const years = await openPicker("Year to analyse");
    fireEvent.click(years.find((option) => option.textContent === "2025")!);
    rerender(<MonthYearPicker months={MONTHS} selectedMonth="2026-02" onSelectMonth={() => {}} />);

    expect(screen.getByLabelText("Year to analyse").textContent).toContain("2026");
    expect(screen.getByLabelText("Month to analyse").textContent).toContain("February");
  });

  it("keeps showing a year the reader picked while the selection catches up", async () => {
    render(<MonthYearPicker months={MONTHS} selectedMonth="2026-01" onSelectMonth={() => {}} />);

    const years = await openPicker("Year to analyse");
    fireEvent.click(years.find((option) => option.textContent === "2025")!);

    expect(screen.getByLabelText("Year to analyse").textContent).toContain("2025");
  });

  it("reports the chosen month, not the window behind it", async () => {
    const onSelectMonth = vi.fn();
    render(
      <MonthYearPicker months={MONTHS} selectedMonth="2026-01" onSelectMonth={onSelectMonth} />,
    );

    const options = await openPicker("Month to analyse");
    fireEvent.click(options.find((option) => option.textContent === "February")!);

    expect(onSelectMonth).toHaveBeenCalledWith("2026-02");
  });
});
