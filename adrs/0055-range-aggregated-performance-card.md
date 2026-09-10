# ADR 0055: A range-aggregated performance card over the ADR 0048 cache pattern

## Status

Accepted. Spec (§§9.9–9.10), plan, and implementation all user-approved on
2026-09-10; implemented unpushed on `feat/governed-channel-intelligence`.

## Context

The Overview performance card was built month-only (§9.9 as written): whole covered
months, previous-month deltas, weekly trend inside the month. Against real staging
data this rule describes a card that can never fill: organization `2dda45b8` holds
projected reports for 1 Jan – 28 Feb 2026 spans plus March 2026, with completed
day/span/month-grain runs over those exact spans — and zero month-grain analyses
matching a single calendar month. Like filing two-month receipts into monthly
folders, the cabinet always reports "nothing here" while the drawer is full.

Meanwhile §9.8 already promises a free-range Channel Audit style picker, and
ADR 0048 settled the same argument for the Channel Audit: free range bounded by
coverage, grain resolved from evidence, content-addressed cache, double
admissibility check, authorization plus a sliding-window rate limit. The user has
now directed the same for this card, with three additions: cache the assembled
card per selected period, auto-build a missing period in the backend behind a
page-content loader, and reuse the Channel Audit calendar unchanged.

## Decision

The card aggregates the operator's picked covered range instead of a calendar
month: four tiles compare against the previous equal-length covered period over
the channels analysed in both periods, and the trend plots whole weeks inside
the range. The Channel Audit `WindowRangePicker` is reused as-is; no second
window path is introduced.

Caching follows ADR 0048 in full: the assembled card is cached per
organization, range, channel, and location; the cache holds answers, never
verdicts about currency; a completed analysis for that scope rebuilds the cached
card; the "already analysed?" lookup is never cached and fails through to the
database; every key is namespaced by organization id.

A picked range with no finished analysis triggers the existing governed
channel-analysis run flow (route check under the caller's RLS client, worker
check under its own lease before claiming) — no new build system. The page
polls a lightweight build-status endpoint and shows the shared page-content
loader (§9.10) until the build lands. Authorization (`report.retry`-equivalent
for starting, `channel.manage`-equivalent for run control) answers who may
spend; a per-organization sliding-window rate limit on not-yet-computed ranges
caps how often. Build triggers are idempotent per period so retries and
refreshes never launch duplicate runs.

The shared loader covers the page-content viewport only — blurry overlay,
docs-exact Spinner centered — and never the side-menu dock or top navbar. The
Spinner is aligned to the shadcn customization (LoaderIcon). The loader never
replaces honest empty states: no coverage, missing permission, and failed
builds keep their own messages.

## Consequences

`enumerateCoveredMonths`, `snapToCoveredMonth`, and the month-only default in
the GI Overview page retire in favor of range resolution; `WindowMonthPicker`
stays for any surface still month-shaped. `?from/&to` remain the filter
carriage; the month-snapping translation is removed, not kept, because two
window paths that can disagree are not maintained.

Rollback is a code revert plus cache clear — no migration is expected unless
the card cache needs a table, in which case board rule 3 review precedes any
staging apply. Findings and runs stay immutable throughout.

Two suspects from the empty-card diagnosis stay open into implementation and
must be closed there: whether the operator's `report.read` grant (required by
the card's RLS policies, while the page only requires `growth_intelligence.read`)
explains the filters-null empty state, and whether the lineage-survival filter
drops the March window. Both are verified with a staging read as that user
before the card is declared fixed.
