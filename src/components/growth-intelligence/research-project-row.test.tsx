// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResearchProjectRow } from "@/components/growth-intelligence/research-project-row";
import {
  buildMarketWatchProjectList,
  type MarketWatchProjectDisplayState,
  type MarketWatchProjectFailedUpdate,
  type MarketWatchProjectListItem,
  type MarketWatchProjectRecord,
  type MarketWatchProjectReportSummary,
  type MarketWatchProjectRevisionSummary,
} from "@/modules/growth-intelligence/application/market-watch";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const DOWNTOWN = "20000000-0000-4000-8000-00000000000a";
const PROJECT = "50000000-0000-4000-8000-000000000005";
const TIME_ZONE = "Asia/Dubai";

/** The exact en-AE short date the row renders, computed the same way. */
function reportDate(value: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function buildItem(input: {
  project?: Partial<MarketWatchProjectRecord>;
  reports?: readonly MarketWatchProjectReportSummary[];
  revisions?: readonly MarketWatchProjectRevisionSummary[];
  failedUpdates?: readonly MarketWatchProjectFailedUpdate[];
}): MarketWatchProjectListItem {
  const [item] = buildMarketWatchProjectList({
    projects: [
      {
        projectId: PROJECT,
        organizationId: ORGANIZATION,
        branchId: DOWNTOWN,
        branchName: "Downtown",
        title: "Competitor monitoring",
        question: "Which nearby competitors changed their offers?",
        mode: "recurring",
        lifecycle: "active",
        createdAt: "2026-09-09T10:00:00Z",
        ...input.project,
      },
    ],
    reportsByProject: new Map(input.reports ? [[PROJECT, input.reports]] : []),
    revisionsByProject: new Map(input.revisions ? [[PROJECT, input.revisions]] : []),
    failedUpdatesByProject: new Map(input.failedUpdates ? [[PROJECT, input.failedUpdates]] : []),
  });
  return item;
}

function readyItem(): MarketWatchProjectListItem {
  return buildItem({
    reports: [
      {
        reportVersionId: "60000000-0000-4000-8000-000000000006",
        briefRevisionId: "61000000-0000-4000-8000-000000000061",
        reviewState: "pending_review",
        createdAt: "2026-09-12T10:00:00Z",
        takeaway: "Compare family offers before choosing a promotion.",
      },
    ],
    revisions: [
      {
        revisionId: "61000000-0000-4000-8000-000000000061",
        revisionNumber: 1,
        pinnedToUpdateId: "64000000-0000-4000-8000-000000000064",
        createdAt: "2026-09-10T11:00:00Z",
      },
    ],
  });
}

afterEach(() => {
  cleanup();
});

describe("ResearchProjectRow", () => {
  it.each([
    {
      state: "ready" as MarketWatchProjectDisplayState,
      item: () => readyItem(),
      pill: "Ready to review",
      caption: `Report · ${reportDate("2026-09-12T10:00:00Z")}`,
    },
    {
      state: "researching" as MarketWatchProjectDisplayState,
      item: () =>
        buildItem({
          revisions: [
            {
              revisionId: "65000000-0000-4000-8000-000000000065",
              revisionNumber: 3,
              pinnedToUpdateId: "66000000-0000-4000-8000-000000000066",
              createdAt: "2026-09-11T10:00:00Z",
            },
          ],
        }),
      pill: "Researching",
      caption: "Comparing public sources.",
    },
    {
      state: "paused" as MarketWatchProjectDisplayState,
      item: () =>
        buildItem({
          project: { lifecycle: "paused" },
          reports: [
            {
              reportVersionId: "62000000-0000-4000-8000-000000000062",
              briefRevisionId: "63000000-0000-4000-8000-000000000063",
              reviewState: "pending_review",
              createdAt: "2026-09-08T10:00:00Z",
              takeaway: "Regulars praise fast lunch service.",
            },
          ],
        }),
      pill: "Monitoring paused",
      caption: "Future scheduled starts are paused.",
    },
    {
      state: "failed" as MarketWatchProjectDisplayState,
      item: () =>
        buildItem({
          revisions: [
            {
              revisionId: "65000000-0000-4000-8000-000000000065",
              revisionNumber: 3,
              pinnedToUpdateId: "66000000-0000-4000-8000-000000000066",
              createdAt: "2026-09-11T10:00:00Z",
            },
          ],
          failedUpdates: [
            { updateId: "66000000-0000-4000-8000-000000000066", stage: "research_failed" },
          ],
        }),
      pill: "Needs attention",
      caption: "The background research run could not finish. No findings were saved.",
    },
    {
      state: "needs_attention" as MarketWatchProjectDisplayState,
      item: () => buildItem({}),
      pill: "Needs attention",
      caption: "Start research to receive the first report.",
    },
  ])("renders the $state pill with its sub-caption", ({ state, item, pill, caption }) => {
    const row = item();
    expect(row.displayState).toBe(state);
    render(<ResearchProjectRow item={row} timeZone={TIME_ZONE} />);

    expect(screen.getByText(pill)).toBeTruthy();
    expect(screen.getByText(caption)).toBeTruthy();
  });

  it("shows the title with its location and mode line", () => {
    render(<ResearchProjectRow item={readyItem()} timeZone={TIME_ZONE} />);

    expect(screen.getByRole("heading", { name: "Competitor monitoring" })).toBeTruthy();
    expect(screen.getByText("Downtown · Recurring research")).toBeTruthy();
  });

  it("keeps the full question out of the row — it lives in the overview dialog", () => {
    render(<ResearchProjectRow item={readyItem()} timeZone={TIME_ZONE} />);

    expect(screen.queryByText("Which nearby competitors changed their offers?")).toBeNull();
  });

  it("renders no arrow drill-in without onOpen", () => {
    render(<ResearchProjectRow item={readyItem()} timeZone={TIME_ZONE} />);

    expect(screen.queryByRole("button", { name: "Open Competitor monitoring" })).toBeNull();
  });

  it("routes the arrow drill-in through onOpen with the project id", () => {
    const onOpen = vi.fn();
    render(<ResearchProjectRow item={readyItem()} timeZone={TIME_ZONE} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Competitor monitoring" }));
    expect(onOpen).toHaveBeenCalledWith(PROJECT);
  });

  it("keeps the prior report link disabled with its reason without onReviewReport", () => {
    const paused = buildItem({
      project: { lifecycle: "paused" },
      reports: [
        {
          reportVersionId: "62000000-0000-4000-8000-000000000062",
          briefRevisionId: "63000000-0000-4000-8000-000000000063",
          reviewState: "pending_review",
          createdAt: "2026-09-08T10:00:00Z",
          takeaway: "Regulars praise fast lunch service.",
        },
      ],
    });
    render(<ResearchProjectRow item={paused} timeZone={TIME_ZONE} />);

    const prior = screen.getByRole("button", {
      name: `Previous report · ${reportDate("2026-09-08T10:00:00Z")}`,
    });
    expect(prior).toHaveProperty("disabled", true);
    expect(prior.getAttribute("title")).toMatch(/unavailable in this view/i);
  });

  it("routes the prior report link through onReviewReport when provided", () => {
    const onReviewReport = vi.fn();
    const paused = buildItem({
      project: { lifecycle: "paused" },
      reports: [
        {
          reportVersionId: "62000000-0000-4000-8000-000000000062",
          briefRevisionId: "63000000-0000-4000-8000-000000000063",
          reviewState: "pending_review",
          createdAt: "2026-09-08T10:00:00Z",
          takeaway: "Regulars praise fast lunch service.",
        },
      ],
    });
    render(
      <ResearchProjectRow item={paused} timeZone={TIME_ZONE} onReviewReport={onReviewReport} />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: `Previous report · ${reportDate("2026-09-08T10:00:00Z")}`,
      }),
    );
    expect(onReviewReport).toHaveBeenCalledWith("62000000-0000-4000-8000-000000000062");
  });

  it("spins a loading ring on researching rows and keeps it static for reduced motion (P6)", () => {
    const researching = buildItem({
      revisions: [
        {
          revisionId: "65000000-0000-4000-8000-000000000065",
          revisionNumber: 3,
          pinnedToUpdateId: "66000000-0000-4000-8000-000000000066",
          createdAt: "2026-09-11T10:00:00Z",
        },
      ],
    });
    expect(researching.displayState).toBe("researching");
    render(<ResearchProjectRow item={researching} timeZone={TIME_ZONE} />);

    const ring = screen.getByTestId("market-watch-loading-ring");
    expect(ring.getAttribute("class") ?? "").toMatch(/animate-spin/);
    expect(ring.getAttribute("class") ?? "").toMatch(/motion-reduce:animate-none/);
  });

  it("renders no loading ring on non-researching rows", () => {
    render(<ResearchProjectRow item={readyItem()} timeZone={TIME_ZONE} />);

    expect(screen.queryByTestId("market-watch-loading-ring")).toBeNull();
  });

  it("renders bare rows without card chrome for the grouped single-box list (P7)", () => {
    const researching = buildItem({
      revisions: [
        {
          revisionId: "65000000-0000-4000-8000-000000000065",
          revisionNumber: 3,
          pinnedToUpdateId: "66000000-0000-4000-8000-000000000066",
          createdAt: "2026-09-11T10:00:00Z",
        },
      ],
    });
    render(<ResearchProjectRow item={researching} timeZone={TIME_ZONE} bare />);

    const row = screen.getByTestId(`research-project-${PROJECT}`);
    expect(row.className).toMatch(/min-w-0/);
    expect(screen.getByTestId("market-watch-loading-ring")).toBeTruthy();
    expect(
      screen.getByTestId(`research-project-state-${PROJECT}`),
    ).toBeTruthy();
  });
});
