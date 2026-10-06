import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const adviceReads = vi.hoisted(() => ({
  recommendations: vi.fn(),
  items: vi.fn(),
  memory: vi.fn(),
  evidence: vi.fn(),
}));
vi.mock("@/modules/growth-intelligence/infrastructure/read-repository", () => ({
  createAuthenticatedGrowthIntelligenceReadRepository: () => ({
    listChannelRecommendationRecords: adviceReads.recommendations,
    listWorkspaceItems: adviceReads.items,
  }),
}));
vi.mock("@/modules/growth-intelligence/application/feature-access", () => ({
  hasGrowthIntelligenceAccess: () => true,
}));
vi.mock("@/modules/campaigns/application/feature-access", () => ({
  isCampaignsEnabled: () => true,
}));
vi.mock("@/modules/campaigns/infrastructure/proposal-read-repository", () => ({
  createCampaignProposalReader: () => ({ listProposals: async () => [] }),
}));
vi.mock("@/modules/memory/application/api", () => ({
  createMemoryWorkspaceApi: () => ({ retrieval: { retrieve: adviceReads.memory } }),
}));
vi.mock("@/modules/metrics/infrastructure/repository", () => ({
  createGovernedMetricWindowRepository: () => ({ loadGovernedWindow: adviceReads.evidence }),
}));

import {
  composeAgentAdviceContext,
  createAgentContextReaders,
  createAgentResearchProfileResolver,
  createAgentWatchProjectSeams,
  resolveAgentContextScope,
  readAgentRecentQuestions,
} from "@/modules/agent-chat/application/api";
import { buildAgentContextPack } from "@/modules/agent-chat/application/context-pack";
import { executeWatchCreate, type WatchKeyedCreateInput } from "@/modules/agent-chat/application/executors";
import { fingerprintMonitoringScope } from "@/modules/growth-intelligence/application/market-monitoring-update";
import type { ResearchProjectRepository } from "@/modules/growth-intelligence/infrastructure/research-project-repository";

/**
 * Minimal session-client fake: table rows filtered by eq/is chains, with
 * maybeSingle for single-row reads and a thenable for list reads (the
 * profile repository awaits the builder directly).
 */
function fakeClient(tables: Record<string, Record<string, unknown>[]>) {
  const apply = (table: string, filters: { column: string; value: unknown }[]) =>
    (tables[table] ?? []).filter((row) =>
      filters.every((filter) => (row[filter.column] ?? null) === filter.value),
    );
  return {
    from(table: string) {
      const filters: { column: string; value: unknown }[] = [];
      let before: { column: string; value: string } | undefined;
      let limit = Infinity;
      const rows = () =>
        apply(table, filters)
          .filter((row) => !before || String(row[before.column]) < before.value)
          .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
          .slice(0, limit);
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          filters.push({ column, value });
          return builder;
        },
        is: (column: string, value: unknown) => {
          filters.push({ column, value });
          return builder;
        },
        order: () => builder,
        lt: (column: string, value: string) => {
          before = { column, value };
          return builder;
        },
        limit: (value: number) => {
          limit = value;
          return builder;
        },
        maybeSingle: async () => ({ data: apply(table, filters)[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: rows(), error: null }).then(resolve),
      };
      return builder;
    },
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    rpc: async (_name: string, _args: Record<string, unknown>) => ({ data: null, error: null }),
  };
}

const ORG = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-000000000002";
const PROFILE = "30000000-0000-4000-8000-000000000003";
const VERSION = "40000000-0000-4000-8000-000000000004";

function watchCreateInput(): WatchKeyedCreateInput {
  const input = { organizationId: ORG, branchId: BRANCH, actorId: PROFILE,
    title: "Watch Jumeirah demand", question: "What should we learn about Jumeirah demand?",
    mode: "one-time" as const, researchArea: "Jumeirah", competitors: [],
    investigationAreas: ["demand"] as "demand"[],
    businessContextSnapshotId: "00000000-0000-0000-0000-000000000000",
    idempotencyKey: "watch-source-key-proof-00000001" };
  return { ...input, scopeFingerprint: fingerprintMonitoringScope({ ...input, frequency: "once" }) };
}

