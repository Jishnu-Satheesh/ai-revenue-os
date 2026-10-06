import { describe, expect, it } from "vitest";

import {
  isResearchBudgetUncapped,
  resolveResearchBudgetPolicy,
} from "./budget-policy";

describe("resolveResearchBudgetPolicy", () => {
  it("resolves capped when the variable is missing", () => {
    expect(resolveResearchBudgetPolicy(undefined)).toBe("capped");
  });

  it("resolves capped for blank values", () => {
    expect(resolveResearchBudgetPolicy("")).toBe("capped");
    expect(resolveResearchBudgetPolicy("   ")).toBe("capped");
  });

  it("resolves capped for unrecognized values", () => {
    expect(resolveResearchBudgetPolicy("unlimited")).toBe("capped");
    expect(resolveResearchBudgetPolicy("TRUE")).toBe("capped");
    expect(resolveResearchBudgetPolicy(1)).toBe("capped");
  });

  it("resolves the explicit capped value", () => {
    expect(resolveResearchBudgetPolicy("capped")).toBe("capped");
  });

  it("resolves the explicit uncapped value", () => {
    expect(resolveResearchBudgetPolicy("uncapped")).toBe("uncapped");
  });
});

describe("isResearchBudgetUncapped", () => {
  it("is false without an explicit opt-in", () => {
    expect(isResearchBudgetUncapped(undefined)).toBe(false);
    expect(isResearchBudgetUncapped("capped")).toBe(false);
    expect(isResearchBudgetUncapped("unlimited")).toBe(false);
  });

  it("is true only for the explicit uncapped value", () => {
    expect(isResearchBudgetUncapped("uncapped")).toBe(true);
  });
});
