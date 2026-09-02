import { describe, expect, it } from "vitest";

import { REPORT_STRUCTURE_VERSION } from "@/domain/reports/contracts";
import { createReportStructureFingerprint } from "@/domain/reports/document-digest";
import type { ReportStructureFingerprintInput } from "@/domain/reports/contracts";

/**
 * Talabat names its worksheet after the export range, so the same report
 * profiles under a different sheet name every month. The structure digest is
 * the answer to that: a report is identified by its columns.
 */
function profile(
  overrides: Partial<ReportStructureFingerprintInput> = {},
): ReportStructureFingerprintInput {
  return {
    structureVersion: REPORT_STRUCTURE_VERSION,
    outletGrain: "branch",
    parserVersion: 1,
    sheets: [
      {
        position: 1,
        hasFormula: false,
        hasMergedCells: false,
        hasRepeatedHeader: false,
        headerCandidateDigests: [{ rowPosition: 1, fieldCount: 58, digest: "a".repeat(64) }],
      },
    ],
    ...overrides,
  };
}

describe("createReportStructureFingerprint", () => {
  it("is a sha256 hex digest", () => {
    expect(createReportStructureFingerprint(profile())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same structure", () => {
    expect(createReportStructureFingerprint(profile())).toBe(
      createReportStructureFingerprint(profile()),
    );
  });

  it("changes when a column set changes", () => {
    const different = profile({
      sheets: [
        {
          position: 1,
          hasFormula: false,
          hasMergedCells: false,
          hasRepeatedHeader: false,
          headerCandidateDigests: [{ rowPosition: 1, fieldCount: 58, digest: "b".repeat(64) }],
        },
      ],
    });
    expect(createReportStructureFingerprint(different)).not.toBe(
      createReportStructureFingerprint(profile()),
    );
  });

  it("changes when a header moves to a different row", () => {
    const moved = profile({
      sheets: [
        {
          position: 1,
          hasFormula: false,
          hasMergedCells: false,
          hasRepeatedHeader: false,
          headerCandidateDigests: [{ rowPosition: 2, fieldCount: 58, digest: "a".repeat(64) }],
        },
      ],
    });
    expect(createReportStructureFingerprint(moved)).not.toBe(
      createReportStructureFingerprint(profile()),
    );
  });

  it("does not depend on the order sheets arrive in", () => {
    const second = {
      position: 2,
      hasFormula: false,
      hasMergedCells: false,
      hasRepeatedHeader: false,
      headerCandidateDigests: [{ rowPosition: 1, fieldCount: 4, digest: "c".repeat(64) }],
    };
    const first = profile().sheets[0];
    expect(createReportStructureFingerprint(profile({ sheets: [first, second] }))).toBe(
      createReportStructureFingerprint(profile({ sheets: [second, first] })),
    );
  });

  it("separates a sheet that gained a formula", () => {
    const withFormula = profile({
      sheets: [{ ...profile().sheets[0], hasFormula: true }],
    });
    expect(createReportStructureFingerprint(withFormula)).not.toBe(
      createReportStructureFingerprint(profile()),
    );
  });
});
