import { describe, expect, it } from "vitest";

import {
  parseCategoricalRefusalDetail,
  ReportCategoricalValueNotDeclared,
} from "@/domain/reports/projection-error";

describe("parseCategoricalRefusalDetail", () => {
  it("recovers the output, label, and dates from a recorded refusal", () => {
    const failure = new ReportCategoricalValueNotDeclared("cancel_reason", "CLOSED", [
      "2026-03-04",
      "2026-03-11",
    ]);
    const detail = ["ReportProjectionError", failure.code, failure.message].join(": ");

    expect(parseCategoricalRefusalDetail(detail)).toEqual({
      outputKey: "cancel_reason",
      value: "CLOSED",
      dates: ["2026-03-04", "2026-03-11"],
    });
  });

  it("returns null for any other failure", () => {
    expect(parseCategoricalRefusalDetail("ReportProjectionFailure: INVALID_LOCAL_DATE")).toBeNull();
    expect(parseCategoricalRefusalDetail("")).toBeNull();
  });

  it("returns null rather than a wrong button when the shape does not parse", () => {
    expect(
      parseCategoricalRefusalDetail(
        "ReportProjectionError: CATEGORICAL_VALUE_NOT_DECLARED: something unexpected",
      ),
    ).toBeNull();
  });

  it("keeps a label that itself contains the matched words", () => {
    expect(
      parseCategoricalRefusalDetail(
        "ReportProjectionError: CATEGORICAL_VALUE_NOT_DECLARED: cancel_reason: NOT is not a declared value (2026-03-04) is not a declared value (2026-03-05)",
      ),
    ).toEqual({
      outputKey: "cancel_reason",
      value: "NOT is not a declared value (2026-03-04)",
      dates: ["2026-03-05"],
    });
  });
});
