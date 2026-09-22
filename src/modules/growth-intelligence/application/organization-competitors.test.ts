import { describe, expect, it } from "vitest";

import {
  deduplicateCompetitorsByName,
  toNormalizedCompetitorName,
} from "@/modules/growth-intelligence/application/organization-competitors";

describe("organization competitors", () => {
  it("normalizes names by case and whitespace only", () => {
    expect(toNormalizedCompetitorName("  Seaside   Grill ")).toBe("seaside grill");
    expect(toNormalizedCompetitorName("SEASIDE GRILL")).toBe("seaside grill");
  });

  it("de-duplicates by normalized name keeping the first row", () => {
    const rows = deduplicateCompetitorsByName([
      { name: "Seaside Grill" },
      { name: "seaside  grill" },
      { name: "Harbour Eats" },
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Seaside Grill", "Harbour Eats"]);
  });
});
