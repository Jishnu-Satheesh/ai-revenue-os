// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: nav.refresh, push: nav.push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
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
import { toast } from "sonner";
import type {
  ChannelSourceAliasRow,
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

const keetaAlias: ChannelSourceAliasRow = {
  id: "66666666-6666-4666-8666-666666666666",
  organization_id: organizationId,
  channel_id: channel.id,
  alias: "Keeta orders",
  normalized_alias: "keeta orders",
  source_scope: "report_package",
  source_record_reference: null,
  status: "active",
  effective_from: null,
  effective_to: null,
  confirmed_at: null,
  created_by: null,
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

describe("channel management dialogs (Task 6 wiring)", () => {
  afterEach(() => cleanup());

  // The D04/D05 dialogs mount TanStack mutation hooks, so these wiring
  // tests render inside a QueryClientProvider. Suites above never open a
  // dialog and stay provider-free by design.
  function renderManagement(props: {
    channels?: readonly OrganizationChannelRow[];
    branches?: readonly OrganizationBranchRow[];
    branchMappings?: readonly OrganizationChannelBranchRow[];
    aliases?: readonly ChannelSourceAliasRow[];
    canManage?: boolean;
    canMapBranches?: boolean;
    onAdd?: () => void;
    onManage?: (channelId: string) => void;
  }) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={props.channels ?? [channel]}
        branches={props.branches ?? []}
        branchMappings={props.branchMappings ?? []}
        aliases={props.aliases ?? []}
        analysis={disabled}
        canManage={props.canManage ?? false}
        canMapBranches={props.canMapBranches}
        onAdd={props.onAdd}
        onManage={props.onManage}
      />,
      { wrapper },
    );
  }

  it("opens its own create dialog from Add when no hook is provided", async () => {
    renderManagement({ canManage: true });

    fireEvent.click(screen.getByRole("button", { name: "Add channel" }));
    expect(await screen.findByRole("dialog", { name: "Add a channel" })).toBeInTheDocument();
    expect(screen.getByText("Add a sales channel to your business directory.")).toBeInTheDocument();
  });

  it("emits onAdd instead of opening its own dialog when the hook is provided", () => {
    const onAdd = vi.fn();
    renderManagement({ canManage: true, onAdd });

    fireEvent.click(screen.getByRole("button", { name: "Add channel" }));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Add a channel" })).toBeNull();
  });

  it("opens the manage dialog from the directory ellipsis", async () => {
    renderManagement({ canManage: true });

    const table = within(screen.getByRole("table", { name: "Channels" }));
    fireEvent.click(table.getByRole("button", { name: "Manage Keeta" }));
    expect(await screen.findByRole("dialog", { name: "Manage Keeta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save channel" })).toBeInTheDocument();
  });

  it("emits onManage with the channel ID instead of opening its own dialog", () => {
    const onManage = vi.fn();
    renderManagement({ canManage: true, onManage });

    const table = within(screen.getByRole("table", { name: "Channels" }));
    fireEvent.click(table.getByRole("button", { name: "Manage Keeta" }));
    expect(onManage).toHaveBeenCalledTimes(1);
    expect(onManage).toHaveBeenCalledWith(channel.id);
    expect(screen.queryByRole("dialog", { name: "Manage Keeta" })).toBeNull();
  });

  it("opens read-only Channel details for a viewer", async () => {
    renderManagement({ canManage: false });

    const table = within(screen.getByRole("table", { name: "Channels" }));
    fireEvent.click(table.getByRole("button", { name: "View details for Keeta" }));
    expect(await screen.findByRole("dialog", { name: "Channel details" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save channel" })).not.toBeInTheDocument();
  });

  it("wires snapshot branches into the map-only Manage mapping form", async () => {
    const branchDeira: OrganizationBranchRow = {
      ...branch,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Deira",
      slug: "deira",
    };
    renderManagement({
      canManage: false,
      canMapBranches: true,
      branches: [branchDeira, branch],
      branchMappings: [inactiveMapping],
      aliases: [keetaAlias],
    });

    const table = within(screen.getByRole("table", { name: "Channels" }));
    fireEvent.click(table.getByRole("button", { name: "Manage Keeta" }));
    const dialog = await screen.findByRole("dialog", { name: "Manage Keeta" });

    // Inactive history survives into the editable section's saved list, while
    // the draft defaults to the first active outlet — never the stored row.
    // (The directory also captions "No active mappings" in both its desktop
    // and mobile renderings, so scope that copy to the dialog.)
    fireEvent.click(within(dialog).getByRole("button", { name: /Locations/ }));
    expect(within(dialog).getByText("No active mappings")).toBeInTheDocument();
    // The outlet menu also carries a hidden native option per branch, so pin
    // the saved-history row by its element.
    expect(
      within(dialog).getByText("Al Barsha", { selector: "span.font-medium" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Outlet" })).toHaveTextContent("Deira");
    expect(
      within(dialog).getByRole("button", { name: "Save location mapping" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Report labels/ }));
    // The alias appears in the collapsed summary and again in the detail row.
    expect(screen.getAllByText("Keeta orders")).toHaveLength(2);
    expect(screen.getByLabelText("Exact report label")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save report label" })).toBeInTheDocument();

    // Identity stays read-only for map-only through the full stack.
    expect(screen.queryByRole("button", { name: "Save channel" })).not.toBeInTheDocument();
  });

  it("shows a viewer saved configuration without mapping forms", async () => {
    renderManagement({
      canManage: false,
      branches: [branch],
      branchMappings: [inactiveMapping],
      aliases: [keetaAlias],
    });

    const table = within(screen.getByRole("table", { name: "Channels" }));
    fireEvent.click(table.getByRole("button", { name: "View details for Keeta" }));
    await screen.findByRole("dialog", { name: "Channel details" });

    fireEvent.click(screen.getByRole("button", { name: /Locations/ }));
    expect(screen.getByText("Al Barsha")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Outlet" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Report labels/ }));
    expect(screen.getAllByText("Keeta orders")).toHaveLength(2);
    expect(screen.queryByLabelText("Exact report label")).not.toBeInTheDocument();
  });

  it("closes the manage dialog with a safe message when the channel disappears", async () => {
    const { rerender } = renderManagement({ canManage: true });

    const table = within(screen.getByRole("table", { name: "Channels" }));
    fireEvent.click(table.getByRole("button", { name: "Manage Keeta" }));
    await screen.findByRole("dialog", { name: "Manage Keeta" });

    // The original QueryClientProvider wrapper persists across rerender;
    // only the snapshot changes, so the open dialog observes fresh props.
    rerender(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[]}
        analysis={disabled}
        canManage
      />,
    );

    await waitFor(() => expect(toast.info).toHaveBeenCalledWith("Channel is no longer available."));
    expect(screen.queryByRole("dialog", { name: "Manage Keeta" })).toBeNull();
  });
});