describe("agent watch source composition", () => {
  it("resumes the exact tenant creation key and its tenant-owned active scope", async () => {
    const input = watchCreateInput();
    const seams = createAgentWatchProjectSeams(fakeClient({
      growth_intelligence_project_create_keys: [
        { organization_id: "foreign", idempotency_key: input.idempotencyKey, project_id: PROFILE },
        { organization_id: ORG, idempotency_key: input.idempotencyKey, project_id: VERSION },
      ],
      growth_intelligence_monitoring_active_scopes: [
        { organization_id: "foreign", project_id: VERSION, scope_fingerprint: "0".repeat(64) },
        { organization_id: ORG, project_id: VERSION, scope_fingerprint: input.scopeFingerprint },
      ],
    }) as never, {} as ResearchProjectRepository);
    expect(await seams.findCreatedByKey(input)).toBe(VERSION);
  });

  it("does not inherit another tenant's key or active scope", async () => {
    const input = watchCreateInput();
    const foreignKey = createAgentWatchProjectSeams(fakeClient({
      growth_intelligence_project_create_keys: [
        { organization_id: "foreign", idempotency_key: input.idempotencyKey, project_id: VERSION },
      ],
    }) as never, {} as ResearchProjectRepository);
    expect(await foreignKey.findCreatedByKey(input)).toBeNull();
    const foreignScope = createAgentWatchProjectSeams(fakeClient({
      growth_intelligence_project_create_keys: [
        { organization_id: ORG, idempotency_key: input.idempotencyKey, project_id: VERSION },
      ],
      growth_intelligence_monitoring_active_scopes: [
        { organization_id: "foreign", project_id: VERSION, scope_fingerprint: input.scopeFingerprint },
      ],
    }) as never, {} as ResearchProjectRepository);
    await expect(foreignScope.findCreatedByKey(input)).rejects.toMatchObject({ code: "DOMAIN_ERROR" });
  });

  it("refuses a failed latest-brief read before a partial-create retry can write", async () => {
    const input = watchCreateInput();
    const client = fakeClient({ growth_intelligence_project_create_keys: [
      { organization_id: ORG, idempotency_key: input.idempotencyKey, project_id: VERSION },
    ] });
    const failed = { from(table: string) {
      const builder = client.from(table);
      if (table === "growth_intelligence_brief_revisions") {
        builder.maybeSingle = async () => ({ data: null, error: { code: "42501" } });
      }
      return builder;
    } };
    let writes = 0;
    const projects = { createProject: async () => { writes += 1; throw new Error("Unexpected source write."); },
      saveBriefRevision: async () => { writes += 1; throw new Error("Unexpected source write."); } };
    const seams = createAgentWatchProjectSeams(failed as never, projects as unknown as ResearchProjectRepository);
    const { scopeFingerprint, ...watch } = input;
    expect(scopeFingerprint).toMatch(/^[0-9a-f]{64}$/);
    await expect(executeWatchCreate(watch, { ...seams, listActive: async () => [] }))
      .rejects.toMatchObject({ code: "INTEGRATION_ERROR" });
    expect(writes).toBe(0);
  });
});

describe("advice timezone boundary", () => {
  const input = {
    organizationId: ORG,
    actorId: PROFILE,
    role: "owner" as const,
    question: "How is Talabat doing?",
    correlationId: "advice-timezone-test",
  };
  it("retains an honest limitation when optional timezone context is unavailable", async () => {
    const client = fakeClient({});
    const from = vi.spyOn(client, "from");
    const advice = await composeAgentAdviceContext({ ...input, supabase: client as never });
    expect(advice).toEqual({
      entries: [],
      limitations: ["The requested branch or timezone is unavailable."],
      periodSwitch: null,
    });
    expect(from.mock.calls.map(([table]) => table)).toEqual(["organizations"]);
  });
  it("does not substitute the organization timezone for a branch in another tenant", async () => {
    const advice = await composeAgentAdviceContext({
      ...input,
      branchId: BRANCH,
      supabase: fakeClient({
        organizations: [{ id: ORG, default_timezone: "Asia/Dubai" }],
        branches: [{ id: BRANCH, organization_id: VERSION, timezone: "Asia/Dubai" }],
      }) as never,
    });
    expect(advice.periodSwitch).toBeNull();
    expect(advice.entries).toEqual([]);
    expect(advice.limitations).toHaveLength(1);
  });

  it("builds shared advice without personal preference tables while keeping Memory below internal", async () => {
    const readShared = async (scope: { actorId: string }) => {
      if (scope.actorId !== "") throw new Error("personal table denied to worker");
      return [];
    };
    adviceReads.recommendations.mockImplementation(readShared);
    adviceReads.items.mockImplementation(readShared);
    adviceReads.memory.mockResolvedValue({ results: [], retrievalMode: "lexical" });
    adviceReads.evidence.mockResolvedValue([]);
    const context = await composeAgentAdviceContext({
      ...input,
      correlationId: VERSION,
      allowPeriodFallback: false,
      supabase: fakeClient({
        organizations: [{ id: ORG, default_timezone: "Asia/Dubai" }],
      }) as never,
    });
    expect(context.limitations.join(" ")).not.toContain("SOURCE_READ_FAILED");
    for (const read of [adviceReads.recommendations, adviceReads.items]) {
      expect(read).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: ORG, actorId: "" }),
      );
    }
    expect(adviceReads.memory).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: ORG,
        sensitivityAllowance: "internal",
        correlationId: VERSION,
      }),
    );
  });
});

