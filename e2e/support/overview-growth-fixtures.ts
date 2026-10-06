import type { APIRequestContext, Page } from "@playwright/test";

/**
 * Overview growth E2E fixtures (Task 8).
 *
 * The growth section renders server-side from staging reads, so browser
 * scenarios come in two layers:
 *
 * - Route layer (always available): the real overview route with real guards.
 *   Unauthenticated visitors redirect; authenticated operator/viewer/nonmember
 *   checks need the seeded E2E environment and skip without it.
 * - Harness layer (developer-only): the uncommitted temp route
 *   `src/app/overview-growth-harness` rendering the V08 behind/ahead fixtures
 *   plus the V07 degraded states. It exists only while a reviewer is
 *   producing browser evidence and is deleted afterwards — it must never
 *   ship, and every harness-gated test below skips when it is absent.
 *
 * Frozen presentation: locale en-GB, timezone Asia/Dubai, deviceScaleFactor
 * 1, light scheme. Motion is frozen by waiting for fonts plus a fixed settle
 * delay; reduced-motion itself is a separate V09 matrix entry.
 */

export const GROWTH_FROZEN = {
  locale: "en-GB",
  timezoneId: "Asia/Dubai",
  deviceScaleFactor: 1,
  colorScheme: "light" as const,
  /** Fixed post-load settle before any screenshot or measurement. */
  settleMs: 500,
} as const;

/** Canonical frame of the approved references (behind is exactly this). */
export const GROWTH_CANONICAL_VIEWPORT = { width: 1672, height: 940 } as const;

/**
 * V09 viewport matrix: full route widths plus the isolated-card small frames.
 * The harness renders the isolated card; full-route sidebar checks stay a
 * live-acceptance gate (see the skips in overview-growth.spec.ts).
 */
export const GROWTH_VIEWPORT_MATRIX = [
  { width: 1672, height: 940, label: "canonical" },
  { width: 1920, height: 1080, label: "desktop-wide" },
  { width: 1440, height: 1100, label: "desktop" },
  { width: 1280, height: 900, label: "laptop" },
  { width: 1024, height: 900, label: "tablet-landscape" },
  { width: 768, height: 1024, label: "tablet-portrait" },
  { width: 390, height: 844, label: "phone" },
  { width: 320, height: 800, label: "small-phone" },
] as const;

/** Harness scenarios: both PNG states plus the V07 degraded states. */
export const GROWTH_HARNESS_SCENARIOS = [
  "behind",
  "ahead",
  "failed-retained",
  "failed-initial",
  "missing",
  "upcoming",
  "awaiting",
  "stale",
] as const;
export type GrowthHarnessScenario = (typeof GROWTH_HARNESS_SCENARIOS)[number];

export function harnessUrl(scenario: GrowthHarnessScenario): string {
  return `/overview-growth-harness?state=${scenario}`;
}

export function missingHarnessReason(): string {
  return [
    "The developer-only harness route /overview-growth-harness is absent.",
    "Copy .superdesign/overview-growth/browser-harness/temp-route-page.tsx to",
    "src/app/overview-growth-harness/page.tsx, run `pnpm dev`, re-run this",
    "spec, then DELETE the route. Fixture rendering is browser evidence only —",
    "it never counts as authenticated or live acceptance.",
  ].join(" ");
}

/** True when the harness route serves the scenario (not a 404). */
export async function isHarnessScenarioAvailable(
  request: APIRequestContext,
  scenario: GrowthHarnessScenario,
): Promise<boolean> {
  const response = await request.get(harnessUrl(scenario));
  return response.ok();
}

/** Anchor tolerances for the Task 8 visual review (brief contract). */
export const GROWTH_ANCHOR_TOLERANCE = {
  /** Outer card and divider geometry. */
  outerPx: 2,
  dividerPx: 2,
  /** Inner content placement. */
  contentPx: 3,
  /** Type sizes. */
  typePx: 1,
  /** Plotted line/dot geometry. */
  plotPx: 0.5,
  /** Secondary browser baselines may only be adopted under this diff ratio. */
  maxDiffPixelRatio: 0.005,
} as const;

export function overviewPath(organizationId: string): string {
  return `/organizations/${organizationId}/overview`;
}

/** Markers that must never leak through any growth surface. */
export const FORBIDDEN_GROWTH_MARKERS = [
  "signedUrl",
  "signed_url",
  "storage_path",
  "credential_reference",
  "internalCause",
  "supabase",
] as const;

/** Settle the harness render: fonts ready plus the frozen delay. */
export async function settleHarness(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(GROWTH_FROZEN.settleMs);
}

/**
 * Show the ready 1M chart: fixtures default to the ready 1M horizon, so this
 * is a confirming click. Selection is atomic per Task 7: the pressed pill
 * proves the switch completed.
 */
export async function showReadyMonthChart(page: Page): Promise<void> {
  await page.getByRole("button", { name: "1 month" }).click();
  await page.waitForFunction(() => {
    const pressed = document.querySelector('#home-revenue [aria-pressed="true"]');
    return pressed?.textContent?.includes("1M") ?? false;
  });
}
