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

function workspacePersistence(results: Record<string, QueryResult[]> = {}) {
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
      lte: vi.fn((key: string, value: unknown) => {
        call.filters.push([`lte:${key}`, value]);
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

const actorId = "20000000-0000-4000-8000-000000000002";

function workspaceItemRow(overrides = {}) {
  return {
    id: "70000000-0000-4000-8000-000000000007",
    kind: "insight",
    narrative: "Delivery orders spike on rainy Thursdays.",
    item_fingerprint: "a".repeat(64),
    evidence_fingerprint: "b".repeat(64),
    support_grade: "corroborated",
    freshness: "current",
    urgency: "medium",
    goal_alignment: "direct",
    activity_month: "2026-09",
    status: "current",
    missing_input: null,
    created_at: "2026-09-02T08:00:00.000Z",
    ...overrides,
  };
}

function channelRecommendationRow(overrides = {}) {
  return {
    id: "60000000-0000-4000-8000-000000000006",
    channel_id: "61000000-0000-4000-8000-000000000061",
    branch_id: null,
    label: "recommendation",
    headline: "Extend Friday hours",
    detail: "Friday evenings carry the strongest observed demand.",
    window_start: "2026-08-01",
    window_end: "2026-08-31",
    created_at: "2026-09-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("workspace reads", () => {
  it("reads the organization's stored timezone", async () => {
    const db = workspacePersistence({
      organizations: [{ data: [{ default_timezone: "Asia/Dubai" }], error: null }],
    });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    await expect(repository.readOrganizationTimeZone(organizationId)).resolves.toBe(
      "Asia/Dubai",
    );
  });

  it("refuses to guess a timezone when none is stored", async () => {
    const db = workspacePersistence({ organizations: [{ data: [], error: null }] });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    await expect(repository.readOrganizationTimeZone(organizationId)).rejects.toThrow(
      /timezone/i,
    );
  });

  it("lists current items through the viewed month with their latest decision and pin", async () => {
    const db = workspacePersistence({
      growth_intelligence_items: [
        {
          data: [
            workspaceItemRow(),
            workspaceItemRow({
              id: "70000000-0000-4000-8000-000000000008",
              activity_month: "2026-07",
            }),
          ],
          error: null,
        },
      ],
      growth_intelligence_item_decisions: [
        {
          data: [
            {
              growth_intelligence_item_id: "70000000-0000-4000-8000-000000000007",
              actor_id: actorId,
              decision: "acknowledged",
              reason: null,
              snoozed_until: null,
              item_fingerprint: "a".repeat(64),
              created_at: "2026-09-03T08:00:00.000Z",
            },
          ],
          error: null,
        },
      ],
      growth_intelligence_item_preferences: [
        {
          data: [
            {
              growth_intelligence_item_id: "70000000-0000-4000-8000-000000000008",
              user_id: actorId,
              pinned: true,
            },
          ],
          error: null,
        },
      ],
    });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    const items = await repository.listWorkspaceItems({
      organizationId,
      actorId,
      throughMonth: "2026-09",
      limit: 100,
    });

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: "70000000-0000-4000-8000-000000000007" });
    expect(items[0]!.decision).toBe("acknowledged");
    expect(items[1]!.activityMonth).toBe("2026-07");
    expect(items[1]!.pinned).toBe(true);
    const itemQuery = db.calls.find((call) => call.table === "growth_intelligence_items")!;
    expect(itemQuery.filters).toContainEqual(["organization_id", organizationId]);
    expect(itemQuery.filters).toContainEqual(["status", "current"]);
    expect(itemQuery.filters).toContainEqual(["lte:activity_month", "2026-09"]);
  });

  it("lists channel recommendations with their latest owning-module decision and pin", async () => {
    const db = workspacePersistence({
      channel_recommendations: [{ data: [channelRecommendationRow()], error: null }],
      channel_recommendation_decisions: [
        {
          data: [
            {
              recommendation_id: "60000000-0000-4000-8000-000000000006",
              decision: "acknowledged",
              created_at: "2026-09-02T08:00:00.000Z",
            },
          ],
          error: null,
        },
      ],
      channel_recommendation_preferences: [
        {
          data: [
            {
              channel_recommendation_id: "60000000-0000-4000-8000-000000000006",
              user_id: actorId,
              pinned: false,
            },
          ],
          error: null,
        },
      ],
    });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    const rows = await repository.listChannelRecommendationRecords({
      organizationId,
      actorId,
      limit: 100,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: "60000000-0000-4000-8000-000000000006",
      label: "recommendation",
      windowStart: "2026-08-01",
      windowEnd: "2026-08-31",
      generatedAt: "2026-09-01T08:00:00.000Z",
    });
    expect(rows[0]!.decision).toEqual({
      decision: "acknowledged",
      createdAt: "2026-09-02T08:00:00.000Z",
    });
  });

  it("skips decision and pin lookups when there is nothing to resolve", async () => {
    const db = workspacePersistence({
      growth_intelligence_items: [{ data: [], error: null }],
      channel_recommendations: [{ data: [], error: null }],
    });
    const repository = createAuthenticatedGrowthIntelligenceReadRepository(db.client);

    await repository.listWorkspaceItems({
      organizationId,
      actorId,
      throughMonth: "2026-09",
      limit: 100,
    });
    await repository.listChannelRecommendationRecords({
      organizationId,
      actorId,
      limit: 100,
    });

    expect(db.calls.map((call) => call.table).sort()).toEqual([
      "channel_recommendations",
      "growth_intelligence_items",
    ]);
  });
});