const DOCUMENT = {
  schemaVersion: 2,
  branchId: BRANCH,
  publicIdentity: {
    approvedName: "Malabar Table",
    domains: ["malabartable.example"],
    publicUrls: ["https://malabartable.example/"],
  },
  nicheDescriptors: ["Kerala cuisine"],
  geographies: [
    { layer: "trade_area", locationRef: "trade:malabar", name: "Malabar trade area", branchId: BRANCH },
    { layer: "city", locationRef: "city:dubai", name: "Dubai", countryCode: "AE" },
    { layer: "country", locationRef: "country:ae", name: "UAE", countryCode: "AE" },
  ],
  competitors: [],
  topics: [{ key: "kerala-cuisine", label: "Kerala cuisine", provenance: "operator" }],
  sourcePolicy: {
    excludedDomains: [],
    excludedPublishers: [],
    excludedCompetitorKeys: [],
    allowBoundedQuotes: false,
    maxQuotationCharacters: 0,
  },
  cadence: {
    timeZone: "Asia/Dubai",
    dailyLocalTime: "06:00",
    weeklyDay: "monday",
    weeklyLocalTime: "07:00",
  },
};

function fullTables() {
  return {
    branches: [{ id: BRANCH, organization_id: ORG, timezone: "Asia/Dubai" }],
    organizations: [{ id: ORG, name: "Malabar Table", industry: "Restaurant", country_code: "AE" }],
    organization_market_profiles: [
      {
        id: PROFILE,
        organization_id: ORG,
        branch_id: BRANCH,
        current_version_id: VERSION,
        enabled: true,
        next_daily_research_due_at: null,
        next_weekly_synthesis_due_at: null,
      },
    ],
    organization_market_profile_versions: [
      {
        id: VERSION,
        organization_id: ORG,
        market_profile_id: PROFILE,
        version: 1,
        profile_document: DOCUMENT,
        profile_digest: "a".repeat(64),
        proposal_source: "operator",
        created_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    organization_market_profile_decisions: [{
      id: "50000000-0000-4000-8000-000000000005", organization_id: ORG,
      market_profile_id: PROFILE, market_profile_version_id: VERSION,
      decision: "confirmed", reason: null, created_at: "2026-09-02T00:00:00.000Z",
    }],
  };
}

describe("agent context readers", () => {
  it("resolves pack and research scope from the same bounded tenant-owned names", async () => {
    const client = fakeClient({ branches: [
      { id: BRANCH, organization_id: ORG, name: "Jumeirah" },
      { id: VERSION, organization_id: ORG, name: "Marina" },
      { id: PROFILE, organization_id: "other", name: "Downtown" },
    ] });
    expect(await resolveAgentContextScope(client as never, { organizationId: ORG, question: "Research Jumeirah" }))
      .toEqual({ kind: "branch", branchId: BRANCH });
    expect(await resolveAgentContextScope(client as never, { organizationId: ORG, question: "Research our business" }))
      .toEqual({ kind: "organization" });
    expect(await resolveAgentContextScope(client as never, { organizationId: ORG, question: "Research Downtown" }))
      .toEqual({ kind: "organization" });
    expect(await resolveAgentContextScope(client as never, { organizationId: ORG, question: "Compare Jumeirah and Marina" }))
      .toEqual({ kind: "ambiguous" });
  });

  it("leaves branch scope unavailable after a failed or oversized source read", async () => {
    const failed = { from: () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: null, error: { code: "42501" } }) }) }) }) };
    expect(await resolveAgentContextScope(failed as never, { organizationId: ORG, question: "Research Jumeirah" }))
      .toEqual({ kind: "unavailable" });
    const rows = Array.from({ length: 101 }, (_, index) => ({ id: `branch-${index}`, organization_id: ORG, name: `Branch ${index}` }));
    expect(await resolveAgentContextScope(fakeClient({ branches: rows }) as never, { organizationId: ORG, question: "Research Branch 1" }))
      .toEqual({ kind: "unavailable" });
  });

  it("binds research only to a uniquely named tenant branch and its confirmed profile", async () => {
    const resolve = createAgentResearchProfileResolver(fakeClient({
      ...fullTables(),
      branches: [
        { id: BRANCH, organization_id: ORG, name: "Jumeirah" },
        { id: "foreign", organization_id: "other", name: "Marina" },
      ],
    }) as never);
    expect(await resolve({ organizationId: ORG, question: "Research competitors around Jumeirah" }))
      .toMatchObject({ status: "current", versionId: VERSION, branchId: BRANCH });
    expect(await resolve({ organizationId: ORG, question: "Research our competitors" }))
      .toEqual({ status: "missing" });
    expect(await resolve({ organizationId: ORG, question: "Research Marina" }))
      .toEqual({ status: "missing" });
    const ambiguous = createAgentResearchProfileResolver(fakeClient({
      ...fullTables(), branches: [
        { id: BRANCH, organization_id: ORG, name: "Jumeirah" },
        { id: "other", organization_id: ORG, name: "Marina" },
      ],
    }) as never);
    expect(await ambiguous({ organizationId: ORG, question: "Compare Jumeirah and Marina" })).toBeNull();
  });
  it("bounds prior questions to this tenant and thread before the current turn", async () => {
    const row = (body: string, created_at: string, rest = {}) => ({
      organization_id: ORG,
      thread_id: "thread",
      role: "user",
      body,
      created_at,
      ...rest,
    });
    const questions = await readAgentRecentQuestions(
      fakeClient({
        agent_messages: [
          row("Earlier question", "2026-10-01"),
          row("Current question", "2026-10-04"),
          row("Other tenant", "2026-10-02", { organization_id: "other" }),
          row("Other thread", "2026-10-02", { thread_id: "other" }),
          row("Private assistant content", "2026-10-02", { role: "assistant" }),
        ],
      }) as never,
      { organizationId: ORG, threadId: "thread", beforeCreatedAt: "2026-10-04" },
    );
    expect(questions).toEqual(["Earlier question"]);
  });
  it("brings tenant goals and current constraints into advice without another tenant's settings", async () => {
    const readers = createAgentContextReaders(
      fakeClient({
        ...fullTables(),
        goals: [
          {
            id: "goal-1",
            organization_id: ORG,
            name: "Increase returning customers",
            target_value: 20,
            unit: "percent",
            baseline_status: "unknown",
            scope_kind: "organization",
          },
          {
            id: "foreign-goal",
            organization_id: "other",
            name: "Secret",
            target_value: 10,
            unit: "percent",
          },
        ],
        constraints: [
          {
            organization_id: ORG,
            name: "Protect margin",
            severity: "hard",
            is_active: true,
            scope_kind: "organization",
          },
        ],
        policies: [
          {
            organization_id: ORG,
            name: "Campaign approvals",
            mode: "approval_required",
            is_active: true,
          },
        ],
      }) as never,
    );
    expect(await readers.getGoals?.({ organizationId: ORG })).toEqual({
      goals: [
        expect.objectContaining({
          id: "goal-1",
          title: expect.stringContaining("Increase returning customers"),
        }),
      ],
      constraints: ["Protect margin (hard)"],
      policies: ["Campaign approvals: approval_required"],
      capabilityBlocks: [],
    });
  });
  it("resolves the branch timezone, falling back to the organization default", async () => {
    const readers = createAgentContextReaders(fakeClient(fullTables()) as never);
    await expect(
      readers.resolveBranchTimezone?.({ organizationId: ORG, branchId: BRANCH }),
    ).resolves.toBe("Asia/Dubai");
    const noBranch = createAgentContextReaders(
      fakeClient({
        ...fullTables(),
        branches: [{ id: BRANCH, organization_id: ORG, timezone: "" }],
        organizations: [{ id: ORG, default_timezone: "Asia/Dubai" }],
      }) as never,
    );
    await expect(noBranch.resolveBranchTimezone?.({ organizationId: ORG })).resolves.toBe(
      "Asia/Dubai",
    );
    const none = createAgentContextReaders(fakeClient({}) as never);
    await expect(none.resolveBranchTimezone?.({ organizationId: ORG })).resolves.toBeNull();
  });

  it("binds the current profile version pointer, or honest missing", async () => {
    const readers = createAgentContextReaders(fakeClient(fullTables()) as never);
    expect(await readers.getMarketProfile?.({ organizationId: ORG, branchId: BRANCH })).toEqual({
      status: "current",
      versionId: VERSION,
      digest: "a".repeat(64),
      niche: "Kerala cuisine",
      branchId: BRANCH,
    });
    const none = createAgentContextReaders(fakeClient({}) as never);
    expect(await none.getMarketProfile?.({ organizationId: ORG })).toEqual({ status: "missing" });
  });

  it("does not bind an enabled profile without its current confirmation", async () => {
    const readers = createAgentContextReaders(fakeClient({
      ...fullTables(), organization_market_profile_decisions: [],
    }) as never);
    expect(await readers.getMarketProfile?.({ organizationId: ORG, branchId: BRANCH })).toEqual({
      status: "missing", reasonCode: "PROFILE_NOT_CONFIRMED",
    });
    const pack = await buildAgentContextPack({
      organizationId: ORG, userId: "u", branchId: BRANCH, windowDays: 30,
      page: "overview", readers, now: "2026-09-25T10:00:00.000Z",
    });
    expect(pack.lanes.marketProfile).toEqual({ status: "missing", reasonCode: "PROFILE_NOT_CONFIRMED" });
    expect(pack.limitations.join(" ")).toMatch(/profile.*not.*confirmed/i);
  });

  it("never substitutes another branch or a legacy organization profile", async () => {
    const readers = createAgentContextReaders(fakeClient(fullTables()) as never);
    expect(await readers.getMarketProfile?.({ organizationId: ORG })).toEqual({ status: "missing" });
    expect(await readers.getMarketProfile?.({ organizationId: ORG, branchId: VERSION })).toEqual({ status: "missing" });
    expect(await readers.getMarketProfile?.({ organizationId: VERSION, branchId: BRANCH })).toEqual({ status: "missing" });
  });

  it("refuses a document whose declared branch differs from the selected source profile", async () => {
    const tables: Record<string, Record<string, unknown>[]> = fullTables();
    tables.organization_market_profile_versions[0].profile_document = {
      ...DOCUMENT, branchId: VERSION,
      geographies: DOCUMENT.geographies.map((geography) => geography.layer === "trade_area"
        ? { ...geography, branchId: VERSION } : geography),
    };
    const readers = createAgentContextReaders(fakeClient(tables) as never);
    expect(await readers.getMarketProfile?.({ organizationId: ORG, branchId: BRANCH })).toEqual({
      status: "missing", reasonCode: "PROFILE_SCOPE_MISMATCH",
    });
  });

  it("reads identity facts from the organization's own row", async () => {
    const readers = createAgentContextReaders(fakeClient(fullTables()) as never);
    const facts = (await readers.getIdentityFacts?.({ organizationId: ORG })) as {
      id: string;
      verified: boolean;
      source: string;
    }[];
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => fact.verified === false && fact.source === "organization")).toBe(
      true,
    );
  });

  it("packs digest stably through the bound readers", async () => {
    const readers = createAgentContextReaders(fakeClient(fullTables()) as never);
    const pack = await buildAgentContextPack({
      organizationId: ORG,
      userId: "u",
      branchId: BRANCH,
      windowDays: 30,
      page: "overview",
      readers,
      now: "2026-09-25T10:00:00.000Z",
    });
    expect(pack.refused).toBe(false);
    expect(pack.digest).toMatch(/^[0-9a-f]{16}$/);
    expect(pack.window.branchTimezone).toBe("Asia/Dubai");
    expect(pack.lanes.marketProfile).toMatchObject({ status: "current", versionId: VERSION });
  });
});
