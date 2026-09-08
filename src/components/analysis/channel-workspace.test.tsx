// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ChannelWorkspace } from "@/components/analysis/channel-workspace";
import type {
  AnalysisWindowSelection,
  CoverageSegment,
  CoverageWindow,
} from "@/domain/analysis/window-selection";
import { buildChannelWorkspaceView } from "@/modules/analysis/application/read-model";
import type {
  ChannelAnalysisRunRecord,
  ChannelFindingEvidenceRecord,
  ChannelFindingRecord,
} from "@/modules/analysis/application/ports";

const CHANNEL = {
  id: "channel-1",
  key: "noon",
  displayName: "Noon",
  category: "marketplace",
  templateKey: null,
  status: "active",
};

function run(overrides: Partial<ChannelAnalysisRunRecord> = {}): ChannelAnalysisRunRecord {
  return {
    id: "run-1",
    channelId: CHANNEL.id,
    branchId: "branch-1",
    windowStart: "2026-01-01",
    windowEnd: "2026-01-31",
    periodGrain: "day",
    windowTimezone: "Asia/Dubai",
    registryVersion: 1,
    detectorVersions: [{ key: "evidence.period_coverage", calculationVersion: 1 }],
    status: "completed",
    resultDigest: "d".repeat(64),
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
    channelId: CHANNEL.id,
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
    limitations: [],
    calculationDigest: "a".repeat(64),
    createdAt: "2026-02-01T00:01:00Z",
    ...overrides,
  };
}

function metricEvidence(
  findingId: string,
  referenceId: string,
  role: ChannelFindingEvidenceRecord["evidenceRole"],
  input: {
    periodStart: string;
    numerator: number;
    dimensions?: Record<string, string>;
  },
): ChannelFindingEvidenceRecord {
  return {
    findingId,
    evidenceKind: "normalized_metric",
    evidenceRole: role,
    referenceId,
    metric: {
      periodStart: input.periodStart,
      periodEnd: input.periodStart,
      numerator: input.numerator,
      dimensions: input.dimensions ?? {},
    },
  } as ChannelFindingEvidenceRecord;
}

const COVERAGE_SEGMENTS: CoverageSegment[] = [{ start: "2026-01-01", end: "2026-01-31" }];

const COVERAGE_WINDOWS: CoverageWindow[] = [
  { windowStart: "2026-01-01", windowEnd: "2026-01-31", grain: "day", governedRowCount: 31 },
];

const SELECTED_WINDOW: AnalysisWindowSelection = { from: "2026-01-01", to: "2026-01-04" };

type WorkspaceInput = {
  runs?: ChannelAnalysisRunRecord[];
  findings?: ChannelFindingRecord[];
  evidence?: ChannelFindingEvidenceRecord[];
  canRunAnalysis?: boolean;
  segments?: CoverageSegment[];
  coverageWindows?: CoverageWindow[];
  selectedWindow?: AnalysisWindowSelection | null;
  recommendations?: import("@/modules/analysis/application/ports").ChannelRecommendationRecord[];
};

/** The element on its own, so a test can re-render the same instance with a
 *  different window's view -- which is what a refresh actually does. */
function workspaceElement(input: WorkspaceInput) {
  const view = buildChannelWorkspaceView({
    runs: input.runs ?? [run()],
    findings: input.findings ?? [],
    evidence: input.evidence ?? [],
    recommendations: input.recommendations ?? [],
  });
  return (
    <ChannelWorkspace
      organizationId="org-1"
      channel={CHANNEL}
      view={view}
      segments={input.segments ?? COVERAGE_SEGMENTS}
      coverageWindows={input.coverageWindows ?? COVERAGE_WINDOWS}
      selectedWindow={input.selectedWindow === undefined ? SELECTED_WINDOW : input.selectedWindow}
      timeZone="Asia/Dubai"
      canRunAnalysis={input.canRunAnalysis ?? true}
      channelsHref="/organizations/org-1/channels"
      economicsHref="/organizations/org-1/economics"
    />
  );
}

function renderWorkspace(input: WorkspaceInput) {
  return render(workspaceElement(input));
}

