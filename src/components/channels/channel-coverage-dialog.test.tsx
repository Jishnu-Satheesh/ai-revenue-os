// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AboutChannelSetupDialog,
  ChannelCoverageDialog,
  ChannelCoverageRail,
  ComparisonExplanationStrip,
} from "@/components/channels/channel-coverage-dialog";
import { buildChannelsPortfolioPresentation } from "@/components/channels/channels-presentation";
import type {
  ChannelsOverviewRow,
  ChannelsOverviewView,
  ChannelsOverviewWindow,
} from "@/modules/analysis/application/channels-overview";

const organizationId = "11111111-1111-4111-8111-111111111111";

const WINDOW_FEB: ChannelsOverviewWindow = {
  windowStart: "2026-02-01",
  windowEnd: "2026-02-28",
  grain: "month",
  label: "2026-02-01 to 2026-02-28",
  value: "2026-02-01..2026-02-28..month",
};

function row(
  channelId: string,
  displayName: string,
  band: ChannelsOverviewRow["band"],
  status: ChannelsOverviewRow["status"] = "active",
): ChannelsOverviewRow {
  return { channelId, displayName, status, assessed: band.state === "complete", band };
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

function februaryView(overrides: Partial<ChannelsOverviewView> = {}): ChannelsOverviewView {
  return {
    windows: [WINDOW_FEB],
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

function februaryPortfolio(overrides: Partial<ChannelsOverviewView> = {}) {
  return buildChannelsPortfolioPresentation(februaryView(overrides));
}

function renderCoverageDialog(
  overrides: Partial<ChannelsOverviewView> = {},
  dialog: { open?: boolean; focusedChannelId?: string | null } = {},
) {
  const onOpenChange = vi.fn();
  render(
    <ChannelCoverageDialog
      organizationId={organizationId}
      portfolio={februaryPortfolio(overrides)}
      selectedWindow={WINDOW_FEB}
      open={dialog.open ?? true}
      onOpenChange={onOpenChange}
      focusedChannelId={dialog.focusedChannelId}
    />,
  );
  return { onOpenChange };
}

afterEach(cleanup);

describe("ChannelCoverageDialog", () => {
  it("lists every active channel with its status and exact band figures", async () => {
    renderCoverageDialog();

    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    expect(
      within(dialog).getByText("1 February 2026 – 28 February 2026 · Reported scope · AED"),
    ).toBeInTheDocument();

    // Statuses: complete means Measured, revenue-only is its own state, a
    // refusal asks for review instead of diagnosing a missing report.
    expect(within(dialog).getByLabelText("Delivery A, Measured")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Delivery B, Measured")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Direct, Revenue only")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("In-store, Needs review")).toBeInTheDocument();

    expect(within(dialog).getByText("AED 80,000.00")).toBeInTheDocument();
    expect(within(dialog).getByText("AED 76,000.00")).toBeInTheDocument();
    expect(within(dialog).getByText("AED 4,000.00")).toBeInTheDocument();
    expect(within(dialog).getByText("AED 18,000.00")).toBeInTheDocument();

    const direct = within(dialog).getByLabelText("Direct, Revenue only");
    expect(within(direct).getByText("Not recorded")).toBeInTheDocument();
    expect(within(direct).getByText("Not available without recorded loss")).toBeInTheDocument();

    const refused = within(dialog).getByLabelText("In-store, Needs review");
    expect(
      within(refused).getByText("No comparable revenue figure for this window."),
    ).toBeInTheDocument();
  });

  it("keeps complete, revenue-only and refused rows visible when earned is null", async () => {
    renderCoverageDialog({
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

    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    // The reported channel is not hidden because the complete-band aggregate
    // refuses, and the refusal stays visible beside it.
    expect(within(dialog).getByLabelText("Direct, Revenue only")).toBeInTheDocument();
    expect(within(dialog).getByText("AED 18,000.00")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("In-store, Needs review")).toBeInTheDocument();
    // Revenue-only is never counted as measured.
    expect(within(dialog).queryByLabelText("Direct, Measured")).toBeNull();
    expect(within(dialog).queryByText("Measured")).toBeNull();
  });

  it("excludes archived rows and their money from active coverage", async () => {
    renderCoverageDialog({
      rows: [
        ...februaryRows(),
        row(
          "prev",
          "Previous",
          {
            state: "complete",
            potential: { minorUnits: 5_000_000, currency: "AED" },
            lost: { minorUnits: 250_000, currency: "AED" },
            earned: { minorUnits: 4_750_000, currency: "AED" },
          },
          "archived",
        ),
      ],
    });

    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    expect(within(dialog).queryByText("Previous")).toBeNull();
    expect(within(dialog).queryByText("AED 50,000.00")).toBeNull();
    expect(within(dialog).getAllByText("Measured")).toHaveLength(2);
  });

  it("explains Measured and the revenue-only contribution without inventing values", async () => {
    renderCoverageDialog();

    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    expect(
      within(dialog).getByText(
        "Measured means revenue and provider-reported loss are available. It does not establish profit or attribute a result to platform actions.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Revenue-only channels contribute to reported revenue. Channels without a comparable figure remain visible.",
      ),
    ).toBeInTheDocument();
    // Unknowns are words and em dashes, never zeros.
    expect(within(dialog).queryByText("AED 0.00")).toBeNull();
  });

  it("links every active channel to its existing detail page", async () => {
    renderCoverageDialog();

    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    const links = within(dialog).getAllByRole("link", { name: /Channel Audit for / });
    expect(links).toHaveLength(4);
    expect(links[0]).toHaveAttribute("href", `/organizations/${organizationId}/channels/a`);
    expect(links[3]).toHaveAttribute("href", `/organizations/${organizationId}/channels/instore`);
  });

  it("is read-only and closes through the single X", async () => {
    const { onOpenChange } = renderCoverageDialog();

    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    expect(
      within(dialog).queryByRole("button", { name: /save|refresh|start|acknowledge/i }),
    ).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("focuses the chart-opened row inside the same dialog", async () => {
    renderCoverageDialog({}, { focusedChannelId: "direct" });

    await screen.findByRole("dialog", { name: "Data coverage" });
    expect(document.activeElement?.getAttribute("id")).toBe("channel-coverage-row-direct");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Direct, Revenue only");
  });

  it("opens unfocused when the focused channel is gone", async () => {
    renderCoverageDialog({}, { focusedChannelId: "gone" });

    const dialog = await screen.findByRole("dialog", { name: "Data coverage" });
    expect(within(dialog).getByLabelText("Direct, Revenue only")).toBeInTheDocument();
  });
});

describe("ChannelCoverageRail", () => {
  it("shows the complete/total count, strip and three count rows", () => {
    const onReview = vi.fn();
    const { container } = render(
      <ChannelCoverageRail portfolio={februaryPortfolio()} onReview={onReview} />,
    );

    const rail = screen.getByRole("complementary", { name: "Data coverage" });
    // Source keeps the prototype's casing; scoped CSS uppercases it to the
    // contract's exact `THE COMPLETE PICTURE`.
    expect(within(rail).getByText("The complete picture")).toBeInTheDocument();
    expect(within(rail).getByText("/ 4 channels")).toBeInTheDocument();
    expect(
      within(rail).getByText("have both revenue and loss data for this reporting window."),
    ).toBeInTheDocument();

    // One segment per active channel; the strip is decorative because the
    // text counts follow.
    expect(container.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(4);
    expect(within(rail).getByText("Revenue + loss").parentElement).toHaveTextContent("2");
    expect(within(rail).getByText("Revenue only").parentElement).toHaveTextContent("1");
    expect(within(rail).getByText("No comparable figure").parentElement).toHaveTextContent("1");

    const review = within(rail).getByRole("button", { name: "Review data coverage" });
    fireEvent.click(review);
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it("uses singular grammar for one complete channel", () => {
    render(
      <ChannelCoverageRail
        portfolio={februaryPortfolio({
          rows: [
            row("a", "Delivery A", {
              state: "complete",
              potential: { minorUnits: 8_000_000, currency: "AED" },
              lost: { minorUnits: 400_000, currency: "AED" },
              earned: { minorUnits: 7_600_000, currency: "AED" },
            }),
            row("direct", "Direct", {
              state: "revenue_only",
              potential: { minorUnits: 1_800_000, currency: "AED" },
              lost: null,
              earned: null,
            }),
          ],
        })}
        onReview={() => {}}
      />,
    );

    const rail = screen.getByRole("complementary", { name: "Data coverage" });
    expect(within(rail).getByText("/ 2 channels")).toBeInTheDocument();
    expect(
      within(rail).getByText("has both revenue and loss data for this reporting window."),
    ).toBeInTheDocument();
  });

  it("states 0 / 0 with no segments when no channel is active", () => {
    const { container } = render(
      <ChannelCoverageRail portfolio={februaryPortfolio({ rows: [] })} onReview={() => {}} />,
    );

    const rail = screen.getByRole("complementary", { name: "Data coverage" });
    expect(within(rail).getByText("/ 0 channels")).toBeInTheDocument();
    expect(within(rail).getByText("No active channels to compare.")).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-hidden="true"] > span')).toHaveLength(0);
  });
});

describe("ComparisonExplanationStrip", () => {
  it("names the revenue-only channel with singular grammar", () => {
    render(<ComparisonExplanationStrip portfolio={februaryPortfolio()} />);

    expect(
      screen.getByText(
        "Direct has revenue data, but no recorded loss. Included in reported revenue; excluded from earned and loss totals.",
      ),
    ).toBeInTheDocument();
  });

  it("pluralizes several revenue-only names without hardcoding one", () => {
    render(
      <ComparisonExplanationStrip
        portfolio={februaryPortfolio({
          rows: [
            ...februaryRows(),
            row("web", "Website", {
              state: "revenue_only",
              potential: { minorUnits: 500_000, currency: "AED" },
              lost: null,
              earned: null,
            }),
          ],
        })}
      />,
    );

    expect(
      screen.getByText(
        "Direct, Website have revenue data, but no recorded loss. Included in reported revenue; excluded from earned and loss totals.",
      ),
    ).toBeInTheDocument();
  });

  it("states the complete-band rule when every channel is measured", () => {
    render(
      <ComparisonExplanationStrip
        portfolio={februaryPortfolio({ rows: februaryRows().slice(0, 2) })}
      />,
    );

    expect(
      screen.getByText(
        "Only channels with both revenue and loss contribute to earned and loss totals.",
      ),
    ).toBeInTheDocument();
  });

  it("is honest when there is nothing to compare", () => {
    render(<ComparisonExplanationStrip portfolio={februaryPortfolio({ rows: [] })} />);

    expect(screen.getByText("No active channels to compare.")).toBeInTheDocument();
  });
});

describe("AboutChannelSetupDialog", () => {
  it("explains setup with the boundary rule and a real Integration Hub link", async () => {
    const onOpenChange = vi.fn();
    render(
      <AboutChannelSetupDialog organizationId={organizationId} open onOpenChange={onOpenChange} />,
    );

    const dialog = await screen.findByRole("dialog", { name: "A channel is where you sell" });
    expect(
      within(dialog).getByText(
        "A marketplace, your website or a physical store can each be a channel. Keep them together here to compare performance and organise reporting.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Channel identity").parentElement).toHaveTextContent(
      "Name and category",
    );
    expect(within(dialog).getByText("Locations").parentElement).toHaveTextContent(
      "Where the channel operates",
    );
    expect(within(dialog).getByText("Report labels").parentElement).toHaveTextContent(
      "Other names for the same channel",
    );
    expect(
      within(dialog).getByText(
        "Adding a channel does not connect a provider or grant permission to run campaigns. Connections stay in Integration Hub.",
      ),
    ).toBeInTheDocument();

    const link = within(dialog).getByRole("link", { name: "Open Integration Hub" });
    expect(link).toHaveAttribute("href", `/organizations/${organizationId}/integrations`);

    // Read-only: the Close X is the only control.
    expect(within(dialog).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
