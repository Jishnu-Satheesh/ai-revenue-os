import { describe, expect, it } from "vitest";

import {
  selectBranchFindings,
  toCompactBusinessFinding,
  toEligibleMarketClaims,
} from "./synthesis-loaders";

function findingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    calculation_digest: "d".repeat(64),
    code: "DEMAND_SOFTNESS",
    detector_key: "demand_softness",
    severity: "high",
    quality_state: "complete",
    status: "open",
    kind: "finding",
    channel_id: "chan-1",
    branch_id: null,
    analysis_run_id: "41000000-0000-4000-8000-000000000041",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    currency: "AED",
    value_kind: "money",
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
      analysisRunId: "41000000-0000-4000-8000-000000000041",
      branchId: null,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      currency: "AED",
      valueKind: "money",
      scope: "branch",
      stale: false,
    });
  });

  it("yields no limitations when the row omits them", () => {
    const { limitations, ...withoutLimitations } = findingRow();
    void limitations;
    expect(toCompactBusinessFinding(withoutLimitations).limitations).toEqual([]);
  });

  it("yields no limitations when the row carries null or non-array limitations", () => {
    expect(toCompactBusinessFinding(findingRow({ limitations: null })).limitations).toEqual([]);
    expect(
      toCompactBusinessFinding(findingRow({ limitations: "STALE_EVIDENCE" })).limitations,
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
    expect(toCompactBusinessFinding(findingRow({ severity: undefined })).severity).toBe("low");
    expect(toCompactBusinessFinding(findingRow({ severity: null })).severity).toBe("low");
  });

  it("truncates the headline at 200 chars", () => {
    const detectorKey = "d".repeat(150);
    const code = "C".repeat(100);
    const mapped = toCompactBusinessFinding(findingRow({ detector_key: detectorKey, code }));
    expect(mapped.headline).toBe(`${detectorKey}: ${code}`.slice(0, 200));
    expect(mapped.headline).toHaveLength(200);
  });
});

const branchA = "30000000-0000-4000-8000-000000000030";
const branchB = "30000000-0000-4000-8000-000000000031";
const runA = "41000000-0000-4000-8000-000000000041";
const claimA = "20000000-0000-4000-8000-000000000022";
const researchRunA = "42000000-0000-4000-8000-000000000042";

function scopedRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-0000-4000-8000-000000000001",
    calculation_digest: "d".repeat(64),
    code: "DEMAND_SOFTNESS",
    detector_key: "demand_softness",
    severity: "high",
    quality_state: "complete",
    status: "open",
    kind: "finding",
    channel_id: "chan-1",
    branch_id: branchA,
    analysis_run_id: runA,
    run_status: "completed",
    run_branch_id: branchA,
    run_channel_id: "chan-1",
    period_start: "2026-08-01",
    period_end: "2026-08-31",
    currency: "AED",
    value_kind: "money",
    limitations: [],
    ...overrides,
  };
}

describe("toCompactBusinessFinding lineage", () => {
  it("carries analysis-run, branch, period, currency, unit, and freshness lineage", () => {
    expect(toCompactBusinessFinding(scopedRow())).toEqual({
      id: "11111111-0000-4000-8000-000000000001",
      digest: "d".repeat(64),
      code: "DEMAND_SOFTNESS",
      severity: "high",
      headline: "demand_softness: DEMAND_SOFTNESS",
      limitations: [],
      analysisRunId: runA,
      branchId: branchA,
      periodStart: "2026-08-01",
      periodEnd: "2026-08-31",
      currency: "AED",
      valueKind: "money",
      scope: "branch",
      stale: false,
    });
  });

  it("marks partial-quality rows stale and null-branch rows broader context", () => {
    const mapped = toCompactBusinessFinding(
      scopedRow({ quality_state: "partial", branch_id: null, run_branch_id: null }),
      branchA,
    );
    expect(mapped.stale).toBe(true);
    expect(mapped.scope).toBe("broader_context");
    expect(mapped.branchId).toBeNull();
  });

  it("treats null-branch rows as in-scope measurements for legacy organization synthesis", () => {
    const mapped = toCompactBusinessFinding(
      scopedRow({ branch_id: null, run_branch_id: null }),
      null,
    );
    expect(mapped.scope).toBe("branch");
  });
});

