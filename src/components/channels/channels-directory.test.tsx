// @vitest-environment jsdom
/**
 * Task 5 — directory, filters, search, sort and navigation.
 *
 * Fixtures reuse the integer minor-unit amounts from implementation plan §7
 * (February: A 8,000,000/400,000/7,600,000; B 4,000,000/200,000/3,800,000;
 * Direct 1,800,000 revenue-only; In-store refused; Previous archived).
 * Desktop table assertions scope into the table role; the mobile card list
 * renders the same rows from the same records, so global text queries would
 * match twice.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChannelsDirectory } from "@/components/channels/channels-directory";
import {
  buildChannelsPortfolioPresentation,
  type ChannelsLandingAnalysis,
} from "@/components/channels/channels-presentation";
import type {
  ChannelsOverviewRow,
  ChannelsOverviewView,
  ChannelsOverviewWindow,
} from "@/modules/analysis/application/channels-overview";
import type {
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";

const FEBRUARY_WINDOW: ChannelsOverviewWindow = {
  windowStart: "2026-02-01",
  windowEnd: "2026-02-28",
  grain: "month",
  label: "2026-02-01 to 2026-02-28",
  value: "2026-02-01..2026-02-28..month",
};

function channelRecord(
  idSuffix: string,
  displayName: string,
  overrides: Partial<OrganizationChannelRow> = {},
): OrganizationChannelRow {
  return {
    id: `22222222-2222-4222-8222-22222222${idSuffix}`,
    organization_id: ORGANIZATION_ID,
    key: displayName.toLowerCase().replace(/[^a-z0-9.-]+/g, "-"),
    display_name: displayName,
    category: "marketplace",
    template_key: null,
    status: "active",
    created_by: ACTOR_ID,
    archived_by: null,
    archived_at: null,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
    ...overrides,
  };
}

function mappingRecord(
  idSuffix: string,
  channelId: string,
  branchId: string,
  status: "active" | "inactive",
): OrganizationChannelBranchRow {
  return {
    id: `55555555-5555-4555-8555-55555555${idSuffix}`,
    organization_id: ORGANIZATION_ID,
    channel_id: channelId,
    branch_id: branchId,
    status,
    effective_from: null,
    effective_to: null,
    created_by: ACTOR_ID,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
  };
}

function bandRow(
  idSuffix: string,
  displayName: string,
  status: string,
  band: ChannelsOverviewRow["band"],
): ChannelsOverviewRow {
  return {
    channelId: `22222222-2222-4222-8222-22222222${idSuffix}`,
    displayName,
    status,
    band,
    assessed: band.state === "complete",
  };
}

/** February §7 reference rows: A + B complete, Direct revenue-only, In-store refused. */
function februaryRows(): ChannelsOverviewRow[] {
  return [
    bandRow("0001", "Delivery A", "active", {
      state: "complete",
      potential: { minorUnits: 8_000_000, currency: "AED" },
      lost: { minorUnits: 400_000, currency: "AED" },
      earned: { minorUnits: 7_600_000, currency: "AED" },
    }),
    bandRow("0002", "Delivery B", "active", {
      state: "complete",
      potential: { minorUnits: 4_000_000, currency: "AED" },
      lost: { minorUnits: 200_000, currency: "AED" },
      earned: { minorUnits: 3_800_000, currency: "AED" },
    }),
    bandRow("0003", "Direct", "active", {
      state: "revenue_only",
      potential: { minorUnits: 1_800_000, currency: "AED" },
      lost: null,
      earned: null,
    }),
    bandRow("0004", "In-store", "active", {
      state: "refused",
      potential: null,
      lost: null,
      earned: null,
    }),
  ];
}

function februaryChannels(): OrganizationChannelRow[] {
  return [
    channelRecord("0001", "Delivery A"),
    channelRecord("0002", "Delivery B"),
    channelRecord("0003", "Direct", { category: "owned_digital" }),
    channelRecord("0004", "In-store", { category: "physical" }),
    channelRecord("0005", "Previous", { status: "archived" }),
  ];
}

function readyView(rows: readonly ChannelsOverviewRow[]): ChannelsOverviewView {
  return {
    windows: [FEBRUARY_WINDOW],
    selectedWindow: FEBRUARY_WINDOW,
    // Deliberately the complete-only shared-model total: the directory must
    // never read this as the all-reported sum.
    total: {
      potential: { minorUnits: 12_000_000, currency: "AED" },
      lost: { minorUnits: 600_000, currency: "AED" },
      earned: { minorUnits: 11_400_000, currency: "AED" },
    },
    coverage: {
      assessedCount: 2,
      channelCount: rows.length,
      revenueOnlyNames: ["Direct"],
      unassessedNames: ["In-store"],
    },
    refusalReason: null,
    rows,
  };
}

