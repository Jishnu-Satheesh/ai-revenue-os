// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  Legend: () => null,
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

/** Range navigation the page builds from the same evidence reads as the windows. */
const RANGE = {
  segments: [{ start: "2026-01-01", end: "2026-03-31" }],
  coverageWindows: [
    {
      windowStart: "2026-02-01",
      windowEnd: "2026-02-28",
      grain: "month" as const,
      governedRowCount: 20,
    },
  ],
  today: "2026-03-15",
};

function readyWithRange(overrides: Partial<ChannelsOverviewView> = {}): ChannelsLandingAnalysis {
  return { state: "ready", view: view(overrides), range: RANGE };
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
    expect(screen.queryByRole("region", { name: "Channel performance summary" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Revenue comparison" })).toBeNull();
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

  it("shows the free-range picker instead of the dropdown when range navigation is present", () => {
    render(<ChannelsRollup organizationId="org-1" analysis={readyWithRange()} />);

    expect(screen.getByRole("button", { name: /2026-02-01 to 2026-02-28/ })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Reporting period" })).toBeNull();
  });

  it("applies a picked range as from/to and drops the legacy window param", async () => {
    const user = userEvent.setup();
    render(<ChannelsRollup organizationId="org-1" analysis={readyWithRange()} />);

    await user.click(screen.getByRole("button", { name: /2026-02-01 to 2026-02-28/ }));
    await user.click(screen.getByRole("button", { name: /^apply$/i }));

    expect(nav.push).toHaveBeenCalledTimes(1);
    const url = nav.push.mock.calls[0]?.[0] as string;
    expect(url).toContain("from=2026-02-01");
    expect(url).toContain("to=2026-02-28");
    expect(url).not.toContain("window=");
  });

  it("seeds the picker from the newest declared window when the URL resolved nothing", () => {
    render(
      <ChannelsRollup organizationId="org-1" analysis={readyWithRange({ selectedWindow: null })} />,
    );

    // The baseline only seeds the calendar draft; no figure from another
    // window is shown above the unresolved request.
    expect(screen.getByRole("button", { name: /2026-03-01 to 2026-03-31/ })).toBeInTheDocument();
    expect(screen.getByText("Choose a reporting window.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Channel performance summary" })).toBeNull();
  });

  it("shows the February reference strip with exact totals and counts", () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    const summary = screen.getByRole("region", { name: "Channel performance summary" });
    expect(within(summary).getByText("Reported revenue")).toBeInTheDocument();
    expect(within(summary).getByText("138,000")).toBeInTheDocument();
    expect(within(summary).getByText("Across 3 of 4 active channels")).toBeInTheDocument();
    expect(within(summary).getByText("Earned")).toBeInTheDocument();
    expect(within(summary).getByText("114,000")).toBeInTheDocument();
    expect(within(summary).getByText("Revenue less loss · 2 channels")).toBeInTheDocument();
    expect(within(summary).getByText("Provider-reported loss")).toBeInTheDocument();
    expect(within(summary).getByText("6,000")).toBeInTheDocument();
    expect(within(summary).getByText("Reported loss · 2 channels")).toBeInTheDocument();
    expect(within(summary).getByText("Channel coverage")).toBeInTheDocument();
    expect(within(summary).getByText("3 / 4")).toBeInTheDocument();
    expect(within(summary).getByText("Channels with reported revenue")).toBeInTheDocument();
    // Headline visuals round; each stat cell exposes the exact figure via its
    // group accessible name (role="group" so browse-mode AT announces it).
    // Intl separates the currency code with a non-breaking space, so match it
    // with \s (a literal space would miss).
    expect(
      within(summary).getByRole("group", { name: /Reported revenue AED\s138,000\.00/ }),
    ).toBeInTheDocument();
    expect(
      within(summary).getByRole("group", { name: /Earned AED\s114,000\.00/ }),
    ).toBeInTheDocument();
    expect(
      within(summary).getByRole("group", { name: /Provider-reported loss AED\s6,000\.00/ }),
    ).toBeInTheDocument();
    expect(
      within(summary).getByRole("group", { name: /Channel coverage 3 of 4/ }),
    ).toBeInTheDocument();
  });

  it("states an em dash with the reason when earned and loss have no complete band", () => {
    const revenueOnly = view({
      rows: [
        row("direct", "Direct", {
          state: "revenue_only",
          potential: { minorUnits: 1_800_000, currency: "AED" },
          lost: null,
          earned: null,
        }),
      ],
    });
    render(
      <ChannelsRollup organizationId="org-1" analysis={{ state: "ready", view: revenueOnly }} />,
    );

    const summary = screen.getByRole("region", { name: "Channel performance summary" });
    expect(within(summary).getByText("18,000")).toBeInTheDocument();
    // Both the Earned and the loss note state the same honest reason.
    expect(
      within(summary).getAllByText(
        "No channel has both a revenue figure and a recorded loss for this window.",
      ),
    ).toHaveLength(2);
  });

  it("keeps the AED earned subtotal honest when only the revenue-only row is foreign", () => {
    const rows = [
      row("a", "Delivery A", {
        state: "complete",
        potential: { minorUnits: 8_000_000, currency: "AED" },
        lost: { minorUnits: 400_000, currency: "AED" },
        earned: { minorUnits: 7_600_000, currency: "AED" },
      }),
      row("direct", "Direct", {
        state: "revenue_only",
        potential: { minorUnits: 1_800_000, currency: "USD" },
        lost: null,
        earned: null,
      }),
    ];
    render(<ChannelsRollup organizationId="org-1" analysis={ready({ rows })} />);

    const summary = screen.getByRole("region", { name: "Channel performance summary" });
    // Reported refuses across currencies instead of converting…
    expect(
      within(summary).getByText("Revenue cannot be compared across currencies."),
    ).toBeInTheDocument();
    // …while the currency-consistent earned subtotal stays, explicitly scoped.
    expect(within(summary).getByText("76,000")).toBeInTheDocument();
    expect(within(summary).getByText("Revenue less loss · 1 channel")).toBeInTheDocument();
  });

  it("renders a genuine zero as zero, never as a missing figure", () => {
    const rows = [
      row("a", "Delivery A", {
        state: "complete",
        potential: { minorUnits: 0, currency: "AED" },
        lost: { minorUnits: 0, currency: "AED" },
        earned: { minorUnits: 0, currency: "AED" },
      }),
    ];
    render(<ChannelsRollup organizationId="org-1" analysis={ready({ rows })} />);

    const summary = screen.getByRole("region", { name: "Channel performance summary" });
    expect(within(summary).getAllByText("0")).toHaveLength(3);
    expect(within(summary).getByText("1 / 1")).toBeInTheDocument();
  });

  it("resets the Amount/Share choice when the organization or window changes", () => {
    const { rerender } = render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    fireEvent.click(screen.getByRole("radio", { name: "Show shares" }));
    expect(screen.getByText("58.0%")).toBeInTheDocument();

    rerender(
      <ChannelsRollup
        organizationId="org-1"
        analysis={ready({ selectedWindow: WINDOW_MARCH_MONTH })}
      />,
    );
    expect(screen.queryByText("58.0%")).toBeNull();
    expect(screen.getByText("80,000")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Show shares" }));
    expect(screen.getByText("58.0%")).toBeInTheDocument();
    rerender(<ChannelsRollup organizationId="org-2" analysis={ready()} />);
    expect(screen.queryByText("58.0%")).toBeNull();
  });

  it("opens the full coverage dialog focused on the chart row for keyboard and touch", async () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    fireEvent.click(screen.getByRole("button", { name: /Delivery A:.*Show band details/ }));

    // Task 4: the chart row opens D02 (not a second one-channel dialog),
    // focused on the inspected channel's section in the same dialog.
    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    const section = within(dialog).getByLabelText("Delivery A, Measured");
    expect(within(section).getByText("AED 80,000.00")).toBeInTheDocument();
    expect(within(section).getByText("AED 76,000.00")).toBeInTheDocument();
    expect(within(section).getByText("AED 4,000.00")).toBeInTheDocument();
    expect(document.activeElement?.getAttribute("id")).toBe("channel-coverage-row-a");
    // The full list travels with the focused row: revenue-only and refused
    // stay visible beside it.
    expect(within(dialog).getByLabelText("Direct, Revenue only")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("In-store, Needs review")).toBeInTheDocument();
    // Read-only: a close control and nothing that writes.
    expect(within(dialog).getByRole("button", { name: "Close dialog" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /save|refresh|start/i })).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Data coverage" })).toBeNull());
  });

  it("shows the coverage rail beside the plot with counts and a working review link", async () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    const comparison = screen.getByRole("region", { name: "Revenue comparison" });
    const rail = within(comparison).getByRole("complementary", { name: "Data coverage" });
    expect(within(rail).getByText("The complete picture")).toBeInTheDocument();
    expect(
      within(rail).getByText(
        (_, element) => element?.tagName === "P" && element.textContent === "2 / 4 channels",
      ),
    ).toBeInTheDocument();
    expect(
      within(rail).getByText("have both revenue and loss data for this reporting window."),
    ).toBeInTheDocument();
    expect(within(rail).getByText("Revenue + loss").parentElement).toHaveTextContent("2");
    expect(within(rail).getByText("Revenue only").parentElement).toHaveTextContent("1");
    expect(within(rail).getByText("No comparable figure").parentElement).toHaveTextContent("1");

    fireEvent.click(within(rail).getByRole("button", { name: "Review data coverage" }));
    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    expect(
      within(dialog).getByText("1 February 2026 – 28 February 2026 · Reported scope · AED"),
    ).toBeInTheDocument();
  });

  it("explains the revenue-only channel below the comparison", () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready()} />);

    const comparison = screen.getByRole("region", { name: "Revenue comparison" });
    expect(
      within(comparison).getByText(
        "Direct has revenue data, but no recorded loss. Included in reported revenue; excluded from earned and loss totals.",
      ),
    ).toBeInTheDocument();
  });

  it("states the complete-band rule when every channel is measured", () => {
    render(
      <ChannelsRollup
        organizationId="org-1"
        analysis={ready({ rows: februaryRows().slice(0, 2) })}
      />,
    );

    const comparison = screen.getByRole("region", { name: "Revenue comparison" });
    expect(
      within(comparison).getByText(
        "Only channels with both revenue and loss contribute to earned and loss totals.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps coverage honest when no channel is active", () => {
    render(<ChannelsRollup organizationId="org-1" analysis={ready({ rows: [] })} />);

    const comparison = screen.getByRole("region", { name: "Revenue comparison" });
    const rail = within(comparison).getByRole("complementary", { name: "Data coverage" });
    expect(
      within(rail).getByText(
        (_, element) => element?.tagName === "P" && element.textContent === "0 / 0 channels",
      ),
    ).toBeInTheDocument();
    // Chart empty state, rail sentence, explanation strip and the summary's
    // reported-revenue note all say the same honest thing; no segment
    // strip, no fake zeros.
    expect(screen.getAllByText("No active channels to compare.")).toHaveLength(4);
  });

  it("renders no coverage counts at all when the read fails", () => {
    render(<ChannelsRollup organizationId="org-1" analysis={{ state: "unavailable" }} />);

    expect(screen.getByText("Channel performance is unavailable")).toBeInTheDocument();
    expect(screen.queryByRole("complementary", { name: "Data coverage" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Review data coverage" })).toBeNull();
    expect(screen.queryByText("Revenue + loss")).toBeNull();
  });

  it("keeps every coverage row visible when earned is null", async () => {
    const revenueOnly = view({
      rows: [
        row("direct", "Direct", {
          state: "revenue_only",
          potential: { minorUnits: 1_800_000, currency: "AED" },
          lost: null,
          earned: null,
        }),
        row("instore", "In-store", {
          state: "refused",
          potential: null,
          lost: null,
          earned: null,
        }),
      ],
    });
    render(
      <ChannelsRollup organizationId="org-1" analysis={{ state: "ready", view: revenueOnly }} />,
    );

    const comparison = screen.getByRole("region", { name: "Revenue comparison" });
    const rail = within(comparison).getByRole("complementary", { name: "Data coverage" });
    expect(within(rail).getByText("Revenue only").parentElement).toHaveTextContent("1");

    fireEvent.click(within(rail).getByRole("button", { name: "Review data coverage" }));
    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    expect(within(dialog).getByLabelText("Direct, Revenue only")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("In-store, Needs review")).toBeInTheDocument();
    expect(within(dialog).queryByText("Measured")).toBeNull();
  });
});
