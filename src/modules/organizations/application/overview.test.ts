import { describe, expect, it } from "vitest";

import type { LedgerEntry } from "@/domain/economics/rollup";
import type { OrganizationRole } from "@/domain/organizations/types";
import type { DigitalTwinSnapshot } from "@/modules/organizations/infrastructure/repository";
import type { EconomicsView } from "@/modules/economics/application/read-model";
import {
  buildDigitalTwinReadiness,
  buildOverviewActionQueue,
  buildOverviewComparison,
  buildOverviewEconomics,
  buildOverviewIntegration,
  buildOverviewMoneyScale,
  getOverviewPermissions,
} from "@/modules/organizations/application/overview";
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
      account_id: "33333333-3333-4333-8333-333333333333",
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

describe("overview money scale", () => {
  it("sums only the costs that were recorded, never sales minus the kept floor", () => {
    const scale = buildOverviewMoneyScale(
      buildOverviewEconomics({
        view: economicsView(),
        entries: [
          ledgerEntry({ grossRevenueMinor: 10_000, contributionMarginMinor: 3_000 }),
          ledgerEntry({
            periodStart: new Date("2026-08-11T20:00:00.000Z"),
            grossRevenueMinor: 8_000,
            completenessGrade: "indicative",
            contributionMarginMinor: null,
            atMostMinor: 2_500,
          }),
        ],
      }),
    );

    // Sales counts both days; costs count only the day that recorded them.
    // 18,000 - 3,000 would read as 15,000 of costs and be a guess about day two.
    expect(scale).toEqual({
      currency: "AED",
      salesMinor: 18_000,
      costsRecordedMinor: 7_000,
      keptFloorMinor: 3_000,
      keptCeilingMinor: 5_500,
      hasUnprovenBand: true,
    });
  });

  it("closes the band when every recorded day can state a margin", () => {
    const scale = buildOverviewMoneyScale(
      buildOverviewEconomics({
        view: economicsView(),
        entries: [ledgerEntry({ grossRevenueMinor: 10_000, contributionMarginMinor: 3_000 })],
      }),
    );

    expect(scale).toMatchObject({ keptFloorMinor: 3_000, keptCeilingMinor: 3_000 });
    expect(scale?.hasUnprovenBand).toBe(false);
  });

  it("states no scale at all for a window with no recorded trade", () => {
    expect(
      buildOverviewMoneyScale(buildOverviewEconomics({ view: economicsView(), entries: [] })),
    ).toBeNull();
  });
});

describe("overview comparison", () => {
  const current = () =>
    buildOverviewEconomics({
      view: economicsView(),
      entries: [ledgerEntry({ grossRevenueMinor: 12_000 })],
    });

  it("stores both amounts and their difference, and never a ratio", () => {
    const comparison = buildOverviewComparison({
      economics: current(),
      priorEntries: [ledgerEntry({ grossRevenueMinor: 10_000 })],
    });

    expect(comparison).toEqual({
      currency: "AED",
      currentMinor: 12_000,
      priorMinor: 10_000,
      deltaMinor: 2_000,
    });
    // The percentage is the caller's display-time division of the two.
    expect(comparison).not.toHaveProperty("deltaRatio");
  });

  it("refuses a comparison against a window that recorded nothing", () => {
    expect(buildOverviewComparison({ economics: current(), priorEntries: [] })).toBeNull();
  });

  it("refuses a comparison when the prior window is in another currency", () => {
    expect(
      buildOverviewComparison({
        economics: current(),
        priorEntries: [ledgerEntry({ grossRevenueMinor: 10_000, currency: "KWD" })],
      }),
    ).toBeNull();
  });

  it("refuses a comparison when this window recorded nothing", () => {
    expect(
      buildOverviewComparison({
        economics: buildOverviewEconomics({ view: economicsView(), entries: [] }),
        priorEntries: [ledgerEntry({ grossRevenueMinor: 10_000 })],
      }),
    ).toBeNull();
  });
});

describe("overview intelligence", () => {
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
      title: "Nobody is named as the approver yet",
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
