import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "@/domain/economics/rollup";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import type { EconomicsView } from "@/modules/economics/application/read-model";
import {
  buildDigitalTwinReadiness,
  buildOverviewActionQueue,
  buildOverviewEconomics,
  buildOverviewIntegration,
  buildStrategicBriefing,
  getOverviewPermissions,
  selectRecentCampaigns,
} from "@/modules/organizations/application/overview";
import { demoCampaigns } from "@/modules/campaigns/demo/fixtures";
import type { IntegrationHubSnapshot } from "@/modules/integrations/application/read-model";

const organizationId = "11111111-1111-4111-8111-111111111111";

function snapshot(overrides: Partial<DigitalTwinSnapshot> = {}): DigitalTwinSnapshot {
  return {
    organization: {
      id: organizationId,
      name: "Al Noor Kitchen",
      slug: "al-noor-kitchen",
      industry: "restaurant",
      country_code: "AE",
      base_currency: "AED",
      default_timezone: "Asia/Dubai",
      industry_pack_slug: "restaurant",
      branchless_confirmed: false,
      status: "draft_onboarding",
      created_by: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-12T08:00:00.000Z",
      archived_at: null,
    },
    branches: [],
    profile: null,
    facts: [],
    goals: [],
    constraints: [],
    policies: [],
    auditEvents: [],
    ...overrides,
  };
}

function ledgerEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    channel: "direct",
    periodStart: new Date("2026-08-10T20:00:00.000Z"),
    grossRevenueMinor: 10_000,
    transactionCount: 10,
    currency: "AED",
    marginSource: "derived",
    completenessGrade: "complete",
    contributionMarginMinor: 3_000,
    atMostMinor: null,
    reportedMarginMinor: null,
    components: [],
    ...overrides,
  };
}

function economicsView(): EconomicsView {
  return {
    window: {
      preset: "30d",
      rangeStart: new Date("2026-07-13T20:00:00.000Z"),
      rangeEndExclusive: new Date("2026-08-12T20:00:00.000Z"),
      timeZone: "Asia/Dubai",
    },
    rollup: {
      channels: [
        {
          channel: "direct",
          currency: "AED",
          grossRevenueMinor: 10_000,
          transactionCount: 10,
          periodCount: 1,
          marginSource: "derived",
          grade: "complete",
          contributionMarginMinor: 3_000,
          marginRate: 0.3,
        },
        {
          channel: "marketplace",
          currency: "AED",
          grossRevenueMinor: 5_000,
          transactionCount: 5,
          periodCount: 1,
          marginSource: "derived",
          grade: "indicative",
          atMostMinor: 2_000,
        },
      ],
      currency: "AED",
      hasAnyDerivedChannel: true,
    },
    breakdown: null,
    gaps: [
      {
        key: "packaging",
        label: "Packaging",
        state: "not_yet_possible",
        reason: "No item count is being imported yet.",
      },
    ],
    coverage: { measured: 2, priced: 3, applicable: 5 },
    catalogAvailable: true,
  };
}

describe("Digital Twin readiness", () => {
  it("keeps a restaurant incomplete until a physical branch or branchless confirmation exists", () => {
    const readiness = buildDigitalTwinReadiness(snapshot());

    expect(readiness.sections.map(({ label, complete }) => [label, complete])).toEqual([
      ["Identity", true],
      ["Branches", false],
      ["Business profile", false],
      ["Facts", false],
      ["Goals", false],
      ["Policies", false],
    ]);
    expect(readiness.groundedCount).toBe(1);
    expect(readiness.percentage).toBe(17);
  });

  it("accepts an explicit branchless confirmation for the branch section", () => {
    const current = snapshot();
    const readiness = buildDigitalTwinReadiness(
      snapshot({ organization: { ...current.organization, branchless_confirmed: true } }),
    );

    expect(readiness.sections.find(({ key }) => key === "branches")?.complete).toBe(true);
  });
});

describe("overview economics", () => {
  it("groups daily points with the same weakest-grade rules as the ledger rollup", () => {
    const entries = [
      ledgerEntry(),
      ledgerEntry({
        channel: "marketplace",
        grossRevenueMinor: 5_000,
        transactionCount: 5,
        completenessGrade: "indicative",
        contributionMarginMinor: null,
        atMostMinor: 2_000,
      }),
    ];

    const result = buildOverviewEconomics({ view: economicsView(), entries });

    expect(result.state).toBe("ready");
    expect(result.trend).toEqual([
      {
        periodStart: "2026-08-10T20:00:00.000Z",
        grossRevenueMinor: 15_000,
        contributionMarginMinor: null,
        atMostMinor: 5_000,
        grade: "indicative",
      },
    ]);
    expect(result.gradeCounts).toEqual({ complete: 0, partial: 0, indicative: 1 });
    expect(result.channels[0]?.grossRevenueMinor + result.channels[1]?.grossRevenueMinor).toBe(
      15_000,
    );
  });

  it("returns an honest empty state instead of an all-zero chart", () => {
    const view = economicsView();
    view.rollup = { channels: [], currency: null, hasAnyDerivedChannel: false };

    expect(buildOverviewEconomics({ view, entries: [] })).toMatchObject({
      state: "empty",
      trend: [],
      channels: [],
    });
  });
});

