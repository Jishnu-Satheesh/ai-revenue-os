import { describe, expect, it } from "vitest";

import { channelAnalysisDetectors } from "@/domain/analysis/registry";
import { WORKSPACE_CHAPTERS } from "@/domain/analysis/copy";
import {
  BAND_DETECTOR_KEYS,
  buildChannelWorkspaceView,
  projectOrganizationRecommendationLane,
  type OrganizationRecommendationRecord,
} from "@/modules/analysis/application/read-model";
import type {
  ChannelAnalysisRunRecord,
  ChannelFindingRecord,
  ChannelRecommendationDecisionRecord,
  ChannelRecommendationRecord,
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
    resultDigest: "d".repeat(64),
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
  it("gives every registered detector somewhere to appear", () => {
    // A chapter with no detector keys renders as deferred, so a detector
    // belonging to no chapter and to no band slot is computed, stored, cited --
    // and shown to nobody. That is what happened to `economics.commission_share`:
    // it shipped while the money chapter still told operators no approved report
    // writes a cost, and nothing compared the two halves. This is that check.
    const placed = new Set([
      ...WORKSPACE_CHAPTERS.flatMap((chapter) => chapter.detectorKeys),
      ...BAND_DETECTOR_KEYS,
    ]);
    const unplaced = channelAnalysisDetectors
      .map((detector) => detector.key)
      .filter((key) => !placed.has(key));

    expect(unplaced).toEqual([]);
  });

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
      recommendations: [],
    });

    const trust = view.chapters.find((chapter) => chapter.id === "trust");
    expect(trust?.findings.map((f) => f.detectorKey)).toEqual([
      "evidence.period_coverage",
      "evidence.reconciliation_blocked",
    ]);
    // The movement and share findings are placed in the verdict band rather
    // than a chapter, so nothing leaks into "Also measured".
    expect(view.unplacedFindings).toHaveLength(0);
  });

  it("marks the chapters no report fills as deferred, each with a reason", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [finding()],
      evidence: [],
      recommendations: [],
    });

    // Registry version 2 gave Funnel and Operations detectors, so only the
    // chapters waiting on other reports stay deferred.
    const deferred = view.chapters.filter((chapter) => chapter.state === "deferred");
    expect(deferred.map((chapter) => chapter.id).sort()).toEqual([
      "customer-voice",
      "items",
      "promotions",
      "recommendations",
    ]);
    // An empty frame reads as "nothing wrong here", so each one has to say why.
    for (const chapter of deferred) expect(chapter.deferredReason).toBeTruthy();
  });

  it("tells a chapter nobody analysed apart from one whose detector needed data", () => {
    const notRun = buildChannelWorkspaceView({
      runs: [],
      findings: [],
      evidence: [],
      recommendations: [],
    });
    expect(notRun.chapters.find((chapter) => chapter.id === "funnel")?.state).toBe("not_run");

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
      recommendations: [],
    });
    expect(needsData.chapters.find((chapter) => chapter.id === "trust")?.state).toBe("needs_data");
  });

  it("separates a chapter its run never bound from one nobody analysed", () => {
    // A channel reporting one figure for its whole window binds only the two
    // detectors that can answer without periods. The remaining chapters used to
    // read "No analysis has completed for this channel" while one had just
    // completed -- a false statement about the operator's own data.
    const boundNothing = buildChannelWorkspaceView({
      runs: [run()],
      findings: [],
      evidence: [],
      recommendations: [],
    });
    expect(boundNothing.chapters.find((chapter) => chapter.id === "funnel")?.state).toBe(
      "not_applicable",
    );

    // And the genuine case still reads as itself.
    const neverRan = buildChannelWorkspaceView({
      runs: [],
      findings: [],
      evidence: [],
      recommendations: [],
    });
    expect(neverRan.chapters.find((chapter) => chapter.id === "funnel")?.state).toBe("not_run");
  });

  it("shows no run for a window with none, even beside another window's run", () => {
    // A covered-but-unanalysed URL beside another window's completed run: the
    // page passes displayedRunId: null, so the view must stay not-analysed
    // rather than borrowing that run.
    const view = buildChannelWorkspaceView({
      runs: [run({ id: "run-other", windowStart: "2026-02-01", windowEnd: "2026-02-28" })],
      findings: [],
      evidence: [],
      recommendations: [],
      displayedRunId: null,
    });

    expect(view.run).toBeNull();
    expect(view.chapters.find((chapter) => chapter.id === "funnel")?.state).toBe("not_run");
    // The full list still feeds the indicators, which is why it is not narrowed.
    expect(view.runs).toHaveLength(1);
  });

  it("shows the page's exact-window run rather than the newest completed one", () => {
    const view = buildChannelWorkspaceView({
      runs: [
        run({ id: "run-new", windowStart: "2026-02-01", windowEnd: "2026-02-28" }),
        run({ id: "run-window", windowStart: "2026-01-01", windowEnd: "2026-01-31" }),
      ],
      findings: [],
      evidence: [],
      recommendations: [],
      displayedRunId: "run-window",
    });

    expect(view.run?.id).toBe("run-window");
    expect(view.runs).toHaveLength(2);
  });

  it("renders a needs_data outcome as a sentence and never as a number", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [
        finding({
          kind: "needs_data",
          code: "FUNNEL_STAGE_CONVERSION_UNAVAILABLE",
          detectorKey: "funnel.stage_conversion",
          needsDataReason: "STAGE_SERIES_ABSENT",
          valueKind: null,
          valueNumerator: null,
          valueDenominator: null,
        }),
      ],
      evidence: [],
      recommendations: [],
    });

    const outcome = view.chapters.find((chapter) => chapter.id === "funnel")?.findings[0];
    expect(outcome?.value).toBeNull();
    expect(outcome?.detail).toContain("carries no figures");
    expect(outcome?.severity).toBeNull();
  });

  it("leaves a tile blank with a reason rather than showing a zero", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [],
      evidence: [],
      recommendations: [],
    });

    for (const tile of view.summaryTiles) {
      expect(tile.value).toBeNull();
      expect(tile.unavailableReason).toBeTruthy();
    }
  });

  it("fills gross revenue from the channel-scoped window observation", () => {
    const view = buildChannelWorkspaceView({
      runs: [run()],
      findings: [
        finding({
          id: "window-gross",
          detectorKey: "revenue.window_gross",
          code: "WINDOW_GROSS_REVENUE",
          valueKind: "money",
          valueNumerator: 91_000,
          valueDenominator: null,
          currency: "AED",
          expectedPeriodCount: 5,
          observedPeriodCount: 2,
          absentPeriodCount: 3,
        }),
      ],
      evidence: [],
      recommendations: [],
    });

    const gross = view.summaryTiles[0];
    expect(gross.value).toEqual({
      kind: "money",
      minorUnits: 91_000,
      currency: "AED",
      base: null,
    });
    // The coverage travels with the figure, so two reported days are never
    // read as a five-day revenue total.
    expect(gross.coverage).toEqual({ expected: 5, observed: 2, absent: 3 });
    expect(gross.findingId).toBe("window-gross");
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
      recommendations: [],
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
      recommendations: [],
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
      recommendations: [],
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
      recommendations: [],
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
      recommendations: [],
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
        recommendations: [],
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
        recommendations: [],
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
        recommendations: [],
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

    it("splits cancellations and availability into their own chapters", () => {
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
        recommendations: [],
      });

      // The approved draft separates the two questions: cancellations and the
      // provider's rejection loss live in their own chapter, and closed time
      // lives in the availability heatmap chapter. Neither is merged under one
      // "operations" card.
      const cancellations = view.chapters.find((chapter) => chapter.id === "cancellations");
      const availability = view.chapters.find((chapter) => chapter.id === "availability");
      expect(cancellations?.findings.map((entry) => entry.id)).toEqual(["cancellation"]);
      expect(availability?.findings.map((entry) => entry.id)).toEqual(["closed-share"]);
    });
  });

  describe("the verdict band", () => {
    it("builds the earned, lost, and potential split from channel-scoped evidence", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          finding({
            id: "window-gross",
            detectorKey: "revenue.window_gross",
            code: "WINDOW_GROSS_REVENUE",
            valueKind: "money",
            valueNumerator: 91_000,
            valueDenominator: null,
            currency: "AED",
          }),
          finding({
            id: "cancellation-loss",
            detectorKey: "orders.cancellation_loss",
            code: "ORDER_CANCELLATION_LOSS",
            valueKind: "count",
            valueNumerator: 7,
            valueDenominator: null,
            currency: "AED",
            monetaryImpactMinorUnits: 35_700,
          }),
        ],
        evidence: [],
        recommendations: [],
      });

      expect(view.verdict.verdictFigures).toEqual({
        potential: { minorUnits: 91_000, currency: "AED" },
        lost: { minorUnits: 35_700, currency: "AED" },
        earned: { minorUnits: 55_300, currency: "AED" },
      });
      expect(view.unplacedFindings).toHaveLength(0);
    });

    it("withholds the entire split when the stored amounts cannot be compared", () => {
      const baseFindings = [
        finding({
          id: "window-gross",
          detectorKey: "revenue.window_gross",
          code: "WINDOW_GROSS_REVENUE",
          valueKind: "money",
          valueNumerator: 91_000,
          valueDenominator: null,
          currency: "AED",
        }),
      ];
      const mismatchedCurrency = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          ...baseFindings,
          finding({
            id: "cancellation-usd",
            detectorKey: "orders.cancellation_loss",
            code: "ORDER_CANCELLATION_LOSS",
            valueKind: "count",
            valueNumerator: 7,
            valueDenominator: null,
            currency: "USD",
            monetaryImpactMinorUnits: 35_700,
          }),
        ],
        evidence: [],
        recommendations: [],
      });
      const lossAbovePotential = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          ...baseFindings,
          finding({
            id: "cancellation-too-large",
            detectorKey: "orders.cancellation_loss",
            code: "ORDER_CANCELLATION_LOSS",
            valueKind: "count",
            valueNumerator: 7,
            valueDenominator: null,
            currency: "AED",
            monetaryImpactMinorUnits: 91_001,
          }),
        ],
        evidence: [],
        recommendations: [],
      });

      expect(mismatchedCurrency.verdict.verdictFigures).toEqual({
        potential: null,
        lost: null,
        earned: null,
      });
      expect(lossAbovePotential.verdict.verdictFigures).toEqual({
        potential: null,
        lost: null,
        earned: null,
      });
    });

    it("speaks directionally from stored findings and states nothing else", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [
          finding({
            id: "window-gross",
            detectorKey: "revenue.window_gross",
            code: "WINDOW_GROSS_REVENUE",
            valueKind: "money",
            valueNumerator: 120_000,
            valueDenominator: null,
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
        recommendations: [],
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
        recommendations: [],
      });

      expect(view.verdict.headlineSentence).toMatch(/with care/);
      expect(view.verdict.badges[2]).toBe(
        "Some periods in this window carry no governed evidence.",
      );
    });

    it("says what is missing instead of inventing figures when nothing ran", () => {
      const view = buildChannelWorkspaceView({
        runs: [],
        findings: [],
        evidence: [],
        recommendations: [],
      });

      expect(view.verdict.headlineSentence).toMatch(/not enough governed evidence/);
      expect(view.verdict.badges).toHaveLength(3);
      // Honesty check: with no run at all there is no figure to speak of, so
      // no badge may carry a digit that looks like one.
      for (const badge of view.verdict.badges) expect(badge).not.toMatch(/\d/);
    });
  });

  describe("recommendations", () => {
    function triageDecision(
      overrides: Partial<ChannelRecommendationDecisionRecord> = {},
    ): ChannelRecommendationDecisionRecord {
      return {
        recommendationId: "rec-1",
        decision: "acknowledged",
        reason: null,
        snoozedUntil: null,
        actorId: "actor-1",
        actorName: "Dana",
        createdAt: "2026-02-02T09:00:00Z",
        ...overrides,
      };
    }

    function recommendation(
      overrides: Partial<ChannelRecommendationRecord> = {},
    ): ChannelRecommendationRecord {
      return {
        id: "rec-1",
        analysisRunId: "run-1",
        channelId: CHANNEL,
        branchId: "branch-1",
        resultDigest: "d".repeat(64),
        label: "recommendation",
        headline: "Close the seventeen uncovered days first",
        detail:
          "Seventeen days in January carry no governed evidence, so any conclusion about them is a guess.",
        supportedActions: ["reupload_report"],
        limitations: ["Impact has not been measured."],
        citationFindingIds: ["finding-1"],
        decisions: [],
        myFeedback: null,
        createdAt: "2026-02-01T00:05:00Z",
        ...overrides,
      };
    }

    it("carries the narrator's words with their citations and nothing invented", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [finding()],
        evidence: [],
        recommendations: [recommendation()],
      });

      expect(view.recommendations).toHaveLength(1);
      const rec = view.recommendations[0];
      expect(rec.id).toBe("rec-1");
      expect(rec.label).toBe("recommendation");
      expect(rec.headline).toBe("Close the seventeen uncovered days first");
      expect(rec.detail).toContain("Seventeen days");
      expect(rec.supportedActions).toEqual(["reupload_report"]);
      expect(rec.limitations).toEqual(["Impact has not been measured."]);
      // Citations travel as finding ids so the page can attach the narration
      // to the chapter that holds the evidence; none is invented here.
      expect(rec.citationFindingIds).toEqual(["finding-1"]);
      expect(rec.decision).toBeNull();
      expect(rec.myFeedback).toBeNull();
    });

    it("passes each label through exactly as the narrator filed it", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [],
        evidence: [],
        recommendations: [
          recommendation({ id: "rec-o", label: "observation" }),
          recommendation({ id: "rec-r", label: "recommendation" }),
          recommendation({ id: "rec-n", label: "needs_data" }),
        ],
      });

      expect(view.recommendations.map((rec) => rec.label)).toEqual([
        "observation",
        "recommendation",
        "needs_data",
      ]);
    });

    it("announces the newest triage answer when several people decided", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [],
        evidence: [],
        recommendations: [
          recommendation({
            decisions: [
              triageDecision({
                decision: "acknowledged",
                actorName: "Dana",
                createdAt: "2026-02-02T09:00:00Z",
              }),
              triageDecision({
                decision: "dismissed",
                reason: "We already reuploaded January.",
                actorId: "actor-2",
                actorName: "Omar",
                createdAt: "2026-02-03T11:30:00Z",
              }),
            ],
          }),
        ],
      });

      expect(view.recommendations[0].decision).toEqual({
        decision: "dismissed",
        reason: "We already reuploaded January.",
        snoozedUntil: null,
        actorName: "Omar",
        createdAt: "2026-02-03T11:30:00Z",
      });
    });

    it("reflects the viewer's own vote, whatever it was", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [],
        evidence: [],
        recommendations: [
          recommendation({ id: "rec-helpful", myFeedback: true }),
          recommendation({ id: "rec-not", myFeedback: false }),
          recommendation({ id: "rec-silent", myFeedback: null }),
        ],
      });

      expect(view.recommendations.find((rec) => rec.id === "rec-helpful")?.myFeedback).toBe(true);
      expect(view.recommendations.find((rec) => rec.id === "rec-not")?.myFeedback).toBe(false);
      // Absence is null, never a silent false.
      expect(view.recommendations.find((rec) => rec.id === "rec-silent")?.myFeedback).toBeNull();
    });

    it("keeps a recommendation whose citations name nothing on display", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [finding()],
        evidence: [],
        recommendations: [
          recommendation({ id: "rec-cited", citationFindingIds: ["finding-1"] }),
          recommendation({ id: "rec-unplaced", citationFindingIds: [] }),
          recommendation({ id: "rec-superseded", citationFindingIds: ["finding-gone"] }),
        ],
      });

      // Band data with no displayed anchor still reaches the page: dropping it
      // would hide what the narrator said about the run.
      expect(view.recommendations.map((rec) => rec.id)).toEqual([
        "rec-cited",
        "rec-unplaced",
        "rec-superseded",
      ]);
      expect(view.recommendations[1].citationFindingIds).toEqual([]);
    });

    it("renders an empty list when the narrator never spoke", () => {
      const view = buildChannelWorkspaceView({
        runs: [run()],
        findings: [finding()],
        evidence: [],
        recommendations: [],
      });

      expect(view.recommendations).toEqual([]);
    });
  });
});

