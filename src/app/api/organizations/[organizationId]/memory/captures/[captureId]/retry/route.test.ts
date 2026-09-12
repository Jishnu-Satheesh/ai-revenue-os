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

import { POST as retryCapture } from "@/app/api/organizations/[organizationId]/memory/captures/[captureId]/retry/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const captureId = "22222222-2222-4222-8222-222222222222";

function captureParams() {
  return { params: Promise.resolve({ organizationId, captureId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createMemoryWorkspaceApi.mockReturnValue({ service: {}, retrieval: {} });
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "owner" },
    supabase: { rpc: mocks.rpc },
  });
  mocks.rpc.mockResolvedValue({ data: { captureId, status: "pending" }, error: null });
});

describe("memory capture retry route", () => {
  it("requeues an identifier-only request and returns identifiers plus status", async () => {
    const response = await retryCapture(
      new Request("http://localhost/memory/captures/x/retry", { method: "POST" }),
      captureParams(),
    );
    const body = (await response.json()) as { captureId: string; status: string };

    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith(
      "retry_memory_capture",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_id: "user-1",
        p_capture_id: captureId,
      }),
    );
    expect(body).toEqual({ captureId, status: "pending" });
  });

  it("refuses a viewer before the RPC is reached", async () => {
    mocks.getOrganizationContext.mockResolvedValueOnce({
      organizationId,
      user: { id: "viewer-1" },
      membership: { role: "viewer" },
      supabase: { rpc: mocks.rpc },
    });

    const response = await retryCapture(
      new Request("http://localhost/memory/captures/x/retry", { method: "POST" }),
      captureParams(),
    );

    expect(response.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("maps an unknown capture to a safe 404", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0002", message: "not found" } });

    const response = await retryCapture(
      new Request("http://localhost/memory/captures/x/retry", { method: "POST" }),
      captureParams(),
    );
    const body = (await response.json()) as { error: { message: string } };

    expect(response.status).toBe(404);
    expect(body.error.message).not.toContain("P0002");
  });

  it("reports a non-retryable capture explicitly instead of a new success", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "not retryable" } });

    const response = await retryCapture(
      new Request("http://localhost/memory/captures/x/retry", { method: "POST" }),
      captureParams(),
    );

    expect(response.status).toBe(409);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});
