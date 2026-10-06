# Overview growth planning discovery — 2026-09-18

## What was verified

- Current checkout: /home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence.
- Existing route: src/app/(platform)/organizations/[organizationId]/overview/page.tsx; HomeRevenue is the first section after HomeHeader in organization-home.tsx.
- Existing visual source: home-revenue.tsx and the revenue block in organization-home.module.css. Three metric columns, a 70/30 chart/recommendation layout, 1/3/6/12M selector, notes/footer. Existing app font is Manrope from src/app/layout.tsx.
- Existing calculation: revenue-scenario.ts holds the latest measured level flat and adds action ranges. projectRevenueHorizon multiplies monthly amounts by the number of future months. It is not an actual-versus-original-projection comparison.
- Existing read: readLatestRevenueSnapshot selects the latest daily row; writeRevenueSnapshot UPSERTs by organization/date. The table has no frozen period identity or saved forward points. Its 13-month trim must never delete new fixed projections.
- Existing snapshot table is member-readable. New projection reads need the source permission checks described in the new contract, not a copied membership-only policy.
- Existing Home loader filters action kinds for the viewer BEFORE recalculating the scenario. That is unacceptable for the new fixed projection: permission narrowing must hide inaccessible content/rows, never change frozen numbers.
- Existing readDailyMetricAggregates is useful precedent but loses branch/dimension/row provenance. Its totals add spans to finest-grain period rows. Do not reuse that total blindly for cumulative actuals: partial overlap, cross-grain duplicates and incomplete coverage need explicit handling.
- Existing projection source uses analysed-window bands. New actual results must read current reconciled ledger facts, independent of completed analyses.
- Existing on-demand POST revenue/proposals prepares ranges in memory. It must not replace or mutate a frozen projection.
- Trigger worker stores a scenario input; a completed task or stored:true does not establish a usable frozen projection or a valid comparison. Preserve separate result fields and persisted identity.

## Hosted staging: bounded read-only inspection

- Used the configured DATABASE_URL through the repository's URL resolver, a READ ONLY transaction and a 10-second statement timeout. No write, migration, paid model/provider request, or Trigger run was performed.
- Inspected only column metadata, record counts, grain/channel counts and date bounds. No customer revenue amounts, workbook contents, credentials, prompts, or signed URLs were printed.
- Development organization is the fixed README canary, 2dda45b8-82db-4f5f-b17d-611b9bbb7846.
- Current reconciled revenue.gross normalized facts: 50 rows, day grain, 2 distinct channels. Raw timestamp date bounds: 2025-12-31 through 2026-03-31; these are not a claim of complete local-day coverage.
- Current reconciled revenue.gross exact-range facts: 1 row, 1 channel, 2026-01-01 through 2026-02-28.
- Canary organization_revenue_snapshots: 0 rows. This does not prove absence for other organizations.
- Both ledger tables have id, organization_id, branch_id, channel_id, metric_definition_id, dimensions, period_timezone, period_start/end, value_numerator/denominator and created_at. normalized_metrics has period_grain; period times are timestamps. Exact-range dates are inclusive calendar dates.
- Neither record counts nor historical date bounds prove current, complete, non-overlapping September actuals. September behind/ahead mockups remain illustrative fixtures.
- No new fixed-projection table/RPC was created or exercised. Live authorization, future worker publication, and authenticated visual acceptance remain execution gates.

## Known traps for the executor

- Copying the old grey current-course line and recolouring it blue would mislabel a forecast as recorded revenue.
- Reusing latest snapshots, their mutable UPSERT, or viewer-filtered recomputation would move the original projection.
- Summing period totals onto a cumulative series or spreading actual monthly totals into invented days would create a false trajectory.
- A source's zero-valued observation is data; an absent observation is not zero.
- Missing one scoped channel/branch means the total at that date is incomplete, even if the other channels look healthy.
- Do not backdate a new forecast to manufacture a successful September comparison.
- Sparse input may leave the live canary in an honest unavailable/partial state after implementation. That is not a reason to inject the PNG's example numbers into production.
- The tree has unrelated work, including analysis readers and Growth Intelligence components. Do not reset/stash, broadly format, stage, or commit their changes.
- Supabase changelog and official RLS guidance were consulted. The recent changelog excerpt contained no change affecting the planned immutable table pattern. Reverify documentation when executing migrations.
- References: https://supabase.com/docs/guides/database/postgres/row-level-security and https://supabase.com/changelog.md.

## Planning verification, not implementation verification

- Source references were inspected; both frozen PNG dimensions and SHA-256 hashes were measured.
- No application test suite was run for a documentation-only change. Later test commands are requirements, not reported passes.
- Neither screenshot is a live browser test. No interactive implementation or mobile render exists in this package.
