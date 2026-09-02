import { describe, expect, it, vi } from "vitest";

import { createChannelService } from "@/modules/channels/application/service";
import type {
  ChannelRepository,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";

const organizationId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";

function channel(): OrganizationChannelRow {
  return {
    id: channelId,
    organization_id: organizationId,
    key: "talabat",
    display_name: "Talabat",
    category: "marketplace",
    template_key: "talabat",
    status: "active",
    created_by: actorId,
    archived_by: null,
    archived_at: null,
    created_at: "2026-08-20T00:00:00.000Z",
    updated_at: "2026-08-20T00:00:00.000Z",
  };
}

function repository(): ChannelRepository {
  return {
    listChannels: vi.fn(async () => [channel()]),
    listManagementSnapshot: vi.fn(async () => ({
      channels: [channel()],
      branches: [],
      branchMappings: [],
      aliases: [],
    })),
    createChannel: vi.fn(async () => channel()),
    updateChannel: vi.fn(async () => channel()),
    upsertBranchMapping: vi.fn(async () => null),
    createAlias: vi.fn(async () => null),
  };
}

describe("channel service", () => {
  it("keeps operator mutation to branch mapping and normalizes aliases before persistence", async () => {
    const store = repository();
    const service = createChannelService(store);
    const context = { organizationId, actorId, role: "operator" as const };

    await expect(
      service.createChannel(context, {
        key: "talabat",
        displayName: "Talabat",
        category: "marketplace",
      }),
    ).rejects.toMatchObject({ code: "AUTHORIZATION_ERROR" });

    await expect(
      service.createAlias(context, channelId, { alias: " Talabat  UAE ", sourceScope: "manual" }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
    expect(store.createAlias).toHaveBeenCalledWith(
      expect.objectContaining({ normalizedAlias: "talabat uae", organizationId, actorId }),
    );
  });

  it("requires a channel to be in the caller's organization before returning an update", async () => {
    const store = repository();
    vi.mocked(store.updateChannel).mockResolvedValueOnce(null);
    const service = createChannelService(store);

    await expect(
      service.updateChannel({ organizationId, actorId, role: "admin" }, channelId, {
        status: "archived",
      }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });
});
