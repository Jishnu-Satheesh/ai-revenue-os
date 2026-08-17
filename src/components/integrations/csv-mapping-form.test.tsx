// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CsvMappingForm,
  mappingNeedsPeriod,
  suggestTargetField,
  toColumnMapping,
  type CsvColumnMappingEntry,
} from "@/components/integrations/csv-mapping-form";

const metricTargets = [
  { key: "revenue.gross", label: "Gross revenue", importable: true },
  { key: "transactions.count", label: "Transactions", importable: true },
  { key: "listing.conversion_rate", label: "Conversion rate", importable: false },
];

function entries(overrides: Partial<CsvColumnMappingEntry>[] = []): CsvColumnMappingEntry[] {
  const base: CsvColumnMappingEntry[] = [
    { header: "Date", include: true, targetField: "" },
    { header: "Total", include: true, targetField: "" },
  ];
  return base.map((entry, index) => ({ ...entry, ...overrides[index] }));
}

describe("suggestTargetField", () => {
  it("slugifies a header without guessing a metric key", () => {
    // Deciding that "Total" means revenue.gross is the operator's call. Guessing
    // it here would put an unreviewed mapping behind a real number.
    expect(suggestTargetField("Gross Revenue")).toBe("gross_revenue");
    expect(suggestTargetField("Total")).toBe("total");
  });
});

describe("mappingNeedsPeriod", () => {
  it("requires a period only once a metric key is claimed", () => {
    expect(
      mappingNeedsPeriod(entries([{ targetField: "order_id" }, { targetField: "notes" }])),
    ).toBe(false);
    expect(
      mappingNeedsPeriod(entries([{ targetField: "order_id" }, { targetField: "revenue.gross" }])),
    ).toBe(true);
    expect(
      mappingNeedsPeriod(entries([{ targetField: "period" }, { targetField: "revenue.gross" }])),
    ).toBe(false);
  });

  it("ignores excluded columns", () => {
    expect(
      mappingNeedsPeriod([
        { header: "Total", include: false, targetField: "revenue.gross" },
        { header: "Date", include: true, targetField: "period" },
      ]),
    ).toBe(false);
  });
});

afterEach(() => cleanup());

describe("CsvMappingForm", () => {
  it("offers registered metric keys and row context, and records the choice", async () => {
    const onChange = vi.fn();

    render(
      <CsvMappingForm entries={entries()} metricTargets={metricTargets} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Target field for Total" }));
    const listbox = await screen.findByRole("listbox");

    expect(within(listbox).getByText("period")).toBeInTheDocument();
    expect(within(listbox).getByText("revenue.gross")).toBeInTheDocument();

    fireEvent.click(within(listbox).getByText("revenue.gross"));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ header: "Date", targetField: "" }),
      expect.objectContaining({ header: "Total", targetField: "revenue.gross" }),
    ]);
  });

  it("shows a rate but will not let it be chosen", async () => {
    const onChange = vi.fn();

    render(
      <CsvMappingForm entries={entries()} metricTargets={metricTargets} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Target field for Total" }));
    const listbox = await screen.findByRole("listbox");

    // A rate needs a numerator and a denominator; one column carries only the
    // quotient, so choosing it would reject every row at import time.
    expect(within(listbox).getByText(/need two columns/i)).toBeInTheDocument();
    fireEvent.click(within(listbox).getByText("listing.conversion_rate"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("still accepts a target another consumer owns", async () => {
    const onChange = vi.fn();

    render(
      <CsvMappingForm entries={entries()} metricTargets={metricTargets} onChange={onChange} />,
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Target field for Total" }));
    fireEvent.change(await screen.findByPlaceholderText(/search targets/i), {
      target: { value: "order_id" },
    });
    fireEvent.click(await screen.findByText(/Use “order_id” as a plain field/));

    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ header: "Date", targetField: "" }),
      expect.objectContaining({ header: "Total", targetField: "order_id" }),
    ]);
  });

  it("warns when metrics are mapped without a period column", () => {
    render(
      <CsvMappingForm
        entries={entries([{ targetField: "order_id" }, { targetField: "revenue.gross" }])}
        metricTargets={metricTargets}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole("status")).toHaveTextContent(/Map one column to .period./);
  });

  it("drops excluded and unnamed columns from the submitted mapping", () => {
    expect(
      toColumnMapping([
        { header: "Date", include: true, targetField: "period" },
        { header: "Total", include: false, targetField: "revenue.gross" },
        { header: "Notes", include: true, targetField: "  " },
      ]),
    ).toEqual({ period: "Date" });
  });
});
