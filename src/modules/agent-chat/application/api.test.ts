import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createAgentContextReaders } from "@/modules/agent-chat/application/api";
import { buildAgentContextPack } from "@/modules/agent-chat/application/context-pack";

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
        limit: () => builder,
        maybeSingle: async () => ({ data: apply(table, filters)[0] ?? null, error: null }),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve({ data: apply(table, filters), error: null }).then(resolve),
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

const DOCUMENT = {
  schemaVersion: 1,
  publicIdentity: {
    approvedName: "Malabar Table",
    domains: ["malabartable.example"],
    publicUrls: ["https://malabartable.example/"],
  },
  nicheDescriptors: ["Kerala cuisine"],
  geographies: [
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
        branch_id: null,
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
    organization_market_profile_decisions: [],
  };
}

describe("agent context readers", () => {
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
    expect(await readers.getMarketProfile?.({ organizationId: ORG })).toEqual({
      status: "current",
      versionId: VERSION,
      digest: "a".repeat(64),
      niche: "Kerala cuisine",
    });
    const none = createAgentContextReaders(fakeClient({}) as never);
    expect(await none.getMarketProfile?.({ organizationId: ORG })).toEqual({ status: "missing" });
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
