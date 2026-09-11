/**
 * TEST-ONLY fixtures for the Channels redesign review (Spec 018, Task 8).
 *
 * Never import this module from production code. It exists for two consumers
 * only: vitest suites (files ending `.test.ts` / `.test.tsx`) and the
 * temporary development-only harness at
 * `src/app/design-review-channels/page.tsx`, which is deleted before the
 * release build. A guard test in `./channels-redesign.test.tsx` fails the
 * suite if any other module imports this path.
 *
 * Values follow the implementation plan §7 matrix verbatim: reference
 * organization `11111111-1111-4111-8111-111111111111` ("Example Kitchen" is a
 * test-only display label), actor `33333333-3333-4333-8333-333333333333`,
 * channels `...0001`–`...0005`, February/January minor units. Records carry
 * every field of their database row type -- no partial casts.
 */

import type { AnalysisGrain } from "@/domain/analysis/types";
import type {
  ChannelBandRecord,
  ChannelEvidenceWindow,
  ChannelFindingRecord,
} from "@/modules/analysis/application/ports";
import type {
  ChannelSourceAliasRow,
  OrganizationBranchRow,
  OrganizationChannelBranchRow,
  OrganizationChannelRow,
} from "@/modules/channels/application/ports";

export const REDESIGN_ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
/** Test-only display label. Production never ships this name. */
export const REDESIGN_ORGANIZATION_NAME = "Example Kitchen";
export const REDESIGN_CURRENCY = "AED";
export const REDESIGN_TIMEZONE = "Asia/Dubai";
export const REDESIGN_ACTOR_ID = "33333333-3333-4333-8333-333333333333";

const CREATED_AT = "2026-02-28T00:00:00.000Z";

export const CHANNEL_ID_A = "22222222-2222-4222-8222-222222220001";
export const CHANNEL_ID_B = "22222222-2222-4222-8222-222222220002";
export const CHANNEL_ID_DIRECT = "22222222-2222-4222-8222-222222220003";
export const CHANNEL_ID_INSTORE = "22222222-2222-4222-8222-222222220004";
export const CHANNEL_ID_PREVIOUS = "22222222-2222-4222-8222-222222220005";

