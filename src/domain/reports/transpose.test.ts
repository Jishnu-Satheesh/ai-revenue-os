import { describe, expect, it } from "vitest";

import {
  TRANSPOSED_HEADER_ROW_POSITION,
  TRANSPOSED_PERIOD_HEADER,
  transposePeriodColumns,
} from "@/domain/reports/transpose";

/**
 * Rotating a statement whose periods are its column headings.
 *
 * The shape under test is the one an accounting profit and loss actually has:
 * a title, a basis line, a row of month headings, then one row per account.
 * No figure from any real statement appears here.
 */
const statement = [
  ["ACME TRADING LLC", "", "", ""],
  ["", "Profit and Loss", "", ""],
  ["Basis: Accrual", "", "", ""],
  ["", "May 2026", "Jun 2026", "Jul 2026"],
  ["Account", "Total", "Total", "Total"],
  ["Sales", "1,000.00", "2,000.00", "3,000.00"],
  ["Food Items", "100.00", "200.00", "300.00"],
];

function rotate(rows: readonly (readonly unknown[])[] = statement, periodHeaderRow = 4) {
  return transposePeriodColumns({ rows, periodHeaderRow });
}

describe("rotating a sheet whose records are its columns", () => {
  it("turns the label column into the header row", () => {
    const { rows } = rotate();

    // Row one of the rotated sheet is the account column, read top to bottom.
    expect(rows[0]?.[5]).toBe("Sales");
    expect(rows[0]?.[6]).toBe("Food Items");
  });

  it("turns each value column into one record", () => {
    const { rows } = rotate();

    // Four columns in, four rows out: the labels and one per month.
    expect(rows).toHaveLength(4);
    expect(rows[1]?.[5]).toBe("1,000.00");
    expect(rows[2]?.[5]).toBe("2,000.00");
    expect(rows[3]?.[6]).toBe("300.00");
  });

  it("gives the period column a header the file never printed", () => {
    const { rows } = rotate();

    // The months are painted above the columns, so after rotation they are
    // values with nothing naming them. The reader supplies the name.
    expect(rows[0]?.[3]).toBe(TRANSPOSED_PERIOD_HEADER);
    expect(rows[1]?.[3]).toBe("May 2026");
    expect(rows[3]?.[3]).toBe("Jul 2026");
  });

  it("reports a label the statement uses twice", () => {
    const repeated = [
      ["Account", "Total"],
      ["Cost of Goods Sold", "10.00"],
      ["Cost of Goods Sold", "20.00"],
      ["Food Items", "30.00"],
    ];

    const { ambiguousLabels } = transposePeriodColumns({ rows: repeated, periodHeaderRow: 1 });

    // Two rows answering to one name. Binding either would be a guess, and on a
    // real statement the two carry different figures.
    expect(ambiguousLabels.has("cost_of_goods_sold")).toBe(true);
    expect(ambiguousLabels.has("food_items")).toBe(false);
  });

  it("does not call repeated blanks ambiguous", () => {
    // Section headings and spacer rows leave the label column empty, and a
    // sheet full of them would otherwise report one useless ambiguity.
    const { ambiguousLabels } = rotate();

    expect([...ambiguousLabels]).toEqual([]);
  });

  it("reports an account that answers to the reserved period name", () => {
    const collision = [
      ["Account", "Total"],
      ["Report Period", "10.00"],
      ["Food Items", "20.00"],
    ];

    const { ambiguousLabels } = transposePeriodColumns({ rows: collision, periodHeaderRow: 1 });

    // Two different things would answer to one name, which is the same failure
    // as a repeated label and is reported the same way.
    expect(ambiguousLabels.has(TRANSPOSED_PERIOD_HEADER)).toBe(true);
  });

  it("leaves the period header unwritten when the sheet has no such row", () => {
    const { rows } = rotate(statement, 99);

    // A contract naming a row past the end finds no period header, which the
    // caller reports as the missing source header it is, rather than this
    // module inventing a column.
    expect(rows[0]?.includes(TRANSPOSED_PERIOD_HEADER)).toBe(false);
  });

  it("squares off a ragged sheet rather than dropping the short rows", () => {
    const ragged = [
      ["Account", "Total", "Total"],
      ["Sales", "1.00"],
    ];

    const { rows } = transposePeriodColumns({ rows: ragged, periodHeaderRow: 1 });

    expect(rows).toHaveLength(3);
    // The cell the second row never had reads as absent, not as a shifted one.
    expect(rows[2]?.[1]).toBeNull();
  });

  it("files a rotated header outside the range a contract may name", () => {
    // Row positions a contract can declare start at one, so nothing an ordinary
    // mapping asks for can collide with where a rotated sheet is recognised.
    expect(TRANSPOSED_HEADER_ROW_POSITION).toBe(0);
  });
});
