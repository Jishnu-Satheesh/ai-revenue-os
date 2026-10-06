import { describe, expect, it } from "vitest";

import { isAbsentValue, isEmptyCell } from "@/domain/reports/absent";
import { reportContractDocumentSchema } from "@/domain/reports/contracts";

describe("deciding whether a cell said nothing", () => {
  it("treats an empty cell as absent whatever the provider declared", () => {
    for (const value of [null, undefined, "", "   "]) {
      expect(isAbsentValue(value)).toBe(true);
      expect(isEmptyCell(value)).toBe(true);
    }
  });

  it("reads a declared marker as absent", () => {
    // Keeta's restaurant report writes `-` for valid orders on a day with no
    // orders, beside a column that still counted the customers who looked.
    expect(isAbsentValue("-", ["-"])).toBe(true);
    expect(isAbsentValue(" - ", ["-"])).toBe(true);
  });

  it("reads the same marker as a value when nobody declared it", () => {
    // The rule that makes this safe: `-` is absence here only because this
    // provider was said to write it that way.
    expect(isAbsentValue("-")).toBe(false);
    expect(isAbsentValue("-", ["N/A"])).toBe(false);
  });

  it("never treats a zero as absent", () => {
    expect(isAbsentValue(0, ["-"])).toBe(false);
    expect(isAbsentValue("0", ["-"])).toBe(false);
    expect(isEmptyCell(0)).toBe(false);
  });

  it("leaves a number alone even when a marker is declared", () => {
    expect(isAbsentValue(12.34, ["-"])).toBe(false);
  });
});

function contractWith(absentMarkers: unknown) {
  return () =>
    reportContractDocumentSchema.parse({
      schemaVersion: 1,
      currency: "AED",
      outletGrain: "branch",
      sheets: [
        {
          normalizedSheetName: "sheet1",
          headerRow: 1,
          dataStartRow: 2,
          allowFormula: false,
          allowMergedCells: false,
          fields: [
            {
              canonicalField: "valid_orders",
              sourceHeader: "valid_orders",
              parser: "integer",
              required: true,
              absentMarkers,
            },
          ],
        },
      ],
      controls: [],
      unmappedFieldDisposition: "reviewed_ignore",
    });
}

describe("what a contract may declare as absence", () => {
  it("accepts the dash the provider actually writes", () => {
    expect(contractWith(["-"])()).toBeTruthy();
  });

  it("refuses a number, which would turn real data into silence", () => {
    expect(contractWith(["0"])).toThrow();
    expect(contractWith(["-0.00"])).toThrow();
  });

  it("refuses the same marker declared twice", () => {
    expect(contractWith(["-", "-"])).toThrow();
  });

  it("refuses an empty marker, which every blank cell would match anyway", () => {
    expect(contractWith([""])).toThrow();
  });
});
