// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { ChannelsManagement } from "@/components/channels/channels-management";
import type {
  OrganizationBranchRow,
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";

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

describe("ChannelsManagement", () => {
  afterEach(() => cleanup());

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
    expect(screen.getByText("Not assessed")).toBeInTheDocument();
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

  it("gives an operator access to map a channel without identity-edit access", () => {
    render(
      <ChannelsManagement
        organizationId={organizationId}
        organizationName="Nostaza"
        channels={[channel]}
        canManage={false}
        canMapBranches
      />,
    );

    expect(screen.getByRole("button", { name: "Manage mappings" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
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
