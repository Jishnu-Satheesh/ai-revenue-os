import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { MemoryItemRow, MemoryPersistencePort } from "@/modules/memory/application/ports";
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

  it("builds detail from only tenant-visible predecessors, successors, and link targets", async () => {
    const { port } = createPersistence();
    const root = {
      id: "root",
      organization_id: "org-1",
      sensitivity: "internal",
      superseded_by_id: "successor",
    } as MemoryItemRow;
    const successor = {
      id: "successor",
      organization_id: "org-1",
      sensitivity: "internal",
      superseded_by_id: null,
    } as MemoryItemRow;
    const predecessors = Array.from(
      { length: 40 },
      (_, index) =>
        ({
          id: `predecessor-${index}`,
          organization_id: "org-1",
          sensitivity: "internal",
          superseded_by_id: null,
        }) as MemoryItemRow,
    );
    const calls: string[] = [];
    Object.assign(port, {
      getItem: async ({ itemId }: { itemId: string }) => {
        calls.push(itemId);
        if (itemId === "root") return root;
        if (itemId === "successor") return successor;
        if (itemId === "visible-target") {
          return { id: "visible-target", sensitivity: "internal" } as MemoryItemRow;
        }
        return null;
      },
      listSupersessionPredecessors: async () => predecessors,
      listItemLinks: async () => [
        {
          id: "visible-link",
          organization_id: "org-1",
          from_item_id: "root",
          to_item_id: "visible-target",
          relation: "derived_from",
          created_by: null,
          created_at: "2026-08-09T00:00:00.000Z",
        },
        {
          id: "hidden-link",
          organization_id: "org-1",
          from_item_id: "root",
          to_item_id: "cross-tenant-target",
          relation: "supports",
          created_by: null,
          created_at: "2026-08-09T00:00:00.000Z",
        },
      ],
    });
    const repository = createMemoryRepository(port);

    const detail = await repository.getItemDetail({
      organizationId: "org-1",
      itemId: "root",
      sensitivities: ["public", "internal"],
    });

    expect(detail?.item.id).toBe("root");
    expect(detail?.chain).toHaveLength(32);
    expect(detail?.chain.some((item) => item.organization_id !== "org-1")).toBe(false);
    expect(detail?.links).toEqual([
      {
        id: "visible-link",
        relation: "derived_from",
        direction: "to",
        relatedItemId: "visible-target",
      },
    ]);
    expect(calls).toContain("visible-target");
    expect(calls).toContain("cross-tenant-target");
  });
});

describe("createSupabaseMemoryPersistence", () => {
  it("calls the authenticated promotion RPC with only scoped identifiers and flags", async () => {
    vi.resetModules();
    const rpc = vi.fn(async () => ({
      data: { itemId: "proposal-1", factId: "fact-1", promoted: true, replayed: false },
      error: null,
    }));
    const { createSupabaseMemoryPromotionTransactionPort } = await import(
      "@/modules/memory/infrastructure/persistence"
    );

    const transactions = createSupabaseMemoryPromotionTransactionPort({
      rpc,
    } as never);
    const result = await transactions.confirmProposal({
      organizationId: "org-1",
      actorId: "actor-1",
      itemId: "proposal-1",
      overrideVerified: true,
      idempotencyKey: "promotion-key-1",
      correlationId: "correlation-1",
    });

    expect(result).toEqual({
      itemId: "proposal-1",
      factId: "fact-1",
      promoted: true,
      replayed: false,
    });
    expect(rpc).toHaveBeenCalledWith("confirm_memory_fact_proposal", {
      p_organization_id: "org-1",
      p_actor_id: "actor-1",
      p_item_id: "proposal-1",
      p_override_verified: true,
      p_idempotency_key: "promotion-key-1",
      p_correlation_id: "correlation-1",
    });

    await transactions.rejectProposal({
      organizationId: "org-1",
      actorId: "actor-1",
      itemId: "proposal-1",
      reason: "The source is stale.",
      idempotencyKey: "rejection-key-1",
      correlationId: "correlation-2",
    });
    expect(rpc).toHaveBeenLastCalledWith("reject_memory_proposal", {
      p_organization_id: "org-1",
      p_actor_id: "actor-1",
      p_item_id: "proposal-1",
      p_reason: "The source is stale.",
      p_idempotency_key: "rejection-key-1",
      p_correlation_id: "correlation-2",
    });

    await transactions.supersede({
      organizationId: "org-1",
      actorId: "actor-1",
      itemId: "proposal-1",
      title: "Corrected note",
      body: "The previous note was stale.",
      sensitivity: "internal",
      reason: "The source was corrected.",
      idempotencyKey: "supersede-key-1",
      correlationId: "correlation-3",
    });
    expect(rpc).toHaveBeenLastCalledWith("supersede_memory_item", {
      p_organization_id: "org-1",
      p_actor_id: "actor-1",
      p_item_id: "proposal-1",
      p_title: "Corrected note",
      p_body: "The previous note was stale.",
      p_sensitivity: "internal",
      p_supersession_reason: "The source was corrected.",
      p_idempotency_key: "supersede-key-1",
      p_correlation_id: "correlation-3",
    });

    await transactions.createItem({
      organizationId: "org-1",
      actorId: "actor-1",
      memoryType: "note",
      title: "Idempotent note",
      body: undefined,
      branchId: undefined,
      sensitivity: "internal",
      markVerified: true,
      reviewDueAt: undefined,
      expiresAt: undefined,
      idempotencyKey: "create-key-1",
      correlationId: "correlation-4",
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "create_authenticated_memory_item",
      expect.objectContaining({
        p_organization_id: "org-1",
        p_actor_id: "actor-1",
        p_idempotency_key: "create-key-1",
        p_correlation_id: "correlation-4",
      }),
    );
  });

  it("projects a validated provider record through the scoped atomic RPC", async () => {
    vi.resetModules();
    const rpc = vi.fn(async () => ({ data: null, error: null }));
    const client = { from: vi.fn(), rpc };
    const { createSupabaseMemoryPersistence } = await import(
      "@/modules/memory/infrastructure/persistence"
    );

    await createSupabaseMemoryPersistence(client as never).projectGoogleBusinessProfileRecord({
      organizationId: "org-1",
      ingestionRunId: "run-1",
      sourceConnectionId: "connection-1",
      sourceSystem: "google_business_profile",
      sourceRecordId: "locations/opaque",
      title: "Google Business Profile location record",
      body: null,
      structuredValue: null,
      sensitivity: "internal",
      observedAt: "2026-08-09T00:00:00.000Z",
      locationFactValues: { "google_business_profile.location.hours": "09:00-17:00" },
    });

    expect(rpc).toHaveBeenCalledWith("project_google_business_profile_record", {
      p_organization_id: "org-1",
      p_ingestion_run_id: "run-1",
      p_source_connection_id: "connection-1",
      p_source_system: "google_business_profile",
      p_source_record_id: "locations/opaque",
      p_branch_id: null,
      p_location_fact_values: { "google_business_profile.location.hours": "09:00-17:00" },
      p_body: null,
      p_structured_value: null,
      p_sensitivity: "internal",
      p_observed_at: "2026-08-09T00:00:00.000Z",
      p_title: "Google Business Profile location record",
    });
  });

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
