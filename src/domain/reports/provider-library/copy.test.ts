import { describe, expect, it } from "vitest";

import { describeMetric, describeMetrics } from "@/domain/reports/provider-library/copy";
import { PROVIDER_REPORT_DEFINITIONS } from "@/domain/reports/provider-library";

describe("saying what a report family reads", () => {
  it("uses the operator's word, not the identifier", () => {
    expect(describeMetric("revenue.gross")).toBe("sales");
    expect(describeMetrics(["revenue.gross", "transactions.count"])).toBe("sales and orders");
    expect(describeMetrics(["revenue.gross", "transactions.count", "promotion.funding"])).toBe(
      "sales, orders and promotion spend",
    );
  });

  it("shows an unknown identifier rather than inventing a word for it", () => {
    // Better an operator sees something they can ask about than a confident
    // label that means something else.
    expect(describeMetric("something.new")).toBe("something.new");
  });

  it("has a word for every metric the checked-in families actually read", () => {
    for (const definition of PROVIDER_REPORT_DEFINITIONS) {
      for (const output of definition.projection.outputs) {
        expect(describeMetric(output.metricKey), definition.key).not.toBe(output.metricKey);
      }
    }
  });
});