describe("selectBranchFindings A/B/org fixture", () => {
  // Branch A sales 100, branch B sales 900, organization sales 1,000. The
  // values ride the rows so the test proves which measurements survive
  // scoping; the compact mapping never forwards raw values to the model.
  function salesRows() {
    return [
      scopedRow({
        id: "11111111-0000-4000-8000-0000000000a1",
        branch_id: branchA,
        value_numerator: 100,
      }),
      scopedRow({
        id: "11111111-0000-4000-8000-0000000000b1",
        branch_id: branchB,
        run_branch_id: branchB,
        value_numerator: 900,
      }),
      scopedRow({
        id: "11111111-0000-4000-8000-0000000000c1",
        branch_id: null,
        run_branch_id: null,
        value_numerator: 1000,
      }),
    ];
  }

  it("sees branch A (100) as its metric and excludes branch B (900)", () => {
    const selected = selectBranchFindings(salesRows(), {
      organizationId: "10000000-0000-4000-8000-000000000001",
      branchId: branchA,
      channelId: null,
      evidenceWindow: null,
    });
    const ids = selected.findings.map((finding) => finding.id);
    expect(ids).toContain("11111111-0000-4000-8000-0000000000a1");
    expect(ids).not.toContain("11111111-0000-4000-8000-0000000000b1");
    expect(selected.coverage.scoped).toBe(1);
  });

  it("labels the organization row (1,000) broader context, never a branch measurement", () => {
    const selected = selectBranchFindings(salesRows(), {
      organizationId: "10000000-0000-4000-8000-000000000001",
      branchId: branchA,
      channelId: null,
      evidenceWindow: null,
    });
    const org = selected.findings.find(
      (finding) => finding.id === "11111111-0000-4000-8000-0000000000c1",
    );
    expect(org?.scope).toBe("broader_context");
    expect(selected.coverage.broaderContext).toBe(1);
  });

  it("yields a branch gap with no fallback when branch A has no rows", () => {
    const selected = selectBranchFindings(
      salesRows().filter((row) => (row as { branch_id: string | null }).branch_id !== branchA),
      {
        organizationId: "10000000-0000-4000-8000-000000000001",
        branchId: branchA,
        channelId: null,
        evidenceWindow: null,
      },
    );
    expect(selected.coverage.scoped).toBe(0);
    expect(selected.findings.every((finding) => finding.scope === "broader_context")).toBe(true);
  });

  it("excludes superseded findings and runs that never completed", () => {
    const selected = selectBranchFindings(
      [
        scopedRow({ id: "11111111-0000-4000-8000-0000000000a2", status: "superseded" }),
        scopedRow({ id: "11111111-0000-4000-8000-0000000000a3", run_status: "running" }),
        scopedRow({ id: "11111111-0000-4000-8000-0000000000a4" }),
      ],
      {
        organizationId: "10000000-0000-4000-8000-000000000001",
        branchId: branchA,
        channelId: null,
        evidenceWindow: null,
      },
    );
    expect(selected.findings.map((finding) => finding.id)).toEqual([
      "11111111-0000-4000-8000-0000000000a4",
    ]);
  });

  it("refuses findings whose analysis-run scope disagrees with the finding scope", () => {
    const selected = selectBranchFindings([scopedRow({ run_branch_id: branchB })], {
      organizationId: "10000000-0000-4000-8000-000000000001",
      branchId: branchA,
      channelId: null,
      evidenceWindow: null,
    });
    expect(selected.findings).toEqual([]);
  });

  it("excludes findings outside the requested evidence window and counts them", () => {
    const selected = selectBranchFindings(salesRows(), {
      organizationId: "10000000-0000-4000-8000-000000000001",
      branchId: branchA,
      channelId: null,
      evidenceWindow: { start: "2026-09-01", end: "2026-09-30" },
    });
    expect(selected.findings).toEqual([]);
    expect(selected.coverage.excludedOutOfWindow).toBe(2);
  });

  it("keeps the deterministic batch limit", () => {
    const rows = Array.from({ length: 250 }, (_, index) =>
      scopedRow({ id: `11111111-0000-4000-8000-${String(index).padStart(12, "0")}` }),
    );
    const selected = selectBranchFindings(rows, {
      organizationId: "10000000-0000-4000-8000-000000000001",
      branchId: branchA,
      channelId: null,
      evidenceWindow: null,
    });
    expect(selected.findings.length).toBeLessThanOrEqual(200);
  });
});

describe("toEligibleMarketClaims branch lineage", () => {
  function claimRow(overrides: Record<string, unknown> = {}) {
    return {
      id: claimA,
      claim_digest: "b".repeat(64),
      paraphrase: "A public notice lists a weekend food festival near the trade area.",
      quotation: null,
      geographic_layer: "city",
      geography_ref: "ae:du:dubai",
      market_research_run_id: researchRunA,
      run_branch_id: branchA,
      stale_at: "2026-12-01T00:00:00Z",
      expires_at: "2027-01-01T00:00:00Z",
      limitations: [],
      ...overrides,
    };
  }

  it("keeps exact branch/profile/run claims with their research lineage", () => {
    const eligible = toEligibleMarketClaims({
      rows: [claimRow()],
      events: [],
      links: [{ market_evidence_claim_id: claimA, relation: "supports" }],
      scope: {
        organizationId: "10000000-0000-4000-8000-000000000001",
        profileVersionId: "70000000-0000-4000-8000-000000000007",
        branchId: branchA,
      },
      nowMs: new Date("2026-09-09T00:00:00Z").getTime(),
    });
    expect(eligible).toHaveLength(1);
    expect(eligible[0]).toMatchObject({
      id: claimA,
      researchRunId: researchRunA,
      branchId: branchA,
      supportGrade: "single_source",
    });
  });

  it("excludes claims whose research run belongs to another branch", () => {
    const eligible = toEligibleMarketClaims({
      rows: [claimRow({ run_branch_id: branchB })],
      events: [],
      links: [{ market_evidence_claim_id: claimA, relation: "supports" }],
      scope: {
        organizationId: "10000000-0000-4000-8000-000000000001",
        profileVersionId: "70000000-0000-4000-8000-000000000007",
        branchId: branchA,
      },
      nowMs: new Date("2026-09-09T00:00:00Z").getTime(),
    });
    expect(eligible).toEqual([]);
  });
});
