import { describe, expect, it } from "vitest";

import {
  isSensitivityWithinCeiling,
  memoryPurposes,
  sensitivities,
  sensitivityCeilingFor,
} from "@/domain/memory/purposes";

describe("sensitivityCeilingFor", () => {
  it("caps worker purposes at internal", () => {
    expect(sensitivityCeilingFor({ purpose: "decision_context" })).toBe("internal");
    expect(sensitivityCeilingFor({ purpose: "opportunity_generation" })).toBe("internal");
    expect(sensitivityCeilingFor({ purpose: "onboarding_assist" })).toBe("internal");
  });

  it("allows outcome analysis to reach confidential and no further", () => {
    expect(sensitivityCeilingFor({ purpose: "outcome_analysis" })).toBe("confidential");
  });

  it("derives the operator search ceiling from the caller's role", () => {
    expect(sensitivityCeilingFor({ purpose: "operator_search", role: "viewer" })).toBe("internal");
    expect(sensitivityCeilingFor({ purpose: "operator_search", role: "operator" })).toBe(
      "internal",
    );
    expect(sensitivityCeilingFor({ purpose: "operator_search", role: "admin" })).toBe(
      "customer_content",
    );
    expect(sensitivityCeilingFor({ purpose: "operator_search", role: "owner" })).toBe(
      "customer_content",
    );
  });

  it("fails closed to the most restrictive ceiling when a role arrives unrecognized", () => {
    expect(
      sensitivityCeilingFor({
        purpose: "operator_search",
        role: "not-a-role" as never,
      }),
    ).toBe("public");
  });

  it("never lets a worker purpose reach customer content in V1", () => {
    for (const purpose of memoryPurposes) {
      if (purpose === "operator_search") continue;
      expect(sensitivityCeilingFor({ purpose })).not.toBe("customer_content");
    }
  });
});

describe("isSensitivityWithinCeiling", () => {
  it("allows a request at or below its ceiling", () => {
    expect(isSensitivityWithinCeiling("public", "internal")).toBe(true);
    expect(isSensitivityWithinCeiling("internal", "internal")).toBe(true);
  });

  it("refuses a request above its ceiling", () => {
    expect(isSensitivityWithinCeiling("confidential", "internal")).toBe(false);
    expect(isSensitivityWithinCeiling("customer_content", "confidential")).toBe(false);
  });

  it("orders the four classes by increasing restriction", () => {
    expect(sensitivities).toEqual(["public", "internal", "confidential", "customer_content"]);
    for (let index = 1; index < sensitivities.length; index += 1) {
      expect(isSensitivityWithinCeiling(sensitivities[index], sensitivities[index - 1])).toBe(
        false,
      );
      expect(isSensitivityWithinCeiling(sensitivities[index - 1], sensitivities[index])).toBe(true);
    }
  });
});
