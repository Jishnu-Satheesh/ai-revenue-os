import { describe, expect, it } from "vitest";

import { reconstructPdfGrid, type PositionedTextItem } from "@/domain/reports/pdf-grid";

/**
 * Geometry taken from the pilot client's own profit and loss, a
 * wkhtmltopdf-rendered statement. The coordinates are the real ones — that is
 * the whole point, since the algorithm is inferring structure from them — and
 * the amounts are substituted, because a test fixture is not a place to keep a
 * client's revenue.
 */
function item(text: string, x: number, y: number, width: number): PositionedTextItem {
  return { text, x, y, width };
}

const statement: PositionedTextItem[] = [
  item("NOSTAZA RESTAURANT LLC", 210.7, 774.2, 197.4),
  item("Profit and Loss", 266.5, 748.1, 85.2),
  // Column headings, right-aligned like the figures they sit above.
  item("May 2026", 210.0, 678.1, 41.5),
  item("Jun 2026", 319.9, 678.1, 37.2),
  item("Jul 2026", 428.2, 678.1, 33.9),
  item("Aug 2026", 528.2, 678.1, 40.0),
  item("Account", 50.1, 655.9, 34.7),
  item("Total", 230.0, 655.9, 21.0),
  item("Total", 335.0, 655.9, 21.0),
  item("Total", 441.0, 655.9, 21.0),
  item("Total", 547.0, 655.9, 21.0),
  // A section heading with no figures at all.
  item("Operating Income", 46.0, 633.5, 82.0),
  // A row of zeros. Zero is an answer and must survive as one.
  item("Sales", 55.0, 610.5, 23.0),
  item("0.00", 233.0, 610.5, 18.0),
  item("0.00", 338.0, 610.5, 18.0),
  item("0.00", 444.0, 610.5, 18.0),
  item("0.00", 550.0, 610.5, 18.0),
  // Indented detail, right-aligned values of differing widths.
  item("Daily Sales", 65.0, 587.5, 46.0),
  item("111,111.11", 205.0, 587.5, 46.0),
  item("222,222.22", 310.0, 587.5, 46.9),
  item("333,333.33", 415.0, 587.5, 47.0),
  item("444,444.44", 521.0, 587.5, 47.0),
  // A label that wraps onto a second line while its figures stay on the first.
  item("Total for Operating", 46.0, 543.0, 88.0),
  item("111,111.11", 204.0, 543.0, 47.0),
  item("222,222.22", 309.0, 543.0, 47.4),
  item("333,333.33", 414.0, 543.0, 48.0),
  item("444,444.44", 520.0, 543.0, 48.0),
  item("Income", 46.0, 530.0, 34.0),
  item("Cost of Goods Sold", 46.0, 507.0, 84.0),
  item("Food Items", 65.0, 460.5, 48.0),
  item("55,555.55", 205.0, 460.5, 46.0),
  item("66,666.66", 310.0, 460.5, 47.0),
  item("77,777.77", 415.0, 460.5, 47.0),
  item("88,888.88", 527.0, 460.5, 41.0),
];

function gridOf(items: PositionedTextItem[]) {
  const result = reconstructPdfGrid(items);
  if (result.outcome !== "reconstructed") throw new Error(`expected a grid, got ${result.code}`);
  return result.grid;
}

