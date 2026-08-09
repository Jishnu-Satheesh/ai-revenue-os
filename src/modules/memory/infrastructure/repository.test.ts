import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MemoryPersistencePort } from "@/modules/memory/application/ports";
import {
  createMemoryRepository,
  MAX_RETRIEVAL_LIMIT,
} from "@/modules/memory/infrastructure/repository";

function createPersistence(): {
  port: MemoryPersistencePort;
  calls: Record<string, unknown[]>;
} {
  const calls: Record<string, unknown[]> = {};
  const record =
    <T>(name: string, result: T) =>
    async (input: unknown) => {
      calls[name] = [...(calls[name] ?? []), input];
      return result;
    };

  return {
    calls,
    port: {
      search: record("search", []),
      searchFacts: record("searchFacts", []),
      hydrateByIds: record("hydrateByIds", []),
      getItem: record("getItem", null),
      listTimeline: record("listTimeline", []),
      listByTypes: record("listByTypes", []),
      listLinks: record("listLinks", []),
      insertItem: record("insertItem", {} as never),
      updateItem: record("updateItem", {} as never),
      insertLinks: record("insertLinks", undefined),
      insertRetrievalLog: record("insertRetrievalLog", undefined),
      countsFor: record("countsFor", {} as never),
    } as unknown as MemoryPersistencePort,
  };
}

const searchInput = {
  organizationId: "org-1",
  query: "kitchen staffing",
  queryEmbedding: null,
  sensitivities: ["public", "internal"] as const,
  includeSuperseded: false,
  includeExpired: false,
  lexicalWeight: 0.5,
  semanticWeight: 0.5,
  limit: 20,
};

describe("createMemoryRepository", () => {
  it("refuses every operation without an organization scope", async () => {
    const { port } = createPersistence();
    const repository = createMemoryRepository(port);

    await expect(repository.search({ ...searchInput, organizationId: "" })).rejects.toMatchObject({
      code: "TENANT_SCOPE_ERROR",
    });
    await expect(repository.getItem({ organizationId: "  ", itemId: "a" })).rejects.toMatchObject({
      code: "TENANT_SCOPE_ERROR",
    });
    await expect(repository.countsFor({ organizationId: "" })).rejects.toMatchObject({
      code: "TENANT_SCOPE_ERROR",
    });
  });

  it("caps the retrieval limit so a caller cannot request an unbounded page", async () => {
    const { port, calls } = createPersistence();
    const repository = createMemoryRepository(port);

    await repository.search({ ...searchInput, limit: 5_000 });

    expect((calls.search[0] as { limit: number }).limit).toBe(MAX_RETRIEVAL_LIMIT);
  });

  it("treats an empty sensitivity allowance as nothing permitted, never as no filter", async () => {
    const { port, calls } = createPersistence();
    const repository = createMemoryRepository(port);

    await expect(repository.search({ ...searchInput, sensitivities: [] })).resolves.toEqual([]);
    await expect(
      repository.hydrateByIds({
        organizationId: "org-1",
        ids: ["a"],
        sensitivities: [],
        includeSuperseded: false,
        includeExpired: false,
      }),
    ).resolves.toEqual([]);
    await expect(
      repository.listTimeline({ organizationId: "org-1", sensitivities: [], limit: 10 }),
    ).resolves.toEqual([]);

    expect(calls.search).toBeUndefined();
    expect(calls.hydrateByIds).toBeUndefined();
    expect(calls.listTimeline).toBeUndefined();
  });

  it("passes the caller's sensitivity allowance through to hydration unchanged", async () => {
    const { port, calls } = createPersistence();
    const repository = createMemoryRepository(port);

    await repository.hydrateByIds({
      organizationId: "org-1",
      ids: ["a", "b"],
      sensitivities: ["public", "internal"],
      includeSuperseded: false,
      includeExpired: false,
    });

    expect(calls.hydrateByIds[0]).toMatchObject({
      organizationId: "org-1",
      sensitivities: ["public", "internal"],
    });
  });

  it("refuses to write links that belong to another organization", async () => {
    const { port } = createPersistence();
    const repository = createMemoryRepository(port);

    await expect(
      repository.insertLinks({
        organizationId: "org-1",
        links: [
          {
            organization_id: "org-2",
            from_item_id: "a",
            to_item_id: "b",
            relation: "derived_from",
            created_by: null,
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "TENANT_SCOPE_ERROR" });
  });

  it("truncates logged query text and bounds the recorded result ids", async () => {
    const { port, calls } = createPersistence();
    const repository = createMemoryRepository(port);

    await repository.insertRetrievalLog({
      organization_id: "org-1",
      purpose: "operator_search",
      actor_type: "user",
      query_text: "x".repeat(900),
      retrieval_mode: "lexical",
      sensitivity_allowance: "internal",
      result_count: 200,
      result_item_ids: Array.from({ length: 200 }, (_, index) => `id-${index}`),
      correlation_id: "correlation-1",
    });

    const logged = calls.insertRetrievalLog[0] as {
      query_text: string;
      result_item_ids: string[];
    };
    expect(logged.query_text).toHaveLength(500);
    expect(logged.result_item_ids).toHaveLength(MAX_RETRIEVAL_LIMIT);
  });

  it("hydrates at most one page of identifiers even if a cached ranking is oversized", async () => {
    const { port, calls } = createPersistence();
    const repository = createMemoryRepository(port);

    await repository.hydrateByIds({
      organizationId: "org-1",
      ids: Array.from({ length: 500 }, (_, index) => `id-${index}`),
      sensitivities: ["internal"],
      includeSuperseded: false,
      includeExpired: false,
    });

    expect((calls.hydrateByIds[0] as { ids: string[] }).ids).toHaveLength(MAX_RETRIEVAL_LIMIT);
  });
});

describe("createSupabaseMemoryPersistence", () => {
  it("never selects the embedding or the search vector", async () => {
    vi.resetModules();
    const selected: string[] = [];
    const builder = {
      select: (columns: string) => {
        selected.push(columns);
        return builder;
      },
      eq: () => builder,
      in: () => builder,
      is: () => builder,
      or: () => builder,
      lt: () => builder,
      gte: () => builder,
      ilike: () => builder,
      order: () => builder,
      limit: () => builder,
      single: async () => ({ data: null, error: null }),
      maybeSingle: async () => ({ data: null, error: null }),
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
        resolve({ data: [], error: null }),
    };
    const client = {
      from: () => builder,
      rpc: async () => ({ data: [], error: null }),
    };

    const { createSupabaseMemoryPersistence } = await import(
      "@/modules/memory/infrastructure/persistence"
    );
    const persistence = createSupabaseMemoryPersistence(client as never);

    await persistence.listTimeline({
      organizationId: "org-1",
      sensitivities: ["internal"],
      limit: 10,
    });
    await persistence.getItem({ organizationId: "org-1", itemId: "item-1" });

    expect(selected.length).toBeGreaterThan(0);
    for (const columns of selected) {
      expect(columns).not.toContain("embedding,");
      expect(columns).not.toContain("search_vector");
    }
  });
});
