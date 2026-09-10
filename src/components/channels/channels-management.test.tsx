// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push }),
  useSearchParams: () => new URLSearchParams(),
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

import { ChannelsManagement } from "@/components/channels/channels-management";
import type { ChannelsLandingAnalysis } from "@/components/channels/channels-presentation";
import type {
  OrganizationBranchRow,
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";
import type {
  ChannelsOverviewRow,
  ChannelsOverviewView,
} from "@/modules/analysis/application/channels-overview";

const organizationId = "11111111-1111-4111-8111-111111111111";
const channel: OrganizationChannelRow = {
  id: "22222222-2222-4222-8222-222222222222",
  organization_id: organizationId,
  key: "keeta",
  display_name: "Keeta",
  category: "marketplace",
  template_key: "keeta",
  status: "active",
  created_by: "33333333-3333-4333-8333-333333333333",
  archived_by: null,
  archived_at: null,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const branch: OrganizationBranchRow = {
  id: "44444444-4444-4444-8444-444444444444",
  organization_id: organizationId,
  name: "Al Barsha",
  slug: "al-barsha",
  kind: "physical",
  timezone: "Asia/Dubai",
  currency: "AED",
  service_area: {},
  operating_hours: {},
  contact_details: {},
  capacity_metadata: {},
  is_active: true,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const inactiveMapping: OrganizationChannelBranchRow = {
  id: "55555555-5555-4555-8555-555555555555",
  organization_id: organizationId,
  channel_id: channel.id,
  branch_id: branch.id,
  status: "inactive",
  effective_from: null,
  effective_to: null,
  created_by: channel.created_by,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const measuredRow: ChannelsOverviewRow = {
  channelId: channel.id,
  displayName: channel.display_name,
  status: "active",
  assessed: true,
  band: {
    state: "complete",
    potential: { minorUnits: 55300, currency: "AED" },
    lost: { minorUnits: 35700, currency: "AED" },
    earned: { minorUnits: 19600, currency: "AED" },
  },
};

const februaryWindow = {
  windowStart: "2026-02-01",
  windowEnd: "2026-02-28",
  grain: "month" as const,
  label: "2026-02-01 to 2026-02-28",
  value: "2026-02-01..2026-02-28..month",
};

function readyView(rows: readonly ChannelsOverviewRow[]): ChannelsOverviewView {
  return {
    windows: [februaryWindow],
    selectedWindow: februaryWindow,
    total: {
      potential: { minorUnits: 55300, currency: "AED" },
      lost: { minorUnits: 35700, currency: "AED" },
      earned: { minorUnits: 19600, currency: "AED" },
    },
    coverage: {
      assessedCount: 1,
      channelCount: 1,
      revenueOnlyNames: [],
      unassessedNames: [],
    },
    refusalReason: null,
    rows,
  };
}

function ready(rows: readonly ChannelsOverviewRow[]): ChannelsLandingAnalysis {
  return { state: "ready", view: readyView(rows) };
}

const disabled: ChannelsLandingAnalysis = { state: "disabled" };

describe("ChannelsManagement", () => {
  afterEach(() => cleanup());

  it("makes governed analysis visible in the channel directory", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        analysis={ready([measuredRow])}
        canManage={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Your channels 1" })).toBeInTheDocument();
    const table = within(screen.getByRole("table", { name: "Channels" }));
    expect(table.getByText("553.00")).toBeInTheDocument();
    expect(table.getByText("100.0% of reported total")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Measured 1" })).toBeInTheDocument();
  });

  it("filters the directory by the actionable analysis state", () => {
    const unassessedChannel: OrganizationChannelRow = {
      ...channel,
      id: "77777777-7777-4777-8777-777777777777",
      key: "noon",
      display_name: "Noon",
    };

    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel, unassessedChannel]}
        analysis={ready([measuredRow])}
        canManage={false}
      />,
    );

    const table = () => within(screen.getByRole("table", { name: "Channels" }));

    fireEvent.click(screen.getByRole("radio", { name: "Measured 1" }));
    expect(table().getByText("Keeta")).toBeInTheDocument();
    expect(table().queryByText("Noon")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Needs attention 1" }));
    expect(table().queryByText("Keeta")).not.toBeInTheDocument();
    expect(table().getByText("Noon")).toBeInTheDocument();
  });

  it("renders the V01 title without the old eyebrow, tile or technical subtitle", () => {
    const onAdd = vi.fn();
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        analysis={disabled}
        canManage
        onAdd={onAdd}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Channels" })).toBeInTheDocument();
    expect(screen.getByText("See what each channel brings to your business.")).toBeInTheDocument();
    expect(screen.queryByText("Channel portfolio")).toBeNull();
    expect(screen.queryByText(/business identities that keep marketplace reporting/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Add channel" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("shows no fake Add action to a viewer", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        analysis={disabled}
        canManage={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /Add channel/ })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Channels" })).toBeInTheDocument();
  });

  it("hides toolbar and portfolio when analysis is disabled but keeps the directory", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        analysis={disabled}
        canManage={false}
      />,
    );

    expect(screen.queryByRole("combobox", { name: "Reporting period" })).toBeNull();
    expect(screen.queryByText("Channel performance is unavailable")).toBeNull();
    // Directory-level notice plus the disabled evidence-filter explanation.
    expect(screen.getAllByText("Analysis is not enabled for this organization.")).toHaveLength(2);
    expect(
      within(screen.getByRole("table", { name: "Channels" })).getByText("Keeta"),
    ).toBeInTheDocument();
  });

  it("keeps the directory usable when the performance read fails", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        analysis={{ state: "unavailable" }}
        canManage={false}
      />,
    );

    expect(screen.getByText("Channel performance is unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(
      within(screen.getByRole("table", { name: "Channels" })).getByText("Keeta"),
    ).toBeInTheDocument();
  });

  it("explains the empty register and gives an authorized manager an empty-state action", () => {
    const onAdd = vi.fn();
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[]}
        analysis={disabled}
        canManage
        onAdd={onAdd}
      />,
    );

    // The provider-access boundary now lives in the About channel setup
    // dialog (D03), not as a landing alert between chart and directory.
    expect(screen.getByText("No channels yet")).toBeInTheDocument();
    expect(
      screen.getByText("Add a channel to organise reporting and compare its performance."),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Your channels 0" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add channel/ })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: /Add channel/ })[1] as HTMLElement);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("does not render mutation controls for a read-only member", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[]}
        analysis={disabled}
        canManage={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /Add channel/ })).not.toBeInTheDocument();
    expect(screen.getByText("No channels yet")).toBeInTheDocument();
  });

  it("offers Manage to a map-only operator without identity-edit actions", () => {
    // Mapping setup moved to the channel's own Setup tab (ChannelSetupPanel).
    // The compact row keeps no pencil Edit; a map-only operator opens the
    // same Manage entry point as a manager (Task 6 dialog).
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        analysis={disabled}
        canManage={false}
        canMapBranches
      />,
    );

    expect(screen.queryByRole("button", { name: "Manage mappings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(
      within(screen.getByRole("table", { name: "Channels" })).getByRole("button", {
        name: "Manage Keeta",
      }),
    ).toBeInTheDocument();
  });

  it("links every channel to its own page, with history wording for an archived one", () => {
    // The channel page is the only place Setup lives now, and Setup is what
    // an archived channel needs (its Restore control lives there). Archived
    // history stays reader-visible under the Archived filter; the Active
    // default lists only the active channel.
    const archivedChannel: OrganizationChannelRow = {
      ...channel,
      id: "66666666-6666-4666-8666-666666666666",
      status: "archived",
      archived_by: channel.created_by,
      archived_at: "2026-08-25T00:00:00.000Z",
    };
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel, archivedChannel]}
        analysis={disabled}
        canManage={false}
      />,
    );
    const table = () => within(screen.getByRole("table", { name: "Channels" }));

    expect(table().getAllByRole("link", { name: "Open channel" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("radio", { name: "Archived 1" }));
    const history = table().getByRole("link", { name: "View history" });
    expect(history).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/channels/${archivedChannel.id}`,
    );
    expect(table().queryByRole("link", { name: "Open channel" })).toBeNull();
  });

  it("keeps inactive outlet mappings visible as historical evidence", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        branches={[branch]}
        branchMappings={[inactiveMapping]}
        analysis={disabled}
        canManage={false}
        canMapBranches
      />,
    );

    const table = within(screen.getByRole("table", { name: "Channels" }));
    expect(table.getByText("1 historical")).toBeInTheDocument();
    expect(table.getByText("No active mappings")).toBeInTheDocument();
  });
  it("opens the About channel setup dialog with a real Integration Hub link", async () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        analysis={ready([measuredRow])}
        canManage={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "About channel setup" }));

    const dialog = await screen.findByRole("dialog", { name: "A channel is where you sell" });
    expect(
      within(dialog).getByText(
        "A marketplace, your website or a physical store can each be a channel. Keep them together here to compare performance and organise reporting.",
      ),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        "Adding a channel does not connect a provider or grant permission to run campaigns. Connections stay in Integration Hub.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Open Integration Hub" })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/integrations`,
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "Close dialog" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "A channel is where you sell" })).toBeNull(),
    );
  });

  it("emits onAboutSetup instead of opening its own dialog when the hook is provided", async () => {
    const onAboutSetup = vi.fn();
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        analysis={ready([measuredRow])}
        canManage={false}
        onAboutSetup={onAboutSetup}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "About channel setup" }));
    expect(onAboutSetup).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "A channel is where you sell" })).toBeNull();
  });
});
