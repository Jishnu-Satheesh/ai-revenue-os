// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  MarketWatchProjectsSection,
  MarketWatchProjectsView,
} from "@/components/growth-intelligence/market-watch-projects";
import { briefRevisionSchema } from "@/domain/growth-intelligence/brief";
import {
  assembleReportReader,
  type AssembledReportView,
} from "@/modules/growth-intelligence/application/report-reader";
import {
  buildMarketWatchProjectList,
  type MarketWatchProjectListItem,
} from "@/modules/growth-intelligence/application/market-watch";

const DOWNTOWN = "20000000-0000-4000-8000-00000000000a";
const MARINA = "20000000-0000-4000-8000-00000000000b";
const ORGANIZATION = "10000000-0000-4000-8000-000000000001";

function items(): MarketWatchProjectListItem[] {
  return buildMarketWatchProjectList({
    projects: [
      {
        projectId: "50000000-0000-4000-8000-000000000005",
        organizationId: ORGANIZATION,
        branchId: DOWNTOWN,
        branchName: "Downtown",
        title: "Prepare for National Day",
        question: "How should we prepare for National Day?",
        mode: "one-time",
        lifecycle: "active",
        createdAt: "2026-09-10T10:00:00Z",
      },
      {
        projectId: "51000000-0000-4000-8000-000000000051",
        organizationId: ORGANIZATION,
        branchId: DOWNTOWN,
        branchName: "Downtown",
        title: "Competitor monitoring",
        question: "Which nearby competitors changed their offers?",
        mode: "recurring",
        lifecycle: "active",
        createdAt: "2026-09-09T10:00:00Z",
      },
      {
        projectId: "52000000-0000-4000-8000-000000000052",
        organizationId: ORGANIZATION,
        branchId: MARINA,
        branchName: "Marina",
        title: "Local customer feedback",
        question: "What do regulars praise or complain about?",
        mode: "recurring",
        lifecycle: "paused",
        createdAt: "2026-09-01T10:00:00Z",
      },
    ],
    reportsByProject: new Map([
      [
        "50000000-0000-4000-8000-000000000005",
        [
          {
            reportVersionId: "60000000-0000-4000-8000-000000000006",
            briefRevisionId: "61000000-0000-4000-8000-000000000061",
            reviewState: "pending_review",
            createdAt: "2026-09-12T10:00:00Z",
            takeaway: "Compare family offers and check delivery capacity before choosing a promotion.",
          },
        ],
      ],
      [
        "52000000-0000-4000-8000-000000000052",
        [
          {
            reportVersionId: "62000000-0000-4000-8000-000000000062",
            briefRevisionId: "63000000-0000-4000-8000-000000000063",
            reviewState: "pending_review",
            createdAt: "2026-09-08T10:00:00Z",
            takeaway: "Regulars praise fast lunch service.",
          },
        ],
      ],
    ]),
    revisionsByProject: new Map([
      [
        "50000000-0000-4000-8000-000000000005",
        [
          {
            revisionId: "61000000-0000-4000-8000-000000000061",
            revisionNumber: 1,
            pinnedToUpdateId: "64000000-0000-4000-8000-000000000064",
            createdAt: "2026-09-10T11:00:00Z",
          },
        ],
      ],
      [
        "51000000-0000-4000-8000-000000000051",
        [
          {
            revisionId: "65000000-0000-4000-8000-000000000065",
            revisionNumber: 3,
            pinnedToUpdateId: "66000000-0000-4000-8000-000000000066",
            createdAt: "2026-09-11T10:00:00Z",
          },
        ],
      ],
      [
        "52000000-0000-4000-8000-000000000052",
        [
          {
            revisionId: "63000000-0000-4000-8000-000000000063",
            revisionNumber: 2,
            pinnedToUpdateId: "67000000-0000-4000-8000-000000000067",
            createdAt: "2026-09-05T10:00:00Z",
          },
        ],
      ],
    ]),
  });
}

const branches = [
  { id: DOWNTOWN, name: "Downtown" },
  { id: MARINA, name: "Marina" },
];

