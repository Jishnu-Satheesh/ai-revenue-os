import { describe, expect, it } from "vitest";

import { buildChannelWorkspaceView } from "@/modules/analysis/application/read-model";
import type {
  ChannelAnalysisRunRecord,
  ChannelFindingRecord,
} from "@/modules/analysis/application/ports";

const CHANNEL = "channel-1";

function run(overrides: Partial<ChannelAnalysisRunRecord> = {}): ChannelAnalysisRunRecord {
  return {
    id: "run-1",
    channelId: CHANNEL,
    branchId: "branch-1",
    windowStart: "2026-01-01",
    windowEnd: "2026-01-31",
    periodGrain: "day",
    windowTimezone: "Asia/Dubai",
    registryVersion: 1,
    detectorVersions: [{ key: "evidence.period_coverage", calculationVersion: 1 }],
    status: "completed",
    findingCount: 0,
    observationCount: 1,
    needsDataCount: 0,
    safeFailureCode: null,
    startedAt: "2026-02-01T00:00:00Z",
    completedAt: "2026-02-01T00:01:00Z",
    ...overrides,
  };
}

function finding(overrides: Partial<ChannelFindingRecord> = {}): ChannelFindingRecord {
  return {
    id: "finding-1",
    analysisRunId: "run-1",
    channelId: CHANNEL,
    branchId: "branch-1",
    detectorKey: "evidence.period_coverage",
    detectorVersion: 1,
    kind: "observation",
    code: "PERIOD_COVERAGE_INCOMPLETE",
    severity: null,
    priority: null,
    metricKey: "revenue.gross",
    periodStart: "2026-01-01",
    periodEnd: "2026-01-31",
    valueKind: "ratio",
    valueNumerator: 14,
    valueDenominator: 31,
    currency: null,
    monetaryImpactMinorUnits: null,
    expectedPeriodCount: 31,
    observedPeriodCount: 14,
    absentPeriodCount: 17,
    qualityState: "complete",
    needsDataReason: null,
    limitations: ["A period is counted as covered when a current observation starts in it."],
    calculationDigest: "a".repeat(64),
    createdAt: "2026-02-01T00:01:00Z",
    ...overrides,
  };
}

