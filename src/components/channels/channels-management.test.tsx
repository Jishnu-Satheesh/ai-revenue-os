// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ChannelsManagement } from "@/components/channels/channels-management";
import type {
  OrganizationBranchRow,
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";
import type { ChannelsOverviewRow } from "@/modules/analysis/application/channels-overview";

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

describe("ChannelsManagement", () => {
  afterEach(() => cleanup());

  it("makes governed analysis visible in the channel directory", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        analysisRows={[measuredRow]}
        workspaceEnabled
        canManage={false}
      />,
    );

    expect(screen.getByRole("heading", { name: "Channel directory" })).toBeInTheDocument();
    expect(screen.getByText(/AED\s*196\.00 earned/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Measured" })).toBeInTheDocument();
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
        analysisRows={[measuredRow]}
        workspaceEnabled
        canManage={false}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Measured" }));
    expect(screen.getByRole("heading", { name: "Keeta" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Noon" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Needs attention" }));
    expect(screen.queryByRole("heading", { name: "Keeta" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Noon" })).toBeInTheDocument();
  });

  it("explains the capability boundary and gives an authorized manager an empty-state action", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[]}
        canManage
      />,
    );

    expect(
      screen.getByText("Channel identity is separate from provider access"),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Add channel/ })).toHaveLength(2);
    expect(screen.getByRole("heading", { name: "Channel directory" })).toBeInTheDocument();
  });

  it("does not render mutation controls for a read-only member", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[]}
        canManage={false}
      />,
    );

    expect(screen.queryByRole("button", { name: /Add channel/ })).not.toBeInTheDocument();
    expect(screen.getByText("No channels yet")).toBeInTheDocument();
  });

  it("does not render mapping or identity-edit actions on the card, regardless of canMapBranches", () => {
    // Mapping setup moved to the channel's own Setup tab (ChannelSetupPanel).
    // The register card keeps only the read-only counts and, when canManage,
    // the identity Edit action.
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        canManage={false}
        canMapBranches
      />,
    );

    expect(screen.queryByRole("button", { name: "Manage mappings" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("links every channel card to its own page, including an archived one", () => {
    // The channel page is the only place Setup lives now, and Setup is what
    // an archived channel needs (its Restore control lives there). The card
    // must not gate this link on workspace availability or channel status.
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
        canManage={false}
      />,
    );

    const links = screen.getAllByRole("link", { name: "Open channel" });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/channels/${channel.id}`,
    );
    expect(links[1]).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/channels/${archivedChannel.id}`,
    );
  });

  it("keeps inactive outlet mappings visible as historical evidence", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        branches={[branch]}
        branchMappings={[inactiveMapping]}
        canManage={false}
        canMapBranches
      />,
    );

    expect(screen.getByText("1 historical")).toBeInTheDocument();
  });
});
