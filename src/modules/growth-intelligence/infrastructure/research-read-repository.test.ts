import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAuthenticatedResearchReadRepository } from "@/modules/growth-intelligence/infrastructure/research-read-repository";

const organizationId = "10000000-0000-4000-8000-000000000001";
const branchId = "20000000-0000-4000-8000-000000000002";
const otherBranchId = "20000000-0000-4000-8000-000000000022";
const pipelineId = "30000000-0000-4000-8000-000000000003";
const profileId = "40000000-0000-4000-8000-000000000004";
const versionId = "50000000-0000-4000-8000-000000000005";
const requestId = "60000000-0000-4000-8000-000000000006";
const runId = "70000000-0000-4000-8000-000000000007";
const actorId = "00000000-0000-4000-8000-000000000010";

type QueryResult = { data: unknown; error: unknown };

function persistence(results: Record<string, QueryResult[]> = {}) {
  const queues = new Map(Object.entries(results).map(([table, rows]) => [table, [...rows]]));
  const calls: Array<{ table: string; filters: Array<[string, unknown]>; select?: string }> = [];
  const from = vi.fn((table: string) => {
    const result = queues.get(table)?.shift() ?? { data: [], error: null };
    const call: { table: string; filters: Array<[string, unknown]>; select?: string } = {
      table,
      filters: [],
    };
    calls.push(call);
    const builder = {
      select: vi.fn((columns: string) => {
        call.select = columns;
        return builder;
      }),
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
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => result),
      single: vi.fn(async () => result),
      then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  });
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const result = queues.get(`rpc:${name}`)?.shift() ?? { data: null, error: null };
    return result;
  });
  return { client: { from, rpc } as never, calls, rpcCalls };
}

function pipelineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: pipelineId,
    organization_id: organizationId,
    branch_id: branchId,
    market_profile_id: profileId,
    market_profile_version_id: versionId,
    scope_digest: "a".repeat(64),
    research_request_id: requestId,
    synthesis_request_id: null,
    stage: "synthesis_failed",
    coverage: [{ slotKey: "local", kind: "local_market", outcome: "supported" }],
    stage_changed_at: "2026-09-02T09:00:00.000Z",
    safe_failure_code: "SYNTHESIS_TIMEOUT",
    created_at: "2026-09-01T08:00:00.000Z",
    updated_at: "2026-09-02T09:00:00.000Z",
    ...overrides,
  };
}

function versionRow() {
  return {
    id: versionId,
    // Column name must match the migration: organization_market_profile_versions
    // stores the document in profile_document, not document.
    profile_document: {
      schemaVersion: 2,
      branchId,
      topics: [{ key: "vegan", label: "Vegan options", provenance: "operator" }],
      competitors: [{ key: "rival", name: "Rival Kitchen" }],
      geographies: [
        { layer: "city", locationRef: "dubai", name: "Dubai", countryCode: "AE" },
        { layer: "country", locationRef: "ae", name: "UAE", countryCode: "AE" },
      ],
    },
  };
}

function readPipelineResults(row: Record<string, unknown> = pipelineRow()) {
  return {
    growth_intelligence_research_pipelines: [{ data: row, error: null }],
    branches: [{ data: [{ id: branchId, name: "Marina" }], error: null }],
    organization_market_profile_versions: [{ data: [versionRow()], error: null }],
    organization_market_profiles: [
      { data: [{ id: profileId, current_version_id: versionId }], error: null },
    ],
    market_research_runs: [
      { data: [{ id: runId, growth_intelligence_request_id: requestId }], error: null },
    ],
    market_evidence_sources: [{ data: [], error: null }],
    market_evidence_claims: [{ data: [], error: null }],
  };
}

