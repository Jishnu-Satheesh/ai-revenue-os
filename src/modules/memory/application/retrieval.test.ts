import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { sensitivityCeilingFor } from "@/domain/memory/purposes";
import type { MemorySearchRow } from "@/modules/memory/application/ports";
import { createMemoryRetrieval } from "@/modules/memory/application/retrieval";
import type { MemoryRepository } from "@/modules/memory/infrastructure/repository";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const CORRELATION_ID = "22222222-2222-4222-8222-222222222222";

function searchRow(overrides: Partial<MemorySearchRow> = {}): MemorySearchRow {
  return {
    id: "33333333-3333-4333-8333-333333333331",
    memory_type: "lesson",
    title: "Kitchen staffing limits evening service",
    body: "The owner confirmed staffing caps late orders.",
    structured_value: null,
    origin: "user_verified",
    source_tier: 1,
    source_system: null,
    source_reference: null,
    verification_state: "verified",
    verified_at: "2026-08-01T00:00:00.000Z",
    confidence: null,
    sensitivity: "internal",
    observed_at: "2026-08-01T00:00:00.000Z",
    effective_from: null,
    effective_to: null,
    superseded_by_id: null,
    trust_rank: 0,
    freshness: "fresh",
    lexical: 0.2,
    semantic: 0.1,
    blended: 0.15,
    ...overrides,
  };
}

function createRepository(overrides: Partial<MemoryRepository> = {}) {
  const logs: unknown[] = [];
  const repository = {
    search: async () => [searchRow()],
    searchFacts: async () => [],
    insertRetrievalLog: async (entry: unknown) => {
      logs.push(entry);
    },
    ...overrides,
  } as unknown as MemoryRepository;
  return { repository, logs };
}

function createRetrieval(
  repositoryOverrides: Partial<MemoryRepository> = {},
  embeddings: Parameters<typeof createMemoryRetrieval>[0]["embeddings"] = null,
) {
  const { repository, logs } = createRepository(repositoryOverrides);
  const retrieval = createMemoryRetrieval({
    repository,
    embeddings,
    ceilingFor: (query) =>
      query.purpose === "operator_search"
        ? sensitivityCeilingFor({ purpose: "operator_search", role: "operator" })
        : sensitivityCeilingFor({ purpose: query.purpose }),
    now: () => new Date("2026-08-09T12:00:00.000Z"),
  });
  return { retrieval, logs };
}

const baseQuery = {
  organizationId: ORGANIZATION_ID,
  purpose: "decision_context" as const,
  query: "kitchen staffing",
  sensitivityAllowance: "internal" as const,
  correlationId: CORRELATION_ID,
};

