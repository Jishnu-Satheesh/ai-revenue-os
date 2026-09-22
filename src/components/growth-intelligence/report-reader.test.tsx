// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("leads the summary with question and findings, keeping local meaning in its own section", () => {
    render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);

    expect(screen.getByText("What matters for Downtown")).toBeTruthy();
    expect(screen.getByText(/delivery capacity/)).toBeTruthy();
    // The prototype summary goes straight from the question to the findings.
    expect(screen.queryByText("What it means for Downtown")).toBeNull();
    expect(screen.getByText("Findings to keep in view")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Local opportunity" }));
    expect(screen.getByRole("heading", { name: "The local opportunity" })).toBeTruthy();
    expect(screen.getByText(/order early for National Day/)).toBeTruthy();
  });

  it("matches the prototype summary treatment: green eyebrow, short cites, gaps icon", () => {
    render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);

    expect(screen.getByText("The short version").className).toMatch(/emerald-700/);
    // Long source tokens collapse to short per-finding labels; the full
    // reference stays on the accessible name.
    expect(screen.getByRole("button", { name: "See source S1" }).textContent).toBe("[S1]");
    const gapsTitle = screen.getByText("Where the evidence is incomplete");
    expect(gapsTitle.querySelector("svg")).toBeTruthy();
  });

  it("tones competitor rows by evidence: dark findings, muted empty states", () => {
    const { rerender } = render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);
    fireEvent.click(screen.getByRole("button", { name: "Competitors" }));

    const heading = screen.getByRole("heading", { name: "Competitors & their offers" });
    expect(heading.className).toMatch(/text-\[22px\]/);
    expect(heading.className).toMatch(/font-bold/);
    // Fixture row carries no citations: honest empty state in muted tone.
    const emptyCell = screen.getByText(/Promotes family bundles/).closest("td");
    expect(emptyCell?.className).toMatch(/text-muted-foreground/);

    rerender(
      <ReportReaderView
        view={viewFixture({
          competitorComparison: [
            {
              competitorName: "Rival Kitchen",
              summary: "Promotes family bundles.",
              citationSlots: [{ claimId: CLAIM, sourceRef: "S1" }],
            },
          ],
        })}
        timeZone="Asia/Dubai"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Competitors" }));
    const fullCell = screen.getByText(/Promotes family bundles/).closest("td");
    expect(fullCell?.className).not.toMatch(/text-muted-foreground/);
  });

  it("renders sources as short labels with domain titles and no internal digest", () => {
    render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));

    const heading = screen.getByRole("heading", { name: "Sources & evidence" });
    expect(heading.className).toMatch(/text-\[22px\]/);
    expect(heading.className).toMatch(/font-bold/);
    expect(screen.queryByText(/Evidence digest/)).toBeNull();

    const record = screen.getByTestId("reader-source-S1");
    expect(record.textContent).toContain("[S1] · rival.example");
    const link = within(record).getByRole("link");
    expect(link.getAttribute("href")).toBe("https://rival.example/menu");
  });

  it("falls back to the short label when a source URL is malformed or missing", () => {
    render(
      <ReportReaderView
        view={viewFixture({
          sources: [
            { sourceRef: "S1", url: "not a url", retrievedAtUtc: "2026-09-11T10:00:00.000Z" },
          ],
        })}
        timeZone="Asia/Dubai"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Sources" }));

    const record = screen.getByTestId("reader-source-S1");
    expect(record.textContent).toContain("[S1]");
    expect(record.textContent).not.toContain("·");
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

  it("keeps section labels, order and behavior with icons", () => {
    render(<ReportReaderView view={viewFixture()} timeZone="Asia/Dubai" />);

    const nav = screen.getByRole("navigation", { name: "Report sections" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Summary",
      "Competitors",
      "Local opportunity",
      "Draft advice",
      "Sources",
    ]);
    for (const button of buttons) {
      expect(button.querySelector("svg")).toBeTruthy();
    }
  });

  it("holds summary-finding checkboxes disabled with an honest reason", () => {
    render(
      <ReportReaderView
        view={viewFixture()}
        timeZone="Asia/Dubai"
        acceptance={{ organizationId: ORGANIZATION, canAccept: true }}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: /Select finding for Insights/ });
    expect(checkbox).toBeDisabled();
    expect(
      screen.getByText(/accepting findings needs a backend update/),
    ).toBeTruthy();
    fireEvent.click(checkbox);
    expect(screen.getByRole("status").textContent).toContain("Nothing selected");
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
    // It keeps the short per-finding label; the full reference stays on title.
    expect(screen.queryByRole("button", { name: /See source/ })).toBeNull();
    const inertCite = screen.getByText("[S1]");
    expect(inertCite.getAttribute("title")).toBe("S9");

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
      expect(screen.getByRole("button", { name: /save for later/i })).toBeTruthy();
      expect(screen.getByRole("button", { name: /^review selection$/i })).toBeDisabled();
      expect(screen.getByText(/stays in the Ready to review list/)).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("holds a fixed frame so short reports do not collapse the dialog", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(readerBody()), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<ReportReaderDialog {...dialogProps()} />);
      expect(await screen.findByText("What matters for Downtown")).toBeTruthy();
      const dialog = screen.getByRole("dialog");
      expect(dialog.className).toMatch(/sm:h-\[85vh\]/);
      expect(dialog.className).toMatch(/max-h-\[90vh\]/);
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

  it("closes on Escape and restores focus on Close", async () => {    const fetchMock = vi.fn(async () => new Response(JSON.stringify(readerBody()), { status: 200 }));
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

describe("ReportReaderView acceptance", () => {
  const acceptUrl =
    `/api/organizations/${ORGANIZATION}/growth-intelligence/monitoring/reports/${REPORT_VERSION}/accept`;

  function adviceView() {
    return viewFixture({
      draftAdvice: [
        {
          itemKey: "bundle",
          kind: "action",
          title: "Draft one clear family bundle",
          detail: "Name the occasion and what the customer receives.",
        },
        {
          itemKey: "late-note",
          kind: "finding",
          title: "Late-night demand is visible in reviews",
          detail: "Several reviews mention late closing times.",
        },
      ],
    });
  }

  function acceptResponse(items: { itemKey: string; destination: string; outcome: string }[]) {
    return new Response(JSON.stringify({ items }), { status: 200 });
  }

  function reviewDialogProps(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: ORGANIZATION,
      reportVersionId: REPORT_VERSION as string | null,
      open: true,
      onOpenChange: vi.fn(),
      timeZone: "Asia/Dubai",
      canAccept: true,
      ...overrides,
    };
  }

  function stubReviewFetch(
    acceptImpl: () => Promise<Response>,
    view: AssembledReportView = adviceView(),
  ) {
    const fetchMock = vi.fn(async (url: unknown) => {
      if (typeof url === "string" && url.endsWith("/accept")) return acceptImpl();
      return new Response(JSON.stringify({ report: view }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  function acceptCalls(fetchMock: ReturnType<typeof vi.fn>) {
    return fetchMock.mock.calls.filter(
      ([url]) => typeof url === "string" && (url as string).endsWith("/accept"),
    );
  }

  async function openReviewWithOneSelected() {
    fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Draft one clear family bundle/ }));
    fireEvent.click(screen.getByRole("button", { name: /review selection \(1\)/i }));
    return screen.findByRole("dialog", { name: /review selected items/i });
  }

  it("stays local-only without the review entry point", () => {
    render(<ReportReaderView view={adviceView()} timeZone="Asia/Dubai" />);
    fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));

    expect(screen.queryByRole("button", { name: /accept selected/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /review selection/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /mark as reviewed/i })).toBeNull();
  });

  it("previews type-derived destinations with a local summary and no writes", () => {
    const fetchMock = vi.fn(async () => {
      throw new Error("must not fetch");
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <ReportReaderView
          view={adviceView()}
          timeZone="Asia/Dubai"
          acceptance={{ organizationId: ORGANIZATION, canAccept: true }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));

      // Per-item destination preview, derived from the item type.
      expect(screen.getByText("Adds to Recommendations")).toBeTruthy();
      expect(screen.getByText("Adds to Insights")).toBeTruthy();

      fireEvent.click(screen.getByRole("checkbox", { name: /Draft one clear family bundle/ }));
      expect(screen.getByText(/1 to Recommendations/)).toBeTruthy();
      expect(screen.getByText(/keeps its link to this report \(Brief 1\)/)).toBeTruthy();
      expect(screen.getByText(/Use Review selection in the footer/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /accept selected/i })).toBeNull();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("footer offers save-for-later close and a live review-selection entry", async () => {
    stubReviewFetch(async () =>
      acceptResponse([{ itemKey: "bundle", destination: "Recommendations", outcome: "accepted" }]),
    );
    try {
      const onOpenChange = vi.fn();
      render(<ReportReaderDialog {...reviewDialogProps({ onOpenChange })} />);
      await screen.findByText("What matters for Downtown");

      expect(screen.getByRole("button", { name: /^review selection$/i })).toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));
      fireEvent.click(screen.getByRole("checkbox", { name: /Draft one clear family bundle/ }));
      expect(screen.getByRole("button", { name: /review selection \(1\)/i })).toBeEnabled();

      fireEvent.click(screen.getByRole("button", { name: /review selection \(1\)/i }));
      const review = await screen.findByRole("dialog", { name: /review selected items/i });
      expect(within(review).getByText("Draft one clear family bundle")).toBeTruthy();

      // Back to report returns to the still-open report.
      fireEvent.click(within(review).getByRole("button", { name: /back to report/i }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name: /review selected items/i })).toBeNull(),
      );
      expect(screen.getByRole("dialog", { name: /prepare for national day/i })).toBeTruthy();

      // Save for later is the honest close: the report stays in the Ready list.
      fireEvent.click(screen.getByRole("button", { name: /save for later/i }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("posts the selection once with an idempotency key from the review dialog", async () => {
    const fetchMock = stubReviewFetch(async () =>
      acceptResponse([{ itemKey: "bundle", destination: "Recommendations", outcome: "accepted" }]),
    );
    try {
      render(<ReportReaderDialog {...reviewDialogProps()} />);
      await screen.findByText("What matters for Downtown");

      const review = await openReviewWithOneSelected();
      expect(within(review).getByText(/Adds to Recommendations/)).toBeTruthy();

      fireEvent.click(within(review).getByRole("button", { name: /accept selected items/i }));
      await within(review).findByText(/accepted to Recommendations/);

      const posts = acceptCalls(fetchMock);
      expect(posts).toHaveLength(1);
      const [url, init] = posts[0] as unknown as [string, RequestInit];
      expect(url).toBe(acceptUrl);
      expect(init.method).toBe("POST");
      const body = JSON.parse(String(init.body)) as {
        items: { itemKey: string; kind: string }[];
        idempotencyKey: string;
      };
      expect(body.items).toEqual([{ itemKey: "bundle", kind: "action" }]);
      expect(body.idempotencyKey).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("single-flights rapid accept clicks into one request", async () => {
    const fetchMock = stubReviewFetch(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return acceptResponse([
        { itemKey: "bundle", destination: "Recommendations", outcome: "accepted" },
      ]);
    });
    try {
      render(<ReportReaderDialog {...reviewDialogProps()} />);
      await screen.findByText("What matters for Downtown");

      const review = await openReviewWithOneSelected();
      const accept = within(review).getByRole("button", { name: /accept selected items/i });
      fireEvent.click(accept);
      fireEvent.click(accept);
      await within(review).findByText(/accepted to Recommendations/);
      expect(acceptCalls(fetchMock)).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("explains an already-accepted replay and creates nothing", async () => {
    let calls = 0;
    const fetchMock = stubReviewFetch(async () => {
      calls += 1;
      return calls === 1
        ? acceptResponse([{ itemKey: "bundle", destination: "Recommendations", outcome: "accepted" }])
        : acceptResponse([
            { itemKey: "bundle", destination: "Recommendations", outcome: "already_accepted" },
          ]);
    });
    try {
      render(<ReportReaderDialog {...reviewDialogProps()} />);
      await screen.findByText("What matters for Downtown");

      const review = await openReviewWithOneSelected();
      fireEvent.click(within(review).getByRole("button", { name: /accept selected items/i }));
      await within(review).findByText(/accepted to Recommendations/);

      fireEvent.click(within(review).getByRole("button", { name: /accept selected items/i }));
      await within(review).findByText(/Already accepted — nothing new was added/);
      expect(acceptCalls(fetchMock)).toHaveLength(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("operates by keyboard: Space selects, Enter reviews and accepts", async () => {
    const user = userEvent.setup();
    stubReviewFetch(async () =>
      acceptResponse([{ itemKey: "bundle", destination: "Recommendations", outcome: "accepted" }]),
    );
    try {
      render(<ReportReaderDialog {...reviewDialogProps()} />);
      await screen.findByText("What matters for Downtown");
      fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));

      const checkbox = screen.getByRole("checkbox", { name: /Draft one clear family bundle/ });
      checkbox.focus();
      expect(document.activeElement).toBe(checkbox);
      await user.keyboard(" ");
      expect(checkbox).toBeChecked();
      expect(screen.getByText(/1 to Recommendations/)).toBeTruthy();

      const reviewButton = screen.getByRole("button", { name: /review selection \(1\)/i });
      reviewButton.focus();
      expect(document.activeElement).toBe(reviewButton);
      await user.keyboard("{Enter}");
      const review = await screen.findByRole("dialog", { name: /review selected items/i });

      const accept = within(review).getByRole("button", { name: /accept selected items/i });
      accept.focus();
      expect(document.activeElement).toBe(accept);
      await user.keyboard("{Enter}");
      await within(review).findByText(/accepted to Recommendations/);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("offers mark-reviewed with no feed writes when advice is empty", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ itemCount: 0 }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(
        <ReportReaderView
          view={viewFixture({ draftAdvice: [] })}
          timeZone="Asia/Dubai"
          acceptance={{ organizationId: ORGANIZATION, canAccept: true }}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));

      expect(screen.getByText("No draft advice was saved with this report.")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: /mark as reviewed/i }));
      await screen.findByText(/no feed items were created/);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe(acceptUrl);
      expect(JSON.parse(String(init.body))).toMatchObject({ markReviewed: true });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("hides the actions with a reason when the reader cannot accept", () => {
    render(
      <ReportReaderView
        view={adviceView()}
        timeZone="Asia/Dubai"
        acceptance={{ organizationId: ORGANIZATION, canAccept: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));

    expect(screen.queryByRole("button", { name: /accept selected/i })).toBeNull();
    expect(screen.getByText(/needs the manage permission/)).toBeTruthy();
  });

  it("hides accept controls by default when canAccept is omitted (viewer-safe)", () => {
    render(
      <ReportReaderView view={adviceView()} timeZone="Asia/Dubai" acceptance={{ organizationId: ORGANIZATION }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));

    expect(screen.queryByRole("button", { name: /accept selected/i })).toBeNull();
    expect(screen.getByText(/needs the manage permission/)).toBeTruthy();
  });

  it("hides mark-reviewed by default when canAccept is omitted (viewer-safe)", () => {
    render(
      <ReportReaderView
        view={viewFixture({ draftAdvice: [] })}
        timeZone="Asia/Dubai"
        acceptance={{ organizationId: ORGANIZATION }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));

    expect(screen.queryByRole("button", { name: /mark as reviewed/i })).toBeNull();
    expect(screen.getAllByText(/needs the manage permission/).length).toBeGreaterThanOrEqual(1);
  });

  it("points managers at the footer review entry when canAccept is true", () => {
    render(
      <ReportReaderView
        view={adviceView()}
        timeZone="Asia/Dubai"
        acceptance={{ organizationId: ORGANIZATION, canAccept: true }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));

    expect(screen.queryByRole("button", { name: /accept selected/i })).toBeNull();
    expect(screen.getByText(/Use Review selection in the footer/)).toBeTruthy();
    expect(screen.queryByText(/needs the manage permission/)).toBeNull();
  });

  it("review dialog explains the permission reason to viewers", async () => {
    stubReviewFetch(async () =>
      acceptResponse([{ itemKey: "bundle", destination: "Recommendations", outcome: "accepted" }]),
    );
    try {
      render(<ReportReaderDialog {...reviewDialogProps({ canAccept: false })} />);
      await screen.findByText("What matters for Downtown");

      const review = await openReviewWithOneSelected();
      expect(within(review).getByText(/needs the manage permission/)).toBeTruthy();
      expect(
        within(review).queryByRole("button", { name: /accept selected items/i }),
      ).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a safe reason when the route refuses the call", async () => {
    stubReviewFetch(async () => new Response("nope", { status: 403 }));
    try {
      render(<ReportReaderDialog {...reviewDialogProps()} />);
      await screen.findByText("What matters for Downtown");

      const review = await openReviewWithOneSelected();
      fireEvent.click(within(review).getByRole("button", { name: /accept selected items/i }));

      const alert = await within(review).findByRole("alert");
      expect(alert.textContent).toMatch(/permission/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
