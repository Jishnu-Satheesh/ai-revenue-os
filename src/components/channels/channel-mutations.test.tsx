// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  useChannelIdentityMutation,
  useChannelLocationMutation,
  useChannelReportLabelMutation,
  useChannelStatusMutation,
} from "@/components/channels/channel-mutations";

const organizationId = "11111111-1111-4111-8111-111111111111";
const channelId = "22222222-2222-4222-8222-222222222222";
const branchId = "44444444-4444-4444-8444-444444444444";

const channelResource = {
  id: channelId,
  organization_id: organizationId,
  key: "online-store",
  display_name: "Online store",
  category: "marketplace",
  template_key: null,
  status: "active",
  created_by: "33333333-3333-4333-8333-333333333333",
  archived_by: null,
  archived_at: null,
  created_at: "2026-09-10T00:00:00.000Z",
  updated_at: "2026-09-10T00:00:00.000Z",
};

const mappingResource = {
  id: "55555555-5555-4555-8555-555555555555",
  organization_id: organizationId,
  channel_id: channelId,
  branch_id: branchId,
  status: "active",
  effective_from: null,
  effective_to: null,
  created_by: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-09-10T00:00:00.000Z",
  updated_at: "2026-09-10T00:00:00.000Z",
};

const aliasResource = {
  id: "66666666-6666-4666-8666-666666666666",
  organization_id: organizationId,
  channel_id: channelId,
  alias: "Website orders",
  normalized_alias: "website orders",
  source_scope: "manual",
  source_record_reference: null,
  status: "active",
  effective_from: null,
  effective_to: null,
  confirmed_at: null,
  created_by: null,
  created_at: "2026-09-10T00:00:00.000Z",
  updated_at: "2026-09-10T00:00:00.000Z",
};

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function setup() {
  const client = new QueryClient();
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, fetchMock, wrapper };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("useChannelIdentityMutation", () => {
  it("creates a channel with the full identity and resolves the validated resource", async () => {
    const { fetchMock, wrapper, client } = setup();
    fetchMock.mockResolvedValue(jsonResponse({ channel: channelResource }, 201));

    const { result } = renderHook(
      () => useChannelIdentityMutation({ organizationId, channelId: null }),
      { wrapper },
    );
    const resolved = await result.current.mutateAsync({
      key: "Online-Store",
      displayName: "Online store",
      category: "marketplace",
      templateKey: null,
    });

    expect(resolved.id).toBe(channelId);
    expect(resolved.display_name).toBe("Online store");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/organizations/${organizationId}/channels`);
    expect(init.method).toBe("POST");
    // The domain schema normalizes the key (trim + lowercase) before send.
    expect(JSON.parse(String(init.body))).toEqual({
      key: "online-store",
      displayName: "Online store",
      category: "marketplace",
      templateKey: null,
    });
    expect(
      client.getMutationCache().findAll({
        mutationKey: ["channels", organizationId, "new", "identity"],
        exact: true,
      }),
    ).toHaveLength(1);
  });

  it("updates identity without ever submitting the stable key", async () => {
    const { fetchMock, wrapper, client } = setup();
    fetchMock.mockResolvedValue(jsonResponse({ channel: channelResource }));

    const { result } = renderHook(() => useChannelIdentityMutation({ organizationId, channelId }), {
      wrapper,
    });
    await result.current.mutateAsync({
      displayName: "Online storefront",
      category: "marketplace",
      templateKey: null,
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/organizations/${organizationId}/channels/${channelId}`);
    expect(init.method).toBe("PATCH");
    const sent = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(sent).not.toHaveProperty("key");
    expect(sent).not.toHaveProperty("status");
    expect(
      client.getMutationCache().findAll({
        mutationKey: ["channels", organizationId, channelId, "identity"],
        exact: true,
      }),
    ).toHaveLength(1);
  });

  it("surfaces the public envelope message on a non-2xx response", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "FORBIDDEN", message: "Only a manager can do this." } }, 403),
    );

    const { result } = renderHook(() => useChannelIdentityMutation({ organizationId, channelId }), {
      wrapper,
    });
    await expect(
      result.current.mutateAsync({ displayName: "Renamed", templateKey: null }),
    ).rejects.toThrow("Only a manager can do this.");
  });

  it("falls back to the safe message when the error envelope is missing", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockResolvedValue(jsonResponse({ unexpected: true }, 500));

    const { result } = renderHook(() => useChannelIdentityMutation({ organizationId, channelId }), {
      wrapper,
    });
    await expect(
      result.current.mutateAsync({ displayName: "Renamed", templateKey: null }),
    ).rejects.toThrow("The channel could not be saved. Please try again.");
  });

  it("treats a network rejection as a safe identity error", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));

    const { result } = renderHook(() => useChannelIdentityMutation({ organizationId, channelId }), {
      wrapper,
    });
    await expect(
      result.current.mutateAsync({ displayName: "Renamed", templateKey: null }),
    ).rejects.toThrow("The channel could not be saved. Please try again.");
  });

  it("treats a malformed non-JSON body as a safe error without leaking it", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockResolvedValue(
      new Response("<html>gateway blew up</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );

    const { result } = renderHook(() => useChannelIdentityMutation({ organizationId, channelId }), {
      wrapper,
    });
    const failure = await result.current
      .mutateAsync({ displayName: "Renamed", templateKey: null })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("The channel could not be saved. Please try again.");
    expect((failure as Error).message).not.toContain("gateway");
  });

  it("rejects a 2xx that returns another tenant's channel", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockResolvedValue(
      jsonResponse({
        channel: { ...channelResource, organization_id: "99999999-9999-4999-8999-999999999999" },
      }),
    );

    const { result } = renderHook(() => useChannelIdentityMutation({ organizationId, channelId }), {
      wrapper,
    });
    await expect(
      result.current.mutateAsync({ displayName: "Renamed", templateKey: null }),
    ).rejects.toThrow("The channel could not be saved. Please try again.");
  });

  it("rejects an empty success envelope that carries no channel", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockResolvedValue(jsonResponse({ ok: true }));

    const { result } = renderHook(() => useChannelIdentityMutation({ organizationId, channelId }), {
      wrapper,
    });
    await expect(
      result.current.mutateAsync({ displayName: "Renamed", templateKey: null }),
    ).rejects.toThrow("The channel could not be saved. Please try again.");
  });

  it("never auto-retries a failed write", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockRejectedValue(new TypeError("connection reset"));

    const { result } = renderHook(
      () => useChannelIdentityMutation({ organizationId, channelId: null }),
      { wrapper },
    );
    await expect(
      result.current.mutateAsync({
        key: "online-store",
        displayName: "Online store",
        category: "marketplace",
      }),
    ).rejects.toThrow();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useChannelStatusMutation", () => {
  it("archives with the requested status and resolves the validated channel", async () => {
    const { fetchMock, wrapper, client } = setup();
    fetchMock.mockResolvedValue(
      jsonResponse({ channel: { ...channelResource, status: "archived" } }),
    );

    const { result } = renderHook(() => useChannelStatusMutation({ organizationId, channelId }), {
      wrapper,
    });
    const resolved = await result.current.mutateAsync({ status: "archived" });

    expect(resolved.status).toBe("archived");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/organizations/${organizationId}/channels/${channelId}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ status: "archived" });
    expect(
      client.getMutationCache().findAll({
        mutationKey: ["channels", organizationId, channelId, "status"],
        exact: true,
      }),
    ).toHaveLength(1);
  });

  it("rejects when the returned status does not match the request", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockResolvedValue(jsonResponse({ channel: channelResource }));

    const { result } = renderHook(() => useChannelStatusMutation({ organizationId, channelId }), {
      wrapper,
    });
    await expect(result.current.mutateAsync({ status: "archived" })).rejects.toThrow(
      "The channel status could not be changed. Please try again.",
    );
  });

  it("surfaces the public envelope message and never retries", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { code: "FORBIDDEN", message: "Managers only." } }, 403),
    );

    const { result } = renderHook(() => useChannelStatusMutation({ organizationId, channelId }), {
      wrapper,
    });
    await expect(result.current.mutateAsync({ status: "archived" })).rejects.toThrow(
      "Managers only.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useChannelLocationMutation", () => {
  it("saves one mapping via PUT and resolves the validated record", async () => {
    const { fetchMock, wrapper, client } = setup();
    fetchMock.mockResolvedValue(jsonResponse({ mapping: mappingResource }));

    const { result } = renderHook(() => useChannelLocationMutation({ organizationId, channelId }), {
      wrapper,
    });
    const resolved = await result.current.mutateAsync({
      branchId,
      applicability: "active",
      effectiveFrom: null,
      effectiveTo: null,
    });

    expect(resolved.id).toBe(mappingResource.id);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/organizations/${organizationId}/channels/${channelId}/branches`);
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({
      branchId,
      applicability: "active",
      effectiveFrom: null,
      effectiveTo: null,
    });
    expect(
      client.getMutationCache().findAll({
        mutationKey: ["channels", organizationId, channelId, "location"],
        exact: true,
      }),
    ).toHaveLength(1);
  });

  it("rejects a mapping that belongs to another channel", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockResolvedValue(
      jsonResponse({
        mapping: { ...mappingResource, channel_id: "88888888-8888-4888-8888-888888888888" },
      }),
    );

    const { result } = renderHook(() => useChannelLocationMutation({ organizationId, channelId }), {
      wrapper,
    });
    await expect(result.current.mutateAsync({ branchId, applicability: "active" })).rejects.toThrow(
      "The location mapping could not be saved. Please try again.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("useChannelReportLabelMutation", () => {
  it("saves one exact label via POST and resolves the validated record", async () => {
    const { fetchMock, wrapper, client } = setup();
    fetchMock.mockResolvedValue(jsonResponse({ alias: aliasResource }, 201));

    const { result } = renderHook(
      () => useChannelReportLabelMutation({ organizationId, channelId }),
      { wrapper },
    );
    const resolved = await result.current.mutateAsync({
      alias: "Website orders",
      sourceScope: "manual",
    });

    expect(resolved.id).toBe(aliasResource.id);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`/api/organizations/${organizationId}/channels/${channelId}/aliases`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      alias: "Website orders",
      sourceScope: "manual",
      effectiveFrom: null,
      effectiveTo: null,
    });
    expect(
      client.getMutationCache().findAll({
        mutationKey: ["channels", organizationId, channelId, "report-label"],
        exact: true,
      }),
    ).toHaveLength(1);
  });

  it("rejects a 201 that carries no alias and never retries", async () => {
    const { fetchMock, wrapper } = setup();
    fetchMock.mockResolvedValue(jsonResponse({}, 201));

    const { result } = renderHook(
      () => useChannelReportLabelMutation({ organizationId, channelId }),
      { wrapper },
    );
    await expect(
      result.current.mutateAsync({ alias: "Website orders", sourceScope: "manual" }),
    ).rejects.toThrow("The report label could not be saved. Please try again.");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
