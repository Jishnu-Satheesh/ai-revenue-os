import { describe, expect, it } from "vitest";

import {
  isBareCategoricalValueNotDeclared,
  isDeclarableCategoricalValue,
  isTruncatedCategoricalValue,
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

describe("isDeclarableCategoricalValue", () => {
  it("accepts short uppercase labels, exactly the shape the declare RPC requires", () => {
    expect(isDeclarableCategoricalValue("CLOSED")).toBe(true);
    expect(isDeclarableCategoricalValue("ITEM_UNAVAILABLE")).toBe(true);
    expect(isDeclarableCategoricalValue("NO_SHOW_1")).toBe(true);
  });

  it("refuses provider prose the one-click path was never meant to translate", () => {
    // These are exactly the routine cases the refusal carries verbatim:
    // lowercase, mixed case, and spaced-out provider text.
    expect(isDeclarableCategoricalValue("closed")).toBe(false);
    expect(isDeclarableCategoricalValue("Closed by store")).toBe(false);
    expect(isDeclarableCategoricalValue("closed because the shop shut")).toBe(false);
  });

  it("refuses a truncated value, which is too long to match the code shape", () => {
    const truncated = `${"A".repeat(64)}…`;
    expect(isDeclarableCategoricalValue(truncated)).toBe(false);
  });
});

describe("isTruncatedCategoricalValue", () => {
  it("recognises the trailing marker boundedCategoryValue writes", () => {
    expect(isTruncatedCategoricalValue(`${"A".repeat(64)}…`)).toBe(true);
  });

  it("is false for a value that merely happens to be long, or short", () => {
    expect(isTruncatedCategoricalValue("CLOSED")).toBe(false);
    expect(isTruncatedCategoricalValue("closed because the shop shut")).toBe(false);
  });
});

describe("isBareCategoricalValueNotDeclared", () => {
  it("recognises the pre-Task-4 recording, exactly as it reads on staging", () => {
    expect(
      isBareCategoricalValueNotDeclared("ReportProjectionError: CATEGORICAL_VALUE_NOT_DECLARED"),
    ).toBe(true);
    expect(isBareCategoricalValueNotDeclared("CATEGORICAL_VALUE_NOT_DECLARED")).toBe(true);
  });

  it("is false once the failure names a label -- the modern, parseable shape", () => {
    const failure = new ReportCategoricalValueNotDeclared("cancel_reason", "CLOSED", [
      "2026-03-04",
    ]);
    const detail = ["ReportProjectionError", failure.code, failure.message].join(": ");
    expect(isBareCategoricalValueNotDeclared(detail)).toBe(false);
  });

  it("is false for a detail that carries the marker but is not the bare form", () => {
    expect(
      isBareCategoricalValueNotDeclared(
        "ReportProjectionError: CATEGORICAL_VALUE_NOT_DECLARED: something unexpected",
      ),
    ).toBe(false);
  });

  it("is false for an unrelated failure", () => {
    expect(isBareCategoricalValueNotDeclared("ReportProjectionFailure: INVALID_LOCAL_DATE")).toBe(
      false,
    );
    expect(isBareCategoricalValueNotDeclared("")).toBe(false);
  });
});