function setup(
  input: {
    channels?: readonly OrganizationChannelRow[];
    rows?: readonly ChannelsOverviewRow[];
    analysis?: ChannelsLandingAnalysis;
    branchMappings?: readonly OrganizationChannelBranchRow[];
    canManage?: boolean;
    canMapBranches?: boolean;
  } = {},
) {
  const channels = input.channels ?? februaryChannels();
  const analysis: ChannelsLandingAnalysis = input.analysis ?? {
    state: "ready",
    view: readyView(input.rows ?? februaryRows()),
  };
  const portfolio =
    analysis.state === "ready" ? buildChannelsPortfolioPresentation(analysis.view) : null;
  const onManage = vi.fn();
  const onAdd = vi.fn();
  const onAboutSetup = vi.fn();
  render(
    <ChannelsDirectory
      organizationId={ORGANIZATION_ID}
      channels={channels}
      branchMappings={input.branchMappings ?? []}
      analysis={analysis}
      portfolio={portfolio}
      canManage={input.canManage ?? true}
      canMapBranches={input.canMapBranches}
      onManage={onManage}
      onAdd={onAdd}
      onAboutSetup={onAboutSetup}
    />,
  );
  return { channels, analysis, portfolio, onManage, onAdd, onAboutSetup };
}

/** First-cell text of each desktop table body row, in display order. */
function tableNames(): string[] {
  const table = screen.getByRole("table", { name: "Channels" });
  return within(table)
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

describe("ChannelsDirectory", () => {
  afterEach(() => cleanup());

  it("defaults to Active, excluding archived records", () => {
    setup();

    expect(screen.getByRole("radio", { name: "Active 4" })).toHaveAttribute("aria-checked", "true");
    expect(tableNames()).toEqual([
      expect.stringContaining("Delivery A"),
      expect.stringContaining("Delivery B"),
      expect.stringContaining("Direct"),
      expect.stringContaining("In-store"),
    ]);
    expect(screen.getByRole("heading", { name: "Your channels 4" })).toBeInTheDocument();
  });

  it("counts every filter before search applies", () => {
    setup();

    expect(screen.getByRole("radio", { name: "Active 4" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Measured 2" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Needs attention 2" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Archived 1" })).toBeInTheDocument();
  });

  it("splits measured and needs-attention by band state", () => {
    setup();

    fireEvent.click(screen.getByRole("radio", { name: "Measured 2" }));
    expect(tableNames()).toEqual([
      expect.stringContaining("Delivery A"),
      expect.stringContaining("Delivery B"),
    ]);

    fireEvent.click(screen.getByRole("radio", { name: "Needs attention 2" }));
    expect(tableNames()).toEqual([
      expect.stringContaining("Direct"),
      expect.stringContaining("In-store"),
    ]);
  });

  it("searches names case-insensitively and trims the query", () => {
    setup();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search channels" }), {
      target: { value: "  direct " },
    });
    expect(tableNames()).toEqual([expect.stringContaining("Direct")]);
  });

  it("searches the displayed category label, not just the raw value", () => {
    setup();

    // `owned_digital` in the snapshot displays as "Owned digital".
    fireEvent.change(screen.getByRole("searchbox", { name: "Search channels" }), {
      target: { value: "owned digital" },
    });
    expect(tableNames()).toEqual([expect.stringContaining("Direct")]);
  });

  it("caps the query at 160 characters and clears through the labelled X", () => {
    setup();
    const search = screen.getByRole("searchbox", { name: "Search channels" });

    expect(search).toHaveAttribute("maxLength", "160");
    expect(screen.queryByRole("button", { name: "Clear channel search" })).toBeNull();

    fireEvent.change(search, { target: { value: "delivery" } });
    expect(screen.getByRole("button", { name: "Clear channel search" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear channel search" }));
    expect(search).toHaveValue("");
    expect(tableNames()).toHaveLength(4);
    expect(screen.queryByRole("button", { name: "Clear channel search" })).toBeNull();
  });

  it("offers Clear filters on an empty view and resets query plus Active only", () => {
    setup();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search channels" }), {
      target: { value: "zzz-no-such-channel" },
    });
    expect(screen.getByText("No channels in this view")).toBeInTheDocument();
    expect(screen.getByText("Try another filter or a different channel name.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
    expect(screen.getByRole("searchbox", { name: "Search channels" })).toHaveValue("");
    expect(screen.getByRole("radio", { name: "Active 4" })).toHaveAttribute("aria-checked", "true");
    expect(tableNames()).toHaveLength(4);
  });

  it("renders revenue, one-decimal shares and state explanations per band", () => {
    setup();
    const table = screen.getByRole("table", { name: "Channels" });

    expect(within(table).getByText("80,000.00")).toBeInTheDocument();
    expect(within(table).getByText("58.0% of reported total")).toBeInTheDocument();
    expect(within(table).getByText("29.0% of reported total")).toBeInTheDocument();
    expect(within(table).getByText("13.0% of reported total")).toBeInTheDocument();

    expect(within(table).getAllByText("Measured")).toHaveLength(2);
    expect(within(table).getAllByText("Revenue and loss available")).toHaveLength(2);
    expect(within(table).getByText("Revenue only")).toBeInTheDocument();
    expect(within(table).getByText("Loss not recorded")).toBeInTheDocument();
    expect(within(table).getByText("Needs review")).toBeInTheDocument();
    expect(
      within(table).getByText("No comparable revenue figure for this window."),
    ).toBeInTheDocument();

    // The refused row carries an em dash, never a fabricated zero.
    const inStoreRow = within(table)
      .getAllByRole("row")
      .find((row) => row.textContent?.includes("In-store"));
    expect(inStoreRow?.textContent).toContain("—");
    expect(inStoreRow?.textContent).toContain("No reported figure");
    expect(inStoreRow?.textContent).not.toContain("0.00");
  });

  it("keeps a recorded zero Measured while its share stays unavailable", () => {
    const zeroChannel = channelRecord("0009", "Zero");
    const zeroRow = bandRow("0009", "Zero", "active", {
      state: "complete",
      potential: { minorUnits: 0, currency: "AED" },
      lost: { minorUnits: 0, currency: "AED" },
      earned: { minorUnits: 0, currency: "AED" },
    });
    setup({ channels: [zeroChannel], rows: [zeroRow] });
    const table = screen.getByRole("table", { name: "Channels" });

    expect(screen.getByRole("radio", { name: "Active 1" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Measured 1" })).toBeInTheDocument();
    expect(within(table).getByText("Measured")).toBeInTheDocument();
    expect(within(table).getByText("0.00")).toBeInTheDocument();
    // Zero denominator: a share for everyone would divide by nothing.
    expect(within(table).getByText("Share unavailable")).toBeInTheDocument();
  });

  it("sorts reported revenue descending by default and toggles ascending with unknowns last", () => {
    setup();
    const table = screen.getByRole("table", { name: "Channels" });
    const sortButton = within(table).getByRole("button", {
      name: "Sort channels by reported revenue",
    });

    expect(tableNames()).toEqual([
      expect.stringContaining("Delivery A"),
      expect.stringContaining("Delivery B"),
      expect.stringContaining("Direct"),
      expect.stringContaining("In-store"),
    ]);

    fireEvent.click(sortButton);
    expect(tableNames()).toEqual([
      expect.stringContaining("Direct"),
      expect.stringContaining("Delivery B"),
      expect.stringContaining("Delivery A"),
      expect.stringContaining("In-store"),
    ]);
    expect(within(table).getByRole("columnheader", { name: /Reported revenue/ })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
  });

  it("breaks amount ties by display name then channel ID", () => {
    const tied = [
      channelRecord("0009", "Zulu"),
      channelRecord("0008", "Alpha"),
      channelRecord("0007", "Same"),
      channelRecord("0006", "Same"),
    ];
    const rows = [tied[0], tied[1], tied[2], tied[3]].map((channel) =>
      bandRow(channel.id.slice(-4), channel.display_name, "active", {
        state: "complete",
        potential: { minorUnits: 1_000_000, currency: "AED" },
        lost: { minorUnits: 100_000, currency: "AED" },
        earned: { minorUnits: 900_000, currency: "AED" },
      }),
    );
    setup({ channels: tied, rows });

    // Alpha before Zulu by name; the two "Same" rows by ascending ID.
    expect(tableNames()).toEqual([
      expect.stringContaining("Alpha"),
      expect.stringContaining("Same"),
      expect.stringContaining("Same"),
      expect.stringContaining("Zulu"),
    ]);
    const sameRows = tableNames().filter((name) => name.includes("Same"));
    expect(sameRows).toHaveLength(2);
  });

  it("falls back to alphabetical order with amounts kept when currencies differ", () => {
    const rows = februaryRows().map((row) =>
      row.channelId.endsWith("0003")
        ? {
            ...row,
            band: {
              ...row.band,
              state: "revenue_only" as const,
              potential: { minorUnits: 10_000_000, currency: "USD" },
            },
          }
        : row,
    );
    setup({ rows });
    const table = screen.getByRole("table", { name: "Channels" });

    // Direct holds $100,000: monetary ranking would put it first, but mixed
    // currencies cannot be ranked together.
    expect(tableNames()).toEqual([
      expect.stringContaining("Delivery A"),
      expect.stringContaining("Delivery B"),
      expect.stringContaining("Direct"),
      expect.stringContaining("In-store"),
    ]);
    const sortButton = within(table).getByRole("button", {
      name: "Sort channels by reported revenue",
    });
    expect(sortButton).toBeDisabled();
    expect(screen.getByText("Different currencies cannot be ranked together")).toBeInTheDocument();
    expect(within(table).getByText("80,000.00")).toBeInTheDocument();
    expect(within(table).getByText("100,000.00")).toBeInTheDocument();
    expect(within(table).getAllByText("Share unavailable").length).toBeGreaterThan(0);
  });

  it("navigates archived records to history with mapped-history captions", () => {
    const archivedId = "22222222-2222-4222-8222-222222220005";
    const archivedRow = bandRow("0005", "Previous", "archived", {
      state: "complete",
      potential: { minorUnits: 5_000_000, currency: "AED" },
      lost: { minorUnits: 500_000, currency: "AED" },
      earned: { minorUnits: 4_500_000, currency: "AED" },
    });
    setup({
      rows: [...februaryRows(), archivedRow],
      branchMappings: [
        mappingRecord("01", archivedId, "44444444-4444-4444-8444-444444444444", "inactive"),
      ],
    });

    fireEvent.click(screen.getByRole("radio", { name: "Archived 1" }));
    const table = screen.getByRole("table", { name: "Channels" });
    const historyLink = within(table).getByRole("link", { name: "View history" });
    expect(historyLink).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION_ID}/channels/${archivedId}`,
    );
    expect(within(table).getByText("Archived")).toBeInTheDocument();
    expect(within(table).getByText("Retained for history")).toBeInTheDocument();
    expect(within(table).getByText("50,000.00")).toBeInTheDocument();
    expect(within(table).getByText("Historical reporting window")).toBeInTheDocument();
    expect(within(table).getByText("No active mappings")).toBeInTheDocument();
    expect(within(table).getByText("1 historical")).toBeInTheDocument();
    // Archived money never takes an active share: A still holds 58.0%.
    fireEvent.click(screen.getByRole("radio", { name: "Active 4" }));
    expect(
      within(screen.getByRole("table", { name: "Channels" })).getByText("58.0% of reported total"),
    ).toBeInTheDocument();
  });

  it("describes location configuration without claiming measured coverage", () => {
    const deliveryA = "22222222-2222-4222-8222-222222220001";
    setup({
      branchMappings: [
        mappingRecord("01", deliveryA, "44444444-4444-4444-8444-444444444441", "active"),
        mappingRecord("02", deliveryA, "44444444-4444-4444-8444-444444444442", "active"),
        mappingRecord("03", deliveryA, "44444444-4444-4444-8444-444444444443", "inactive"),
      ],
    });
    const table = screen.getByRole("table", { name: "Channels" });

    const deliveryARow = within(table)
      .getAllByRole("row")
      .find((row) => row.textContent?.includes("Delivery A"));
    expect(deliveryARow?.textContent).toContain("2 mapped locations");
    expect(deliveryARow?.textContent).toContain("1 historical");

    const deliveryBRow = within(table)
      .getAllByRole("row")
      .find((row) => row.textContent?.includes("Delivery B"));
    expect(deliveryBRow?.textContent).toContain("Organization-wide");
  });

  it("links active channels to Channel Audit in the same tab", () => {
    setup();
    const table = screen.getByRole("table", { name: "Channels" });

    const audits = within(table).getAllByRole("link", { name: "Channel Audit" });
    expect(audits).toHaveLength(4);
    expect(audits[0]).toHaveAttribute(
      "href",
      `/organizations/${ORGANIZATION_ID}/channels/22222222-2222-4222-8222-222222220001`,
    );
    for (const audit of audits) {
      expect(audit.getAttribute("href")).not.toContain("?");
    }
  });

  it("uses Open channel while the gate is off and keeps history for archives", () => {
    setup({ analysis: { state: "disabled" } });
    const table = screen.getByRole("table", { name: "Channels" });

    expect(within(table).getAllByRole("link", { name: "Open channel" })).toHaveLength(4);
    expect(within(table).getAllByText("Analysis not enabled")).toHaveLength(4);
    expect(screen.getByText("4 channels shown")).toBeInTheDocument();
    expect(screen.queryByText(/February 2026/)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Archived 1" }));
    expect(within(table).getByRole("link", { name: "View history" })).toBeInTheDocument();
  });

  it("disables evidence filters with an explanation when analysis is unavailable", () => {
    setup({ analysis: { state: "unavailable" } });

    expect(screen.getByRole("radio", { name: "Measured 0" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Needs attention 0" })).toBeDisabled();
    expect(screen.getByText("Channel performance is unavailable.")).toBeInTheDocument();
    // The directory itself stays usable, with audit navigation intact.
    expect(tableNames()).toHaveLength(4);
    const table = screen.getByRole("table", { name: "Channels" });
    expect(within(table).getAllByRole("link", { name: "Channel Audit" })).toHaveLength(4);
    expect(within(table).getAllByText("Analysis unavailable")).toHaveLength(4);
  });

  it("disables evidence filters with an explanation when analysis is disabled", () => {
    setup({ analysis: { state: "disabled" } });

    expect(screen.getByRole("radio", { name: "Measured 0" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Needs attention 0" })).toBeDisabled();
    expect(screen.getByText("Analysis is not enabled for this organization.")).toBeInTheDocument();
  });

  it("reports the footer count, period and directory-only scope", () => {
    setup();

    expect(screen.getByText("4 channels shown · February 2026")).toBeInTheDocument();
    expect(screen.getByText("Directory filters apply to this list only")).toBeInTheDocument();
  });

  it("shows an archives-only state with a reader-visible path to history", () => {
    const archived = channelRecord("0005", "Previous", { status: "archived" });
    setup({ channels: [archived], rows: [] });

    expect(screen.getByText("No active channels")).toBeInTheDocument();
    expect(screen.getByText("Your archived channels remain available.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "View archived channels" }));
    expect(screen.getByRole("radio", { name: "Archived 1" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(tableNames()).toEqual([expect.stringContaining("Previous")]);
  });

  it("shows managers an in-section Add on an empty organization, viewers none", () => {
    const manager = setup({ channels: [], rows: [] });
    expect(screen.getByText("No channels yet")).toBeInTheDocument();
    expect(
      screen.getByText("Add a channel to organise reporting and compare its performance."),
    ).toBeInTheDocument();

    const addButtons = screen.getAllByRole("button", { name: "Add channel" });
    expect(addButtons).toHaveLength(1);
    fireEvent.click(addButtons[0] as HTMLElement);
    expect(manager.onAdd).toHaveBeenCalledTimes(1);
    cleanup();

    setup({ channels: [], rows: [], canManage: false });
    expect(screen.getByText("No channels yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add channel" })).toBeNull();
  });

  it("opens Manage for either management permission and View details for viewers", () => {
    const manager = setup({});
    const table = screen.getByRole("table", { name: "Channels" });
    fireEvent.click(within(table).getByRole("button", { name: "Manage Direct" }));
    expect(manager.onManage).toHaveBeenCalledWith("22222222-2222-4222-8222-222222220003");
    cleanup();

    setup({ canManage: false, canMapBranches: true });
    fireEvent.click(
      within(screen.getByRole("table", { name: "Channels" })).getByRole("button", {
        name: "Manage Direct",
      }),
    );
    cleanup();

    setup({ canManage: false });
    const viewerTable = screen.getByRole("table", { name: "Channels" });
    expect(
      within(viewerTable).getByRole("button", { name: "View details for Direct" }),
    ).toBeInTheDocument();
    expect(within(viewerTable).queryByRole("button", { name: "Manage Direct" })).toBeNull();
  });

  it("keeps no pencil Edit action in the compact rows", () => {
    setup();
    const table = screen.getByRole("table", { name: "Channels" });
    expect(within(table).queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("emits the About channel setup hook", () => {
    const { onAboutSetup } = setup();

    fireEvent.click(screen.getByRole("button", { name: "About channel setup" }));
    expect(onAboutSetup).toHaveBeenCalledTimes(1);
  });

  it("shows full category strings with muted physical tiles", () => {
    setup();
    const table = screen.getByRole("table", { name: "Channels" });

    expect(within(table).getAllByText("Marketplace")).toHaveLength(2);
    expect(within(table).getByText("Owned digital")).toBeInTheDocument();
    expect(within(table).getByText("Physical")).toBeInTheDocument();
  });
});
