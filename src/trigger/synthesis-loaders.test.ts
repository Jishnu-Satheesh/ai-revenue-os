import { describe, expect, it } from "vitest";

import { toCompactBusinessFinding } from "./synthesis-loaders";

function findingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    calculation_digest: "d".repeat(64),
    code: "DEMAND_SOFTNESS",
    detector_key: "demand_softness",
    severity: "high",
    quality_state: "complete",
    status: "open",
    channel_id: "chan-1",
    limitations: ["STALE_EVIDENCE", "PARTIAL_COVERAGE"],
    ...overrides,
  };
}

describe("toCompactBusinessFinding", () => {
  it("maps a finding row to its compact identity with limitation codes", () => {
    expect(toCompactBusinessFinding(findingRow())).toEqual({
      id: "11111111-0000-4000-8000-000000000001",
      digest: "d".repeat(64),
      code: "DEMAND_SOFTNESS",
      severity: "high",
      headline: "demand_softness: DEMAND_SOFTNESS",
      limitations: ["STALE_EVIDENCE", "PARTIAL_COVERAGE"],
    });
  });

  it("yields no limitations when the row omits them", () => {
    const { limitations, ...withoutLimitations } = findingRow();
    void limitations;
    expect(toCompactBusinessFinding(withoutLimitations).limitations).toEqual([]);
  });

  it("yields no limitations when the row carries null or non-array limitations", () => {
    expect(
      toCompactBusinessFinding(findingRow({ limitations: null })).limitations,
    ).toEqual([]);
    expect(
      toCompactBusinessFinding(findingRow({ limitations: "STALE_EVIDENCE" }))
        .limitations,
    ).toEqual([]);
  });

  it("filters hostile limitation values", () => {
    const mapped = toCompactBusinessFinding(
      findingRow({
        limitations: [
          "STALE_EVIDENCE",
          42,
          null,
          { code: "STALE_EVIDENCE" },
          "stale_evidence",
          "HAS-DASH",
          "HAS SPACE",
          "AB",
          "X".repeat(82),
        ],
      }),
    );
    expect(mapped.limitations).toEqual(["STALE_EVIDENCE"]);
  });

  it("defaults severity to low when absent", () => {
    expect(
      toCompactBusinessFinding(findingRow({ severity: undefined })).severity,
    ).toBe("low");
    expect(
      toCompactBusinessFinding(findingRow({ severity: null })).severity,
    ).toBe("low");
  });

  it("truncates the headline at 200 chars", () => {
    const detectorKey = "d".repeat(150);
    const code = "C".repeat(100);
    const mapped = toCompactBusinessFinding(
      findingRow({ detector_key: detectorKey, code }),
    );
    expect(mapped.headline).toBe(`${detectorKey}: ${code}`.slice(0, 200));
    expect(mapped.headline).toHaveLength(200);
  });
});
