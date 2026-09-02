import { describe, expect, it } from "vitest";

import { ungroupNumber } from "@/domain/reports/number-format";

describe("reading a number the way its provider writes it", () => {
  it("removes thousands separators when the contract declares them", () => {
    expect(ungroupNumber("1,234.56", "grouped")).toBe("1234.56");
    expect(ungroupNumber("-1,234,567", "grouped")).toBe("-1234567");
  });

  it("leaves an undeclared column exactly as it found it", () => {
    // A CSV cell reading `1,234` may be two badly split columns. Guessing which
    // is the silent reinterpretation the contract exists to prevent, so an
    // undeclared column keeps failing against the ordinary pattern.
    expect(ungroupNumber("1,234.56", undefined)).toBe("1,234.56");
    expect(ungroupNumber("1,234.56", "plain")).toBe("1,234.56");
  });

  it("refuses to rescue a string that is not actually grouped", () => {
    // `1,23` is not a grouped number, and quietly making it 123 would turn a
    // malformed cell into a plausible figure.
    expect(ungroupNumber("1,23", "grouped")).toBe("1,23");
    expect(ungroupNumber("1,2345", "grouped")).toBe("1,2345");
    expect(ungroupNumber("1,,234", "grouped")).toBe("1,,234");
  });

  it("passes a plain number through untouched", () => {
    expect(ungroupNumber("0", "grouped")).toBe("0");
    expect(ungroupNumber("123.45", "grouped")).toBe("123.45");
  });

  it("never touches a value that is not text", () => {
    // A spreadsheet hands over a number as a number, and its display format is
    // nobody's business here.
    expect(ungroupNumber(1234.56, "grouped")).toBe(1234.56);
    expect(ungroupNumber(null, "grouped")).toBeNull();
  });
});
