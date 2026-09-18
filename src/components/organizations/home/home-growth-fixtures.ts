import {
  growthProgressSectionSchema,
  type GrowthProgressSection,
  type GrowthProgressView,
} from "@/modules/organizations/application/growth-progress-view";

/**
 * TEST-ONLY September 2026 view fixtures (visual contract V08).
 *
 * These are presentational view DTOs shaped exactly like the loader output,
 * with the V08 illustrative drawing values — never production data and never
 * a fallback for a missing projection. Production code (loaders, services,
 * repositories, workers, route handlers) MUST NOT import this module; the
 * boundary is enforced by `home-revenue.test.tsx` ("blocked production
 * fixture imports"), which fails if any non-test source file references it.
 *
 * Behind/ahead share one frozen projection identity and one projected series:
 * only the actuals, the comparison and the advice differ. `buildBehind…` and
 * `buildAhead…` construct the projected points from the same literal table so
 * the byte-identity is structural, and the test suite pins it with a deep
 * equality check.
 */

const PROJECTION_ID = "9f3b7c2e-6b1a-4d0e-9c5d-2a8e6f0b4c1d";
const PROJECTION_DIGEST = "fixture-digest-september-2026-v1";

const CURRENCY = "AED";
const SCOPE_LABEL = "2 channels";
const ISSUED_AT = "2026-09-01T00:00:00.000Z";
const SOURCE_CUTOFF_DATE = "2026-09-21";
const LATEST_COMPARABLE_DATE = "2026-09-21";

/** Frozen illustrative projected series: date, low/central/high in minor units. */
const PROJECTED_SERIES: ReadonlyArray<readonly [string, number, number, number]> = [
  ["2026-09-07", 2_200_000, 2_400_000, 2_600_000],
  ["2026-09-14", 4_800_000, 5_200_000, 5_600_000],
  ["2026-09-21", 8_000_000, 8_400_000, 8_800_000],
  ["2026-09-30", 11_200_000, 12_000_000, 12_800_000],
];

const LIMITATIONS = ["Estimate assumes steady sales and the included actions."];
const SOURCES = [{ label: "2 reporting channels", href: null }] as const;

function projectedPoints() {
  return PROJECTED_SERIES.map(([date, lowMinor, centralMinor, highMinor]) => ({
    date,
    currentMinor: null as number | null,
    projectedLowMinor: lowMinor,
    projectedCentralMinor: centralMinor,
    projectedHighMinor: highMinor,
    currentCoverage: "missing" as const,
    reasonCode: "FUTURE_DATE" as const,
    breakBefore: false,
  }));
}

function withActuals(
  actuals: ReadonlyArray<readonly [string, number]>,
): GrowthProgressView["points"] {
  const actualByDate = new Map(actuals.map(([date, minor]) => [date, minor] as const));
  return projectedPoints().map((point) => {
    const currentMinor = actualByDate.get(point.date) ?? null;
    if (currentMinor === null) return point;
    return { ...point, currentMinor, currentCoverage: "complete" as const, reasonCode: null };
  });
}

function missingHorizonView(
  horizonMonths: 3 | 6 | 12,
  endDateExclusive: string,
  organizationId: string,
): GrowthProgressView {
  void organizationId;
  return {
    horizonMonths,
    state: "missing",
    reasonCode: "PROJECTION_MISSING",
    projectionId: null,
    projectionDigest: null,
    period: {
      horizonMonths,
      cycleIndex: 0,
      startDate: "2026-09-01",
      endDateExclusive,
    },
    currency: CURRENCY,
    scopeLabel: SCOPE_LABEL,
    issuedAt: null,
    sourceCutoffDate: null,
    latestComparableDate: null,
    points: [],
    latestComparison: null,
    adviceRows: [],
    limitations: [],
    freshness: { status: "awaiting_reports", note: null },
    sources: [],
  };
}