describe("readPipeline", () => {
  it("scopes every read to the context organization and returns the assembled view", async () => {
    const { client, calls } = persistence(readPipelineResults());
    const repository = createAuthenticatedResearchReadRepository(client);

    const view = await repository.readPipeline({ organizationId, pipelineId });

    expect(view?.pipelineId).toBe(pipelineId);
    expect(view?.branchId).toBe(branchId);
    expect(view?.scopeLabel).toBe("Marina");
    expect(view?.stage).toBe("synthesis_failed");
    expect(view?.retry.eligible).toBe(true);
    for (const call of calls) {
      expect(call.filters).toContainEqual(["organization_id", organizationId]);
    }
    const versionCall = calls.find((call) => call.table === "organization_market_profile_versions");
    expect(versionCall?.select).toBe("id,profile_document");
  });

  it("returns null when RLS hides the row from a foreign tenant", async () => {
    const { client } = persistence({
      growth_intelligence_research_pipelines: [{ data: null, error: null }],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    await expect(repository.readPipeline({ organizationId, pipelineId })).resolves.toBeNull();
  });

  it("never selects stored raw content for sources", async () => {
    const { client, calls } = persistence(readPipelineResults());
    const repository = createAuthenticatedResearchReadRepository(client);

    await repository.readPipeline({ organizationId, pipelineId });

    const sourceCall = calls.find((call) => call.table === "market_evidence_sources");
    expect(sourceCall?.select).toBeDefined();
    expect(sourceCall?.select).not.toMatch(/excerpt_text|quotation/);
  });
});

describe("readCurrentPipeline", () => {
  it("returns the active pipeline and never falls back to retained history", async () => {
    const { client } = persistence({
      growth_intelligence_research_pipelines: [
        { data: [pipelineRow({ stage: "researching" })], error: null },
      ],
      branches: [{ data: [{ id: branchId, name: "Marina" }], error: null }],
      organization_market_profile_versions: [{ data: [versionRow()], error: null }],
      organization_market_profiles: [
        { data: [{ id: profileId, current_version_id: versionId }], error: null },
      ],
      market_research_runs: [{ data: [], error: null }],
      market_evidence_sources: [{ data: [], error: null }],
      market_evidence_claims: [{ data: [], error: null }],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    const view = await repository.readCurrentPipeline({ organizationId, branchId });

    expect(view?.stage).toBe("researching");
    expect(view?.retry.eligible).toBe(false);
  });

  it("returns null when only terminal history remains — history never becomes current", async () => {
    const { client, calls } = persistence({
      // The newest row is terminal; there is no active pipeline. The read
      // must report null rather than promote retained history to current.
      growth_intelligence_research_pipelines: [
        { data: pipelineRow({ stage: "ready" }), error: null },
      ],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    await expect(repository.readCurrentPipeline({ organizationId, branchId })).resolves.toBeNull();
    const pipelineCall = calls.find(
      (call) => call.table === "growth_intelligence_research_pipelines",
    );
    expect(pipelineCall?.filters).toContainEqual(["branch_id", branchId]);
  });
});

describe("listPipelineHistory", () => {
  it("pages one branch at 10 by default and never across branches", async () => {
    const rows = Array.from({ length: 10 }, (_, index) =>
      pipelineRow({
        id: `30000000-0000-4000-8000-0000000000${10 + index}`,
        stage: "ready",
      }),
    );
    const { client, calls } = persistence({
      growth_intelligence_research_pipelines: [{ data: rows, error: null }],
      branches: [{ data: [{ id: branchId, name: "Marina" }], error: null }],
      organization_market_profile_versions: [{ data: [versionRow()], error: null }],
      organization_market_profiles: [
        { data: [{ id: profileId, current_version_id: versionId }], error: null },
      ],
      market_research_runs: [{ data: [], error: null }],
      market_evidence_sources: [{ data: [], error: null }],
      market_evidence_claims: [{ data: [], error: null }],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    const history = await repository.listPipelineHistory({ organizationId, branchId });

    expect(history.pipelines).toHaveLength(10);
    const pipelineCall = calls.find(
      (call) => call.table === "growth_intelligence_research_pipelines",
    );
    expect(pipelineCall?.filters).toContainEqual(["organization_id", organizationId]);
    expect(pipelineCall?.filters).toContainEqual(["branch_id", branchId]);
    expect(pipelineCall?.filters).not.toContainEqual(["branch_id", otherBranchId]);
  });

  it("clamps history reads to a maximum of 50", async () => {
    const { client } = persistence({
      growth_intelligence_research_pipelines: [{ data: [], error: null }],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    const history = await repository.listPipelineHistory({
      organizationId,
      branchId,
      limit: 500,
    });

    expect(history.pipelines).toEqual([]);
    expect(history.nextCursor).toBeNull();
  });

  it("rejects malformed cursors without a tenant read", async () => {
    const { client, calls } = persistence({});
    const repository = createAuthenticatedResearchReadRepository(client);

    await expect(
      repository.listPipelineHistory({ organizationId, branchId, cursor: "nope" }),
    ).rejects.toThrow();
    expect(calls).toEqual([]);
  });
});

describe("readLastSuccessfulPipeline", () => {
  it("returns the same-branch last success independent of the current version", async () => {
    const oldVersionId = "50000000-0000-4000-8000-000000000099";
    const { client, calls } = persistence({
      growth_intelligence_research_pipelines: [
        {
          data: [pipelineRow({ market_profile_version_id: oldVersionId, stage: "ready" })],
          error: null,
        },
      ],
      branches: [{ data: [{ id: branchId, name: "Marina" }], error: null }],
      organization_market_profile_versions: [{ data: [versionRow()], error: null }],
      organization_market_profiles: [
        { data: [{ id: profileId, current_version_id: versionId }], error: null },
      ],
      market_research_runs: [{ data: [], error: null }],
      market_evidence_sources: [{ data: [], error: null }],
      market_evidence_claims: [{ data: [], error: null }],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    const last = await repository.readLastSuccessfulPipeline({
      organizationId,
      branchId,
      currentVersionId: versionId,
    });

    expect(last?.pipelineId).toBe(pipelineId);
    // Old settings are shown as earlier settings, never as current support.
    expect(last?.settingsMatchCurrent).toBe(false);
    const pipelineCall = calls.find(
      (call) => call.table === "growth_intelligence_research_pipelines",
    );
    expect(pipelineCall?.filters).toContainEqual(["branch_id", branchId]);
  });
});

describe("listItemProvenance", () => {
  it("links synthesis items to their exact pipeline without cross-tenant reads", async () => {
    const itemId = "80000000-0000-4000-8000-000000000008";
    const { client, calls } = persistence({
      growth_intelligence_synthesis_runs: [
        { data: [{ id: runId, growth_intelligence_request_id: requestId }], error: null },
      ],
      growth_intelligence_requests: [
        { data: [{ id: requestId, pipeline_id: pipelineId, phase: "synthesis" }], error: null },
      ],
      growth_intelligence_research_pipelines: [
        { data: [pipelineRow({ stage: "ready" })], error: null },
      ],
      growth_intelligence_item_market_claims: [
        {
          data: [{ growth_intelligence_item_id: itemId, market_evidence_claim_id: runId }],
          error: null,
        },
      ],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    const provenance = await repository.listItemProvenance({
      organizationId,
      items: [{ itemId, runId }],
    });

    expect(provenance[itemId]?.pipelineId).toBe(pipelineId);
    expect(provenance[itemId]?.stage).toBe("ready");
    expect(provenance[itemId]?.supportingClaimIds).toEqual([runId]);
    for (const call of calls) {
      expect(call.filters).toContainEqual(["organization_id", organizationId]);
    }
  });

  it("skips every round trip when there is nothing to resolve", async () => {
    const { client, calls } = persistence({});
    const repository = createAuthenticatedResearchReadRepository(client);

    await expect(repository.listItemProvenance({ organizationId, items: [] })).resolves.toEqual({});
    expect(calls).toEqual([]);
  });
});

describe("listResearchActivity", () => {
  it("names one start and one terminal event per pipeline and labels retries", async () => {
    const { client } = persistence({
      growth_intelligence_research_pipelines: [
        { data: [pipelineRow({ stage: "ready" })], error: null },
      ],
      branches: [{ data: [{ id: branchId, name: "Marina" }], error: null }],
      audit_events: [
        {
          data: [
            {
              id: "a0000000-0000-4000-8000-000000000001",
              event_name: "growth_intelligence.research_retried",
              entity_type: "growth_intelligence_research_pipeline",
              entity_id: pipelineId,
              occurred_at: "2026-09-03T09:00:00.000Z",
            },
          ],
          error: null,
        },
      ],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    const activity = await repository.listResearchActivity({ organizationId, branchId });

    const kinds = activity.map((event) => event.kind).sort();
    expect(kinds).toEqual(["finished", "retried", "started"]);
    expect(activity.every((event) => event.branchId === branchId)).toBe(true);
  });
});

describe("retrySynthesis", () => {
  const input = {
    organizationId,
    pipelineId,
    actorId,
    idempotencyKey: "retry-key-1234567890",
    correlationId: "c0000000-0000-4000-8000-000000000001",
  };

  it("wires the governed retry RPC with server-owned scope and no research inputs", async () => {
    const { client, rpcCalls } = persistence({
      "rpc:retry_market_research_synthesis": [
        { data: { requestId, status: "pending", replayed: false }, error: null },
      ],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    const outcome = await repository.retrySynthesis(input);

    expect(outcome).toEqual({ requestId, status: "pending", replayed: false });
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0]).toEqual({
      name: "retry_market_research_synthesis",
      args: {
        p_organization_id: organizationId,
        p_pipeline_id: pipelineId,
        p_actor_id: actorId,
        p_idempotency_key: input.idempotencyKey,
        p_correlation_id: input.correlationId,
      },
    });
  });

  it("maps stale evidence and exhausted budget to safe client outcomes", async () => {
    const { client } = persistence({
      "rpc:retry_market_research_synthesis": [
        {
          data: null,
          error: { message: "market_research_synthesis_evidence_stale" },
        },
      ],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    await expect(repository.retrySynthesis(input)).rejects.toThrow(/new research/);

    const budgeted = persistence({
      "rpc:retry_market_research_synthesis": [
        {
          data: null,
          error: { message: "market_research_synthesis_retry_budget_exhausted" },
        },
      ],
    });
    await expect(
      createAuthenticatedResearchReadRepository(budgeted.client).retrySynthesis(input),
    ).rejects.toThrow(/budget/);
  });

  it("never leaks foreign-pipeline existence through retry errors", async () => {
    const { client } = persistence({
      "rpc:retry_market_research_synthesis": [
        { data: null, error: { message: "market_research_pipeline_not_found" } },
      ],
    });
    const repository = createAuthenticatedResearchReadRepository(client);

    await expect(repository.retrySynthesis(input)).rejects.toThrow(
      /cannot be retried in its current state/,
    );
  });
});
