# Feature Specification: Overview actual revenue versus fixed growth projection

## Status

Design approved on 2026-09-18. Implementation Tasks 0–8 complete 2026-09-19
(domain, schema, readers, worker, advice/composition, visual, interaction,
retained-retry wiring, verification). Still explicitly gated and NOT done:
migration application (`20260918120000`), pgTAP first-call proof, worker
deployment, staged publication runs, authenticated/live E2E acceptance, and the
real-touch tooltip fix. See `docs/verification/overview-growth/final-report.md`.

The approved design is the blue-current / emerald-projected line chart with a restrained right advice panel. The user explicitly selected a fixed original projection. The huge revenue headline and horizontal bars were rejected.

This is a Tier 3 slice because actual-versus-fixed-projection semantics require new immutable period storage and source-aligned comparisons. It is not a cosmetic recolouring of ADR 0060's current-course forecast.

## Business outcome

Help a nontechnical client see reported progress against an earlier growth outlook at the same date, understand relevant evidence, and find the next useful action whether performance is below or above that outlook. Crossing the line does not establish platform-attributed revenue or realized campaign impact.

## User stories

- As a client, I can distinguish recorded revenue from projected revenue by colour, line style, point markers, labels and dates.
- I can inspect both values at a date without reading technical terminology.
- My original projection stays fixed while actual results and current recommendations update.
- When behind, I see supported signals and practical recommendations.
- When ahead, I see opportunities to build on progress, rather than the projection being raised retroactively.
- If reports or evidence are missing, I understand what is unavailable instead of seeing manufactured growth.

## Scope

### In scope

- Replace the existing HomeRevenue presentation with the approved chart/advice design.
- Preserve measured actuals, frozen central/low/high projection values, exact period/scope/timezone and input lineage.
- Deterministic comparison, gaps, uncertainty and advice selection.
- Source-owned recommendation/finding links; no duplicate lifecycle controls.
- 1/3/6/12M fixed periods, accessible hover/tap/keyboard comparison, method/evidence dialog and responsive states.
- One new immutable projection table and controlled publication RPC, integrated into the existing nightly revenue worker.
- A feature-specific rollout flag and rollback to the existing section.

### Out of scope

- A new forecasting model, learned seasonality, backtesting platform, guaranteed response rates, action execution, budget changes or provider integrations.
- Rewriting Growth Intelligence, Channel Audit, aggregate readers, campaigns, AppShell or organization-management UI.
- Replacing the nightly mutable snapshot table or changing its retention.
- A revised-projection switch, manual reforecast button or historical period browser in this slice. Original projection is the only displayed forecast. Future revisions require a separate versioned design.
- Fresh AI calls on page load, hover or horizon selection; new AI narration in the advice rail.
- Recreating the PNG's illustrative September data in staging or production.

### Staging demo-data exception (2026-09-20, user-directed)

The owner overrode the out-of-scope rule above for development: stand-in
September rows were written to shared staging for the canary organization
(`2dda45b8-82db-4f5f-b17d-611b9bbb7846`) only, so the real pipeline draws blue
today with zero code changes. Two backdated frozen projections (cycle 99,
period Sep 11 → Oct 11 / Dec 11, same August-partial baseline and limitations
as the Sep-20 rows) plus ten daily `normalized_metrics` rows (Sep 11–20,
287,583 minor/day ≈ 85% of the frozen pace, digests
`sha256('demo-canary-<date>:1')`). Display picks the earliest start per
horizon, so these rows win over the Sep-20 cycle-0 rows; cycle 99 keeps clear
of the nightly worker's numbering. No other org, table, or ledger touched.
Cleanup (offered, not executed): delete the canary metric rows by digest
formula and `delete from organization_growth_projections where
organization_id = ... and cycle_index = 99`.
2026-09-20 follow-up: the Sep-20 cycle-0 rows were deleted (dormant,
superseded; ids 970c9376/7955ddde survive only in audit payloads) because
their second schedule origin (Sep 20 vs Sep 11) tripped the worker's
fail-closed SCHEDULE_CORRUPT. Single origin Sep 11 remains.

## UX flow

- Open Overview: preserve HomeHeader, then mount this section before campaigns.
- Resolve the selected horizon's current fixed period and scope. Read reported facts separately.
- Draw current actuals only where complete comparable observations exist; draw the stored projection unchanged.
- Initial summaries/advice refer to the latest comparable observation date.
- Hover/tap/keyboard exposes date-specific actual, projected central value, range and difference; it does not silently redate the advice panel.
- Follow advice to its owning module. Open the method dialog for assumptions, source lineage and a table.
- Visual/interaction details: docs/superpowers/plans/2026-09-18-overview-growth-visual-contract.md, V00–V09.

## Domain rules

- “Current” means cumulative observed revenue in the selected period, not current-course forecast.
- “Projected” means a central point estimate and scenario range frozen before the displayed prediction period starts.
- Compare one metric, currency, timezone, coverage scope and accumulation start at the SAME date.
- Future actuals are absent. Missing data is absent. Known zero is a valid observation.
- The default technical proposal starts initial tracking on the next organization-local day, then uses fixed rolling periods. Calendar-month start is the alternate pending the user's explicit timing preference. Before implementation, resolve that single choice using the plan's recorded decision; do not invent a retrospective baseline.
- No old daily snapshot is promoted into a supposed historical original forecast. First launch can show an upcoming/awaiting-reports state.
- Central estimate is the deterministic rounded midpoint of the saved low/high range. Within-range actuals are not labelled underperforming merely because they fall below midpoint.
- Behind/ahead classification uses low/high bounds. Displayed money/percentage difference uses the midpoint and says so in details.
- Projection generation and actual aggregation rules are fully defined in the companion data contract. Technical constants there are proposed implementation decisions, not claims the user personally approved every numerical threshold.
- Source permissions are rechecked on every read. They never cause the original numbers to be recomputed.
- Useful unquantified advice remains available; unknown impact is not zero.

