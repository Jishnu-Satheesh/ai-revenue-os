import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { reconstructPdfGrid } from "@/domain/reports/pdf-grid";
import { extractPdfTextLayer, isLegacyXlsBuffer } from "@/workflows/reports/pdf-text-layer";

/**
 * Runs against the pilot client's own downloads, which are gitignored because
 * they carry real figures. Absent them the suite skips rather than fails: a
 * fresh clone has no `fixtures/raw`, and a test that cannot run is not a test
 * that failed.
 *
 * The unit guarantee lives in `src/domain/reports/pdf-grid.test.ts`, which needs
 * no file at all. This suite exists for the thing a synthetic fixture cannot
 * prove — that a real generated statement comes out right — and it earned its
 * place immediately: the leftmost-column boundary bug was invisible to the unit
 * fixture and obvious here.
 */
const RAW = resolve(process.cwd(), "fixtures/raw");
const STATEMENT = resolve(RAW, "Offline_Store_Profit_and_loss .pdf");
const LEGACY_XLS = resolve(RAW, "EatEasily_Brand_Sales_Report_2026-01-01_2026-02-28.xls");

const describeIfPresent = (path: string) => (existsSync(path) ? describe : describe.skip);

function parseAmount(text: string): number {
  return Number(text.replaceAll(",", ""));
}

describeIfPresent(STATEMENT)("a real wkhtmltopdf profit and loss", () => {
  async function gridOfFirstPage() {
    const extracted = await extractPdfTextLayer(readFileSync(STATEMENT));
    if (extracted.outcome !== "extracted") throw new Error(`extract failed: ${extracted.code}`);
    const first = extracted.pages[0];
    if (!first) throw new Error("no pages");
    const result = reconstructPdfGrid(first.items);
    if (result.outcome !== "reconstructed") throw new Error(`grid failed: ${result.code}`);
    return result.grid;
  }

  it("finds one column per reporting month", async () => {
    const grid = await gridOfFirstPage();
    const header = grid.rows.find((row) => row.cells.includes("May 2026"));

    expect(header?.cells).toEqual(["", "May 2026", "Jun 2026", "Jul 2026", "Aug 2026"]);
  });

  it("keeps every label whole, including the ones that wrapped", async () => {
    const labels = (await gridOfFirstPage()).rows.map((row) => row.cells[0]);

    expect(labels).toContain("Packing & Consumables");
    expect(labels).toContain("Total for Operating Income");
    expect(labels).toContain("Total for Delivery partners commission");
    // Fragments of a wrapped label must not survive as rows of their own.
    expect(labels).not.toContain("Income");
    expect(labels).not.toContain("Consumables");
  });

  it("keeps the leftmost column's figures out of the label", async () => {
    // The regression that only the real file exposed. An anchor is a cluster
    // mean, so half the leftmost column ends slightly left of it, and a bare
    // comparison read "Sales 0.00" as one label with an empty column beside it.
    const rows = (await gridOfFirstPage()).rows;
    const sales = rows.find((row) => row.cells[0] === "Sales");

    expect(sales?.cells[1]).toBe("0.00");
    expect(rows.every((row) => !/\d/.test(row.cells[0]))).toBe(true);
  });

  it("reconstructs figures that satisfy the statement's own arithmetic", async () => {
    // The strongest available proof that extraction is correct rather than
    // merely plausible: the document states gross profit, and the figures this
    // produced have to reach it independently. This is the same idea the money
    // control total in ADR 0029 applies to every import.
    const rows = (await gridOfFirstPage()).rows;
    const find = (label: string) => rows.find((row) => row.cells[0] === label);

    const income = find("Total for Operating Income");
    const cost = rows.filter((row) => row.cells[0] === "Total for Cost of Goods Sold").at(-1);
    const stated = find("Gross Profit");
    expect(income && cost && stated).toBeTruthy();

    for (let column = 1; column <= 4; column += 1) {
      const computed = parseAmount(income!.cells[column]) - parseAmount(cost!.cells[column]);
      expect(computed).toBeCloseTo(parseAmount(stated!.cells[column]), 2);
    }
  });

  it("reads every page of the document, not only the first", async () => {
    const extracted = await extractPdfTextLayer(readFileSync(STATEMENT));
    if (extracted.outcome !== "extracted") throw new Error(extracted.code);

    expect(extracted.pages.length).toBeGreaterThan(1);
    expect(extracted.pages.map((page) => page.pageNumber)).toEqual(
      extracted.pages.map((_, index) => index + 1),
    );
  });

  it("produces the same grid every time it reads the same bytes", async () => {
    const [first, second] = [await gridOfFirstPage(), await gridOfFirstPage()];

    expect(second).toEqual(first);
  });
});

describe("refusing what cannot be read deterministically", () => {
  it("reports an unreadable file rather than throwing", async () => {
    const result = await extractPdfTextLayer(Buffer.from("this is not a PDF"));

    expect(result).toEqual({ outcome: "failed", code: "UNREADABLE_WORKBOOK" });
  });

  it("recognises a legacy binary .xls by its signature, not its name", () => {
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x01]);

    expect(isLegacyXlsBuffer(ole)).toBe(true);
    expect(isLegacyXlsBuffer(Buffer.from("PK a real xlsx archive"))).toBe(false);
    expect(isLegacyXlsBuffer(Buffer.alloc(0))).toBe(false);
  });
});

describeIfPresent(LEGACY_XLS)("a real legacy .xls from the provider", () => {
  it("is detected by content so the operator gets an actionable message", () => {
    expect(isLegacyXlsBuffer(readFileSync(LEGACY_XLS))).toBe(true);
  });
});