/** The exact en-AE short date the rows render, computed the same way. */
function reportDate(value: string): string {
  return new Date(value).toLocaleDateString("en-AE", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function viewProps(overrides: Record<string, unknown> = {}) {
  return {
    items: items(),
    branches,
    timeZone: "Asia/Dubai",
    onNewResearch: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("crypto", { randomUUID: () => "00000000-0000-4000-8000-000000000000" });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MarketWatchProjectsView", () => {
  it("features the ready report as a prototype-style card without the takeaway excerpt", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    expect(screen.getByText("Prepare for National Day")).toBeTruthy();
    expect(screen.getByText(/Downtown · One-time research/)).toBeTruthy();
    expect(screen.getByText(`Report · ${reportDate("2026-09-12T10:00:00Z")}`)).toBeTruthy();
    expect(screen.getByText("How should we prepare for National Day?")).toBeTruthy();
    // Prototype card shows the question only; the takeaway lives in the report.
    expect(screen.queryByText(/Compare family offers and check delivery capacity/)).toBeNull();
    expect(screen.getByText(/Based on brief 1/)).toBeTruthy();
    expect(screen.getByText(/Advice awaits your review/)).toBeTruthy();
  });

  it("places the Agent lane switch beside Project history in the featured footer for managers", () => {
    render(
      <MarketWatchProjectsView
        {...viewProps({ organizationId: ORGANIZATION, canManage: true })}
      />,
    );

    const card = screen.getByTestId(
      "featured-report-60000000-0000-4000-8000-000000000006",
    );
    const toggle = within(card).getByTestId(
      "agent-lane-opt-in-50000000-0000-4000-8000-000000000005",
    );
    expect(toggle.getAttribute("role")).toBe("switch");
    // Same button group as Project history, ahead of the right-aligned note.
    const footer = toggle.closest("div")?.parentElement?.parentElement;
    expect(footer).toBeTruthy();
    expect(
      within(footer as HTMLElement).getByRole("button", { name: /project history/i }),
    ).toBeTruthy();
  });

  it("keeps the Review report action disabled by default with its reason", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    const review = screen.getByRole("button", { name: /review report/i });
    expect(review).toHaveProperty("disabled", true);
    expect(review.getAttribute("title")).toMatch(/unavailable in this view/i);
  });

  it("routes Review report through the Slice 5 entry point when provided", () => {
    const onReviewReport = vi.fn();
    render(<MarketWatchProjectsView {...viewProps({ onReviewReport })} />);

    fireEvent.click(screen.getByRole("button", { name: /review report/i }));
    expect(onReviewReport).toHaveBeenCalledWith("60000000-0000-4000-8000-000000000006");
  });

  it("keeps paused, researching and ready rows distinct with plain state text", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    expect(screen.getByText("Monitoring paused")).toBeTruthy();
    expect(screen.getByText(/Researching/)).toBeTruthy();
    // No invented percentages or completion promises anywhere on the list.
    expect(document.body.textContent).not.toMatch(/% complete|percent|ETA|complete in/i);
  });

  it("retains the prior report link with its date on paused rows", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    expect(
      screen.getByRole("button", {
        name: new RegExp(`previous report · ${reportDate("2026-09-08T10:00:00Z")}`, "i"),
      }),
    ).toBeTruthy();
  });

  it("filters the list and the featured report by location consistently", async () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    fireEvent.click(screen.getByRole("combobox", { name: /research location/i }));
    fireEvent.click(await screen.findByRole("option", { name: "Marina" }));

    await waitFor(() => {
      expect(screen.queryByText("Prepare for National Day")).toBeNull();
    });
    expect(screen.getByText("Local customer feedback")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /review report/i })).toBeNull();
    expect(screen.getByText(/1 project shown/)).toBeTruthy();
  });

  it("shows a named empty state for searches with no match and clears filters", async () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    fireEvent.change(screen.getByRole("searchbox", { name: /find a research project/i }), {
      target: { value: "no such project here" },
    });

    expect(await screen.findByText("No projects match these filters")).toBeTruthy();
    expect(screen.getByText(/Nothing matches “no such project here”/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /clear filters/i }));
    expect(screen.getByText("Prepare for National Day")).toBeTruthy();
  });

  it("counts each status once on the compact filter buttons", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    expect(screen.getByRole("button", { name: /all projects 3/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /ready to review 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /in progress 1/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /paused 1/i })).toBeTruthy();
  });

  it("marks only the active filter pressed", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    expect(
      screen.getByRole("button", { name: /all projects 3/i }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      screen.getByRole("button", { name: /paused 1/i }).getAttribute("aria-pressed"),
    ).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: /paused 1/i }));
    expect(
      screen.getByRole("button", { name: /paused 1/i }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps a single New research entry: no section-level duplicate", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    // The header CTA (workspace) stands alone; the section keeps no twin.
    // The empty-state starter is a different control, covered below.
    expect(screen.queryByRole("button", { name: "New research" })).toBeNull();
  });

  it("lists the featured report contents without inventing links", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    const panel = screen.getByRole("complementary", { name: "In this report" });
    expect(panel).toBeTruthy();
    for (const entry of [
      "Competitors & their offers",
      "What customers are saying",
      "The local opportunity",
      "Draft advice for your review",
    ]) {
      expect(screen.getByText(entry)).toBeTruthy();
    }
    // Static preview list: entries navigate nowhere invented.
    expect(panel.querySelectorAll("a,button").length).toBe(0);
  });

  it("keeps Project history disabled by default with its reason", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    const history = screen.getByRole("button", { name: /project history/i });
    expect(history).toHaveProperty("disabled", true);
    expect(history.getAttribute("title")).toMatch(/unavailable in this view/i);
    // No drill-in arrows without the overview entry point.
    expect(screen.queryByRole("button", { name: /^open /i })).toBeNull();
  });

  it("routes row drill-in through the overview entry point when provided", () => {
    const onOpenProject = vi.fn();
    render(<MarketWatchProjectsView {...viewProps({ onOpenProject })} />);

    fireEvent.click(screen.getByRole("button", { name: /open competitor monitoring/i }));
    expect(onOpenProject).toHaveBeenCalledWith("51000000-0000-4000-8000-000000000051");
  });

  it("offers a named next action when no projects exist yet", () => {
    const onNewResearch = vi.fn();
    render(<MarketWatchProjectsView {...viewProps({ items: [], onNewResearch })} />);

    expect(screen.getByText("No research projects yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /start your first research/i }));
    expect(onNewResearch).toHaveBeenCalled();
  });

  it("heads the list as Market Watch without duplicating tab sections", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    expect(screen.getByRole("heading", { name: "Market Watch" })).toBeTruthy();
    // Insights and data gaps live in their own tab sections with triage
    // controls; this list keeps no second copies.
    expect(screen.queryByText("Business insights")).toBeNull();
    expect(screen.queryByText("Improve the next report")).toBeNull();
    expect(screen.queryByText("Check delivery readiness before an event offer")).toBeNull();
    expect(screen.queryByText("Add recent channel reports")).toBeNull();
  });

  it("reflows long names without clipped controls", () => {
    const longTitle = `A very long research title ${"with many words ".repeat(20)}`.slice(0, 200);
    const longItems = buildMarketWatchProjectList({
      projects: [
        {
          projectId: "50000000-0000-4000-8000-000000000005",
          organizationId: ORGANIZATION,
          branchId: DOWNTOWN,
          branchName: "Downtown",
          title: longTitle,
          question: `A very long question ${"about local demand ".repeat(30)}`.slice(0, 500),
          mode: "one-time",
          lifecycle: "active",
          createdAt: "2026-09-10T10:00:00Z",
        },
      ],
      reportsByProject: new Map(),
      revisionsByProject: new Map(),
    });
    render(<MarketWatchProjectsView {...viewProps({ items: longItems })} />);

    expect(screen.getByText(longTitle)).toBeTruthy();
    // The row keeps wrapping text and a reachable action at narrow widths:
    // no fixed widths, no horizontal clipping on the row content.
    const row = screen.getByTestId("research-project-50000000-0000-4000-8000-000000000005");
    expect(row.className).toMatch(/min-w-0/);
    expect(
      screen.getByTestId("research-project-state-50000000-0000-4000-8000-000000000005"),
    ).toBeTruthy();
  });

  it("shows the brief question on the featured Ready-to-review card (P7)", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    expect(screen.getByText("How should we prepare for National Day?")).toBeTruthy();
  });

  it("groups non-review rows inside one card container with separation lines (P7)", () => {
    const { container } = render(<MarketWatchProjectsView {...viewProps()} />);

    const list = screen.getByTestId("market-watch-project-list");
    expect(list).toBeTruthy();
    // Single-box list: the container owns the divided rows.
    expect(list.querySelector(".divide-y")).toBeTruthy();
    // Both non-featured rows live inside the one container.
    expect(
      list.querySelector('[data-testid="research-project-51000000-0000-4000-8000-000000000051"]'),
    ).toBeTruthy();
    expect(
      list.querySelector('[data-testid="research-project-52000000-0000-4000-8000-000000000052"]'),
    ).toBeTruthy();
    // The featured ready project stays out of the grouped list.
    expect(
      list.querySelector('[data-testid="research-project-50000000-0000-4000-8000-000000000005"]'),
    ).toBeNull();
    void container;
  });

  it("animates a loading ring on every Researching row and respects reduced motion (P6)", () => {
    render(<MarketWatchProjectsView {...viewProps()} />);

    const rings = screen.getAllByTestId("market-watch-loading-ring");
    expect(rings.length).toBeGreaterThanOrEqual(1);
    for (const ring of rings) {
      expect(ring.getAttribute("class") ?? "").toMatch(/animate-spin/);
      expect(ring.getAttribute("class") ?? "").toMatch(/motion-reduce:animate-none/);
    }
  });

  it("styles the header with eyebrow, separation lines, pinned location and pills (P8)", () => {
    const { container } = render(<MarketWatchProjectsView {...viewProps()} />);

    const eyebrow = screen.getByText("Your market, in context");
    expect(eyebrow.className).toMatch(/text-primary/);
    // Location left, search right with separation lines around the toolbar.
    expect(screen.getByRole("combobox", { name: /research location/i })).toBeTruthy();
    expect(screen.getByRole("searchbox", { name: /find a research project/i })).toBeTruthy();
    const section = container.querySelector('section[aria-label="Market Watch projects"]');
    expect(section?.querySelectorAll(".border-t").length).toBeGreaterThanOrEqual(2);
    // Filter pills use the smaller prototype radius, not full pills.
    const readyPill = screen.getByRole("button", { name: /ready to review 1/i });
    expect(readyPill.className).toMatch(/rounded-md/);
    expect(readyPill.className).not.toMatch(/rounded-full/);
  });

  it("closes the list section with a separation line before insights (P9)", () => {
    const { container } = render(<MarketWatchProjectsView {...viewProps()} />);

    const section = container.querySelector('section[aria-label="Market Watch projects"]');
    const separators = section?.querySelectorAll('[aria-hidden="true"].border-t');
    expect((separators?.length ?? 0)).toBeGreaterThanOrEqual(3);
  });
});