describe("buildChannelWorkspaceView", () => {
  it("places every shipped detector in the chapter that owns it", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [
        finding(),
        finding({
          id: "f2",
          detectorKey: "revenue.period_movement",
          code: "REVENUE_PERIOD_MOVEMENT_DOWN",
        }),
        finding({
          id: "f3",
          detectorKey: "evidence.reconciliation_blocked",
          code: "NO_EVIDENCE_HELD",
        }),
      ],
      evidence: [],
    });

    const summary = view.chapters.find((chapter) => chapter.id === "summary");
    const trust = view.chapters.find((chapter) => chapter.id === "trust");
    expect(summary?.findings.map((f) => f.detectorKey)).toContain("revenue.period_movement");
    expect(trust?.findings.map((f) => f.detectorKey)).toEqual([
      "evidence.period_coverage",
      "evidence.reconciliation_blocked",
    ]);
    expect(view.unplacedFindings).toHaveLength(0);
  });

  it("marks the chapters no report fills as deferred, each with a reason", () => {
    const view = buildChannelWorkspaceView({ runs: [run()], findings: [finding()], evidence: [] });

    // Registry version 2 gave Funnel and Operations detectors, so only the
    // chapters waiting on other reports stay deferred.
    const deferred = view.chapters.filter((chapter) => chapter.state === "deferred");
    expect(deferred.map((chapter) => chapter.id).sort()).toEqual([
      "customer-voice",
      "items",
      "money",
      "promotions",
      "recommendations",
    ]);
    // An empty frame reads as "nothing wrong here", so each one has to say why.
    for (const chapter of deferred) expect(chapter.deferredReason).toBeTruthy();
  });

  it("tells a chapter nobody analysed apart from one whose detector needed data", () => {
    const notRun = buildChannelWorkspaceView({ runs: [], findings: [], evidence: [] });
    expect(notRun.chapters.find((chapter) => chapter.id === "summary")?.state).toBe("not_run");

    const needsData = buildChannelWorkspaceView({
      runs: [run()],
      findings: [
        finding({
          kind: "needs_data",
          code: "PERIOD_COVERAGE_UNAVAILABLE",
          needsDataReason: "NO_GOVERNED_EVIDENCE_IN_WINDOW",
          valueKind: null,
          valueNumerator: null,
          valueDenominator: null,
          expectedPeriodCount: null,
          observedPeriodCount: null,
          absentPeriodCount: null,
        }),
      ],
      evidence: [],
    });
    expect(needsData.chapters.find((chapter) => chapter.id === "trust")?.state).toBe("needs_data");
  });

  it("renders a needs_data outcome as a sentence and never as a number", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [
        finding({
          kind: "needs_data",
          code: "REVENUE_PERIOD_MOVEMENT_UNAVAILABLE",
          detectorKey: "revenue.period_movement",
          needsDataReason: "PRIOR_PERIOD_ABSENT",
          valueKind: null,
          valueNumerator: null,
          valueDenominator: null,
        }),
      ],
      evidence: [],
    });

    const outcome = view.chapters.find((chapter) => chapter.id === "summary")?.findings[0];
    expect(outcome?.value).toBeNull();
    expect(outcome?.detail).toContain("carries no evidence");
    expect(outcome?.severity).toBeNull();
  });

  it("leaves a tile blank with a reason rather than showing a zero", () => {
    const view = buildChannelWorkspaceView({ runs: [run()], findings: [], evidence: [] });

    for (const tile of view.summaryTiles) {
      expect(tile.value).toBeNull();
      expect(tile.unavailableReason).toBeTruthy();
    }
  });

  it("fills gross revenue only from a cross-channel share that actually reported", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [
        finding({
          id: "share",
          detectorKey: "revenue.channel_share",
          code: "CHANNEL_REVENUE_SHARE",
          valueKind: "ratio",
          valueNumerator: 120_000,
          valueDenominator: 300_000,
          currency: "AED",
          expectedPeriodCount: 31,
          observedPeriodCount: 20,
          absentPeriodCount: 11,
        }),
      ],
      evidence: [],
    });

    const gross = view.summaryTiles[0];
    expect(gross.value).toEqual({
      kind: "money",
      minorUnits: 120_000,
      currency: "AED",
      base: null,
    });
    // The coverage travels with the figure, so a share of twenty days is never
    // read as a share of the month.
    expect(gross.coverage).toEqual({ expected: 31, observed: 20, absent: 11 });
    expect(gross.findingId).toBe("share");
  });

  it("keeps contribution margin blank because no report writes its inputs", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [
        finding({
          id: "share",
          detectorKey: "revenue.channel_share",
          code: "CHANNEL_REVENUE_SHARE",
          valueNumerator: 120_000,
          valueDenominator: 300_000,
          currency: "AED",
        }),
      ],
      evidence: [],
    });

    expect(view.summaryTiles[1].value).toBeNull();
    expect(view.summaryTiles[1].unavailableReason).toContain("variable cost");
    expect(view.summaryTiles[2].value).toBeNull();
  });

  it("shows the completed run, and keeps a failed one visible", () => {
    const view = buildChannelWorkspaceView({
      runs: [
        run({ id: "run-2", status: "failed", safeFailureCode: "EVIDENCE_UNAVAILABLE" }),
        run(),
      ],
      findings: [],
      evidence: [],
    });

    expect(view.run?.id).toBe("run-1");
    expect(view.runs.map((entry) => entry.status)).toEqual(["failed", "completed"]);
  });

  it("carries the cited evidence onto the finding it belongs to", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [finding(), finding({ id: "other" })],
      evidence: [
        {
          findingId: "finding-1",
          evidenceKind: "normalized_metric",
          evidenceRole: "component",
          referenceId: "m1",
        },
        {
          findingId: "other",
          evidenceKind: "projection_run",
          evidenceRole: "gap_count",
          referenceId: "r1",
        },
      ],
    });

    const first = view.chapters
      .flatMap((chapter) => chapter.findings)
      .find((entry) => entry.id === "finding-1");
    expect(first?.evidence).toEqual([
      { kind: "normalized_metric", role: "component", referenceId: "m1" },
    ]);
  });

  it("never drops a finding whose detector no chapter claims", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [
        finding({ id: "future", detectorKey: "margin.contribution", code: "SOMETHING_NEW" }),
      ],
      evidence: [],
    });

    expect(view.unplacedFindings.map((entry) => entry.id)).toEqual(["future"]);
    // An unknown code renders as itself rather than as a blank.
    expect(view.unplacedFindings[0].headline).toBe("SOMETHING_NEW");
  });

  it("puts a quantified finding above an observation and needs_data", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [
        finding({
          id: "a",
          detectorKey: "evidence.reconciliation_blocked",
          code: "NO_EVIDENCE_HELD",
        }),
        finding({
          id: "b",
          detectorKey: "evidence.reconciliation_blocked",
          code: "EVIDENCE_HELD_FOR_DECISION",
          kind: "finding",
          severity: "high",
          priority: 10,
        }),
      ],
      evidence: [],
    });

    const trust = view.chapters.find((chapter) => chapter.id === "trust");
    expect(trust?.findings.map((entry) => entry.id)).toEqual(["b", "a"]);
    expect(trust?.findings[0].severityTone).toBe("danger");
  });

  describe("ADR 0035 ordering", () => {
    // The one money-declaring detector per chapter means two declared amounts
    // can only meet in the unplaced rail, so that is where the amount rules
    // are proven; the fallback rules are proven inside a single chapter.
    function pricedFinding(
      id: string,
      minorUnits: number,
      overrides: Partial<ChannelFindingRecord> = {},
    ): ChannelFindingRecord {
      return finding({
        id,
        detectorKey: "margin.contribution",
        code: "MARGIN_CONTRIBUTION",
        kind: "observation",
        valueKind: "money",
        valueNumerator: minorUnits,
        currency: "AED",
        monetaryImpactMinorUnits: minorUnits,
        ...overrides,
      });
    }

    it("ranks two declared amounts by amount descending, whatever their kind", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          pricedFinding("smaller-observation", 35_700),
          pricedFinding("bigger-finding", -90_000, {
            kind: "finding",
            severity: "low",
            priority: 1,
          }),
        ],
        evidence: [],
      });

      // Amount descending is taken literally from the stored figure, sign
      // included: re-ranking by absolute size would be arithmetic the rule
      // never declared, and would set a gain above a loss.
      expect(view.unplacedFindings.map((entry) => entry.id)).toEqual([
        "smaller-observation",
        "bigger-finding",
      ]);
    });

    it("puts a money-bearing observation above a money-less finding", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          pricedFinding("priced-observation", 10_000),
          finding({
            id: "held-finding",
            detectorKey: "evidence.reconciliation_blocked",
            code: "EVIDENCE_HELD_FOR_DECISION",
            kind: "finding",
            severity: "critical",
            priority: 1,
          }),
        ],
        evidence: [],
      });

      // A declared amount outranks everything, including a higher severity
      // that named no method: only detectors that declared one earned the top.
      expect(view.unplacedFindings[0].id).toBe("priced-observation");
      const trust = view.chapters.find((chapter) => chapter.id === "trust");
      expect(trust?.findings.map((entry) => entry.id)).toEqual(["held-finding"]);
    });

    it("falls back to kind, then severity, then priority when nobody declared money", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          finding({
            id: "finding-high-priority-20",
            detectorKey: "evidence.reconciliation_blocked",
            code: "EVIDENCE_HELD_FOR_DECISION",
            kind: "finding",
            severity: "high",
            priority: 20,
          }),
          finding({
            id: "finding-critical-null-priority-first",
            detectorKey: "evidence.reconciliation_blocked",
            code: "EVIDENCE_HELD_FOR_DECISION",
            kind: "finding",
            severity: "critical",
          }),
          finding({
            id: "finding-medium-priority-1",
            detectorKey: "evidence.reconciliation_blocked",
            code: "EVIDENCE_HELD_FOR_DECISION",
            kind: "finding",
            severity: "medium",
            priority: 1,
          }),
          finding({
            id: "finding-high-priority-10",
            detectorKey: "evidence.reconciliation_blocked",
            code: "EVIDENCE_HELD_FOR_DECISION",
            kind: "finding",
            severity: "high",
            priority: 10,
          }),
        ],
        evidence: [],
      });

      // Severity is checked before priority, so a critical finding with no
      // stated priority still outranks a high one with priority 1; within one
      // severity, priority ascending puts 10 before 20.
      const trust = view.chapters.find((chapter) => chapter.id === "trust");
      expect(trust?.findings.map((entry) => entry.id)).toEqual([
        "finding-critical-null-priority-first",
        "finding-high-priority-10",
        "finding-high-priority-20",
        "finding-medium-priority-1",
      ]);
    });

    it("breaks a full tie by detector key ascending", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          finding({
            id: "cancellation",
            detectorKey: "orders.cancellation_loss",
            code: "ORDER_CANCELLATION_LOSS",
          }),
          finding({
            id: "closed-share",
            detectorKey: "operations.closed_share",
            code: "OPERATIONS_CLOSED_SHARE",
          }),
        ],
        evidence: [],
      });

      // Same kind, no money on either, and no severity or priority: the stored
      // keys decide, and both live in the operations chapter.
      const operations = view.chapters.find((chapter) => chapter.id === "operations");
      expect(operations?.findings.map((entry) => entry.id)).toEqual([
        "closed-share",
        "cancellation",
      ]);
    });
  });

  describe("the verdict band", () => {
    it("speaks directionally from stored findings and states nothing else", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          finding({
            id: "share",
            detectorKey: "revenue.channel_share",
            code: "CHANNEL_REVENUE_SHARE",
            valueKind: "ratio",
            valueNumerator: 120_000,
            valueDenominator: 300_000,
            currency: "AED",
            expectedPeriodCount: 31,
            observedPeriodCount: 31,
            absentPeriodCount: 0,
          }),
          finding({
            id: "movement",
            detectorKey: "revenue.period_movement",
            code: "REVENUE_PERIOD_MOVEMENT_UP",
            valueKind: "money",
            valueNumerator: 30_000,
            valueDenominator: 90_000,
            currency: "AED",
          }),
          finding({ id: "coverage", code: "PERIOD_COVERAGE_COMPLETE", observedPeriodCount: 31 }),
        ],
        evidence: [],
      });

      expect(view.verdict.headlineSentence).toContain("rose");
      expect(view.verdict.badges).toEqual([
        "Gross revenue is reported for this window.",
        "Gross revenue rose against the period before.",
        "Every period in this window carries governed evidence.",
      ]);
    });

    it("leads with caution when some periods carry no governed evidence", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          finding({
            id: "movement",
            detectorKey: "revenue.period_movement",
            code: "REVENUE_PERIOD_MOVEMENT_DOWN",
            valueKind: "money",
            valueNumerator: -50_000,
            currency: "AED",
          }),
          finding({ id: "coverage", code: "PERIOD_COVERAGE_INCOMPLETE" }),
        ],
        evidence: [],
      });

      expect(view.verdict.headlineSentence).toMatch(/with care/);
      expect(view.verdict.badges[2]).toBe(
        "Some periods in this window carry no governed evidence.",
      );
    });

    it("says what is missing instead of inventing figures when nothing ran", () => {
      const view = buildChannelWorkspaceView({ runs: [], findings: [], evidence: [] });

      expect(view.verdict.headlineSentence).toMatch(/not enough governed evidence/);
      expect(view.verdict.badges).toHaveLength(3);
      // Honesty check: with no run at all there is no figure to speak of, so
      // no badge may carry a digit that looks like one.
      for (const badge of view.verdict.badges) expect(badge).not.toMatch(/\d/);
    });
  });
});