beforeAll(() => {
  // Radix Select measures and scrolls its items; jsdom implements neither.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

describe("ChannelWorkspace", () => {
  it("renders narration citing nothing on display in its own Further noted shelf", () => {
    renderWorkspace({
      recommendations: [
        {
          id: "rec-loose",
          analysisRunId: "run-1",
          channelId: CHANNEL.id,
          branchId: "branch-1",
          label: "observation",
          headline: "Nothing here anchors to a chapter",
          detail:
            "Its citations name findings this page does not show, and it still reaches the operator.",
          supportedActions: [],
          limitations: [],
          resultDigest: "e".repeat(64),
          citationFindingIds: ["finding-gone"],
          decisions: [],
          myFeedback: null,
          createdAt: "2026-02-01T00:05:00Z",
        },
      ],
    });

    const shelf = screen.getByRole("region", { name: "Further noted" });
    expect(within(shelf).getByText(/Nothing here anchors to a chapter/)).toBeTruthy();
  });

  it("gives the advice box the recommendation and puts the observation beside the figure", () => {
    // What the operator saw before: the green advice box repeating the number
    // it sits next to. Advice belongs in the box; the plain reading of the
    // figure belongs with the figure.
    const cancellation = finding({
      id: "finding-cancel",
      detectorKey: "orders.cancellation_loss",
      code: "ORDER_CANCELLATION_LOSS",
      kind: "observation",
      metricKey: "order.avoidable_cancellation_count",
    });
    const base = {
      analysisRunId: "run-1",
      channelId: CHANNEL.id,
      branchId: "branch-1",
      supportedActions: [],
      limitations: [],
      citationFindingIds: ["finding-cancel"],
      decisions: [],
      myFeedback: null,
      createdAt: "2026-02-01T00:05:00Z",
    } as const;

    renderWorkspace({
      runs: [
        run({ detectorVersions: [{ key: "orders.cancellation_loss", calculationVersion: 1 }] }),
      ],
      findings: [cancellation],
      recommendations: [
        {
          ...base,
          id: "rec-observation",
          label: "observation",
          headline: "Order cancellations caused avoidable revenue loss.",
          detail: "The provider recorded financial losses from rejected and cancelled orders.",
          resultDigest: "a".repeat(64),
        },
        {
          ...base,
          id: "rec-action",
          label: "recommendation",
          headline:
            "Mark items out of stock before service rather than rejecting orders after they arrive.",
          detail:
            "Cancellations land after the order is accepted, so the lever is stock accuracy at open.",
          resultDigest: "b".repeat(64),
        },
      ],
    });

    const rail = screen.getByRole("complementary", { name: "Cancellations figures" });

    // The green advice card is the only place the action belongs, and the only
    // place the restatement must not appear.
    const adviceBoxes = within(rail).getAllByRole("region", { name: /^Recommendation: / });
    expect(adviceBoxes).toHaveLength(1);
    expect(adviceBoxes[0].getAttribute("aria-label")).toContain("Mark items out of stock");
    expect(within(adviceBoxes[0]).queryByText(/caused avoidable revenue loss/)).toBeNull();

    // The plain reading still reaches the operator -- beside the figure.
    expect(within(rail).getByText(/caused avoidable revenue loss/)).toBeTruthy();
  });

  it("keeps an accessible chapter map whose links resolve to rendered sections", () => {
    renderWorkspace({});

    // Deferred chapters are not anchored -- they render on the awaiting
    // shelf, so linking to them would dead-end mid-story.
    const nav = screen.getByRole("navigation", { name: "Workspace chapters" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual([
      "Cancellations",
      "Availability",
      "Funnel",
      "Retention",
      "Money",
      "Reports & Trust",
      "Awaiting other reports",
    ]);
  });

  it("renders the verdict band as an honest absence when nothing has completed", () => {
    renderWorkspace({ runs: [] });

    // The band leads with the sentence copy.ts chose for "no stored answers".
    expect(
      screen.getByText("There is not enough governed evidence to characterise this window yet."),
    ).toBeTruthy();
    // No comparison bars without a recorded base; the absence explains itself.
    expect(screen.queryByText("Prior period")).toBeNull();
    expect(
      screen.getByText("The earned / lost / potential split cannot be stated for this window yet."),
    ).toBeTruthy();
    // The deterministic claim requires a run that produced findings.
    expect(screen.queryByText("Deterministic findings only")).toBeNull();
    expect(screen.getByText("Nothing analysed")).toBeTruthy();
  });

  it("renders the approved revenue split from channel-scoped deterministic findings", () => {
    renderWorkspace({
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
    });

    expect(screen.getByText(/You earned/).textContent?.replace(/\u00a0/g, " ")).toBe(
      "You earned AED 553 and lost AED 357 to cancellations you could have prevented.",
    );
    expect(
      screen.getByRole("img", {
        name: (name) =>
          name.replace(/\u00a0/g, " ") ===
          "Potential AED 910.00; lost AED 357.00; earned AED 553.00.",
      }),
    ).toBeTruthy();
  });

  it("withholds a scale that would compare money in different currencies", () => {
    renderWorkspace({
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
          currency: "USD",
          monetaryImpactMinorUnits: 35_700,
        }),
      ],
    });

    expect(
      screen.getByText("The earned / lost / potential split cannot be stated for this window yet."),
    ).toBeTruthy();
    expect(screen.queryByText(/You earned/)).toBeNull();
  });

  it("draws a zero-valued split column at zero height", () => {
    renderWorkspace({
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
          valueNumerator: 0,
          valueDenominator: null,
          currency: "AED",
          monetaryImpactMinorUnits: 0,
        }),
      ],
    });

    const lostColumn = screen.getByText("Lost").parentElement;
    const bar = lostColumn?.querySelector(".h-40 > div");
    expect(bar).not.toBeNull();
    expect((bar as HTMLElement).style.height).toBe("0%");
  });

  it("draws the finding chapters distinctly in one pass", () => {
    renderWorkspace({
      findings: [
        finding({
          id: "funnel-stuck",
          detectorKey: "funnel.stage_conversion",
          kind: "needs_data",
          code: "FUNNEL_STAGE_CONVERSION_UNAVAILABLE",
          needsDataReason: "STAGE_SERIES_ABSENT",
          valueKind: null,
          valueNumerator: null,
          valueDenominator: null,
        }),
      ],
    });

    // Funnel: needs_data, saying what was missing rather than showing a frame.
    const funnel = screen.getByRole("region", { name: "Funnel chapter" });
    expect(within(funnel).getAllByText("Needs data").length).toBeGreaterThan(0);
    expect(
      within(funnel).getAllByText(/missing step that read as a complete funnel/i).length,
    ).toBeGreaterThan(0);

    // The other finding chapters: a run completed and their detectors returned
    // nothing, which means those detectors were never bound to it. A bound
    // detector always answers, so this is "does not apply", not "not analysed" --
    // telling an operator no analysis has completed when one just did is a false
    // statement about their own data. The draft keeps them as separate sections.
    for (const label of ["Cancellations", "Availability", "Retention"]) {
      const chapter = screen.getByRole("region", { name: `${label} chapter` });
      expect(within(chapter).getByText("Does not apply")).toBeTruthy();
      expect(within(chapter).queryByText("Not analysed")).toBeNull();
    }

    // Trust has no coverage or reconciliation outcome in this fixture either,
    // so it reads the same way.
    const trust = screen.getByRole("region", { name: "Reports & Trust chapter" });
    expect(within(trust).getByText("Does not apply")).toBeTruthy();
  });

  it("says no analysis has completed only when none actually has", () => {
    // The counterpart to the chapter states above: with no run at all, the
    // chapters go back to naming the real absence rather than a mismatch of
    // detector to evidence shape.
    renderWorkspace({ runs: [], findings: [] });

    const cancellations = screen.getByRole("region", { name: "Cancellations chapter" });
    expect(within(cancellations).getByText("Not analysed")).toBeTruthy();
    expect(
      within(cancellations).getByText(
        /No analysis has completed for this channel, so this chapter has nothing to report\./,
      ),
    ).toBeTruthy();
  });

  it("lists every deferred chapter's own reason on the awaiting shelf, verbatim", () => {
    renderWorkspace({});

    const shelf = screen.getByRole("region", { name: "Awaiting other reports" });
    // One distinctive clause per chapter's recorded deferredReason.
    for (const clause of [
      // The money chapter is no longer here: an approved report writes what a
      // marketplace charges, so it reports rather than waits.
      "item profit without a cost is a guess.",
      "which does not exist yet.",
      "the platform does not yet import.",
      "without narration, which is the fallback the specification requires.",
    ]) {
      expect(
        clause &&
          within(shelf).getByText(new RegExp(clause.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
      ).toBeTruthy();
    }
    expect(within(shelf).queryByText("Money")).toBeNull();
    expect(within(shelf).getByText("Items")).toBeTruthy();
    expect(within(shelf).getByText("Promotions")).toBeTruthy();
    expect(within(shelf).getByText("Customer Voice")).toBeTruthy();
    expect(within(shelf).getByText("Recommendations")).toBeTruthy();
  });

  it("opens one shared evidence sheet carrying the detector key and digest", async () => {
    renderWorkspace({ findings: [finding()] });

    fireEvent.click(screen.getAllByRole("button", { name: "Inspect evidence" })[0]);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByText(/evidence\.period_coverage/)).toBeTruthy());
    expect(dialog.textContent).toContain("a".repeat(64));
  });

  it("never renders the forbidden legacy labels", () => {
    renderWorkspace({ findings: [finding()] });

    const bodyText = document.body.textContent ?? "";
    expect(bodyText).not.toContain("Evidence Node");
    expect(bodyText).not.toContain("Evidence node");
    expect(bodyText).not.toContain("Action Queue");
  });

  it("orders a chapter's rail by the ranking the read model declares", () => {
    renderWorkspace({
      findings: [
        // Declared monetary impact ranks above everything without one, even
        // though the second finding sorts earlier alphabetically.
        finding({
          id: "cancellation-loss",
          detectorKey: "orders.cancellation_loss",
          kind: "finding",
          severity: "critical",
          priority: 1,
          code: "ORDER_CANCELLATION_LOSS",
          valueKind: "count",
          valueNumerator: 10,
          valueDenominator: 26,
          currency: "AED",
          monetaryImpactMinorUnits: 350_000,
        }),
        finding({
          id: "closed-share",
          detectorKey: "operations.closed_share",
          kind: "observation",
          code: "OPERATIONS_CLOSED_SHARE",
          valueKind: "ratio",
          valueNumerator: 1_180,
          valueDenominator: 1_440,
        }),
      ],
    });

    const cancellation = within(
      screen.getByRole("complementary", { name: "Cancellations figures" }),
    ).getByText("AED 3,500.00");
    const closedShare = within(
      screen.getByRole("complementary", { name: "Availability figures" }),
    ).getByText("81.9% Hours");
    expect(
      cancellation.compareDocumentPosition(closedShare) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("draws the approved operations visuals only from stored findings and their citations", () => {
    renderWorkspace({
      findings: [
        finding({
          id: "cancellation",
          detectorKey: "orders.cancellation_loss",
          code: "ORDER_CANCELLATION_LOSS",
          valueKind: "count",
          valueNumerator: 10,
          valueDenominator: null,
          currency: "AED",
          monetaryImpactMinorUnits: 35_700,
        }),
        finding({
          id: "closed-share",
          detectorKey: "operations.closed_share",
          code: "OPERATIONS_CLOSED_SHARE",
          metricKey: "operations.closed_minutes",
          valueKind: "ratio",
          valueNumerator: 355.6,
          valueDenominator: 720,
        }),
        finding({
          id: "check-in-days",
          detectorKey: "operations.closed_share",
          code: "OPERATIONS_CLOSED_DAYS",
          metricKey: "operations.closed_days",
          valueKind: "count",
          valueNumerator: 1,
          valueDenominator: null,
        }),
        finding({
          id: "unreachable-days",
          detectorKey: "operations.closed_share",
          code: "OPERATIONS_CLOSED_DAYS",
          metricKey: "operations.closed_days",
          valueKind: "count",
          valueNumerator: 1,
          valueDenominator: null,
        }),
        finding({
          id: "customer-mix",
          detectorKey: "customer.new_share",
          code: "CUSTOMER_REPEAT_SHARE",
          valueKind: "ratio",
          valueNumerator: 1,
          valueDenominator: 26,
        }),
      ],
      evidence: [
        metricEvidence("closed-share", "closed-jan-06", "component", {
          periodStart: "2026-01-06",
          numerator: 355.6,
        }),
        metricEvidence("closed-share", "scheduled-jan-06", "denominator", {
          periodStart: "2026-01-06",
          numerator: 720,
        }),
        metricEvidence("check-in-days", "check-in-jan-06", "component", {
          periodStart: "2026-01-06",
          numerator: 1,
          dimensions: { reason_code: "CHECK_IN_REQUIRED" },
        }),
        metricEvidence("unreachable-days", "unreachable-jan-07", "component", {
          periodStart: "2026-01-07",
          numerator: 1,
          dimensions: { reason_code: "UNREACHABLE" },
        }),
      ],
    });

    const heatmap = screen.getByRole("region", { name: "Availability heatmap" });
    expect(
      within(heatmap).getByRole("img", {
        name: "2026-01-06: 355.6 closed minutes of 720 scheduled minutes.",
      }),
    ).toBeTruthy();
    expect(
      within(heatmap).getByRole("img", {
        name: "CHECK_IN_REQUIRED: 1 of 2 cited closed days.",
      }),
    ).toBeTruthy();

    const cancellations = screen.getByRole("region", {
      name: "Cancellation financial impact",
    });
    expect(within(cancellations).getByText(/AED 357\.00/)).toBeTruthy();
    expect(
      within(cancellations).getByRole("img", {
        name: "10 avoidable cancellations out of 26 recorded orders.",
      }),
    ).toBeTruthy();
    expect(within(cancellations).getByText(/root-cause breakdown is unavailable/i)).toBeTruthy();
  });

  it("says who cancelled where the marketplace names a party but prices no loss", () => {
    // Keeta attributes every cancellation and states no rejection loss. Without
    // its own rail the chapter would hold the findings and show an empty frame
    // beside them, which reads as nothing having been found.
    renderWorkspace({
      findings: [
        finding({
          id: "attributed-total",
          detectorKey: "orders.cancellation_attribution",
          code: "ORDER_CANCELLATION_ATTRIBUTION_TOTAL",
          metricKey: "order.cancellation_attribution_count",
          valueKind: "count",
          valueNumerator: 12,
          valueDenominator: null,
        }),
        finding({
          id: "attributed-share",
          detectorKey: "orders.cancellation_attribution",
          code: "ORDER_CANCELLATION_ATTRIBUTION_SHARE_OF_ORDERS",
          metricKey: "order.cancellation_attribution_count",
          valueKind: "ratio",
          valueNumerator: 12,
          valueDenominator: 60,
        }),
        finding({
          id: "party-service",
          detectorKey: "orders.cancellation_attribution",
          code: "ORDER_CANCELLATION_ATTRIBUTION_PARTY",
          metricKey: "order.cancellation_attribution_count",
          valueKind: "ratio",
          valueNumerator: 3,
          valueDenominator: 12,
        }),
        finding({
          id: "party-merchant",
          detectorKey: "orders.cancellation_attribution",
          code: "ORDER_CANCELLATION_ATTRIBUTION_PARTY",
          metricKey: "order.cancellation_attribution_count",
          valueKind: "ratio",
          valueNumerator: 9,
          valueDenominator: 12,
        }),
      ],
      evidence: [
        metricEvidence("party-service", "service-jan-06", "component", {
          periodStart: "2026-01-06",
          numerator: 3,
          dimensions: { cancelled_by: "CUSTOMER_SERVICE" },
        }),
        metricEvidence("party-merchant", "merchant-jan-06", "component", {
          periodStart: "2026-01-06",
          numerator: 9,
          dimensions: { cancelled_by: "MERCHANT" },
        }),
      ],
    });

    const cancellations = screen.getByRole("region", { name: "Cancellations chapter" });
    expect(within(cancellations).getByText("20% Cancelled")).toBeTruthy();
    // The largest party leads regardless of the order the findings arrive in,
    // and the provider's code is spoken rather than renamed.
    expect(
      within(cancellations).getByText(
        "20% of the orders this channel took were cancelled with a party named. It held merchant responsible for 75% of them.",
      ),
    ).toBeTruthy();
  });

  it("lands findings outside every chapter in the Also measured band", () => {
    renderWorkspace({
      findings: [
        finding({
          detectorKey: "voice.theme_top",
          code: "REVIEW_THEME_TOP",
          valueKind: "count",
          valueNumerator: 7,
          valueDenominator: null,
        }),
      ],
    });

    const alsoMeasured = screen.getByRole("region", { name: "Also measured" });
    expect(within(alsoMeasured).getByText("REVIEW_THEME_TOP")).toBeTruthy();
    expect(within(alsoMeasured).getByText("7")).toBeTruthy();
    expect(
      within(alsoMeasured).getByRole("img", {
        name: "Evidence coverage: 14 of 31 periods.",
      }),
    ).toBeTruthy();
  });

  it("shows a needs_data outcome as a sentence with no figure", () => {
    renderWorkspace({
      findings: [
        finding({
          detectorKey: "funnel.stage_conversion",
          kind: "needs_data",
          code: "FUNNEL_STAGE_CONVERSION_UNAVAILABLE",
          needsDataReason: "STAGE_SERIES_ABSENT",
          valueKind: null,
          valueNumerator: null,
          valueDenominator: null,
        }),
      ],
    });

    expect(screen.getAllByText(/carries no figures in this window/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Needs data").length).toBeGreaterThan(0);
  });

  it("keeps a failed run visible with the code an operator can act on", () => {
    renderWorkspace({
      runs: [
        run({ id: "run-2", status: "failed", safeFailureCode: "EVIDENCE_UNAVAILABLE" }),
        run(),
      ],
    });

    expect(screen.getByText(/last attempt failed: EVIDENCE_UNAVAILABLE/i)).toBeTruthy();
  });

  it("stops warning about a failure once a later run has succeeded", () => {
    // Talabat on staging: one ANALYSIS_PROCESSING_FAILED run on 26 Aug, then
    // six completed runs over the two days after it. The banner searched the
    // list for any failed run rather than reading the newest one, so it told
    // the operator their analysis was broken while the figures beside it came
    // from a run that had succeeded that morning.
    renderWorkspace({
      runs: [
        run({ id: "run-new", status: "completed" }),
        run({ id: "run-old", status: "failed", safeFailureCode: "ANALYSIS_PROCESSING_FAILED" }),
      ],
    });

    expect(screen.queryByText(/last attempt failed/i)).toBeNull();
  });

  it("disables the range control for a member who may not start one", () => {
    renderWorkspace({ canRunAnalysis: false });

    // The picker stays visible so the selected range still reads, but a
    // viewer who may not spend AI budget cannot apply a run from it.
    expect(screen.getByRole("button", { name: /2026-01-01/ })).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
  });

  // Month-picker coverage lives with the picker itself: the workspace now
  // offers any range the reports cover, and the run it starts is pinned by
  // "posts the picked range, not a month" above.

  it("posts the picked range, not a month", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWorkspace({ selectedWindow: { from: "2026-01-01", to: "2026-01-04" } });

    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      from: "2026-01-01",
      to: "2026-01-04",
    });
  });

  it("shows the loader instead of telling the operator to refresh", async () => {
    // The message this replaces read "refresh in a moment to see the result",
    // which asked the operator to do the waiting themselves.
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWorkspace({ selectedWindow: { from: "2026-01-01", to: "2026-01-04" } });

    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(await screen.findByText(/reading approved reports/i)).toBeInTheDocument();
    expect(screen.queryByText(/refresh in a moment/i)).not.toBeInTheDocument();
  });

  it("says plainly when the organization is over its allowance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({
          error: { message: "This organization has started a lot of analyses" },
        }),
      }),
    );
    const user = userEvent.setup();
    renderWorkspace({ selectedWindow: { from: "2026-01-01", to: "2026-01-04" } });

    await user.click(screen.getByRole("button", { name: /2026-01-01/ }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(await screen.findByText(/started a lot of analyses/i)).toBeInTheDocument();
  });

  it("says there is no reported range rather than offering a dead control", () => {
    renderWorkspace({ segments: [], coverageWindows: [], selectedWindow: null });

    expect(screen.getByText(/no reported range to analyse yet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^apply$/i })).toBeNull();
  });

  it("does not imply a provider connection from a channel", () => {
    renderWorkspace({});

    expect(screen.getByText("No connection implied")).toBeTruthy();
  });

  describe("advice gaps", () => {
    /** The detector's own words for a chapter whose evidence never arrived. */
    const NEEDS_DATA_SENTENCE = "No approved report has written evidence for these days yet.";

    const cancellationChapter = () => ({
      runs: [
        run({ detectorVersions: [{ key: "orders.cancellation_loss", calculationVersion: 1 }] }),
      ],
      findings: [
        finding({
          id: "finding-cancel",
          detectorKey: "orders.cancellation_loss",
          code: "ORDER_CANCELLATION_LOSS",
          kind: "observation",
          metricKey: "order.avoidable_cancellation_count",
        }),
      ],
    });

    /** Two chapters that both lack advice, so both draw the same button. */
    const twoChapters = () => ({
      runs: [
        run({
          detectorVersions: [
            { key: "orders.cancellation_loss", calculationVersion: 1 },
            { key: "funnel.stage_conversion", calculationVersion: 1 },
          ],
        }),
      ],
      findings: [
        finding({
          id: "finding-cancel",
          detectorKey: "orders.cancellation_loss",
          code: "ORDER_CANCELLATION_LOSS",
          kind: "observation",
          metricKey: "order.avoidable_cancellation_count",
        }),
        finding({
          id: "finding-funnel",
          detectorKey: "funnel.stage_conversion",
          code: "FUNNEL_STAGE_CONVERSION",
          kind: "observation",
          metricKey: "funnel.impressions",
        }),
      ],
    });

    /**
     * A chapter whose inputs were never reported: no model may advise on it.
     *
     * Money rather than Cancellations, because Money is drawn by the rail's
     * generic block -- the one that prints the featured finding's own sentence
     * -- which is where a second copy of that sentence could appear.
     */
    const needsDataChapter = () => ({
      runs: [
        run({ detectorVersions: [{ key: "economics.commission_share", calculationVersion: 1 }] }),
      ],
      findings: [
        finding({
          id: "finding-money",
          detectorKey: "economics.commission_share",
          code: "COMMISSION_SHARE_OF_REVENUE",
          kind: "needs_data",
          needsDataReason: "NO_GOVERNED_EVIDENCE_IN_WINDOW",
          valueKind: null,
          valueNumerator: null,
          valueDenominator: null,
        }),
      ],
    });

    it("shows a Generate AI recommendation button where a chapter has findings but the run has no narrations", () => {
      renderWorkspace({ ...cancellationChapter(), recommendations: [] });

      const rail = screen.getByRole("complementary", { name: "Cancellations figures" });
      expect(
        within(rail).getByRole("button", { name: /Generate AI recommendation/i }),
      ).toBeTruthy();
    });

    it("shows no button where advice already exists", () => {
      renderWorkspace({
        ...cancellationChapter(),
        recommendations: [
          {
            id: "rec-action",
            analysisRunId: "run-1",
            channelId: CHANNEL.id,
            branchId: "branch-1",
            label: "recommendation",
            headline: "Mark items out of stock before service.",
            detail: "Cancellations land after the order is accepted.",
            supportedActions: [],
            limitations: [],
            citationFindingIds: ["finding-cancel"],
            resultDigest: "b".repeat(64),
            decisions: [],
            myFeedback: null,
            createdAt: "2026-02-01T00:05:00Z",
          },
        ],
      });

      const rail = screen.getByRole("complementary", { name: "Cancellations figures" });
      expect(
        within(rail).queryByRole("button", { name: /Generate AI recommendation/i }),
      ).toBeNull();
    });

    it("explains the gap without a button where narration exists but skipped the chapter", () => {
      renderWorkspace({
        ...cancellationChapter(),
        recommendations: [
          {
            id: "rec-loose",
            analysisRunId: "run-1",
            channelId: CHANNEL.id,
            branchId: "branch-1",
            label: "observation",
            headline: "Nothing here anchors to a chapter",
            detail: "Its citations name findings this page does not show.",
            supportedActions: [],
            limitations: [],
            citationFindingIds: ["finding-gone"],
            resultDigest: "e".repeat(64),
            decisions: [],
            myFeedback: null,
            createdAt: "2026-02-01T00:05:00Z",
          },
        ],
      });

      const rail = screen.getByRole("complementary", { name: "Cancellations figures" });
      expect(
        within(rail).queryByRole("button", { name: /Generate AI recommendation/i }),
      ).toBeNull();
      expect(within(rail).getByText(/no advice was written for this section/i)).toBeTruthy();
    });

    it("requests narration for the displayed run when the button is pressed", async () => {
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ analysisRunId: "run-1" }), { status: 202 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderWorkspace({ ...cancellationChapter(), recommendations: [] });

      fireEvent.click(screen.getByRole("button", { name: /Generate AI recommendation/i }));
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
        "/api/organizations/org-1/channels/channel-1/analysis-runs/run-1/recommendations",
      );
      vi.unstubAllGlobals();
    });

    it("settles every section's button on one press, because one press narrates the run", async () => {
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ analysisRunId: "run-1" }), { status: 202 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderWorkspace({ ...twoChapters(), recommendations: [] });

      const buttons = screen.getAllByRole("button", { name: /Generate AI recommendation/i });
      expect(buttons.length).toBeGreaterThan(1);
      fireEvent.click(buttons[0] as HTMLElement);

      await waitFor(() =>
        expect(screen.getAllByRole("button", { name: /Advice requested/i }).length).toBe(
          buttons.length,
        ),
      );
      // The narration is filed per run, so a second section must not queue a
      // second ask -- and must not still look unpressed.
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: /Generate AI recommendation/i })).toBeNull();
      vi.unstubAllGlobals();
    });

    it("says the narrator reads the whole run, not only the section pressed", async () => {
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ analysisRunId: "run-1" }), { status: 202 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      renderWorkspace({ ...cancellationChapter(), recommendations: [] });

      fireEvent.click(screen.getByRole("button", { name: /Generate AI recommendation/i }));

      expect(await screen.findByText(/reads every section's findings together/i)).toBeTruthy();
      vi.unstubAllGlobals();
    });

    it("quotes the missing-evidence sentence once, not twice, on a needs_data chapter", () => {
      renderWorkspace({ ...needsDataChapter(), recommendations: [] });

      const rail = screen.getByRole("complementary", { name: "Money figures" });
      // The rail's generic block already prints the featured finding's own
      // words above the advice slot. Printing them again inside it read as a
      // stutter -- this is the Money chapter, where that block is what draws.
      expect(within(rail).getAllByText(NEEDS_DATA_SENTENCE)).toHaveLength(1);
      expect(within(rail).getByText(/appears once the missing evidence is reported/i)).toBeTruthy();
      expect(
        within(rail).queryByRole("button", { name: /Generate AI recommendation/i }),
      ).toBeNull();
    });

    it("does not carry one window's request into the window switched to", async () => {
      const fetchMock = vi.fn<typeof fetch>(
        async () => new Response(JSON.stringify({ analysisRunId: "run-1" }), { status: 202 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      const { rerender } = renderWorkspace({ ...cancellationChapter(), recommendations: [] });

      fireEvent.click(screen.getByRole("button", { name: /Generate AI recommendation/i }));
      await screen.findByRole("button", { name: /Advice requested/i });

      // A refresh re-renders rather than remounting, so the next window
      // arrives as new props on the same component. The new run must not
      // inherit the old run's answer.
      rerender(
        workspaceElement({
          runs: [
            run({
              id: "run-2",
              detectorVersions: [{ key: "orders.cancellation_loss", calculationVersion: 1 }],
            }),
          ],
          findings: cancellationChapter().findings.map((entry) => ({
            ...entry,
            analysisRunId: "run-2",
          })),
          recommendations: [],
        }),
      );

      expect(screen.getByRole("button", { name: /Generate AI recommendation/i })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Advice requested/i })).toBeNull();
      vi.unstubAllGlobals();
    });

    it("offers no button to a member who may not run the analysis", () => {
      renderWorkspace({ ...cancellationChapter(), recommendations: [], canRunAnalysis: false });

      const rail = screen.getByRole("complementary", { name: "Cancellations figures" });
      expect(
        within(rail).queryByRole("button", { name: /Generate AI recommendation/i }),
      ).toBeNull();
      expect(within(rail).getByText(/no advice was written for this section/i)).toBeTruthy();
    });
  });
});
