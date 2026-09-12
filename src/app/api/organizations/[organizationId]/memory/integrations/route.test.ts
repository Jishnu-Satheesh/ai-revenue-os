import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createMemoryWorkspaceApi: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/api/organization-context", () => ({
  getOrganizationContext: mocks.getOrganizationContext,
}));

vi.mock("@/modules/memory/infrastructure/embedding-provider", () => ({
  createEmbeddingProvider: () => null,
}));

vi.mock("@/modules/memory/application/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/modules/memory/application/api")>();
  return { ...actual, createMemoryWorkspaceApi: mocks.createMemoryWorkspaceApi };
});

import { PATCH as patchIntegrations } from "@/app/api/organizations/[organizationId]/memory/integrations/route";

const organizationId = "11111111-1111-4111-8111-111111111111";

function organizationParams() {
  return { params: Promise.resolve({ organizationId }) };
}

function jsonRequest(body: unknown) {
  return new Request("http://localhost/memory/integrations", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const explicitBody = {
  captureEnabled: true,
  channelContextEnabled: true,
  growthContextEnabled: false,
  campaignContextEnabled: false,
  subjectContextEnabled: false,
  legacyCorpusQualified: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createMemoryWorkspaceApi.mockReturnValue({ service: {}, retrieval: {} });
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "owner" },
    supabase: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({
    data: {
      organizationId,
      captureEnabled: true,
      contextPolicyVersion: "shared-context-v1",
    },
    error: null,
  });
});

describe("memory integrations route", () => {
  it("saves explicit booleans through the fenced RPC and returns safe fields only", async () => {
    const response = await patchIntegrations(jsonRequest(explicitBody), organizationParams());
    const body = (await response.json()) as {
      settings: { organizationId: string; captureEnabled: boolean; contextPolicyVersion: string };
    };

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "update_memory_integration_settings",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_id: "user-1",
        p_capture_enabled: true,
        p_channel_context_enabled: true,
        p_growth_context_enabled: false,
        p_legacy_corpus_qualified: false,
      }),
    );
    expect(body.settings).toEqual({
      organizationId,
      captureEnabled: true,
      contextPolicyVersion: "shared-context-v1",
    });
  });

  it("refuses an operator before the RPC is reached", async () => {
    mocks.getOrganizationContext.mockResolvedValueOnce({
      organizationId,
      user: { id: "viewer-1" },
      membership: { role: "operator" },
      supabase: { rpc: mocks.rpc },
    });

    const response = await patchIntegrations(jsonRequest(explicitBody), organizationParams());

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("refuses a missing boolean rather than guessing a default", async () => {
    const { legacyCorpusQualified: _dropped, ...withoutOne } = explicitBody;

    const response = await patchIntegrations(jsonRequest(withoutOne), organizationParams());

    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps a database refusal to an explicit error, never a silent success", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "denied" } });

    const response = await patchIntegrations(jsonRequest(explicitBody), organizationParams());

    expect(response.status).toBe(403);
  });
});
