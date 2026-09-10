// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChannelsRollup } from "@/components/channels/channels-rollup";
import type { ChannelsLandingAnalysis } from "@/components/channels/channels-presentation";
import type {
  ChannelsOverviewRow,
  ChannelsOverviewView,
  ChannelsOverviewWindow,
} from "@/modules/analysis/application/channels-overview";

const nav = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  params: new URLSearchParams(),
}));

// The toolbar reads and updates the `window` query param through the app
// router. A real `URLSearchParams` so `.toString()` behaves, and spyable
// `push`/`refresh`.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
  useSearchParams: () => nav.params,
}));

vi.mock("recharts", () => ({
  Bar: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Cell: () => null,
  Legend: () => null,
  Pie: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

const WINDOW_FEB: ChannelsOverviewWindow = {
  windowStart: "2026-02-01",
  windowEnd: "2026-02-28",
  grain: "month",
  label: "2026-02-01 to 2026-02-28",
  value: "2026-02-01..2026-02-28..month",
};

const WINDOW_JAN_FEB_SPAN: ChannelsOverviewWindow = {
  windowStart: "2026-01-01",
  windowEnd: "2026-02-28",
  grain: "span",
  label: "2026-01-01 to 2026-02-28",
  value: "2026-01-01..2026-02-28..span",
};

const WINDOW_MARCH_MONTH: ChannelsOverviewWindow = {
  windowStart: "2026-03-01",
  windowEnd: "2026-03-31",
  grain: "month",
  label: "2026-03-01 to 2026-03-31",
  value: "2026-03-01..2026-03-31..month",
};

// Same March dates at another grain: the label must carry the grain so both
// options stay reachable instead of collapsing into one choice.
const WINDOW_MARCH_SPAN: ChannelsOverviewWindow = {
  windowStart: "2026-03-01",
  windowEnd: "2026-03-31",
  grain: "span",
  label: "2026-03-01 to 2026-03-31",
  value: "2026-03-01..2026-03-31..span",
};

function row(
  channelId: string,
  displayName: string,
  band: ChannelsOverviewRow["band"],
): ChannelsOverviewRow {
  return { channelId, displayName, status: "active", assessed: band.state === "complete", band };
}

/** February §7 reference rows: A + B complete, Direct revenue-only, In-store refused. */
function februaryRows(): ChannelsOverviewRow[] {
  return [
    row("a", "Delivery A", {
      state: "complete",
      potential: { minorUnits: 8_000_000, currency: "AED" },
      lost: { minorUnits: 400_000, currency: "AED" },
      earned: { minorUnits: 7_600_000, currency: "AED" },
    }),
    row("b", "Delivery B", {
      state: "complete",
      potential: { minorUnits: 4_000_000, currency: "AED" },
      lost: { minorUnits: 200_000, currency: "AED" },
      earned: { minorUnits: 3_800_000, currency: "AED" },
    }),
    row("direct", "Direct", {
      state: "revenue_only",
      potential: { minorUnits: 1_800_000, currency: "AED" },
      lost: null,
      earned: null,
    }),
    row("instore", "In-store", { state: "refused", potential: null, lost: null, earned: null }),
  ];
}

function view(overrides: Partial<ChannelsOverviewView> = {}): ChannelsOverviewView {
  return {
    windows: [WINDOW_MARCH_MONTH, WINDOW_MARCH_SPAN, WINDOW_FEB, WINDOW_JAN_FEB_SPAN],
    selectedWindow: WINDOW_FEB,
    total: {
      potential: { minorUnits: 12_000_000, currency: "AED" },
      lost: { minorUnits: 600_000, currency: "AED" },
      earned: { minorUnits: 11_400_000, currency: "AED" },
    },
    coverage: {
      assessedCount: 2,
      channelCount: 4,
      revenueOnlyNames: ["Direct"],
      unassessedNames: ["In-store"],
    },
    refusalReason: null,
    rows: februaryRows(),
    ...overrides,
  };
}

function ready(overrides: Partial<ChannelsOverviewView> = {}): ChannelsLandingAnalysis {
  return { state: "ready", view: view(overrides) };
}

afterEach(cleanup);

beforeEach(() => {
  nav.push.mockClear();
  nav.refresh.mockClear();
  nav.params = new URLSearchParams();
});

describe("ChannelsRollup", () => {
  it("renders nothing when analysis is disabled for the organization", () => {
    const { container } = render(
      <ChannelsRollup organizationId="org-1" analysis={{ state: "disabled" }} />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("offers retry without hiding anything else when the read fails", () => {
    render(<ChannelsRollup organizationId="org-1" analysis={{ state: "unavailable" }} />);

    expect(screen.getByText("Channel performance is unavailable")).toBeInTheDocument();
    expect(
      screen.getByText("Your channels are still available. Try loading performance again."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(nav.refresh).toHaveBeenCalledTimes(1);
    // Retry refreshes this page; it never starts an analysis run.
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("shows one reporting-period selector with every declared window value", async () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    const trigger = screen.getByRole("combobox", { name: "Reporting period" });
    expect(trigger).toHaveTextContent("February 2026");

    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "March 2026 · month",
      "March 2026 · span",
      "February 2026",
      "1 Jan 2026 – 28 Feb 2026",
    ]);
    // The value is always the exact encoded window, never the display label:
    // picking one navigates with the encoded value (see below).
  });

  it("names the scope and the reported window beside the selector", () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    expect(screen.getByText("Reported scope · AED")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: "Reporting window: 1 February 2026 to 28 February 2026",
      }),
    ).toHaveTextContent("1–28 Feb · reported window");
  });

  it("admits a currency mismatch in the scope caption instead of converting", () => {
    const mixed = februaryRows();
    mixed[1] = row("b", "Delivery B", {
      state: "complete",
      potential: { minorUnits: 4_000_000, currency: "USD" },
      lost: { minorUnits: 200_000, currency: "USD" },
      earned: { minorUnits: 3_800_000, currency: "USD" },
    });

    render(<ChannelsRollup organizationId="org-1" analysis={ready({ rows: mixed })} />);

    expect(screen.getByText("Reported scope · Multiple currencies")).toBeInTheDocument();
  });

  it("opens a read-only reporting-window dialog with exact range, grain and scope limits", async () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Reporting window: 1 February 2026 to 28 February 2026",
      }),
    );

    const dialog = await screen.findByRole("dialog", { name: "Reporting window" });
    expect(within(dialog).getByText("1 February 2026 – 28 February 2026")).toBeInTheDocument();
    expect(within(dialog).getByText("Reported scope · AED")).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "The comparison and directory use this same exact reporting window. Each channel shows whether its revenue and loss data are available.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Monthly (month)")).toBeInTheDocument();
    expect(
      within(dialog).getByText(/Location coverage follows each source analysis/),
    ).toBeInTheDocument();
    // Read-only: a close control and nothing that writes, refreshes or analyses.
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /save|refresh|start/i })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Reporting window" })).toBeNull(),
    );
  });

  it("navigates with only the window param changed, preserving the rest", async () => {
    nav.params = new URLSearchParams("tab=setup");
    render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    const trigger = screen.getByRole("combobox", { name: "Reporting period" });
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
    const march = within(await screen.findByRole("listbox")).getByRole("option", {
      name: "March 2026 · month",
    });
    fireEvent.click(march);

    await waitFor(() => expect(nav.push).toHaveBeenCalledTimes(1));
    const target = String(nav.push.mock.calls[0]?.[0]);
    expect(target).toContain("window=2026-03-01..2026-03-31..month");
    expect(target).toContain("tab=setup");
  });

  it("leaves figures out when the requested window names nothing declared", () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready({ selectedWindow: null })} />);

    // The selector stays usable so the reader can pick a real window; no
    // figure from another window is shown above the unresolved request.
    expect(screen.getByText("Choose a reporting window.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Reporting period" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Revenue outcome" })).toBeNull();
    expect(screen.getByText("Reported scope")).toBeInTheDocument();
    expect(screen.queryByText(/Reported scope ·/)).toBeNull();
  });

  it("says plainly when no reporting window exists yet", () => {
    render(
      <ChannelsRollup
        organizationId="org-1"
        analysis={ready({ windows: [], selectedWindow: null, rows: [] })}
      />,
    );

    expect(screen.getByText("No reporting windows yet.")).toBeInTheDocument();
    expect(screen.getByText("Open a channel to review its reports and setup.")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Reporting period" })).toBeNull();
  });

  it("keeps the current figures on screen behind the toolbar", () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    expect(screen.getByRole("region", { name: "Channel portfolio analysis" })).toBeInTheDocument();
    expect(screen.queryByText("Loading reporting window…")).toBeNull();
  });
});