describe("createMemoryRetrieval", () => {
  it("denies a request above its purpose ceiling and returns no rows", async () => {
    const { retrieval, logs } = createRetrieval();

    await expect(
      retrieval.retrieve({ ...baseQuery, sensitivityAllowance: "customer_content" }),
    ).rejects.toMatchObject({ code: "MEMORY_SENSITIVITY_DENIED" });

    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ denied: true, result_count: 0 });
  });

  it("never runs the search when a request is denied", async () => {
    const search = vi.fn(async () => []);
    const { retrieval } = createRetrieval({ search } as never);

    await expect(
      retrieval.retrieve({ ...baseQuery, sensitivityAllowance: "confidential" }),
    ).rejects.toMatchObject({ code: "MEMORY_SENSITIVITY_DENIED" });

    expect(search).not.toHaveBeenCalled();
  });

  it("exposes provenance on every result", async () => {
    const { retrieval } = createRetrieval();

    const response = await retrieval.retrieve(baseQuery);

    expect(response.results).toHaveLength(1);
    expect(response.results[0].provenance).toMatchObject({
      origin: "user_verified",
      sourceTier: 1,
      verificationState: "verified",
    });
    expect(response.results[0].trustRank).toBe(0);
    expect(response.results[0].freshness).toBe("fresh");
  });

  it("logs every retrieval, including one that returns nothing", async () => {
    const { retrieval, logs } = createRetrieval({ search: async () => [] } as never);

    const response = await retrieval.retrieve(baseQuery);

    expect(response.results).toEqual([]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ result_count: 0, denied: false });
  });

  it("reports lexical mode with no embedding provider configured", async () => {
    const { retrieval } = createRetrieval();

    const response = await retrieval.retrieve(baseQuery);

    expect(response).toMatchObject({
      retrievalMode: "lexical",
      degradedReason: "EMBEDDING_NOT_CONFIGURED",
    });
  });

  it("degrades to lexical when the embedding provider times out, and still returns results", async () => {
    const embeddings = {
      model: "test",
      dimensions: 1536,
      embed: async () => {
        const error = new Error("timed out");
        error.name = "TimeoutError";
        throw error;
      },
    };
    const { retrieval } = createRetrieval({}, embeddings);

    const response = await retrieval.retrieve(baseQuery);

    expect(response.retrievalMode).toBe("lexical");
    expect(response.degradedReason).toBe("EMBEDDING_TIMEOUT");
    expect(response.results).toHaveLength(1);
  });

  it("degrades to lexical when the embedding provider errors", async () => {
    const embeddings = {
      model: "test",
      dimensions: 1536,
      embed: async () => {
        throw new Error("provider exploded");
      },
    };
    const { retrieval } = createRetrieval({}, embeddings);

    const response = await retrieval.retrieve(baseQuery);

    expect(response.degradedReason).toBe("EMBEDDING_UNAVAILABLE");
    expect(response.results).toHaveLength(1);
  });

  it("runs hybrid retrieval when the embedding succeeds", async () => {
    let searchParameters: { queryEmbedding: unknown } | undefined;
    const search = async (parameters: { queryEmbedding: unknown }) => {
      searchParameters = parameters;
      return [searchRow()];
    };
    const embeddings = {
      model: "test",
      dimensions: 1536,
      embed: async () => [Array.from({ length: 1536 }, () => 0.01)],
    };
    const { retrieval } = createRetrieval({ search } as never, embeddings);

    const response = await retrieval.retrieve(baseQuery);

    expect(response.retrievalMode).toBe("hybrid");
    expect(response.degradedReason).toBeUndefined();
    expect(searchParameters).toMatchObject({ queryEmbedding: expect.any(Array) });
  });

  it("does not fail the retrieval when the log write fails", async () => {
    const { retrieval } = createRetrieval({
      insertRetrievalLog: async () => {
        throw new Error("log unavailable");
      },
    } as never);

    await expect(retrieval.retrieve(baseQuery)).resolves.toMatchObject({
      results: expect.any(Array),
    });
  });

  it("keeps a verified fact above a semantically closer inference across both stores", async () => {
    const { retrieval } = createRetrieval({
      search: async () => [
        searchRow({
          id: "33333333-3333-4333-8333-333333333332",
          origin: "ai_proposed",
          verification_state: "unverified",
          source_tier: 5,
          trust_rank: 4,
          lexical: 0.99,
          semantic: 0.99,
          blended: 0.99,
        }),
      ],
      searchFacts: async () => [
        {
          id: "44444444-4444-4444-8444-444444444441",
          organization_id: ORGANIZATION_ID,
          branch_id: null,
          fact_key: "kitchen.staffing.cap",
          value: { staffing: "limited" },
          source: "user",
          source_reference: null,
          status: "verified" as const,
          confidence: 1,
          effective_from: null,
          effective_to: null,
          last_verified_at: "2026-08-01T00:00:00.000Z",
          updated_at: "2026-08-01T00:00:00.000Z",
        },
      ],
    } as never);

    const response = await retrieval.retrieve({ ...baseQuery, query: "kitchen staffing" });

    expect(response.results[0]).toMatchObject({
      memoryType: "structured_fact",
      itemId: null,
      trustRank: 0,
    });
    expect(response.results[1].trustRank).toBe(4);
    // The inference genuinely scores higher; trust is what demotes it.
    expect(response.results[1].scores.blended).toBeGreaterThan(response.results[0].scores.blended);
  });

  it("skips the fact projection when the caller asked only for memory types", async () => {
    const searchFacts = vi.fn(async () => []);
    const { retrieval } = createRetrieval({ searchFacts } as never);

    await retrieval.retrieve({ ...baseQuery, memoryTypes: ["lesson"] });

    expect(searchFacts).not.toHaveBeenCalled();
  });

  it("rejects a malformed query before touching the database", async () => {
    const search = vi.fn(async () => []);
    const { retrieval } = createRetrieval({ search } as never);

    await expect(retrieval.retrieve({ ...baseQuery, query: "" })).rejects.toBeInstanceOf(Error);
    expect(search).not.toHaveBeenCalled();
  });
});
