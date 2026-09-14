// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { briefRevisionSchema } from "@/domain/growth-intelligence/brief";
import {
  assembleReportReader,
  type AssembledReportView,
} from "@/modules/growth-intelligence/application/report-reader";
import {
  ReportReaderDialog,
  ReportReaderView,
} from "@/components/growth-intelligence/report-reader";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const PROJECT = "50000000-0000-4000-8000-000000000005";
const BRANCH = "20000000-0000-4000-8000-000000000002";
const REVISION = "61000000-0000-4000-8000-000000000061";
const REPORT_VERSION = "63000000-0000-4000-8000-000000000063";
const REPORT_ROW = "64000000-0000-4000-8000-000000000064";
const CLAIM = "90000000-0000-4000-8000-000000000009";

function viewFixture(overrides: Record<string, unknown> = {}): AssembledReportView {
  const content = {
    reportId: REPORT_ROW,
    reportVersionId: REPORT_VERSION,
    organizationId: ORGANIZATION,
    projectId: PROJECT,
    locationId: BRANCH,
    briefRevisionId: REVISION,
    evidenceDigest: "digest-pinned-1",
    summary: "Compare family offers and check delivery capacity before choosing a promotion.",
    localMeaning: "Downtown families order early for National Day.",
    findings: [
      {
        key: "finding-1",
        statement: "Family bundles appear across competitors.",
        citationSlots: [{ claimId: CLAIM, sourceRef: "S1" }],
      },
    ],
    competitorComparison: [{ competitorName: "Rival Kitchen", summary: "Promotes family bundles." }],
    speculativeEstimate: {
      label: "Rival Kitchen · Monthly sales scenario",
      range: { lowMinorUnits: 4_500_000, highMinorUnits: 7_000_000, currency: "AED" },
      assumptions: ["Assume 40–60 orders per day at AED 38 across 30 trading days."],
      reasoning: "Reviews and visible offers do not establish volume; this is a scenario.",
    },
    gaps: [{ key: "gap-1", description: "Operating capacity is not confirmed." }],
    draftAdvice: [
      {
        itemKey: "bundle",
        kind: "action",
        title: "Draft one clear family bundle",
        detail: "Name the occasion and what the customer receives.",
      },
    ],
    sources: [{ sourceRef: "S1", url: "https://rival.example/menu" }],
    ...overrides,
  };
  return assembleReportReader({
    organizationId: ORGANIZATION,
    reportRow: {
      reportId: REPORT_ROW,
      reportVersionId: REPORT_VERSION,
      organizationId: ORGANIZATION,
      projectId: PROJECT,
      branchId: BRANCH,
      briefRevisionId: REVISION,
      evidenceDigest: "digest-pinned-1",
      content,
      reviewState: "pending_review",
      createdAt: "2026-09-12T10:00:00.000Z",
    },
    briefRow: {
      revisionId: REVISION,
      organizationId: ORGANIZATION,
      projectId: PROJECT,
      revisionNumber: 1,
      document: briefRevisionSchema.parse({
        revisionId: REVISION,
        projectId: PROJECT,
        organizationId: ORGANIZATION,
        revisionNumber: 1,
        question: "How should we prepare for National Day?",
        title: "Prepare for National Day",
        locationId: BRANCH,
        researchArea: "Downtown Dubai",
        competitors: [{ name: "Rival Kitchen", source: "operator_lead" }],
        investigationAreas: ["demand", "presence", "offers", "reviews", "observable_performance"],
        evidencePeriods: [{ label: "Channel reports · 1–31 Aug 2026" }],
        businessContextSnapshotId: "00000000-0000-4000-8000-000000000000",
        frequency: "once",
        pinnedToUpdateId: "65000000-0000-4000-8000-000000000065",
        createdAtUtc: "2026-09-10T11:00:00.000Z",
      }),
      createdAt: "2026-09-10T11:00:00.000Z",
    },
    project: {
      projectId: PROJECT,
      organizationId: ORGANIZATION,
      branchId: BRANCH,
      title: "Prepare for National Day",
      question: "How should we prepare for National Day?",
    },
    branchName: "Downtown",
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ReportReaderView", () => {
  it("leads with the summary and local meaning before findings", () => {
    render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);

    expect(screen.getByText("What matters for Downtown")).toBeTruthy();
    expect(screen.getByText(/delivery capacity/)).toBeTruthy();
    expect(screen.getByText("What it means for Downtown")).toBeTruthy();
    expect(screen.getByText(/order early for National Day/)).toBeTruthy();
    expect(screen.getByText("Findings to keep in view")).toBeTruthy();
  });

  it("navigates sections and jumps a citation to its source record", () => {
    render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);

    fireEvent.click(screen.getByRole("button", { name: "Competitors" }));
    expect(screen.getByRole("heading", { name: "Competitors & their offers" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Competitors" }).getAttribute("aria-current"),
    ).toBe("page");

    fireEvent.click(screen.getByRole("button", { name: "Summary" }));
    fireEvent.click(screen.getByRole("button", { name: "See source S1" }));
    expect(screen.getByRole("heading", { name: "Sources & evidence" })).toBeTruthy();
    const source = screen.getByTestId("reader-source-S1");
    expect(source.className).toMatch(/bg-primary\/10/);
    expect(source.textContent).toContain("https://rival.example/menu");
  });

  it("keeps the estimate label, assumptions and reasoning on one surface", () => {
    render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);
    fireEvent.click(screen.getByRole("button", { name: "Competitors" }));

    expect(screen.getByText("Speculative estimate")).toBeTruthy();
    expect(screen.getByText("Rival Kitchen · Monthly sales scenario")).toBeTruthy();
    expect(screen.getByText(/AED 45,000–70,000/)).toBeTruthy();
    expect(screen.getByText("Assumptions behind this range")).toBeTruthy();
    expect(screen.getByText(/40–60 orders per day/)).toBeTruthy();
    expect(screen.getByText("Reasoning")).toBeTruthy();
    expect(screen.getByText(/this is a scenario/)).toBeTruthy();
  });

  it("keeps draft-advice selection local with destination labels and no writes", () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("must not fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);
      fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));

      expect(screen.getByText("Draft one clear family bundle")).toBeTruthy();
      expect(screen.getByText("Adds to Recommendations")).toBeTruthy();
      fireEvent.click(screen.getByRole("checkbox", { name: /Draft one clear family bundle/ }));
      expect(screen.getByRole("status").textContent).toContain("1 item selected for review");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reflows at narrow widths: scrolling index, wrapped table, internal article scroll", () => {
    const { container } = render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);

    const nav = screen.getByRole("navigation", { name: "Report sections" });
    expect(nav.className).toMatch(/overflow-x-auto/);
    const article = container.querySelector("article");
    expect(article?.className).toMatch(/overflow-y-auto/);
    expect(article?.className).toMatch(/min-w-0/);

    fireEvent.click(screen.getByRole("button", { name: "Competitors" }));
    const tableWrap = container.querySelector("table")?.parentElement;
    expect(tableWrap?.className).toMatch(/overflow-x-auto/);
    // Long names wrap instead of clipping: no fixed widths on content.
    expect(screen.getByText("Rival Kitchen").className).toMatch(/break-words/);
  });

  it("renders honest empty and expired-source states", () => {
    render(
      <ReportReaderView
        view={viewFixture({
          speculativeEstimate: undefined,
          gaps: [],
          draftAdvice: [],
          sources: [{ sourceRef: "S1" }],
          findings: [
            {
              key: "finding-1",
              statement: "Family bundles appear across competitors.",
              citationSlots: [{ claimId: CLAIM, sourceRef: "S9" }],
            },
          ],
        })}
        timeZone="Asia/Dubai"
      />,
    );

    // An unknown citation degrades to inert text, never a jump to nowhere.
    expect(screen.queryByRole("button", { name: /See source/ })).toBeNull();
    expect(screen.getByText("[S9]")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Competitors" }));
    expect(screen.queryByText("Speculative estimate")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));
    expect(screen.getByText("No draft advice was saved with this report.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sources" }));
    expect(screen.getByText(/Source evidence no longer available/)).toBeTruthy();
    expect(screen.getByTestId("reader-source-S1").textContent).toContain("[S1]");
  });
});