describe("overview intelligence", () => {
  it("explains evidence limitations without lift, causal, benchmark, or forecast claims", () => {
    const entries = [
      ledgerEntry({
        completenessGrade: "indicative",
        contributionMarginMinor: null,
        atMostMinor: 4_000,
      }),
    ];
    const briefing = buildStrategicBriefing({
      readiness: buildDigitalTwinReadiness(snapshot()),
      economics: buildOverviewEconomics({ view: economicsView(), entries }),
      integration: {
        status: "ready",
        totalConnections: 2,
        healthyConnections: 1,
        actionRequiredConnections: 1,
      },
    });

    expect(briefing).toHaveLength(3);
    expect(briefing.map(({ kind }) => kind)).toEqual(["foundation", "economics", "operations"]);
    expect(briefing.map(({ conclusion }) => conclusion).join(" ")).not.toMatch(
      /lift|causal|benchmark|forecast/i,
    );
    expect(briefing[1]?.conclusion).toMatch(/limited/i);
  });

  it("prioritizes blocking policy, integration, and economics gaps with role-valid actions", () => {
    const readiness = buildDigitalTwinReadiness(snapshot());
    const entries = [
      ledgerEntry({
        completenessGrade: "indicative",
        contributionMarginMinor: null,
        atMostMinor: 4_000,
      }),
    ];
    const actions = buildOverviewActionQueue({
      organizationId,
      readiness,
      economics: buildOverviewEconomics({ view: economicsView(), entries }),
      integration: {
        status: "ready",
        totalConnections: 2,
        healthyConnections: 1,
        actionRequiredConnections: 1,
      },
      permissions: getOverviewPermissions("admin"),
    });

    expect(actions.map(({ kind }) => kind)).toEqual(["foundation", "integration", "economics"]);
    expect(actions[0]).toMatchObject({
      title: "Add an access policy",
      href: "#organization-management",
    });
    expect(actions[1]?.href).toBe(`/organizations/${organizationId}/integrations`);
    expect(actions[2]?.href).toBe(
      `/organizations/${organizationId}/onboarding?section=cost_structure`,
    );
  });

  it("does not offer a viewer a mutation they cannot complete", () => {
    const actions = buildOverviewActionQueue({
      organizationId,
      readiness: buildDigitalTwinReadiness(snapshot()),
      economics: { status: "failed" },
      integration: { status: "disabled" },
      permissions: getOverviewPermissions("viewer"),
    });

    expect(actions[0]).toMatchObject({ kind: "foundation" });
    expect(actions[0]).not.toHaveProperty("href");
  });

  it.each<[OrganizationRole, boolean, boolean, boolean]>([
    ["owner", true, true, true],
    ["admin", true, true, true],
    ["operator", true, false, false],
    ["viewer", false, false, false],
  ])(
    "maps %s to the existing mutation boundary",
    (role, canManageCore, canManagePolicies, canManageLifecycle) => {
      expect(getOverviewPermissions(role)).toEqual({
        canManageCore,
        canManagePolicies,
        canManageLifecycle,
      });
    },
  );

  it("selects exactly the latest three campaign previews without mutating the fixture list", () => {
    const before = demoCampaigns.map(({ id }) => id);

    expect(selectRecentCampaigns(demoCampaigns).map(({ title }) => title)).toEqual([
      "Weekday evening demand lift",
      "New location announcement",
      "Early-week lunch trial",
    ]);
    expect(demoCampaigns.map(({ id }) => id)).toEqual(before);
  });

  it("orders action-required integrations first and exposes only safe presentation fields", () => {
    const connection = (
      id: string,
      state: "healthy" | "pending" | "degraded" | "stale" | "revoked",
    ): IntegrationHubSnapshot["connections"][number] => ({
      id,
      organization_id: organizationId,
      provider_key: "google_business_profile",
      adapter_version: "1.0.0",
      connection_mode: "fixture",
      status: state === "revoked" ? "revoked" : state === "degraded" ? "degraded" : "active",
      external_account_id: `account-${id}`,
      external_account_label: `Location ${id}`,
      granted_scopes: ["business.manage"],
      token_expires_at: null,
      last_tested_at: "2026-08-12T08:00:00.000Z",
      last_successful_sync_at: "2026-08-12T08:00:00.000Z",
      next_scheduled_sync_at: "2026-08-12T09:00:00.000Z",
      created_by: "22222222-2222-4222-8222-222222222222",
      created_at: "2026-08-01T08:00:00.000Z",
      updated_at: "2026-08-12T08:00:00.000Z",
      latestHealth: null,
      health: {
        state,
        reasonCode: state,
        explanation: `${state} explanation`,
        lastTestedAt: "2026-08-12T08:00:00.000Z",
        lastSuccessfulSyncAt: "2026-08-12T08:00:00.000Z",
        evaluatedAt: "2026-08-12T08:05:00.000Z",
      },
      capabilities: [],
      mappings: [],
    });
    const snapshot: IntegrationHubSnapshot = {
      summary: {
        totalConnections: 4,
        healthyConnections: 1,
        actionRequiredConnections: 2,
        dataSources: 0,
      },
      connections: [
        connection("healthy", "healthy"),
        connection("pending", "pending"),
        connection("stale", "stale"),
        connection("degraded", "degraded"),
      ],
      dataSources: [],
      branches: [],
      recentActivity: [],
      serverTime: "2026-08-12T08:05:00.000Z",
    };

    expect(buildOverviewIntegration(snapshot).connections).toEqual([
      {
        id: "stale",
        providerKey: "google_business_profile",
        accountLabel: "Location stale",
        state: "stale",
        explanation: "stale explanation",
        lastSuccessfulSyncAt: "2026-08-12T08:00:00.000Z",
      },
      {
        id: "degraded",
        providerKey: "google_business_profile",
        accountLabel: "Location degraded",
        state: "degraded",
        explanation: "degraded explanation",
        lastSuccessfulSyncAt: "2026-08-12T08:00:00.000Z",
      },
      {
        id: "healthy",
        providerKey: "google_business_profile",
        accountLabel: "Location healthy",
        state: "healthy",
        explanation: "healthy explanation",
        lastSuccessfulSyncAt: "2026-08-12T08:00:00.000Z",
      },
    ]);
  });
});
