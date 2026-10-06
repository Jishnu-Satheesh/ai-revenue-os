import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  getOrganizationContext: vi.fn(),
  createMemoryWorkspaceApi: vi.fn(),
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

import { GET as getContext } from "@/app/api/organizations/[organizationId]/memory/contexts/[manifestId]/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const manifestId = "44444444-4444-4444-8444-444444444444";

function supabaseFake(manifest: unknown, entries: unknown[]) {
  const makeChain = (table: string): unknown => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = async () => ({ data: table === "memory_context_entries" ? entries : [], error: null });
    chain.maybeSingle = async () => ({ data: table === "memory_context_manifests" ? manifest : null, error: null });
    return chain;
  };
  return { from: (table: string) => makeChain(table) };
}

function contextParams() {
  return { params: Promise.resolve({ organizationId, manifestId }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createMemoryWorkspaceApi.mockReturnValue({ service: {}, retrieval: {} });
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role: "operator" },
    supabase: supabaseFake(null, []),
  });
});

describe("memory context manifest route", () => {
  it("returns the safe visible manifest with mapped entries", async () => {
    mocks.getOrganizationContext.mockResolvedValueOnce({
      organizationId,
      user: { id: "user-1" },
      membership: { role: "operator" },
      supabase: supabaseFake(
        {
          id: manifestId,
          status: "ready",
          policy_version: "shared-context-v1",
          selected_count: 1,
          as_of: "2026-09-11T00:00:00.000Z",
        },
        [
          {
            context_ref: "ctx-0001",
            source_kind: "business_fact",
            memory_item_id: null,
            capture_event_id: null,
            business_fact_id: "55555555-5555-4555-8555-555555555555",
            business_profile_id: null,
            goal_id: null,
            constraint_id: null,
            campaign_version_id: null,
            observed_at: null,
            safe_snapshot: { title: "Average ticket", summary: "avg_ticket [verified] pos :: 42" },
          },
        ],
      ),
    });

    const response = await getContext(new Request("http://localhost/memory/contexts/x"), contextParams());
    const body = (await response.json()) as {
      manifest: { id: string; status: string; policyVersion: string; selectedCount: number };
      entries: { contextRef: string; title: string; summary: string; sourceKind: string; sourceId: string }[];
    };

    expect(response.status).toBe(200);
    expect(body.manifest).toMatchObject({ id: manifestId, status: "ready", selectedCount: 1 });
    expect(body.entries).toEqual([
      expect.objectContaining({
        contextRef: "ctx-0001",
        title: "Average ticket",
        sourceKind: "business_fact",
        sourceId: "55555555-5555-4555-8555-555555555555",
      }),
    ]);
  });

  it("maps an unknown manifest to a safe 404", async () => {
    const response = await getContext(new Request("http://localhost/memory/contexts/x"), contextParams());
    const body = (await response.json()) as { error: { code: string; message: string } };

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a malformed manifest id before any read", async () => {
    const response = await getContext(new Request("http://localhost/memory/contexts/x"), {
      params: Promise.resolve({ organizationId, manifestId: "not-a-uuid" }),
    });

    expect(response.status).toBe(400);
  });
});