function readyView(options: {
  organizationId: string;
  actuals: ReadonlyArray<readonly [string, number]>;
  latestComparison: NonNullable<GrowthProgressView["latestComparison"]>;
  adviceRows: GrowthProgressView["adviceRows"];
}): GrowthProgressView {
  const workspaceHref = `/organizations/${options.organizationId}/growth-intelligence#recommendations`;
  return {
    horizonMonths: 1,
    state: "ready",
    reasonCode: null,
    projectionId: PROJECTION_ID,
    projectionDigest: PROJECTION_DIGEST,
    period: {
      horizonMonths: 1,
      cycleIndex: 0,
      startDate: "2026-09-01",
      endDateExclusive: "2026-10-01",
    },
    currency: CURRENCY,
    scopeLabel: SCOPE_LABEL,
    issuedAt: ISSUED_AT,
    sourceCutoffDate: SOURCE_CUTOFF_DATE,
    latestComparableDate: LATEST_COMPARABLE_DATE,
    points: withActuals(options.actuals),
    latestComparison: options.latestComparison,
    adviceRows: options.adviceRows.map((row) => ({
      ...row,
      href: row.href ?? workspaceHref,
    })),
    limitations: [...LIMITATIONS],
    freshness: { status: "fresh", note: null },
    sources: SOURCES.map((source) => ({ ...source })),
  };
}

/** Behind fixture: 60,000 vs 84,000 central on 21 Sep → −24,000 (−29%). */
export function buildBehindGrowthView(organizationId: string): GrowthProgressView {
  return readyView({
    organizationId,
    actuals: [
      ["2026-09-07", 1_800_000],
      ["2026-09-14", 3_800_000],
      ["2026-09-21", 6_000_000],
    ],
    latestComparison: {
      state: "behind",
      differenceMinor: -2_400_000,
      differencePercent: -29,
      reasonCode: null,
    },
    adviceRows: [
      {
        id: "behind-cancellations",
        title: "Missed orders have increased",
        supportingText: "Review cancellation findings",
        href: null,
        relation: "recovery",
      },
      {
        id: "behind-repeat",
        title: "Repeat-customer action is still planned",
        supportingText: "Review the recommended action",
        href: null,
        relation: "general",
      },
    ],
  });
}

/** Ahead fixture: 98,000 vs 84,000 central on 21 Sep → +14,000 (+17%). */
export function buildAheadGrowthView(organizationId: string): GrowthProgressView {
  return readyView({
    organizationId,
    actuals: [
      ["2026-09-07", 1_800_000],
      ["2026-09-14", 5_600_000],
      ["2026-09-21", 9_800_000],
    ],
    latestComparison: {
      state: "ahead",
      differenceMinor: 1_400_000,
      differencePercent: 17,
      reasonCode: null,
    },
    adviceRows: [
      {
        id: "ahead-channel",
        title: "Expand the strongest channel",
        supportingText: "Review capacity and opportunities",
        href: null,
        relation: "expansion",
      },
      {
        id: "ahead-repeat",
        title: "Build on repeat purchases",
        supportingText: "Explore the next recommended action",
        href: null,
        relation: "general",
      },
    ],
  });
}

function sectionFor(oneMonthView: GrowthProgressView): GrowthProgressSection {
  const section: GrowthProgressSection = {
    state: "ready",
    initialHorizon: 1,
    views: {
      1: oneMonthView,
      3: missingHorizonView(3, "2026-12-01", ""),
      6: missingHorizonView(6, "2027-03-01", ""),
      12: missingHorizonView(12, "2027-09-01", ""),
    },
  };
  // Fail fast if the illustrative values ever drift out of the view contract.
  return growthProgressSectionSchema.parse(section) as GrowthProgressSection;
}

/** Ready section whose 1M view is the V08 behind fixture. */
export function buildBehindGrowthSection(organizationId: string): GrowthProgressSection {
  return sectionFor(buildBehindGrowthView(organizationId));
}

/** Ready section whose 1M view is the V08 ahead fixture. */
export function buildAheadGrowthSection(organizationId: string): GrowthProgressSection {
  return sectionFor(buildAheadGrowthView(organizationId));
}

/** Shared frozen projection identity, for the byte-identity pin in tests. */
export const GROWTH_FIXTURE_PROJECTION = {
  id: PROJECTION_ID,
  digest: PROJECTION_DIGEST,
} as const;
