import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createAuthenticatedGrowthIntelligenceReadRepository,
  decodeClaimCursor,
  encodeClaimCursor,
} from "@/modules/growth-intelligence/infrastructure/read-repository";

const organizationId = "10000000-0000-4000-8000-000000000001";
const profileVersionId = "70000000-0000-4000-8000-000000000007";

type QueryResult = { data: unknown; error: unknown };

function persistence(results: Record<string, QueryResult[]> = {}) {
  const queues = new Map(Object.entries(results).map(([table, rows]) => [table, [...rows]]));
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; limit?: number }> = [];
  const from = vi.fn((table: string) => {
    const result = queues.get(table)?.shift() ?? { data: [], error: null };
    const call: { table: string; filters: Array<[string, unknown]>; limit?: number } = {
      table,
      filters: [],
    };
    calls.push(call);
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((key: string, value: unknown) => {
        call.filters.push([key, value]);
        return builder;
      }),
      in: vi.fn((key: string, value: unknown) => {
        call.filters.push([key, value]);
        return builder;
      }),
      or: vi.fn((value: unknown) => {
        call.filters.push(["or", value]);
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn((value: number) => {
        call.limit = value;
        return builder;
      }),
      maybeSingle: vi.fn(async () => result),
      then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  });
  return { client: { from } as never, calls, from };
}

function claimRow(overrides = {}) {
  return {
    id: "90000000-0000-4000-8000-000000000009",
    market_research_run_id: "40000000-0000-4000-8000-000000000004",
    market_profile_version_id: profileVersionId,
    claim_key: "tourism-demand",
    claim_digest: "b".repeat(64),
    subject_kind: "market",
    subject_ref: "dubai-market",
    claim_kind: "demand_signal",
    paraphrase: "A public market signal may affect local demand.",
    quotation: null,
    geographic_layer: "city",
    geography_ref: "ae:du",
    claim_category: "demand_trend",
    freshness_class: "standard",
    published_at: null,
    observed_at: "2026-09-01T09:00:00Z",
    stale_at: "2026-09-15T09:00:00Z",
    expires_at: "2026-10-01T09:00:00Z",
    limitations: ["BROADER_MARKET_INFERENCE"],
    created_at: "2026-09-02T06:00:00Z",
    ...overrides,
  };
}

describe("claim cursor", () => {
  it("round-trips through an opaque encoding and refuses tampered values", () => {
    const cursor = { createdAt: "2026-09-02T06:00:00Z", id: claimRow().id };
    expect(decodeClaimCursor(encodeClaimCursor(cursor))).toEqual(cursor);
    expect(decodeClaimCursor(null)).toBeNull();
    expect(decodeClaimCursor("not-a-cursor")).toBeNull();
    expect(decodeClaimCursor(encodeClaimCursor({ createdAt: "x", id: "y" }))).toBeNull();
  });
});

describe("authenticated Growth Intelligence read repository", () => {
  it("pages tenant-scoped claims newest-first with a next cursor on full pages", async () => {
    const db = persistence({
      market_evidence_claims: [{ data: [claimRow()], error: null }],
    });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    const page = await repository.listClaimPage({
      organizationId,
      profileVersionId,
      limit: 1,
    });

    expect(page.claims).toHaveLength(1);
    expect(page.claims[0]).toMatchObject({
      id: claimRow().id,
      subjectRef: "dubai-market",
      paraphrase: "A public market signal may affect local demand.",
    });
    expect(page.nextCursor).not.toBeNull();
    const filters = db.calls[0]!.filters;
    expect(filters).toContainEqual(["organization_id", organizationId]);
    expect(filters).toContainEqual(["market_profile_version_id", profileVersionId]);
    expect(db.calls[0]!.limit).toBe(2);
  });

  it("ends pagination without a cursor on short pages and resumes from cursors", async () => {
    const db = persistence({
      market_evidence_claims: [{ data: [], error: null }],
    });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);
    const cursor = encodeClaimCursor({ createdAt: "2026-09-02T06:00:00Z", id: claimRow().id });

    const page = await repository.listClaimPage({
      organizationId,
      profileVersionId,
      limit: 20,
      cursor,
    });

    expect(page).toEqual({ claims: [], nextCursor: null });
    expect(db.calls[0]!.filters.some(([key]) => key === "or")).toBe(true);
  });

  it("clamps page sizes to the bounded range", async () => {
    const db = persistence({
      market_evidence_claims: [
        { data: [], error: null },
        { data: [], error: null },
      ],
    });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    await repository.listClaimPage({ organizationId, profileVersionId, limit: 5_000 });
    await repository.listClaimPage({ organizationId, profileVersionId, limit: 0 });

    expect(db.calls[0]!.limit).toBe(51);
    expect(db.calls[1]!.limit).toBe(2);
  });

  it("skips batched reads when there is nothing to resolve", async () => {
    const db = persistence();
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    await expect(repository.listSourcesByRuns({ organizationId, runIds: [] })).resolves.toEqual([]);
    await expect(repository.listLinksByClaims({ organizationId, claimIds: [] })).resolves.toEqual(
      [],
    );
    await expect(repository.listEventsByClaims({ organizationId, claimIds: [] })).resolves.toEqual(
      [],
    );
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns null for a missing request and maps a stored one", async () => {
    const missing = persistence({
      growth_intelligence_requests: [{ data: null, error: null }],
    });
    const stored = persistence({
      growth_intelligence_requests: [
        {
          data: {
            id: "20000000-0000-4000-8000-000000000002",
            kind: "market_research",
            trigger_reason: "daily_due",
            status: "failed",
            due_at: "2026-09-02T06:00:00Z",
            safe_failure_code: "ADAPTER_UNAVAILABLE",
            correlation_id: "60000000-0000-4000-8000-000000000006",
            attempt_count: 1,
            max_attempts: 5,
          },
          error: null,
        },
      ],
    });

    await expect(
      createAuthenticatedGrowthIntelligenceReadRepository(missing.client).readRequest({
        organizationId,
        requestId: "20000000-0000-4000-8000-000000000002",
      }),
    ).resolves.toBeNull();
    const request = await createAuthenticatedGrowthIntelligenceReadRepository(
      stored.client,
    ).readRequest({
      organizationId,
      requestId: "20000000-0000-4000-8000-000000000002",
    });
    expect(request).toMatchObject({ kind: "market_research", status: "failed" });
  });

  it("scopes every batched read to the organization", async () => {
    const db = persistence({
      market_evidence_sources: [{ data: [], error: null }],
      market_evidence_links: [{ data: [], error: null }],
      market_evidence_claim_events: [{ data: [], error: null }],
      growth_intelligence_requests: [{ data: [], error: null }],
    });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    await repository.listSourcesByRuns({ organizationId, runIds: ["run-1"] });
    await repository.listLinksByClaims({ organizationId, claimIds: ["claim-1"] });
    await repository.listEventsByClaims({ organizationId, claimIds: ["claim-1"] });
    await repository.listRequests({ organizationId, limit: 20 });

    for (const call of db.calls) {
      expect(call.filters).toContainEqual(["organization_id", organizationId]);
    }
  });

  it("converts database failures into safe domain errors", async () => {
    const db = persistence({
      market_evidence_claims: [{ data: null, error: new Error("denied") }],
    });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    await expect(
      repository.listClaimPage({ organizationId, profileVersionId, limit: 20 }),
    ).rejects.toThrow("Market evidence could not be loaded.");
  });
});
