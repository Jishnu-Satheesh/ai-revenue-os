import { describe, expect, it } from "vitest";

import { parseWorkspaceMonth, previousMonth } from "@/components/growth-intelligence/query-options";

describe("parseWorkspaceMonth", () => {
  it("accepts a canonical month and passes through an absent one", () => {
    expect(parseWorkspaceMonth("2026-09")).toBe("2026-09");
    expect(parseWorkspaceMonth(undefined)).toBeNull();
  });

  it("refuses non-months so navigation can never relabel an evidence period", () => {
    for (const value of ["2026-13", "09-2026", "september", "2026-9", ""]) {
      expect(parseWorkspaceMonth(value)).toBeNull();
    }
  });

  it("steps one month back across year boundaries", () => {
    expect(previousMonth("2026-09")).toBe("2026-08");
    expect(previousMonth("2026-01")).toBe("2025-12");
  });
});