function channel(
  id: string,
  suffix: string,
  overrides: Partial<OrganizationChannelRow> = {},
): OrganizationChannelRow {
  return {
    id,
    organization_id: REDESIGN_ORGANIZATION_ID,
    key: `channel-${suffix}`,
    display_name: `Channel ${suffix}`,
    category: "marketplace",
    template_key: null,
    status: "active",
    created_by: REDESIGN_ACTOR_ID,
    archived_by: null,
    archived_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

/** §7 reference channels: A/B complete, Direct revenue-only, In-store refused, Previous archived. */
export const CHANNEL_A = channel(CHANNEL_ID_A, "a", {
  key: "delivery-a",
  display_name: "Delivery A",
  category: "marketplace",
});
export const CHANNEL_B = channel(CHANNEL_ID_B, "b", {
  key: "delivery-b",
  display_name: "Delivery B",
  category: "marketplace",
});
export const CHANNEL_DIRECT = channel(CHANNEL_ID_DIRECT, "direct", {
  key: "direct",
  display_name: "Direct",
  category: "owned_digital",
});
export const CHANNEL_INSTORE = channel(CHANNEL_ID_INSTORE, "instore", {
  key: "in-store",
  display_name: "In-store",
  category: "physical",
});
export const CHANNEL_PREVIOUS = channel(CHANNEL_ID_PREVIOUS, "previous", {
  key: "previous",
  display_name: "Previous",
  category: "marketplace",
  status: "archived",
  archived_by: REDESIGN_ACTOR_ID,
  archived_at: "2026-01-15T00:00:00.000Z",
});

export const REDESIGN_CHANNELS: readonly OrganizationChannelRow[] = [
  CHANNEL_A,
  CHANNEL_B,
  CHANNEL_DIRECT,
  CHANNEL_INSTORE,
  CHANNEL_PREVIOUS,
];

export const REDESIGN_ACTIVE_CHANNELS: readonly OrganizationChannelRow[] = REDESIGN_CHANNELS.filter(
  (entry) => entry.status === "active",
);

/** 160-character display name for the long-name layout case (§7). */
export const LONG_CHANNEL_NAME = `Northgate Grand Marketplace flagship storefront ${"x".repeat(112)}`;

export const BRANCH_BARSHA_ID = "44444444-4444-4444-8444-444444444441";
export const BRANCH_DEIRA_ID = "44444444-4444-4444-8444-444444444442";
export const BRANCH_RETIRED_ID = "44444444-4444-4444-8444-444444444443";

function branch(id: string, name: string, slug: string, isActive: boolean): OrganizationBranchRow {
  return {
    id,
    organization_id: REDESIGN_ORGANIZATION_ID,
    name,
    slug,
    kind: "physical",
    timezone: REDESIGN_TIMEZONE,
    currency: REDESIGN_CURRENCY,
    service_area: {},
    operating_hours: {},
    contact_details: {},
    capacity_metadata: {},
    is_active: isActive,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

export const BRANCH_BARSHA = branch(BRANCH_BARSHA_ID, "Al Barsha", "al-barsha", true);
export const BRANCH_DEIRA = branch(BRANCH_DEIRA_ID, "Deira", "deira", true);
/** Retired branch: mappings may still reference it, but it never appears in outlet choices. */
export const BRANCH_RETIRED = branch(BRANCH_RETIRED_ID, "Old Souq", "old-souq", false);

export const REDESIGN_BRANCHES: readonly OrganizationBranchRow[] = [
  BRANCH_BARSHA,
  BRANCH_DEIRA,
  BRANCH_RETIRED,
];

export const REDESIGN_ACTIVE_BRANCHES: readonly OrganizationBranchRow[] = REDESIGN_BRANCHES.filter(
  (entry) => entry.is_active,
);

let mappingSequence = 0;
function mapping(
  channelId: string,
  branchId: string,
  overrides: Partial<OrganizationChannelBranchRow> = {},
): OrganizationChannelBranchRow {
  mappingSequence += 1;
  return {
    id: `55555555-5555-4555-8555-5555555555${String(mappingSequence).padStart(2, "0")}`,
    organization_id: REDESIGN_ORGANIZATION_ID,
    channel_id: channelId,
    branch_id: branchId,
    status: "active",
    effective_from: null,
    effective_to: null,
    created_by: REDESIGN_ACTOR_ID,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

/**
 * §7 mapping cases: A has two active mappings; B has one active + one
 * inactive; In-store keeps an inactive mapping whose branch is retired (the
 * ghost-name case); Direct and Previous have none.
 */
export const MAPPING_A_BARSHA = mapping(CHANNEL_ID_A, BRANCH_BARSHA_ID, {
  effective_from: "2026-01-01",
  effective_to: "2026-12-31",
});
export const MAPPING_A_DEIRA = mapping(CHANNEL_ID_A, BRANCH_DEIRA_ID);
export const MAPPING_B_BARSHA = mapping(CHANNEL_ID_B, BRANCH_BARSHA_ID);
export const MAPPING_B_DEIRA = mapping(CHANNEL_ID_B, BRANCH_DEIRA_ID, {
  status: "inactive",
  effective_from: "2026-01-01",
  effective_to: "2026-01-31",
});
export const MAPPING_INSTORE_RETIRED = mapping(CHANNEL_ID_INSTORE, BRANCH_RETIRED_ID, {
  status: "inactive",
});

export const REDESIGN_MAPPINGS: readonly OrganizationChannelBranchRow[] = [
  MAPPING_A_BARSHA,
  MAPPING_A_DEIRA,
  MAPPING_B_BARSHA,
  MAPPING_B_DEIRA,
  MAPPING_INSTORE_RETIRED,
];

let aliasSequence = 0;
function alias(
  channelId: string,
  text: string,
  sourceScope: ChannelSourceAliasRow["source_scope"],
): ChannelSourceAliasRow {
  aliasSequence += 1;
  return {
    id: `66666666-6666-4666-8666-6666666666${String(aliasSequence).padStart(2, "0")}`,
    organization_id: REDESIGN_ORGANIZATION_ID,
    channel_id: channelId,
    alias: text,
    normalized_alias: text.trim().toLowerCase(),
    source_scope: sourceScope,
    source_record_reference: null,
    status: "active",
    effective_from: null,
    effective_to: null,
    confirmed_at: null,
    created_by: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
  };
}

export const ALIAS_A_ORDERS = alias(CHANNEL_ID_A, "Delivery A orders", "report_package");
export const ALIAS_A_DAILY = alias(CHANNEL_ID_A, "delivery-a daily", "normalized_metric");
/** Punctuation and semicolons travel literally inside one alias (§7). */
export const ALIAS_DIRECT_PUNCTUATED = alias(
  CHANNEL_ID_DIRECT,
  "Website orders; online, app",
  "manual",
);

export const REDESIGN_ALIASES: readonly ChannelSourceAliasRow[] = [
  ALIAS_A_ORDERS,
  ALIAS_A_DAILY,
  ALIAS_DIRECT_PUNCTUATED,
];

export type RedesignWindowFixture = {
  windowStart: string;
  windowEnd: string;
  grain: AnalysisGrain;
  value: string;
};

/** February §7 window: value `2026-02-01..2026-02-28..month`. */
export const WINDOW_FEB: RedesignWindowFixture = {
  windowStart: "2026-02-01",
  windowEnd: "2026-02-28",
  grain: "month",
  value: "2026-02-01..2026-02-28..month",
};
/** January §7 window. */
export const WINDOW_JAN: RedesignWindowFixture = {
  windowStart: "2026-01-01",
  windowEnd: "2026-01-31",
  grain: "month",
  value: "2026-01-01..2026-01-31..month",
};
/** Partial-range case: Jan 1–Feb 28 at day grain is the full range, not February. */
export const WINDOW_JAN_FEB_DAY: RedesignWindowFixture = {
  windowStart: "2026-01-01",
  windowEnd: "2026-02-28",
  grain: "day",
  value: "2026-01-01..2026-02-28..day",
};
/** March 2–8 at week grain alongside March month/span. */
export const WINDOW_MARCH_WEEK: RedesignWindowFixture = {
  windowStart: "2026-03-02",
  windowEnd: "2026-03-08",
  grain: "week",
  value: "2026-03-02..2026-03-08..week",
};
export const WINDOW_MARCH_MONTH: RedesignWindowFixture = {
  windowStart: "2026-03-01",
  windowEnd: "2026-03-31",
  grain: "month",
  value: "2026-03-01..2026-03-31..month",
};
export const WINDOW_MARCH_SPAN: RedesignWindowFixture = {
  windowStart: "2026-03-01",
  windowEnd: "2026-03-31",
  grain: "span",
  value: "2026-03-01..2026-03-31..span",
};

let packageSequence = 0;
/** Declared evidence windows feeding the real overview builder (newest last; builder sorts). */
export function evidenceWindowsFor(
  fixtures: readonly RedesignWindowFixture[],
): ChannelEvidenceWindow[] {
  return fixtures.map((fixture) => {
    packageSequence += 1;
    return {
      packageId: `77777777-7777-4777-8777-7777777777${String(packageSequence).padStart(2, "0")}`,
      channelId: CHANNEL_ID_A,
      branchId: null,
      windowStart: fixture.windowStart,
      windowEnd: fixture.windowEnd,
      timeZone: REDESIGN_TIMEZONE,
      grain: fixture.grain,
      governedRowCount: 20,
      sourceFilename: "redesign-fixture.xlsx",
    };
  });
}

export const REDESIGN_EVIDENCE_WINDOWS: ChannelEvidenceWindow[] = evidenceWindowsFor([
  WINDOW_JAN,
  WINDOW_FEB,
  WINDOW_JAN_FEB_DAY,
  WINDOW_MARCH_WEEK,
  WINDOW_MARCH_MONTH,
  WINDOW_MARCH_SPAN,
]);

export type BandMoneyFixture = {
  /** Reported revenue in minor units. Omit for a refused band. */
  grossMinorUnits?: number;
  /** Provider-reported loss in minor units. Omit for revenue-only/refused. */
  lostMinorUnits?: number;
  currency?: string;
};

/**
 * One channel's band record in the shape the overview builder reads: a
 * `WINDOW_GROSS_REVENUE` money finding plus an `ORDER_CANCELLATION_LOSS`
 * impact finding. Mirrors the builder's own test scaffolding field for
 * field so the derived views stay honest.
 */
export function bandRecord(
  channelId: string,
  money: BandMoneyFixture,
  runId = `run-${channelId.slice(-4)}`,
): ChannelBandRecord {
  const currency = money.currency ?? REDESIGN_CURRENCY;
  const findings: ChannelFindingRecord[] = [];
  if (money.grossMinorUnits !== undefined) {
    findings.push({
      id: `f-gross-${channelId.slice(-4)}`,
      analysisRunId: runId,
      channelId,
      branchId: null,
      detectorKey: "revenue.window_gross",
      detectorVersion: 1,
      kind: "observation",
      code: "WINDOW_GROSS_REVENUE",
      severity: null,
      priority: null,
      metricKey: "revenue.gross",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      valueKind: "money",
      valueNumerator: money.grossMinorUnits,
      valueDenominator: null,
      currency,
      monetaryImpactMinorUnits: null,
      expectedPeriodCount: 28,
      observedPeriodCount: 28,
      absentPeriodCount: 0,
      qualityState: "complete",
      needsDataReason: null,
      limitations: [],
      calculationDigest: "b".repeat(64),
      createdAt: "2026-02-28T00:00:00Z",
    });
  }
  if (money.lostMinorUnits !== undefined) {
    findings.push({
      id: `f-loss-${channelId.slice(-4)}`,
      analysisRunId: runId,
      channelId,
      branchId: null,
      detectorKey: "orders.cancellation_loss",
      detectorVersion: 1,
      kind: "observation",
      code: "ORDER_CANCELLATION_LOSS",
      severity: null,
      priority: null,
      metricKey: "order.avoidable_cancellation_count",
      periodStart: "2026-02-01",
      periodEnd: "2026-02-28",
      valueKind: "count",
      valueNumerator: 10,
      valueDenominator: null,
      currency,
      monetaryImpactMinorUnits: money.lostMinorUnits,
      expectedPeriodCount: 28,
      observedPeriodCount: 28,
      absentPeriodCount: 0,
      qualityState: "complete",
      needsDataReason: null,
      limitations: [],
      calculationDigest: "b".repeat(64),
      createdAt: "2026-02-28T00:00:00Z",
    });
  }
  return { channelId, analysisRunId: runId, findings };
}

/**
 * February §7 bands: A 8,000,000/400,000/7,600,000; B
 * 4,000,000/200,000/3,800,000; Direct 1,800,000 revenue-only; In-store
 * refused (no record); Previous archived with no band.
 */
export function februaryBands(): ChannelBandRecord[] {
  return [
    bandRecord(CHANNEL_ID_A, { grossMinorUnits: 8_000_000, lostMinorUnits: 400_000 }),
    bandRecord(CHANNEL_ID_B, { grossMinorUnits: 4_000_000, lostMinorUnits: 200_000 }),
    bandRecord(CHANNEL_ID_DIRECT, { grossMinorUnits: 1_800_000 }),
  ];
}

/**
 * January §7 bands: A 7,000,000/350,000/6,650,000; B
 * 3,200,000/160,000/3,040,000; Direct 1,500,000 revenue-only; In-store
 * refused.
 */
export function januaryBands(): ChannelBandRecord[] {
  return [
    bandRecord(CHANNEL_ID_A, { grossMinorUnits: 7_000_000, lostMinorUnits: 350_000 }),
    bandRecord(CHANNEL_ID_B, { grossMinorUnits: 3_200_000, lostMinorUnits: 160_000 }),
    bandRecord(CHANNEL_ID_DIRECT, { grossMinorUnits: 1_500_000 }),
  ];
}

/**
 * Archived-money exclusion case (§7): the archived Previous channel carries
 * nonzero money. It must never contribute to active sums, shares, or counts.
 */
export function februaryBandsWithArchivedMoney(): ChannelBandRecord[] {
  return [
    ...februaryBands(),
    bandRecord(CHANNEL_ID_PREVIOUS, { grossMinorUnits: 5_000_000, lostMinorUnits: 250_000 }),
  ];
}

/** Mixed-currency case (§7): complete AED alongside complete USD. */
export function mixedCurrencyBands(): ChannelBandRecord[] {
  return [
    bandRecord(CHANNEL_ID_A, { grossMinorUnits: 8_000_000, lostMinorUnits: 400_000 }),
    bandRecord(CHANNEL_ID_B, {
      grossMinorUnits: 4_000_000,
      lostMinorUnits: 200_000,
      currency: "USD",
    }),
    bandRecord(CHANNEL_ID_DIRECT, { grossMinorUnits: 1_800_000 }),
  ];
}

/** Recorded-zero case (§7): complete zeros stay Measured and count as reported. */
export function zeroBands(): ChannelBandRecord[] {
  return [bandRecord(CHANNEL_ID_A, { grossMinorUnits: 0, lostMinorUnits: 0 })];
}

/** Signed-adjustment case (§7): negative reported revenue stays signed. */
export function signedBands(): ChannelBandRecord[] {
  return [bandRecord(CHANNEL_ID_A, { grossMinorUnits: -500_000, lostMinorUnits: 0 })];
}

export type PermissionPreset = { canManage: boolean; canMapBranches: boolean };

/** §7 permission matrix: manager true/true, operator false/true, viewer false/false. */
export const PERMISSIONS: Record<"manager" | "operator" | "viewer", PermissionPreset> = {
  manager: { canManage: true, canMapBranches: true },
  operator: { canManage: false, canMapBranches: true },
  viewer: { canManage: false, canMapBranches: false },
};
