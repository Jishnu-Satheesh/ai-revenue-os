// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectOverviewDialog } from "@/components/growth-intelligence/project-overview-dialog";
import {
  buildMarketWatchProjectList,
  type MarketWatchProjectListItem,
  type MarketWatchProjectReportSummary,
} from "@/modules/growth-intelligence/application/market-watch";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const DOWNTOWN = "20000000-0000-4000-8000-00000000000a";
const PROJECT = "50000000-0000-4000-8000-000000000005";
const TIME_ZONE = "Asia/Dubai";

const NEWEST_REPORT: MarketWatchProjectReportSummary = {
  reportVersionId: "60000000-0000-4000-8000-000000000006",
  briefRevisionId: "61000000-0000-4000-8000-000000000061",
  reviewState: "pending_review",
  createdAt: "2026-09-12T10:00:00Z",
  takeaway: "Compare family offers and check delivery capacity before choosing a promotion.",
};

const OLDER_REPORT: MarketWatchProjectReportSummary = {
  reportVersionId: "62000000-0000-4000-8000-000000000062",
  briefRevisionId: "63000000-0000-4000-8000-000000000063",
  reviewState: "reviewed",
  createdAt: "2026-09-08T10:00:00Z",
  takeaway: null,
};

/** The exact en-AE short date the dialog renders, computed the same way. */
function reportDate(value: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function readyProject(): MarketWatchProjectListItem {
  const [item] = buildMarketWatchProjectList({
    projects: [
      {
        projectId: PROJECT,
        organizationId: ORGANIZATION,
        branchId: DOWNTOWN,
        branchName: "Downtown",
        title: "Prepare for National Day",
        question: "How should we prepare for National Day?",
        mode: "one-time",
        lifecycle: "active",
        createdAt: "2026-09-10T10:00:00Z",
      },
    ],
    reportsByProject: new Map([[PROJECT, [NEWEST_REPORT, OLDER_REPORT]]]),
    revisionsByProject: new Map([
      [
        PROJECT,
        [
          {
            revisionId: "61000000-0000-4000-8000-000000000061",
            revisionNumber: 1,
            pinnedToUpdateId: "64000000-0000-4000-8000-000000000064",
            createdAt: "2026-09-10T11:00:00Z",
          },
        ],
      ],
    ]),
  });
  return item;
}

function attentionProject(): MarketWatchProjectListItem {
  const [item] = buildMarketWatchProjectList({
    projects: [
      {
        projectId: PROJECT,
        organizationId: ORGANIZATION,
        branchId: DOWNTOWN,
        branchName: "Downtown",
        title: "Weekend delivery opportunity",
        question: "Should we extend delivery hours on weekends?",
        mode: "one-time",
        lifecycle: "active",
        createdAt: "2026-09-10T10:00:00Z",
      },
    ],
    reportsByProject: new Map(),
    revisionsByProject: new Map(),
  });
  return item;
}

function researchingProject(): MarketWatchProjectListItem {
  const [item] = buildMarketWatchProjectList({
    projects: [
      {
        projectId: PROJECT,
        organizationId: ORGANIZATION,
        branchId: DOWNTOWN,
        branchName: "Downtown",
        title: "National Day opportunity",
        question:
          "Find out what nearby competitors are offering for National Day and how we could attract more family orders without putting delivery quality at risk.",
        mode: "recurring",
        lifecycle: "active",
        createdAt: "2026-09-10T10:00:00Z",
      },
    ],
    reportsByProject: new Map(),
    revisionsByProject: new Map([
      [
        PROJECT,
        [
          {
            revisionId: "61000000-0000-4000-8000-000000000061",
            revisionNumber: 1,
            pinnedToUpdateId: "64000000-0000-4000-8000-000000000064",
            createdAt: "2026-09-10T11:00:00Z",
          },
        ],
      ],
    ]),
  });
  return item;
}

function dialogProps(overrides: Record<string, unknown> = {}) {
  return {
    project: readyProject(),
    reports: [NEWEST_REPORT, OLDER_REPORT],
    timeZone: TIME_ZONE,
    open: true,
    onOpenChange: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

describe("ProjectOverviewDialog", () => {
  it("renders the title, question, pill and report history newest-first", () => {
    render(<ProjectOverviewDialog {...dialogProps()} />);

    expect(screen.getByText("Market Watch")).toBeTruthy();
    expect(screen.getByText("Prepare for National Day")).toBeTruthy();
    expect(screen.getByText("Downtown · One-time research")).toBeTruthy();
    expect(screen.getByText("How should we prepare for National Day?")).toBeTruthy();
    expect(screen.getByText("Ready to review")).toBeTruthy();
    expect(screen.getByText(`Report · ${reportDate("2026-09-12T10:00:00Z")}`)).toBeTruthy();
    expect(screen.getByText(`Report · ${reportDate("2026-09-08T10:00:00Z")}`)).toBeTruthy();
    expect(screen.getByText(/Compare family offers and check delivery capacity/)).toBeTruthy();
  });

  it("skips the takeaway line when a report has none", () => {
    render(<ProjectOverviewDialog {...dialogProps({ reports: [OLDER_REPORT] })} />);

    expect(screen.getByText(`Report · ${reportDate("2026-09-08T10:00:00Z")}`)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Review report · ${reportDate("2026-09-08T10:00:00Z")}` }),
    ).toBeTruthy();
  });

  it("shows the queued progress timeline instead of an empty history when no reports exist", () => {
    render(
      <ProjectOverviewDialog {...dialogProps({ project: attentionProject(), reports: [] })} />,
    );

    expect(screen.getByText("Research queued")).toBeTruthy();
    expect(
      screen.getByText("Your reviewed brief is saved. This project is waiting for research to start."),
    ).toBeTruthy();
    expect(screen.getByText("Research the market")).toBeTruthy();
    expect(screen.getByText("Prepare your report")).toBeTruthy();
    expect(screen.getByText("Ready for your review")).toBeTruthy();
    expect(
      screen.getByText("You can close this dialog and return to the project later."),
    ).toBeTruthy();
    // The failing state this replaced showed a history section with no
    // reports; the progress mockup has neither the header nor the line.
    expect(screen.queryByText("No reports yet.")).toBeNull();
    expect(screen.queryByText("Report history")).toBeNull();
    expect(screen.queryByRole("button", { name: "Review report" })).toBeNull();
  });

  it("names the saved brief and live pill for researching projects", () => {
    render(
      <ProjectOverviewDialog {...dialogProps({ project: researchingProject(), reports: [] })} />,
    );

    expect(screen.getByText("National Day opportunity")).toBeTruthy();
    expect(screen.getByText("Downtown · Recurring research")).toBeTruthy();
    expect(screen.getByText("Researching")).toBeTruthy();
    expect(screen.getByText("Brief saved")).toBeTruthy();
    expect(
      screen.getByText("The exact question and scope are saved for this update."),
    ).toBeTruthy();
    expect(
      screen.getByText("You can close this dialog and return to the project later."),
    ).toBeTruthy();
  });

  it("keeps a History entry point beside Pause, Stop and Close", () => {
    render(
      <ProjectOverviewDialog {...dialogProps({ project: researchingProject(), reports: [] })} />,
    );

    const footer = document.querySelector('[data-slot="dialog-footer"]');
    if (!footer) throw new Error("missing dialog footer");
    const names = within(footer as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(names).toEqual(
      expect.arrayContaining(["Pause monitoring", "Stop this research", "History", "Close"]),
    );

    // History only moves focus within the dialog; it never navigates.
    fireEvent.click(within(footer as HTMLElement).getByRole("button", { name: "History" }));
    expect(screen.getByText("National Day opportunity")).toBeTruthy();
  });

  it("keeps pause and stop disabled with honest backend-update reasons", () => {
    render(<ProjectOverviewDialog {...dialogProps()} />);

    const pause = screen.getByRole("button", { name: "Pause monitoring" });
    expect(pause).toHaveProperty("disabled", true);
    expect(pause.getAttribute("title")).toMatch(/project controls arrive with the backend update/i);

    const stop = screen.getByRole("button", { name: "Stop this research" });
    expect(stop).toHaveProperty("disabled", true);
    expect(stop.getAttribute("title")).toMatch(/project controls arrive with the backend update/i);
  });

  it("keeps review controls disabled with their reason without onReviewReport", () => {
    render(<ProjectOverviewDialog {...dialogProps()} />);

    const review = screen.getByRole("button", { name: "Review report" });
    expect(review).toHaveProperty("disabled", true);
    expect(review.getAttribute("title")).toMatch(/unavailable in this view/i);

    const historyReview = screen.getByRole("button", {
      name: `Review report · ${reportDate("2026-09-12T10:00:00Z")}`,
    });
    expect(historyReview).toHaveProperty("disabled", true);
    expect(historyReview.getAttribute("title")).toMatch(/unavailable in this view/i);
  });

  it("routes the latest Review report through onReviewReport with its id", () => {
    const onReviewReport = vi.fn();
    render(<ProjectOverviewDialog {...dialogProps({ onReviewReport })} />);

    fireEvent.click(screen.getByRole("button", { name: "Review report" }));
    expect(onReviewReport).toHaveBeenCalledWith("60000000-0000-4000-8000-000000000006");
  });

  it("routes each history Review link through onReviewReport with its id", () => {
    const onReviewReport = vi.fn();
    render(<ProjectOverviewDialog {...dialogProps({ onReviewReport })} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: `Review report · ${reportDate("2026-09-08T10:00:00Z")}`,
      }),
    );
    expect(onReviewReport).toHaveBeenCalledWith("62000000-0000-4000-8000-000000000062");
  });

  it("closes through onOpenChange(false)", () => {
    const onOpenChange = vi.fn();
    render(<ProjectOverviewDialog {...dialogProps({ onOpenChange })} />);

    // The corner X shares the "Close" name, so scope to the footer button.
    const footer = document.querySelector('[data-slot="dialog-footer"]');
    if (!footer) throw new Error("missing dialog footer");
    fireEvent.click(within(footer as HTMLElement).getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("mounts through the open prop only", () => {
    render(<ProjectOverviewDialog {...dialogProps({ open: false })} />);

    expect(screen.queryByText("Prepare for National Day")).toBeNull();
  });
});
