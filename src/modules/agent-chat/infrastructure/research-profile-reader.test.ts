import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createMarketProfileDigest } from "@/domain/growth-intelligence/profile-digest";
import type {
  MarketProfileDocumentV1,
  MarketProfileDocumentV2,
} from "@/domain/growth-intelligence/types";
import { readAgentResearchProfileVersion } from "./research-profile-reader";

const ORG = "10000000-0000-4000-8000-000000000001";
const BRANCH = "20000000-0000-4000-8000-000000000002";
const PROFILE = "30000000-0000-4000-8000-000000000003";
const VERSION = "40000000-0000-4000-8000-000000000004";
const document: MarketProfileDocumentV2 = {
  schemaVersion: 2,
  branchId: BRANCH,
  publicIdentity: { approvedName: "Cedar Bakery", domains: [], publicUrls: [] },
  nicheDescriptors: ["artisan bakery"],
  geographies: [
    { layer: "trade_area", locationRef: "trade:cedar", name: "Cedar district", branchId: BRANCH },
    { layer: "city", locationRef: "city:springfield", name: "Springfield", countryCode: "US" },
    { layer: "country", locationRef: "country:us", name: "United States", countryCode: "US" },
  ],
  competitors: [],
  topics: [{ key: "pricing", label: "Bread pricing", provenance: "operator" }],
  sourcePolicy: {
    excludedDomains: [],
    excludedPublishers: [],
    excludedCompetitorKeys: [],
    allowBoundedQuotes: false,
    maxQuotationCharacters: 0,
  },
  cadence: {
    timeZone: "America/New_York",
    dailyLocalTime: "06:00",
    weeklyDay: "monday",
    weeklyLocalTime: "07:00",
  },
};
const digest = createMarketProfileDigest(document);
type Tables = Record<string, Record<string, unknown>[]>;
function tables(): Tables {
  return {
    organization_market_profile_versions: [
      {
        id: VERSION,
        organization_id: ORG,
        market_profile_id: PROFILE,
        profile_digest: digest,
        source_policy_digest: "b".repeat(64),
        profile_document: document,
      },
    ],
    organization_market_profiles: [
      {
        id: PROFILE,
        organization_id: ORG,
        branch_id: BRANCH,
        current_version_id: VERSION,
        enabled: true,
      },
    ],
    organization_market_profile_decisions: [
      {
        id: "50000000-0000-4000-8000-000000000005",
        organization_id: ORG,
        market_profile_id: PROFILE,
        market_profile_version_id: VERSION,
        profile_digest: digest,
        decision: "confirmed",
        created_at: "2026-10-01T00:00:00Z",
      },
    ],
  };
}
function client(rows: Tables, failingTable?: string) {
  return {
    from(table: string) {
      const filters: Array<[string, unknown]> = [];
      const order: string[] = [];
      const builder = {
        select: () => builder,
        eq: (key: string, value: unknown) => {
          filters.push([key, value]);
          return builder;
        },
        is: (key: string, value: unknown) => {
          filters.push([key, value]);
          return builder;
        },
        order: (key: string) => {
          order.push(key);
          return builder;
        },
        limit: () => builder,
        maybeSingle: async () => ({
          data:
            (rows[table] ?? [])
              .filter((row) => filters.every(([key, value]) => (row[key] ?? null) === value))
              .sort((a, b) => {
                for (const key of order) {
                  const compared = String(b[key]).localeCompare(String(a[key]));
                  if (compared) return compared;
                }
                return 0;
              })[0] ?? null,
          error: table === failingTable ? { code: "42501" } : null,
        }),
      };
      return builder;
    },
  };
}
const scope = { organizationId: ORG, versionId: VERSION, branchId: BRANCH };

