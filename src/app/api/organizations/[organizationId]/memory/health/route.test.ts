import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/lib/errors";

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

import { GET as getHealth } from "@/app/api/organizations/[organizationId]/memory/health/route";

const organizationId = "11111111-1111-4111-8111-111111111111";

type FakeConfig = {
  rows: Record<string, unknown[]>;
  count: Record<string, number>;
};

function supabaseFake(config: FakeConfig) {
  const makeChain = (table: string): unknown => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.order = () => chain;
    chain.limit = async () => ({ data: config.rows[table] ?? [], error: null });
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null, count: config.count[table] ?? 0 }).then(resolve);
    return chain;
  };
  return { from: (table: string) => makeChain(table) };
}

function organizationParams() {
  return { params: Promise.resolve({ organizationId }) };
}

function contextWith(role: string, supabase: unknown) {
  mocks.getOrganizationContext.mockResolvedValue({
    organizationId,
    user: { id: "user-1" },
    membership: { role },
    supabase,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.createMemoryWorkspaceApi.mockReturnValue({ service: {}, retrieval: {} });
});

describe("memory health route", () => {
  it("returns bounded per-adapter counts with real embedding backlog, no snippets", async () => {
    contextWith(
      "owner",
      supabaseFake({
        rows: {
          memory_capture_events: [
            { source_kind: "channel_finding", status: "pending", completed_at: null },
            { source_kind: "channel_finding", status: "completed", completed_at: "2026-09-11T10:00:00.000Z" },
            { source_kind: "channel_finding", status: "failed", completed_at: null },
          ],
          memory_context_manifests: [
            { purpose: "channel_advice", status: "ready", as_of: "2026-09-11T00:00:00.000Z" },
          ],
        },
        count: { memory_items: 7 },
      }),
    );

    const response = await getHealth(new Request("http://localhost/memory/health"), organizationParams());
    const body = (await response.json()) as {
      health: {
        adapters: { sourceKind: string; pending: number; completed: number; backlog: number; retryable: number }[];
        contexts: { purpose: string; ready: number; total: number }[];
        embeddingBacklog: number;
        canRetry: boolean;
      };
    };

    expect(response.status).toBe(200);
    expect(body.health.adapters).toEqual([
      expect.objectContaining({ sourceKind: "channel_finding", pending: 1, completed: 1, backlog: 1, retryable: 1 }),
    ]);
    expect(body.health.contexts).toEqual([
      expect.objectContaining({ purpose: "channel_advice", ready: 1, total: 1 }),
    ]);
    expect(body.health.embeddingBacklog).toBe(7);
    expect(body.health.canRetry).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Two staff on Fridays");
  });

  it("hides retry affordances from viewers while keeping counts", async () => {
    contextWith(
      "viewer",
      supabaseFake({
        rows: {
          memory_capture_events: [{ source_kind: "channel_finding", status: "failed", completed_at: null }],
          memory_context_manifests: [],
        },
        count: {},
      }),
    );

    const response = await getHealth(new Request("http://localhost/memory/health"), organizationParams());
    const body = (await response.json()) as {
      health: { adapters: { failed: number; retryable: number }[]; canRetry: boolean; canConfigure: boolean };
    };

    expect(response.status).toBe(200);
    expect(body.health.adapters[0]).toMatchObject({ failed: 1, retryable: 0 });
    expect(body.health.canRetry).toBe(false);
    expect(body.health.canConfigure).toBe(false);
  });

  it("rejects a non-member before any count is read", async () => {
    mocks.getOrganizationContext.mockRejectedValueOnce(
      new DomainError("AUTHORIZATION_ERROR", "You do not have access to this organization."),
    );

    const response = await getHealth(new Request("http://localhost/memory/health"), organizationParams());

    expect(response.status).toBe(403);
  });
});