describe("MarketWatchProjectsSection", () => {
  const listBody = {
    projects: [
      {
        projectId: "50000000-0000-4000-8000-000000000005",
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
    reportsByProject: {
      "50000000-0000-4000-8000-000000000005": [
        {
          reportVersionId: "60000000-0000-4000-8000-000000000006",
          briefRevisionId: "61000000-0000-4000-8000-000000000061",
          reviewState: "pending_review",
          createdAt: "2026-09-12T10:00:00Z",
          takeaway: "Compare family offers and check delivery capacity before choosing a promotion.",
        },
      ],
    },
    revisionsByProject: {
      "50000000-0000-4000-8000-000000000005": [
        {
          revisionId: "61000000-0000-4000-8000-000000000061",
          revisionNumber: 1,
          pinnedToUpdateId: "64000000-0000-4000-8000-000000000064",
          createdAt: "2026-09-10T11:00:00Z",
        },
      ],
    },
  };

  function sectionProps(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: ORGANIZATION,
      branches,
      timeZone: "Asia/Dubai",
      evidencePeriods: [],
      canManage: true,
      ...overrides,
    };
  }

  it("holds the layout shape while loading, then renders real projects", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(listBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<MarketWatchProjectsSection {...sectionProps()} />);
      expect(screen.getByLabelText("Market Watch projects")).toBeTruthy();

      expect(await screen.findByText("Prepare for National Day")).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/organizations/${ORGANIZATION}/growth-intelligence/monitoring/projects?limit=50`,
        expect.objectContaining({ cache: "no-store" }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows failure with retry and keeps retrying until the list loads", async () => {
    const fetchMock = vi
      .fn(async () => new Response("oops", { status: 500 }))
      .mockImplementationOnce(async () => new Response("oops", { status: 500 }))
      .mockImplementationOnce(async () => new Response(JSON.stringify(listBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<MarketWatchProjectsSection {...sectionProps()} />);

      expect(await screen.findByText("Market Watch could not be loaded")).toBeTruthy();
      expect(screen.getByText(/Nothing changed/)).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /retry/i }));
      expect(await screen.findByText("Prepare for National Day")).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("opens the project overview from Project history and closes it again", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(listBody), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<MarketWatchProjectsSection {...sectionProps()} />);
      expect(await screen.findByText("Prepare for National Day")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /project history/i }));
      // The history dialog owns its heading; the question stays on the
      // featured card only. Assert on the dialog scope.
      const dialog = await screen.findByRole("dialog");
      expect(dialog).toBeTruthy();
      expect(
        within(dialog as HTMLElement).getByRole("heading", { name: "Project history" }),
      ).toBeTruthy();
      expect(
        within(dialog as HTMLElement).getByText(/Each report keeps the question/),
      ).toBeTruthy();
      const questions = await screen.findAllByText("How should we prepare for National Day?");
      expect(questions.length).toBe(1);
      const pause = screen.getByRole("button", { name: /pause monitoring/i });
      expect(pause).toHaveProperty("disabled", true);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      // The featured card keeps showing the question after the dialog closes.
    expect(screen.getByText("How should we prepare for National Day?")).toBeTruthy();
    // Status renders as a pill badge, not plain caps text.
    const badge = screen.getByText("Ready to review", { exact: true });
    expect(badge.tagName).toBe("SPAN");
    expect(badge.className).toMatch(/rounded-md/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("MarketWatchProjectsSection report reader wiring", () => {
  const REPORT_VERSION = "60000000-0000-4000-8000-000000000006";
  const REVISION = "61000000-0000-4000-8000-000000000061";
  const PROJECT = "50000000-0000-4000-8000-000000000005";
  const CLAIM = "90000000-0000-4000-8000-000000000009";

  function readerView(): AssembledReportView {
    return assembleReportReader({
      organizationId: ORGANIZATION,
      reportRow: {
        reportId: "64000000-0000-4000-8000-000000000064",
        reportVersionId: REPORT_VERSION,
        organizationId: ORGANIZATION,
        projectId: PROJECT,
        branchId: DOWNTOWN,
        briefRevisionId: REVISION,
        evidenceDigest: "digest-pinned-1",
        content: {
          reportId: "64000000-0000-4000-8000-000000000064",
          reportVersionId: REPORT_VERSION,
          organizationId: ORGANIZATION,
          projectId: PROJECT,
          locationId: DOWNTOWN,
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
          competitorComparison: [
            { competitorName: "Rival Kitchen", summary: "Promotes family bundles." },
          ],
          gaps: [],
          draftAdvice: [],
          sources: [{ sourceRef: "S1", url: "https://rival.example/menu" }],
        },
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
          locationId: DOWNTOWN,
          researchArea: "Downtown Dubai",
          competitors: [],
          investigationAreas: ["demand", "presence", "offers", "reviews", "observable_performance"],
          evidencePeriods: [],
          businessContextSnapshotId: "00000000-0000-4000-8000-000000000000",
          frequency: "once",
          pinnedToUpdateId: "66000000-0000-4000-8000-000000000066",
          createdAtUtc: "2026-09-10T11:00:00.000Z",
        }),
        createdAt: "2026-09-10T11:00:00.000Z",
      },
      project: {
        projectId: PROJECT,
        organizationId: ORGANIZATION,
        branchId: DOWNTOWN,
        title: "Prepare for National Day",
        question: "How should we prepare for National Day?",
      },
      branchName: "Downtown",
    });
  }

  function sectionProps(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: ORGANIZATION,
      branches,
      timeZone: "Asia/Dubai",
      evidencePeriods: [],
      canManage: true,
      ...overrides,
    };
  }

  it("opens the pinned reader from Review report and keeps it across filter changes", async () => {
    const listBody = {
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
      reportsByProject: {
        [PROJECT]: [
          {
            reportVersionId: REPORT_VERSION,
            briefRevisionId: REVISION,
            reviewState: "pending_review",
            createdAt: "2026-09-12T10:00:00Z",
            takeaway: "Compare family offers and check delivery capacity.",
          },
        ],
      },
      revisionsByProject: {
        [PROJECT]: [
          {
            revisionId: REVISION,
            revisionNumber: 1,
            pinnedToUpdateId: "66000000-0000-4000-8000-000000000066",
            createdAt: "2026-09-10T11:00:00Z",
          },
        ],
      },
    };
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/monitoring/reports/")) {
        return new Response(JSON.stringify({ report: readerView() }), { status: 200 });
      }
      return new Response(JSON.stringify(listBody), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<MarketWatchProjectsSection {...sectionProps()} />);
      expect(await screen.findByText("Prepare for National Day")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /review report/i }));
      expect(await screen.findByText("What matters for Downtown")).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/organizations/${ORGANIZATION}/growth-intelligence/monitoring/reports/${REPORT_VERSION}`,
        expect.objectContaining({ cache: "no-store" }),
      );

      // Changing page filters never changes the opened report.
      fireEvent.change(screen.getByLabelText("Find a research project"), {
        target: { value: "no such project here" },
      });
      expect(await screen.findByText("No projects match these filters")).toBeTruthy();
      expect(screen.getByText("What matters for Downtown")).toBeTruthy();
      expect(
        fetchMock.mock.calls.filter((call) => String(call[0]).includes("/monitoring/reports/")),
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  function adviceReaderView(): AssembledReportView {
    const base = readerView();
    return {
      ...base,
      draftAdvice: [
        {
          itemKey: "bundle",
          kind: "action",
          title: "Draft one clear family bundle",
          detail: "Name the occasion and what the customer receives.",
          destinationLabel: "Recommendations",
        },
      ],
    };
  }

  function adviceListBody() {
    return {
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
      reportsByProject: {
        [PROJECT]: [
          {
            reportVersionId: REPORT_VERSION,
            briefRevisionId: REVISION,
            reviewState: "pending_review",
            createdAt: "2026-09-12T10:00:00Z",
            takeaway: "Compare family offers and check delivery capacity.",
          },
        ],
      },
      revisionsByProject: {
        [PROJECT]: [
          {
            revisionId: REVISION,
            revisionNumber: 1,
            pinnedToUpdateId: "66000000-0000-4000-8000-000000000066",
            createdAt: "2026-09-10T11:00:00Z",
          },
        ],
      },
    };
  }

  it("hides accept controls with a reason for viewers (canManage false)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/monitoring/reports/")) {
        return new Response(JSON.stringify({ report: adviceReaderView() }), { status: 200 });
      }
      return new Response(JSON.stringify(adviceListBody()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<MarketWatchProjectsSection {...sectionProps({ canManage: false })} />);
      expect(await screen.findByText("Prepare for National Day")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /review report/i }));
      expect(await screen.findByText("What matters for Downtown")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));
      expect(screen.queryByRole("button", { name: /accept selected/i })).toBeNull();
      expect(screen.getByText(/needs the manage permission/)).toBeTruthy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows accept controls for managers (canManage true)", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/monitoring/reports/")) {
        return new Response(JSON.stringify({ report: adviceReaderView() }), { status: 200 });
      }
      return new Response(JSON.stringify(adviceListBody()), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      render(<MarketWatchProjectsSection {...sectionProps({ canManage: true })} />);
      expect(await screen.findByText("Prepare for National Day")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: /review report/i }));
      expect(await screen.findByText("What matters for Downtown")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Draft advice" }));
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Draft one clear family bundle" }),
      );
      fireEvent.click(screen.getByRole("button", { name: /review selection/i }));
      expect(await screen.findByRole("heading", { name: "Review selected items" })).toBeTruthy();
      expect(screen.getByRole("button", { name: /accept selected/i })).toBeTruthy();
      expect(screen.queryByText(/needs the manage permission/)).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