describe("ReportReaderDialog", () => {
  function dialogProps(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: ORGANIZATION,
      reportVersionId: REPORT_VERSION as string | null,
      open: true,
      onOpenChange: vi.fn(),
      timeZone: "Asia/Dubai",
      ...overrides,
    };
  }

  function readerBody(reportVersionId = REPORT_VERSION, title = "Prepare for National Day") {
    const view = viewFixture();
    return {
      report: {
        ...view,
        identity: { ...view.identity, reportVersionId, projectTitle: title },
      },
    };
  }

  it("loads the pinned version by id with a persistent PDF download and footer", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(readerBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<ReportReaderDialog {...dialogProps()} />);
      expect(screen.getByLabelText("Loading report")).toBeTruthy();

      expect(await screen.findByText("What matters for Downtown")).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/organizations/${ORGANIZATION}/growth-intelligence/monitoring/reports/${REPORT_VERSION}`,
        expect.objectContaining({ cache: "no-store" }),
      );
      const download = screen.getByRole("link", { name: /download pdf/i });
      expect(download.getAttribute("href")).toBe(
        `/api/organizations/${ORGANIZATION}/growth-intelligence/monitoring/reports/${REPORT_VERSION}/download`,
      );
      expect(screen.getByRole("button", { name: /^close$/i })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps the prior report with its date when a refresh fails", async () => {
    const fetchMock = vi
      .fn(async () => new Response(JSON.stringify(readerBody()), { status: 200 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify(readerBody()), { status: 200 }))
      .mockImplementationOnce(async () => new Response("oops", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { rerender } = render(<ReportReaderDialog {...dialogProps()} />);
      expect(await screen.findByText("What matters for Downtown")).toBeTruthy();

      rerender(
        <ReportReaderDialog
          {...dialogProps({ reportVersionId: "66000000-0000-4000-8000-000000000066" })}
        />,
      );
      // The retained report stays on screen with its date and a retry.
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.getByText("What matters for Downtown")).toBeTruthy();
      expect(screen.getAllByText(/12 Sep 2026/).length).toBeGreaterThanOrEqual(2);
      expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never lets page-filter changes disturb the opened report", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(readerBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const { rerender } = render(<ReportReaderDialog {...dialogProps()} />);
      expect(await screen.findByText("What matters for Downtown")).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);

      rerender(<ReportReaderDialog {...dialogProps({ timeZone: "Europe/London" })} />);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(screen.getByText("What matters for Downtown")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows failure with retry when the first load fails", async () => {
    const fetchMock = vi
      .fn(async () => new Response("oops", { status: 500 }))
      .mockImplementationOnce(async () => new Response("oops", { status: 500 }))
      .mockImplementationOnce(
        async () => new Response(JSON.stringify(readerBody()), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<ReportReaderDialog {...dialogProps()} />);
      expect(await screen.findByText("This report could not be loaded")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      expect(await screen.findByText("What matters for Downtown")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("closes on Escape and restores focus on Close", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(readerBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const onOpenChange = vi.fn();
      function harness(open: boolean) {
        return (
          <div>
            <button type="button" data-testid="opener">
              Open report
            </button>
            <ReportReaderDialog {...dialogProps({ open, onOpenChange })} />
          </div>
        );
      }
      const { rerender } = render(harness(false));
      const opener = screen.getByTestId("opener");
      opener.focus();
      rerender(harness(true));
      await screen.findByText("What matters for Downtown");

      fireEvent.keyDown(screen.getByRole("dialog", { name: /prepare for national day/i }), {
        key: "Escape",
      });
      await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));

      // The footer Close unmounts the dialog, which restores focus to the opener.
      // The close commits synchronously, like the production parent update.
      fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
      rerender(harness(false));
      await waitFor(() => expect(document.activeElement).toBe(opener));
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