describe("agent research profile worker guard", () => {
  it("returns only the exact canonical current confirmed branch profile", async () => {
    expect(await readAgentResearchProfileVersion(client(tables()) as never, scope)).toMatchObject({
      kind: "ready",
      profile: {
        versionId: VERSION,
        digest,
        enabled: true,
        sourcePolicyDigest: "b".repeat(64),
        document: { branchId: BRANCH },
      },
    });
  });
  it("accepts a confirmed canonical organization profile only in its null branch scope", async () => {
    const legacyDocument: MarketProfileDocumentV1 = {
      schemaVersion: 1,
      publicIdentity: document.publicIdentity,
      nicheDescriptors: document.nicheDescriptors,
      geographies: document.geographies,
      competitors: document.competitors.map((competitor) => ({
        ...competitor, relevanceReason: competitor.relevanceReason ?? "Comparable public competitor",
      })),
      topics: document.topics,
      sourcePolicy: document.sourcePolicy,
      cadence: document.cadence,
    };
    const rows = tables();
    const legacyDigest = createMarketProfileDigest(legacyDocument);
    rows.organization_market_profile_versions[0].profile_document = legacyDocument;
    rows.organization_market_profile_versions[0].profile_digest = legacyDigest;
    rows.organization_market_profiles[0].branch_id = null;
    rows.organization_market_profile_decisions[0].profile_digest = legacyDigest;
    expect(
      await readAgentResearchProfileVersion(client(rows) as never, {
        organizationId: ORG,
        versionId: VERSION,
      }),
    ).toMatchObject({ kind: "ready", profile: { digest: legacyDigest } });
    expect(await readAgentResearchProfileVersion(client(rows) as never, scope)).toEqual({
      kind: "blocked",
      reasonCode: "PROFILE_SCOPE_MISMATCH",
    });
  });
  it("orders simultaneous version decisions by their source identifiers", async () => {
    const rows = tables();
    rows.organization_market_profile_decisions.push({
      ...rows.organization_market_profile_decisions[0],
      id: "60000000-0000-4000-8000-000000000006",
      decision: "disabled",
    });
    expect(await readAgentResearchProfileVersion(client(rows) as never, scope)).toEqual({
      kind: "blocked",
      reasonCode: "PROFILE_NOT_CONFIRMED",
    });
  });
  it("requires the latest confirmation rather than any historical confirmation", async () => {
    const rows = tables();
    rows.organization_market_profile_decisions.push({
      ...rows.organization_market_profile_decisions[0],
      id: "60000000-0000-4000-8000-000000000006",
      decision: "disabled",
      created_at: "2026-10-02T00:00:00Z",
    });
    expect(await readAgentResearchProfileVersion(client(rows) as never, scope)).toEqual({
      kind: "blocked",
      reasonCode: "PROFILE_NOT_CONFIRMED",
    });
    rows.organization_market_profile_decisions = [];
    expect(await readAgentResearchProfileVersion(client(rows) as never, scope)).toEqual({
      kind: "blocked",
      reasonCode: "PROFILE_NOT_CONFIRMED",
    });
  });
  it("refuses disabled and replaced profile versions", async () => {
    const rows = tables();
    rows.organization_market_profiles[0].enabled = false;
    expect((await readAgentResearchProfileVersion(client(rows) as never, scope)).kind).toBe(
      "blocked",
    );
    rows.organization_market_profiles[0].enabled = true;
    rows.organization_market_profiles[0].current_version_id = PROFILE;
    expect((await readAgentResearchProfileVersion(client(rows) as never, scope)).kind).toBe(
      "blocked",
    );
  });
  it("never substitutes another tenant or an unspecified or different branch", async () => {
    for (const selected of [
      { ...scope, organizationId: PROFILE },
      { ...scope, branchId: PROFILE },
      { organizationId: ORG, versionId: VERSION },
    ]) {
      expect(
        (await readAgentResearchProfileVersion(client(tables()) as never, selected)).kind,
      ).toBe("blocked");
    }
  });
  it("refuses malformed documents, moved digests, and confirmation digest disagreement", async () => {
    const rows = tables();
    rows.organization_market_profile_versions[0].profile_document = {
      publicBusinessName: "obsolete shape",
    };
    expect((await readAgentResearchProfileVersion(client(rows) as never, scope)).kind).toBe(
      "blocked",
    );
    rows.organization_market_profile_versions[0].profile_document = document;
    rows.organization_market_profile_versions[0].profile_digest = "a".repeat(64);
    expect((await readAgentResearchProfileVersion(client(rows) as never, scope)).kind).toBe(
      "blocked",
    );
    rows.organization_market_profile_versions[0].profile_digest = digest;
    rows.organization_market_profile_decisions[0].profile_digest = "a".repeat(64);
    expect((await readAgentResearchProfileVersion(client(rows) as never, scope)).kind).toBe(
      "blocked",
    );
  });
  it("fails closed on source read denial without returning private payloads", async () => {
    for (const table of Object.keys(tables())) {
      expect(
        (await readAgentResearchProfileVersion(client(tables(), table) as never, scope)).kind,
      ).toBe("blocked");
    }
  });
});
