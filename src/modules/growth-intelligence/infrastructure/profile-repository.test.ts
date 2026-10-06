import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type {
  MarketProfileDocumentV1,
  MarketProfileDocumentV2,
} from "@/domain/growth-intelligence/types";
import {
  createAuthenticatedMarketProfileRepository,
  type MarketProfilePersistence,
} from "@/modules/growth-intelligence/infrastructure/profile-repository";

const organizationId = "10000000-0000-4000-8000-000000000001";
const actorId = "20000000-0000-4000-8000-000000000002";
const profileId = "30000000-0000-4000-8000-000000000003";
const versionId = "40000000-0000-4000-8000-000000000004";
const decisionId = "50000000-0000-4000-8000-000000000005";
const correlationId = "60000000-0000-4000-8000-000000000006";

const document: MarketProfileDocumentV1 = {
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

type QueryResult = { data: unknown; error: unknown };

const branchIdFixture = "60000000-0000-4000-8000-000000000006";

const branchDocument: MarketProfileDocumentV2 = {
  schemaVersion: 2,
  branchId: branchIdFixture,
  publicIdentity: {
    approvedName: "Malabar Table",
    domains: ["malabartable.example"],
    publicUrls: ["https://malabartable.example/"],
  },
  nicheDescriptors: ["Kerala cuisine"],
  geographies: [
    {
      layer: "trade_area",
      locationRef: "trade-area:dubai-marina",
      name: "Dubai Marina",
      branchId: branchIdFixture,
    },
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

function persistence(input: { results?: Record<string, QueryResult[]>; rpcResult?: QueryResult }) {
  const queues = new Map(
    Object.entries(input.results ?? {}).map(([table, results]) => [table, [...results]]),
  );
  const calls: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  const rpc = vi.fn().mockResolvedValue(input.rpcResult ?? { data: null, error: null });

  const from = vi.fn((table: string) => {
    const result = queues.get(table)?.shift() ?? { data: [], error: null };
    const filters: Array<[string, unknown]> = [];
    calls.push({ table, filters });
    const builder = {
      select: vi.fn(() => builder),
      eq: vi.fn((key: string, value: unknown) => {
        filters.push([key, value]);
        return builder;
      }),
      is: vi.fn((key: string, value: unknown) => {
        filters.push([key, value]);
        return builder;
      }),
      in: vi.fn((key: string, value: unknown) => {
        filters.push([key, value]);
        return builder;
      }),
      order: vi.fn(() => builder),
      limit: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => result),
      then: (resolve: (value: QueryResult) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  });

  return {
    client: { from, rpc } as unknown as MarketProfilePersistence,
    calls,
    rpc,
  };
}

describe("authenticated Market Profile repository", () => {
  it("reads one tenant-scoped profile with validated immutable history", async () => {
    const db = persistence({
      results: {
        organization_market_profiles: [
          {
            data: {
              id: profileId,
              current_version_id: versionId,
              enabled: true,
              next_daily_research_due_at: null,
              next_weekly_synthesis_due_at: null,
            },
            error: null,
          },
        ],
        organization_market_profile_versions: [
          {
            data: [
              {
                id: versionId,
                market_profile_id: profileId,
                version: 1,
                profile_document: document,
                profile_digest: "a".repeat(64),
                proposal_source: "operator",
                created_at: "2026-09-01T00:00:00.000Z",
              },
            ],
            error: null,
          },
        ],
        organization_market_profile_decisions: [
          {
            data: [
              {
                id: decisionId,
                market_profile_version_id: versionId,
                decision: "confirmed",
                reason: "Approved",
                created_at: "2026-09-01T00:01:00.000Z",
              },
            ],
            error: null,
          },
        ],
      },
    });

    const result = await createAuthenticatedMarketProfileRepository(db.client).read({
      organizationId,
      branchId: null,
    });

    expect(result.profile).toMatchObject({
      id: profileId,
      currentVersionId: versionId,
      enabled: true,
    });
    expect(result.versions[0]).toMatchObject({ id: versionId, document });
    expect(result.decisions[0]).toMatchObject({ id: decisionId, decision: "confirmed" });
    expect(
      db.calls.every((call) =>
        call.filters.some(
          (filter) => filter[0] === "organization_id" && filter[1] === organizationId,
        ),
      ),
    ).toBe(true);
  });

  it("projects only bounded confirmed public context and excludes unrelated payload fields", async () => {
    const db = persistence({
      results: {
        organizations: [
          {
            data: {
              name: "Malabar Table",
              industry: "restaurant",
              country_code: "AE",
              default_timezone: "Asia/Dubai",
            },
            error: null,
          },
        ],
        business_profiles: [
          {
            data: {
              business_model: "Kerala restaurant",
              value_proposition: "Family dining",
            },
            error: null,
          },
        ],
        branches: [
          {
            data: [
              {
                id: versionId,
                name: "Dubai Marina",
                timezone: "Asia/Dubai",
                service_area: { city: "Dubai", internalLeaseCode: "secret-lease" },
              },
            ],
            error: null,
          },
        ],
        onboarding_section_states: [
          {
            data: [
              {
                section_key: "products_services",
                payload: {
                  items: ["Appam", "Fish curry"],
                  categories: ["restaurant"],
                  averageOrderValueMinor: 9000,
                  rawCustomerNote: "private",
                },
              },
              {
                section_key: "channels_presence",
                payload: {
                  profiles: [
                    "https://malabartable.com",
                    "https://malabartable.com/menu?X-Amz-Signature=secret-token",
                    "mailto:owner@example.com",
                    "http://127.0.0.1/admin",
                    "http://169.254.169.254/latest/meta-data",
                    "http://service.internal/private",
                    "https://service.corp/private",
                    "http://[::1]/private",
                  ],
                  credential: "secret",
                },
              },
              {
                section_key: "branches_operations",
                payload: { serviceArea: ["Dubai Marina", "JBR"], capacity: "private" },
              },
            ],
            error: null,
          },
        ],
      },
    });

    const result = await createAuthenticatedMarketProfileRepository(db.client).readProposalContext({
      organizationId,
      branchId: null,
    });

    expect(result).toEqual({
      publicIdentity: {
        approvedName: "Malabar Table",
        publicUrls: ["https://malabartable.com/"],
      },
      market: { countryCode: "AE", timeZone: "Asia/Dubai" },
      nicheDescriptors: ["restaurant", "Kerala restaurant", "Family dining"],
      locations: [
        {
          branchId: versionId,
          name: "Dubai Marina",
          serviceAreas: ["Dubai", "Dubai Marina", "JBR"],
          countryCode: "AE",
          timeZone: "Asia/Dubai",
        },
      ],
      topics: ["Appam", "Fish curry", "restaurant"],
    });
    expect(JSON.stringify(result)).not.toMatch(
      /secret|private|signature|service\.corp|9000|email/i,
    );
  });

  it("calls the proposal RPC with exact governance metadata and reports a revision", async () => {
    const db = persistence({
      rpcResult: {
        data: {
          profileId,
          profileVersionId: versionId,
          version: 2,
          profileDigest: "a".repeat(64),
          replayed: false,
        },
        error: null,
      },
    });

    const result = await createAuthenticatedMarketProfileRepository(db.client).propose({
      organizationId,
      actorId,
      document,
      profileDigest: "a".repeat(64),
      proposalContext: { source: "operator" },
      idempotencyKey: "profile-proposal-0001",
      correlationId,
    });

    expect(db.rpc).toHaveBeenCalledWith("propose_market_profile_version", {
      p_organization_id: organizationId,
      p_actor_id: actorId,
      p_profile_document: document,
      p_profile_digest: "a".repeat(64),
      p_proposal_context: { source: "operator" },
      p_idempotency_key: "profile-proposal-0001",
      p_correlation_id: correlationId,
    });
    expect(db.rpc).toHaveBeenCalledTimes(1);
    expect(db.calls).toEqual([]);
    expect(result).toMatchObject({ profileVersionId: versionId, isRevision: true });
  });

  it("looks up an exact AI proposal replay without loading profile content", async () => {
    const proposalContext = {
      source: "ai" as const,
      modelProvider: "google",
      modelName: "gemini-profile",
      modelVersion: "market-profile-proposal@1",
      modelInputDigest: "b".repeat(64),
    };
    const db = persistence({
      rpcResult: {
        data: {
          profileId,
          profileVersionId: versionId,
          version: 2,
          profileDigest: "a".repeat(64),
          replayed: true,
        },
        error: null,
      },
    });

    const result = await createAuthenticatedMarketProfileRepository(db.client).findProposalReplay({
      organizationId,
      actorId,
      proposalContext,
      idempotencyKey: "profile-proposal-0001",
    });

    expect(db.rpc).toHaveBeenCalledWith("find_market_profile_proposal_replay", {
      p_organization_id: organizationId,
      p_actor_id: actorId,
      p_proposal_context: proposalContext,
      p_idempotency_key: "profile-proposal-0001",
    });
    expect(db.calls).toEqual([]);
    expect(result).toMatchObject({
      profileVersionId: versionId,
      replayed: true,
      isRevision: true,
    });
  });

  it("maps a branch start idempotency conflict to safe domain copy", async () => {
    const db = persistence({
      rpcResult: {
        data: null,
        error: {
          code: "23505",
          message: "market_profile_start_idempotency_conflict: raw detail",
        },
      },
    });

    await expect(
      createAuthenticatedMarketProfileRepository(db.client).startBranchResearch({
        organizationId,
        actorId,
        branchId: "60000000-0000-4000-8000-000000000006",
        document: branchDocument,
        profileDigest: "c".repeat(64),
        expectedCurrentVersionId: null,
        idempotencyKey: "branch-research-0001",
        correlationId,
      }),
    ).rejects.toMatchObject({ code: "RESEARCH_IDEMPOTENCY_CONFLICT" });

    expect(db.rpc).toHaveBeenCalledWith("start_branch_market_research", {
      p_organization_id: organizationId,
      p_actor_id: actorId,
      p_branch_id: "60000000-0000-4000-8000-000000000006",
      p_profile_document: branchDocument,
      p_profile_digest: "c".repeat(64),
      p_expected_current_version_id: null,
      p_idempotency_key: "branch-research-0001",
      p_correlation_id: correlationId,
    });
  });

  it("maps a stale expected branch version to a version conflict", async () => {
    const db = persistence({
      rpcResult: {
        data: null,
        error: { code: "23505", message: "market_profile_version_conflict" },
      },
    });

    await expect(
      createAuthenticatedMarketProfileRepository(db.client).startBranchResearch({
        organizationId,
        actorId,
        branchId: "60000000-0000-4000-8000-000000000006",
        document: branchDocument,
        profileDigest: "c".repeat(64),
        expectedCurrentVersionId: versionId,
        idempotencyKey: "branch-research-0001",
        correlationId,
      }),
    ).rejects.toMatchObject({ code: "PROFILE_VERSION_CONFLICT" });
  });

  it("returns the started branch pipeline from the start RPC", async () => {
    const pipelineId = "70000000-0000-4000-8000-000000000007";
    const researchRequestId = "80000000-0000-4000-8000-000000000008";
    const db = persistence({
      rpcResult: {
        data: {
          outcome: "started",
          profileVersionId: versionId,
          pipelineId,
          researchRequestId,
        },
        error: null,
      },
    });

    const result = await createAuthenticatedMarketProfileRepository(db.client).startBranchResearch({
      organizationId,
      actorId,
      branchId: "60000000-0000-4000-8000-000000000006",
      document: branchDocument,
      profileDigest: "c".repeat(64),
      expectedCurrentVersionId: null,
      idempotencyKey: "branch-research-0001",
      correlationId,
    });

    expect(result).toEqual({
      outcome: "started",
      profileVersionId: versionId,
      pipelineId,
      researchRequestId,
    });
  });

  it("pins a branch read to that exact branch scope", async () => {
    const branchId = "60000000-0000-4000-8000-000000000006";
    const db = persistence({
      results: {
        organization_market_profiles: [
          {
            data: {
              id: profileId,
              current_version_id: versionId,
              enabled: true,
              next_daily_research_due_at: null,
              next_weekly_synthesis_due_at: null,
            },
            error: null,
          },
        ],
        organization_market_profile_versions: [{ data: [], error: null }],
        organization_market_profile_decisions: [{ data: [], error: null }],
      },
    });

    await createAuthenticatedMarketProfileRepository(db.client).read({
      organizationId,
      branchId,
    });

    const profileCall = db.calls.find((call) => call.table === "organization_market_profiles");
    expect(profileCall?.filters).toContainEqual(["organization_id", organizationId]);
    expect(profileCall?.filters).toContainEqual(["branch_id", branchId]);
    for (const call of db.calls) {
      if (call.table === "organization_market_profiles") continue;
      expect(call.filters).toContainEqual(["market_profile_id", profileId]);
    }
  });

  it("pins a legacy read to the explicit null branch scope", async () => {
    const db = persistence({
      results: {
        organization_market_profiles: [{ data: null, error: null }],
      },
    });

    const result = await createAuthenticatedMarketProfileRepository(db.client).read({
      organizationId,
      branchId: null,
    });

    expect(result).toEqual({ profile: null, versions: [], decisions: [] });
    const profileCall = db.calls.find((call) => call.table === "organization_market_profiles");
    expect(profileCall?.filters).toContainEqual(["organization_id", organizationId]);
    expect(
      profileCall?.filters.some(
        (filter) => filter[0] === "branch_id" && (filter[1] === null || filter[1] === "is-null"),
      ),
    ).toBe(true);
  });

  it("scopes AI proposal context to one branch without shared onboarding locality", async () => {
    const branchId = "60000000-0000-4000-8000-000000000006";
    const db = persistence({
      results: {
        organizations: [
          {
            data: {
              name: "Malabar Table",
              industry: "restaurant",
              country_code: "AE",
              default_timezone: "Asia/Dubai",
            },
            error: null,
          },
        ],
        business_profiles: [
          {
            data: { business_model: "Kerala restaurant", value_proposition: "Family dining" },
            error: null,
          },
        ],
        branches: [
          {
            data: [
              {
                id: branchId,
                name: "Dubai Marina",
                timezone: "Asia/Dubai",
                service_area: { city: "Dubai Marina" },
              },
            ],
            error: null,
          },
        ],
        onboarding_section_states: [
          {
            data: [
              {
                section_key: "products_services",
                payload: { items: ["Appam"], categories: [] },
              },
              {
                section_key: "branches_operations",
                payload: { serviceArea: ["Deira shared area"] },
              },
            ],
            error: null,
          },
        ],
      },
    });

    const result = await createAuthenticatedMarketProfileRepository(db.client).readProposalContext({
      organizationId,
      branchId,
    });

    expect(result.locations).toEqual([
      {
        branchId,
        name: "Dubai Marina",
        serviceAreas: ["Dubai Marina"],
        countryCode: "AE",
        timeZone: "Asia/Dubai",
      },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/Deira shared area/);
    const branchCall = db.calls.find((call) => call.table === "branches");
    expect(branchCall?.filters).toContainEqual(["id", branchId]);
  });

  it("maps a stale exact-version decision to safe domain copy", async () => {
    const db = persistence({
      rpcResult: {
        data: null,
        error: {
          code: "42501",
          message: "market_profile_version_not_found: raw provider detail",
        },
      },
    });

    await expect(
      createAuthenticatedMarketProfileRepository(db.client).decide({
        organizationId,
        actorId,
        profileVersionId: versionId,
        profileDigest: "a".repeat(64),
        decision: "confirmed",
        reason: null,
        idempotencyKey: "profile-decision-0001",
        correlationId,
      }),
    ).rejects.toMatchObject({
      code: "DOMAIN_ERROR",
      message: "This Market Profile version is no longer available.",
    });
  });
});