## Data model

- New public.organization_growth_projections, specified in data contract D04, contains immutable period identity, frozen numeric points, scope and source manifest. Source titles/customer payloads are not stored there.
- Existing organization_revenue_snapshots remains a mutable candidate source, not the comparison authority.
- Existing normalized_metrics and exact_range_metric_observations remain authoritative for actuals; no actual facts are copied into the projection as measured future revenue.
- Proposed migration: supabase/migrations/20260918120000_organization_growth_projections.sql. If this name collides before execution, choose the next unused timestamp and update every handoff reference in the same change.
- ADR 0064 records the boundary. ADR 0060 remains the existing scenario/candidate method; only the new Overview comparison semantics supersede its display meaning when this slice is enabled.

## API and events

- Keep the existing organization-scoped page entry and HomeRevenue section id.
- No new browser mutation API. New service-only publication RPC is publish_organization_growth_projection; duplicate calls return the original identity without updating it.
- GET rendering has zero writes/model calls/worker dispatch.
- Existing POST revenue/proposals may continue producing candidates for existing callers, but it must not alter a fixed projection or be mounted as a refresh action in this section.
- Durable publication event organization.growth_projection_published is inserted once in the existing audit_events store within the publication transaction. Payload: projection id, period, method version, digest and correlation id; no raw source amounts or prompts.
- Diagnostic events: organization_home.growth_progress_read_failed, revenue.growth_projection_publish_failed, revenue.growth_projection_skipped. Fixed safe reason codes and identifiers only.

## AI behavior

- Reuse already validated rough-estimate assumptions from the existing worker pipeline where eligible. AI cannot emit displayed totals, fixed point values, comparison state or percentages.
- Advice uses permission-checked source-owned rows and deterministic qualification/ranking. A related finding is a signal to investigate, not proof that it caused the exact gap.
- No additional provider spend is required by this UI/read/comparison slice.

## Security and tenancy

- RLS plus explicit organization predicates for every read. Anonymous/nonmember access denied.
- Projection row read requires channel.read and any campaign/growth source permissions the frozen inputs require. If not granted, return no projection rather than rebuild a different one.
- Workers use the existing worker-only client through the controlled publication RPC. User paths never import it.
- Cross-tenant channel, branch, metric override, observation and action references are rejected at publication and repository boundaries.
- No raw workbook payload, credentials, customer PII or provider errors in UI/logs/artifacts.

## Observability

- Distinguish snapshot stored, projection published/replayed/skipped and comparison ready/partial.
- A worker completion is insufficient: verify immutable projection id/digest/points in the database and the same identity after browser reload.
- Record bounded latency and safe failure codes. Projection unavailability does not fail campaigns or the lower Overview.

## Failure states

Use V07 and D09. Preserve last successful display on refresh failure with its date. Source correction can alter actuals with a correction note; it cannot alter the projection. Incompatible currency/scope, uncertain overlap, insufficient coverage and missing original projection are separate states.

## Acceptance criteria

- AC01: both approved compositions reproduced under visual gates, with independent actual/projection markers and values.
- AC02: original id, digest, period and point values survive refresh, new reports, model proposals, concurrent retry and viewer changes.
- AC03: current revenue uses exact complete ledger coverage, with no invented dates, zeros or double-counted intervals.
- AC04: same-date arithmetic produces behind/ahead/within-range and zero-denominator states correctly.
- AC05: advice is relevant, permission-safe, source-linked, and never invents causation or treats Planned as completed.
- AC06: 1/3/6/12M are independently fixed periods with visible dates; selectors do not reforecast.
- AC07: responsive, keyboard, touch, reduced-motion, dialog and accessible-table requirements pass.
- AC08: tenant/role/source-denial tests and worker-only publication boundaries pass on hosted staging.
- AC09: original blue line stops at latest supported date; a sparse/coarse series stays sparse/coarse.
- AC10: no regression to lower Overview, existing snapshot callers or proposal endpoint.
- AC11: fresh backend evidence and authenticated app acceptance are separate from fixture visual evidence; skipped tests are not passes.
- AC12: execution record lists known limitations, migrations, source changes, visual deviations and rollback.

## Test plan

The implementation plan maps AC01–AC12 to nine gated tasks, concrete files and test vectors. Mandatory layers: pure arithmetic/coverage, repository/RLS, publication/retry, component accessibility, pixel review, full route integration and hosted worker persistence.

## Migration and rollback

- Forward-only additive migration; inspect all pending shared-tree migrations before dry-run/apply. Never apply unrelated pending migrations by accident.
- No local Supabase/Docker; hand-maintain database.types.ts.
- Disable OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS to restore the existing section; do not delete frozen rows or rewrite them as a rollback.
- Preserve existing nightly snapshot behavior and proposal callers. New publication runs only for allowlisted organizations.
- A rollback reenabling legacy display must not relabel legacy current-course forecasts as actuals.

## Documentation updates

- This spec; ADR0064; exact data/visual contracts; implementation plan; handoff; frozen reference manifest; discovery/evidence record.
- Add a clearly scoped supersession note to the older revenue spec and ADR0060; preserve their historical approvals.
- On execution, update README, context/05-module-map.md and the collaboration board narrowly to reflect shipped behavior. Do not call the slice shipped during planning.
