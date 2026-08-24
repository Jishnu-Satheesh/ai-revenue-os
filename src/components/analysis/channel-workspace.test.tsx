// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ChannelWorkspace } from "@/components/analysis/channel-workspace";
import { buildChannelWorkspaceView } from "@/modules/analysis/application/read-model";
import type {
  ChannelAnalysisRunRecord,
  ChannelEvidenceWindow,
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

const EVIDENCE_WINDOW: ChannelEvidenceWindow = {
  packageId: "package-1",
  channelId: CHANNEL.id,
  branchId: "branch-1",
  windowStart: "2026-01-01",
  windowEnd: "2026-01-31",
  timeZone: "Asia/Dubai",
  grain: "day",
  governedRowCount: 28,
  sourceFilename: "Talabat-Jan-2026.xlsx",
};

function renderWorkspace(input: {
  runs?: ChannelAnalysisRunRecord[];
  findings?: ChannelFindingRecord[];
  evidence?: ChannelFindingEvidenceRecord[];
  canRunAnalysis?: boolean;
  evidenceWindows?: ChannelEvidenceWindow[];
}) {
  const view = buildChannelWorkspaceView({
    runs: input.runs ?? [run()],
    findings: input.findings ?? [],
    evidence: input.evidence ?? [],
  });
  render(
    <ChannelWorkspace
      organizationId="org-1"
      channel={CHANNEL}
      view={view}
      evidenceWindows={input.evidenceWindows ?? [EVIDENCE_WINDOW]}
      canRunAnalysis={input.canRunAnalysis ?? true}
      channelsHref="/organizations/org-1/channels"
      economicsHref="/organizations/org-1/economics"
    />,
  );
}

/** Opens the pill-style window select, whose options live in a Radix portal. */
async function openWindowPicker() {
  // Radix opens the listbox from pointerdown only when the event looks like a
  // primary click, which jsdom's synthetic event does not do on its own.
  fireEvent.pointerDown(screen.getByLabelText("Window to analyse"), {
    button: 0,
    ctrlKey: false,
    pointerType: "mouse",
  });
  return within(await screen.findByRole("listbox")).getAllByRole("option");
}

beforeAll(() => {
  // Radix Select measures and scrolls its items; jsdom implements neither.
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn(() => true);
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

describe("ChannelWorkspace", () => {
  it("keeps an accessible chapter map whose links resolve to rendered sections", () => {
    renderWorkspace({});

    // Deferred chapters are not anchored -- they render on the awaiting
    // shelf, so linking to them would dead-end mid-story.
    const nav = screen.getByRole("navigation", { name: "Workspace chapters" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Summary", "Funnel", "Operations", "Reports & Trust", "Awaiting other reports"]);
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
      screen.getByText("No period-over-period comparison is available yet."),
    ).toBeTruthy();
    // The deterministic claim requires a run that produced findings.
    expect(screen.queryByText("Deterministic findings only")).toBeNull();
    expect(screen.getByText("Nothing analysed")).toBeTruthy();
    // An unstateable gross figure is a dash beside its reason, never zero.
    expect(screen.getByText(/No analysis has run for this channel yet\./)).toBeTruthy();
  });

  it("draws the four chapter states distinctly in one pass", () => {
    renderWorkspace({
      findings: [
        finding({
          id: "movement-up",
          detectorKey: "revenue.period_movement",
          code: "REVENUE_PERIOD_MOVEMENT_UP",
          valueKind: "money",
          valueNumerator: 2_300,
          valueDenominator: 1_900,
          currency: "AED",
        }),
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

    // Summary: reported, with figures and comparison bars drawn from stores.
    const summary = screen.getByRole("region", { name: "Summary chapter" });
    expect(within(summary).getAllByText(/AED 23\.00/).length).toBeGreaterThan(0);
    const band = screen.getByRole("region", { name: "Marketplace audit verdict" });
    // `\s` stands in for the non-breaking space `Intl` puts after the currency
    // code, which accessible-name matching surfaces raw.
    expect(
      within(band).getByRole("img", {
        name: /Prior period AED\s19\.00; movement \+AED\s23\.00/,
      }),
    ).toBeTruthy();

    // Funnel: needs_data, saying what was missing rather than showing a frame.
    const funnel = screen.getByRole("region", { name: "Funnel chapter" });
    expect(within(funnel).getAllByText("Needs data").length).toBeGreaterThan(0);
    expect(
      within(funnel).getAllByText(/missing step that read as a complete funnel/i).length,
    ).toBeGreaterThan(0);

    // Operations: detectors exist, no findings came back -> not analysed.
    const operations = screen.getByRole("region", { name: "Operations chapter" });
    expect(within(operations).getByText("Not analysed")).toBeTruthy();

    // Trust has no reconciliation outcome in this fixture, so it reads as
    // structurally empty -- while the coverage outcome it also detects is
    // placed in Summary, where the read model files it.
    const trust = screen.getByRole("region", { name: "Reports & Trust chapter" });
    expect(within(trust).getByText("Not analysed")).toBeTruthy();
    expect(
      within(trust).getByText(/Figures appear here once an analysis has run over this channel\./),
    ).toBeTruthy();
    expect(within(summary).getAllByText(/14 of 31 periods/).length).toBeGreaterThan(0);
  });

  it("lists every deferred chapter's own reason on the awaiting shelf, verbatim", () => {
    renderWorkspace({});

    const shelf = screen.getByRole("region", { name: "Awaiting other reports" });
    // One distinctive clause per chapter's recorded deferredReason.
    for (const clause of [
      "none can report on this channel.",
      "item profit without a cost is a guess.",
      "which does not exist yet.",
      "the platform does not yet import.",
      "without narration, which is the fallback the specification requires.",
    ]) {
      expect(clause && within(shelf).getByText(new RegExp(clause.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))).toBeTruthy();
    }
    expect(within(shelf).getByText("Money")).toBeTruthy();
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

  it("renders money through formatMoney, with its base stated beside it", () => {
    renderWorkspace({
      findings: [
        finding({
          detectorKey: "revenue.period_movement",
          code: "REVENUE_PERIOD_MOVEMENT_DOWN",
          valueKind: "money",
          valueNumerator: -30_000,
          valueDenominator: 120_000,
          currency: "AED",
          expectedPeriodCount: 2,
          observedPeriodCount: 2,
          absentPeriodCount: 0,
        }),
      ],
    });

    // Signed money uses the same formatter; the minus is a real minus sign.
    expect(screen.getAllByText(/−AED 300\.00/).length).toBeGreaterThan(0);
    expect(screen.getByText(/against AED 1,200\.00/)).toBeTruthy();
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

    const cancellation = screen.getByText(
      "Avoidable cancellations, with the provider's own rejection loss",
    );
    const closedShare = screen.getByText(
      "Share of scheduled minutes this channel reported closed",
    );
    expect(
      cancellation.compareDocumentPosition(closedShare) & Node.DOCUMENT_POSITION_FOLLOWING,
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
  });

  it("renders an em-dash and a reason for every figure it cannot state", () => {
    renderWorkspace({});

    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // Both money figures are blocked by the same missing inputs, so the same
    // recorded reason stands beside each dash.
    expect(screen.getAllByText(/Contribution margin needs every variable cost/i)).toHaveLength(2);
  });

  it("shows a needs_data outcome as a sentence with no figure", () => {
    renderWorkspace({
      findings: [
        finding({
          detectorKey: "revenue.period_movement",
          kind: "needs_data",
          code: "REVENUE_PERIOD_MOVEMENT_UNAVAILABLE",
          needsDataReason: "PRIOR_PERIOD_ABSENT",
          valueKind: null,
          valueNumerator: null,
          valueDenominator: null,
        }),
      ],
    });

    expect(screen.getAllByText("No period-over-period comparison is available").length).toBeGreaterThan(0);
    expect(
      screen.getAllByText(/Reaching further back would compare across days nobody measured/i)
        .length,
    ).toBeGreaterThan(0);
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

  it("hides the run control from a member who may not start one", () => {
    renderWorkspace({ canRunAnalysis: false });

    expect(screen.queryByRole("button", { name: "Run analysis" })).toBeNull();
  });

  it("offers the declared windows newest-first inside the pill control", async () => {
    renderWorkspace({
      evidenceWindows: [
        EVIDENCE_WINDOW,
        {
          ...EVIDENCE_WINDOW,
          packageId: "package-2",
          windowStart: "2025-12-01",
          windowEnd: "2025-12-31",
        },
      ],
    });

    const options = await openWindowPicker();
    expect(options.map((option) => option.textContent)).toEqual([
      "2026-01-01 to 2026-01-31 · daily",
      "2025-12-01 to 2025-12-31 · daily",
    ]);
  });

  it("names the grain the evidence was written at, so a run cannot ask for another", async () => {
    renderWorkspace({
      evidenceWindows: [{ ...EVIDENCE_WINDOW, grain: "month" }],
    });

    const options = await openWindowPicker();
    expect(options.some((option) => /· monthly$/.test(option.textContent ?? ""))).toBe(true);
  });

  it("says there is no window to analyse rather than offering a dead control", () => {
    renderWorkspace({ evidenceWindows: [] });

    expect(screen.getByText(/no window to analyse yet/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run analysis" })).toBeNull();
    expect(screen.queryByLabelText("Window to analyse")).toBeNull();
  });

  it("does not imply a provider connection from a channel", () => {
    renderWorkspace({});

    expect(screen.getByText("No connection implied")).toBeTruthy();
  });
});