describe("reconstructing a table from a PDF text layer", () => {
  it("finds one column per period, plus the label column", () => {
    const grid = gridOf(statement);

    expect(grid.columnCount).toBe(5);
    expect(grid.valueColumnAnchors).toHaveLength(4);
  });

  it("puts right-aligned figures of different widths in the same column", () => {
    // "0.00" and "111,111.11" share a column despite starting 28 points apart.
    // Their right edges agree, which is the only thing that does.
    const rows = gridOf(statement).rows;
    const sales = rows.find((row) => row.cells[0] === "Sales");
    const daily = rows.find((row) => row.cells[0] === "Daily Sales");

    expect(sales?.cells).toEqual(["Sales", "0.00", "0.00", "0.00", "0.00"]);
    expect(daily?.cells).toEqual([
      "Daily Sales",
      "111,111.11",
      "222,222.22",
      "333,333.33",
      "444,444.44",
    ]);
  });

  it("keeps a zero as a zero rather than an empty cell", () => {
    const sales = gridOf(statement).rows.find((row) => row.cells[0] === "Sales");

    expect(sales?.cells.slice(1).every((cell) => cell === "0.00")).toBe(true);
  });

  it("rejoins a label that wrapped onto a second line", () => {
    // "Total for Operating" / "Income" is one row in the document. Split in two,
    // its figures would be filed under a heading that does not exist.
    const rows = gridOf(statement).rows;

    expect(rows.some((row) => row.cells[0] === "Total for Operating Income")).toBe(true);
    expect(rows.some((row) => row.cells[0] === "Income")).toBe(false);
  });

  it("keeps a heading that genuinely has no figures", () => {
    const rows = gridOf(statement).rows;

    const heading = rows.find((row) => row.cells[0] === "Operating Income");
    expect(heading).toBeDefined();
    expect(heading?.cells.slice(1).every((cell) => cell === "")).toBe(true);
  });

  it("retains indentation, because the outline level carries meaning", () => {
    const rows = gridOf(statement).rows;
    const total = rows.find((row) => row.cells[0] === "Total for Operating Income");
    const detail = rows.find((row) => row.cells[0] === "Food Items");

    expect(total?.labelIndent).toBe(46);
    expect(detail?.labelIndent).toBe(65);
  });

  it("lands the period headings in the columns they head", () => {
    // The headings are right-aligned like the figures beneath them, so they
    // fall into their own columns without needing a rule of their own. That is
    // what makes the header row usable as a header rather than as prose.
    const grid = gridOf(statement);
    const heading = grid.rows.find((row) => row.cells.includes("May 2026"));

    expect(heading?.cells).toEqual(["", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026"]);
    expect(grid.valueColumnAnchors).toHaveLength(4);
  });

  it("keeps a section heading rather than gluing it to the row above", () => {
    // "Operating Income" has no figures and follows a row that does, which is
    // exactly the shape of a wrapped label. Only the line spacing separates
    // them: a wrap sits tight, a heading starts a new row at the usual pitch.
    const labels = gridOf(statement).rows.map((row) => row.cells[0]);

    expect(labels).toContain("Operating Income");
    expect(labels.some((label) => label.startsWith("Account Operating"))).toBe(false);
  });

  it("orders rows down the page, not up it", () => {
    const labels = gridOf(statement).rows.map((row) => row.cells[0]);

    expect(labels.indexOf("Operating Income")).toBeLessThan(labels.indexOf("Cost of Goods Sold"));
  });

  describe("refusing what it cannot read", () => {
    it("reports no text layer for a scan", () => {
      // A scanned page carries images and no text runs. There is nothing to
      // infer from, and guessing is the one thing ADR 0028 forbids.
      expect(reconstructPdfGrid([])).toEqual({ outcome: "failed", code: "PDF_NO_TEXT_LAYER" });
    });

    it("reports no text layer when every run is whitespace", () => {
      expect(reconstructPdfGrid([item("   ", 10, 10, 5), item("", 20, 10, 0)])).toEqual({
        outcome: "failed",
        code: "PDF_NO_TEXT_LAYER",
      });
    });

    it("refuses prose rather than pretending it is a table", () => {
      const prose = [
        item("This invoice covers the period", 50, 700, 180),
        item("and is payable within 30 days.", 50, 680, 180),
      ];

      expect(reconstructPdfGrid(prose)).toEqual({
        outcome: "failed",
        code: "PDF_NO_TABLE_STRUCTURE",
      });
    });

    it("does not build a column from a single stray figure", () => {
      // One number in a sentence aligns with nothing. Two occurrences is the
      // least that can establish a column.
      const stray = [
        item("Total due", 50, 700, 50),
        item("1,234.00", 300, 700, 40),
        item("Terms", 50, 680, 30),
      ];

      expect(reconstructPdfGrid(stray)).toEqual({
        outcome: "failed",
        code: "PDF_NO_TABLE_STRUCTURE",
      });
    });
  });

  describe("determinism", () => {
    it("produces the same grid whatever order the text runs arrive in", () => {
      // pdf.js emits runs in paint order, which is not reading order and is not
      // guaranteed stable between versions.
      const forwards = gridOf(statement);
      const shuffled = gridOf([...statement].reverse());

      expect(shuffled.rows).toEqual(forwards.rows);
      expect(shuffled.valueColumnAnchors).toEqual(forwards.valueColumnAnchors);
    });

    it("tolerates baselines that wobble by a fraction of a point", () => {
      const wobbled = statement.map((entry, index) => ({
        ...entry,
        y: entry.y + (index % 3 === 0 ? 0.4 : -0.3),
      }));

      expect(gridOf(wobbled).rows).toEqual(gridOf(statement).rows);
    });
  });
});