describe("projectOrganizationRecommendationLane", () => {
  const record = (
    overrides: Partial<OrganizationRecommendationRecord> = {},
  ): OrganizationRecommendationRecord => ({
    id: "rec-1",
    channelId: "channel-1",
    branchId: null,
    label: "recommendation",
    headline: "Extend Friday hours",
    detail: "Friday evenings carry the strongest observed demand.",
    windowStart: "2026-08-01",
    windowEnd: "2026-08-31",
    generatedAt: "2026-09-01T08:00:00.000Z",
    decision: null,
    pinned: false,
    preferenceSnoozedUntil: null,
    ...overrides,
  });

  it("groups records by label without copying them", () => {
    const lanes = projectOrganizationRecommendationLane(
      [
        record(),
        record({ id: "rec-2", label: "observation" }),
        record({ id: "rec-3", label: "needs_data" }),
      ],
      "2026-09",
    );

    expect(lanes.recommendations.map((row) => row.id)).toEqual(["rec-1"]);
    expect(lanes.insights.map((row) => row.id)).toEqual(["rec-2"]);
    expect(lanes.dataGaps.map((row) => row.id)).toEqual(["rec-3"]);
  });

  it("marks an actionable earlier-window record as carried over with its age", () => {
    const lanes = projectOrganizationRecommendationLane(
      [record({ windowStart: "2026-07-01", windowEnd: "2026-07-31" })],
      "2026-09",
    );

    expect(lanes.recommendations[0]!.actionable).toBe(true);
    expect(lanes.recommendations[0]!.carriedOver).toBe(true);
    expect(lanes.recommendations[0]!.ageLabel).toBe("2 months old");
  });

  it("marks decided records as not actionable while keeping them for the timeline", () => {
    const lanes = projectOrganizationRecommendationLane(
      [
        record({
          id: "rec-dismissed",
          decision: {
            decision: "dismissed",
            snoozedUntil: null,
            createdAt: "2026-09-02T08:00:00.000Z",
          },
        }),
        record({
          id: "rec-planned",
          decision: {
            decision: "planned",
            snoozedUntil: null,
            createdAt: "2026-09-02T08:00:00.000Z",
          },
        }),
      ],
      "2026-09",
    );

    expect(lanes.recommendations.map((row) => [row.id, row.actionable])).toEqual([
      ["rec-dismissed", false],
      ["rec-planned", false],
    ]);
  });

  it("rejects a non-canonical activity month", () => {
    expect(() => projectOrganizationRecommendationLane([record()], "September")).toThrow(
      /canonical/,
    );
  });
});
