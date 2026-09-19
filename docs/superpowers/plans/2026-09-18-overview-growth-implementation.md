# Overview Growth Progress Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (when delegation is explicitly authorized) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

- Goal: reproduce the approved minimal two-line growth section and compare reported revenue with an immutable original projection, with useful evidence-linked advice.
- Architecture: pure date/coverage/comparison code; immutable service-published period projections; session-bound ledger reads; a source-owned advice adapter; small presentational chart/advice/details components. Keep the existing mutable snapshot candidate pipeline and legacy section for flag-controlled rollback.
- Tech stack: existing Next16.0.10, React19.2, TypeScript5.7, Zod4, Recharts3.8, Manrope, shadcn, Supabase/Postgres, Trigger SDK4.6.0, Vitest2.1 and Playwright1.55. Use installed dependencies; no upgrade is part of this work.
- Spec: specs/027-overview-growth-progress.md.
- Binding companions: docs/superpowers/plans/2026-09-18-overview-growth-data-contract.md (D00–D09); docs/superpowers/plans/2026-09-18-overview-growth-visual-contract.md (V00–V09); adrs/0064-fixed-growth-projection-progress.md.
- Status: planning deliverable only. Visual direction and fixed projection are approved; this detailed technical plan must be reviewed before execution under repository Tier3 rules.
- Format: bullets rather than implementation snippets, as required by AGENTS.md. Exact interfaces, algorithms, test vectors, files, commands and pass conditions below replace vague “implement appropriately” directions.

## Global constraints

- The original projection must remain fixed for its selected period.
- Current means reported cumulative revenue; Projected means frozen estimated revenue; both compare the same date, period, currency and scope.
- A filled illustrative PNG is never a production fallback.
- No application changes outside this slice's listed files without a material-scope review.
- No local Supabase/Docker, no pnpm db:types, no git stash, no broad formatting/staging, no git push.
- Hosted staging is shared; dry-run includes pending migrations from other work. Never apply them merely to get this migration applied.
- Use the passed session client on every user read; service-role creation belongs only to the existing worker composition root.
- Follow shadcn compositions and existing Manrope/semantic tokens; do not change globals, sidebar, masthead or lower Overview.
- No extra AI/provider call on reads/interactions. No new money-moving or public-brand action.
- Every code task includes meaningful domain/behavior tests; screenshot checks do not prove backend correctness.
- Keep one implementation owner for the UI. Use an independent review pass and an independent test pass where separately authorized; no two implementers styling the same surface.
- Do not commit pre-existing dirty hunks. A scoped WIP commit is acceptable only when file ownership is clear; leave shared mixed files uncommitted rather than sweep other work.
- Technical planning assumptions: next-day rolling bootstrap; even_pace_v1 intra-period estimate;45-day maximum baseline age; classification against scenario bounds; midpoint difference shown;max2 advice rows;no revised-outlook control. Review these with the plan; they are explicitly proposed, not hidden choices.

## File and dependency map

- New domain: src/domain/organizations/growth-progress.ts + .test.ts; growth-periods.ts + .test.ts.
- New application: src/modules/organizations/application/growth-progress-ports.ts; growth-progress-view.ts; growth-projection-builder.ts + .test.ts; growth-projection-publisher.ts + .test.ts; growth-advice.ts + .test.ts; growth-progress-service.ts + .test.ts; growth-progress-access.ts + .test.ts.
- New infrastructure: src/modules/organizations/infrastructure/growth-progress-repository.ts + .test.ts; growth-projection-repository.ts + .test.ts; growth-advice-reader.ts + .test.ts.
- New UI: src/components/organizations/home/home-growth-chart.tsx + .test.tsx; home-growth-insight.tsx + .test.tsx; home-growth-details.tsx + .test.tsx.
- Modified UI: home-revenue.tsx + .test.tsx; organization-home.tsx + .test.tsx; organization-home.module.css (revenue/growth block only).
- Modified composition: home-types.ts; home-service.ts + .test.ts; home-loader.ts + .test.ts; src/lib/env.ts and .env.example for the new flag; modules/organizations/index.ts only if a browser-safe public export is required.
- Persistence: supabase/migrations/20260918120000_organization_growth_projections.sql; supabase/tests/database/organization_growth_projections_test.sql; narrow additions to src/lib/supabase/database.types.ts and database.types.test.ts.
- Worker: src/trigger/revenue-snapshots.ts + .test.ts; src/modules/organizations/application/revenue-snapshot.ts + .test.ts only for a small candidate handoff or result-envelope change. Preserve existing callers and candidate behavior.
- Tests/harness: e2e/overview-growth.spec.ts; e2e/overview-growth.visual.spec.ts; e2e/support/overview-growth-fixtures.ts; .superdesign/overview-growth/browser-harness/ as a test-only render host. No fixture route may ship under src/app.
- Documents: spec027, ADR0064, these contracts, README.md, context/05-module-map.md, collaboration board, docs/verification/overview-growth/.
- Dependencies: Task0 →1; Task1 →2+3; Tasks2+3 →4; Tasks1+3 →5; Task1 →6; Tasks5+6 →7; Tasks2–7 →8. Work sequentially by default; these dependencies are not permission to spawn agents.

## Task 0 — Establish an honest baseline and freeze the reference

- Files: read all binding documents; update only docs/verification/overview-growth/execution-baseline.md and collaboration board.
- Interfaces consumed: approved image hashes and repository's existing route/source seams. Produces: recorded branch/head, dirty-file manifest, source/enum facts, tool availability and test baseline.
- [ ] Read repository mandatory context and collaboration board; claim the listed slice files. Record git status --short and git rev-parse HEAD. Do not reset any dirty file.
- [ ] Verify both frozen PNG hashes using sha256sum .superdesign/overview-growth/approved-behind.png .superdesign/overview-growth/approved-ahead.png. Open both visually. Stop if they differ from REFERENCE.md; do not regenerate.
- [ ] Confirm the user's final timing preference from this thread/hand-off. If no later answer exists, A01 is the plan's explicit proposed next-day rolling assumption; obtain the plan's normal approval before execution, not a silent reinterpretation.
- [ ] Inspect actual source schemas and functions relevant to D02/D04, including audit_events event_name/actor_type/payload fields and private.has_organization_permission(uuid,text). Inspect existing ledger indexes and exact_range quality metadata before selecting columns.
- [ ] Run bounded read-only staging coverage checks, repeating the discovery report without printing values or credentials. Record the latest complete interval per permitted source shape. No model/provider call, data seed or migration.
- [ ] Run baseline: pnpm exec vitest run src/domain/organizations/revenue-scenario.test.ts src/modules/organizations/application/revenue-snapshot.test.ts src/modules/organizations/infrastructure/revenue-snapshot-repository.test.ts src/modules/organizations/infrastructure/home-loader.test.ts src/modules/organizations/application/home-service.test.ts src/components/organizations/home/home-revenue.test.tsx src/components/organizations/home/organization-home.test.tsx src/trigger/revenue-snapshots.test.ts.
- [ ] Record pnpm typecheck and relevant pre-existing lint failures, exact exits and affected files. Do not fix unrelated failures.
- [ ] Verify Chrome DevTools/browser access and installed Trigger SDK skill/tools. If a tool is listed but not callable, record it and use Playwright for browser inspection; never claim an unavailable tool ran.
- Gate: unchanged source tree, frozen references verified, known capability gaps recorded. No claim of authenticated/live-data acceptance.

## Task 1 — Pure period, projection, coverage and comparison contracts

- Files: new growth-periods.ts/.test.ts and growth-progress.ts/.test.ts under src/domain/organizations/; new growth-progress-ports.ts and growth-progress-view.ts under application.
- Consumes: D01–D07. Produces the exact named types/functions used by every subsequent task; no framework, DB, crypto or model import in browser-safe domain/view files.
- [ ] Define strict Zod documents for scope partitions, facts, fixed projection, point arrays and comparison view. Reject duplicate dates, invalid ISO dates, unsupported horizon, unsafe integers, inconsistent metadata and inverted ranges.
- [ ] Write failing tests named “keeps horizon periods fixed independently”, “uses original day anchor after February clamp”, “uses local days through DST”, and “does not start a projection in the past”. Include Jan31→Feb28→Mar31, leapFebruary and organization date different from UTC.
- [ ] Run pnpm exec vitest run src/domain/organizations/growth-periods.test.ts and confirm the intended failures, then implement D01 pure calendar arithmetic.
- [ ] Write failing projection tests for D03's30-day112k–128k bounds: day21=78.4k/84k/89.6k; final=112k/120k/128k; zero and negative rational-rounding vectors; overflow refusal; no compounding at3/6/12M.
- [ ] Implement buildEvenPaceProjection exactly; no interpolation of actual facts, smoothing or hidden learned behavior.
- [ ] Write coverage tests before implementing buildActualGrowthSeries: day10+20 versus span30→30; span35→OVERLAP_CONFLICT; duplicate row→unchanged; day1/day3 missing prefix→null; complete coarse month→one month-end point; one missing partition→unavailable; equivalent cross-store duplicates→one value; partial overlaps never clipped.
- [ ] Implement the per-partition exact-cover DAG from D05 with bounded distinct totals and deterministic equivalent-cover provenance. Preserve gap boundaries and typed reasons.
- [ ] Write compareGrowthPoint cases:60k vs80/84/88→behind/−24k/−29%;98k→ahead/+14k/+17%;82k→within_range;84k→equal;zero center→percentage null;missing actual→unavailable. Implement arithmetic after failure is observed.
- [ ] Add property tests for row-order invariance, duplicate idempotence, in-range date points and safe serialization. Assert explicit zero satisfies coverage and no future blue points exist.
- [ ] Run both new domain suites and existing revenue-scenario suite. Typecheck. Review the full domain contract before any UI consumes it.
- Gate: AC02/03/04/06/09 domain behavior established; interfaces match D07 exactly. Existing scenario engine remains unchanged unless a specifically reviewed reusable helper extraction is required.

## Task 2 — Immutable projection schema and tenant boundaries

- Files: new migration20260918120000, organization_growth_projections_test.sql; narrow database.types.ts entries; database.types.test.ts; docs/verification/overview-growth/persistence.md.
- Consumes: validated D04 schema/document and Task1 types. Produces organization_growth_projections and publish_organization_growth_projection with immutable id/digest and exactly-once audit.
- [ ] Load Supabase/Postgres skills; obey repository hosted-only exceptions over generic local-DB instructions. Inspect current permission helpers, enum and table definitions first.
- [ ] Write pgTAP tests for absence/initial contract, member/source-permission reads, tenantB denial, anon denial, all authenticated RPC denial, service publication, malformed document, cross-tenant reference, invalid date/currency/range, concurrent-key semantics, changed-candidate replay, update denial, audit atomicity and old-trim isolation.
- [ ] Create the additive table, indexes, restrictive grants/RLS, immutability trigger and controlled publication RPC per D04. Use p_-prefixed parameters/v_-prefixed locals to avoid PL/pgSQL column ambiguity.
- [ ] Add JSON/column consistency validation and all bounded checks. A digest column alone is not immutability. Do not preserve a service-role direct UPDATE path.
- [ ] Manually add Row/Insert/Update/Function types. Do not add the new table to an untyped exemption as a shortcut; do not run pnpm db:types.
- [ ] Run pnpm db:migrations:list and pnpm db:migrations:dry-run. Read the exact pending migration list. If unrelated migrations are pending, do not apply them; resolve the sequencing with the owner/user before staging mutation.
- [ ] After the plan's staging application authorization is established, apply only the reviewed forward migration through the repository workflow. Do not edit previously applied migrations.
- [ ] Run pnpm db:test supabase/tests/database/organization_growth_projections_test.sql. All new PL/pgSQL functions must execute in rollback-wrapped tests, including first publication and rejection branches.
- [ ] Perform the concurrent publication test with two separate DB sessions and one exact identity; assert one stored row/id/event. The test must use an isolated rollback-safe test organization, never the client's real fixed period.
- [ ] Record migration identity, all pgTAP assertions, explicit skips and safe outcomes. No secrets/amounts/customer fixtures in logs.
- Gate: AC02/08 proved on staging. Apply success without first-call tests does not pass. Publishing real customer projections is not part of this schema test.

## Task 3 — Qualified projection and actual readers

- Files: growth-progress-repository.ts/.test.ts; growth-projection-repository.ts/.test.ts; growth-projection-builder.ts/.test.ts.
- Consumes: Task1 types, Task2 RPC/table, existing reconciled ledgers and registry. Produces GrowthProgressReadPort / GrowthProjectionWritePort and ready/refused candidate documents.
- [ ] Write repository tests asserting every fact/projection query is organization-scoped, bounds pagination, preserves source identity and distinguishes read failure from missing/corrupt.
- [ ] Implement session-only readProjections and readRevenueFacts. Keep branch/dimension/currency/timezone metadata until D05 has qualified coverage. Do not replace or modify the existing aggregate reader.
- [ ] Implement source filters from D02 and reject unresolved branch-total/dimension overlap. Verify exact_range quality eligibility using actual source contracts rather than assuming a guessed quality_tier column.
- [ ] Test and implement the complete prior-calendar-month baseline read with45-day age limit and exact metric semantics. No latest-month-looking label parsed from an arbitrary historical bucket.
- [ ] Adapt qualified action/finding inputs to the existing deterministic scenario engine. If a range has no scoped valid basis, retain the advice but omit its monetary effect. Test joint-group/overlap behavior and baseline-only projection labels.
- [ ] Implement worker-only RPC adapter using only the existing service client passed by the composition root. Revalidate both request and returned document metadata; never include this adapter in client imports.
- [ ] Test replay of different candidate input: the returned stored id/digest stay unchanged. Test permission denial does not cause a live-scenario fallback or a per-viewer recalculation.
- [ ] Run pnpm exec vitest run src/modules/organizations/infrastructure/growth-progress-repository.test.ts src/modules/organizations/infrastructure/growth-projection-repository.test.ts src/modules/organizations/application/growth-projection-builder.test.ts src/lib/client-module-boundary.test.ts.
- Gate: AC02/03/08/09; no broad edits to analysis/Growth Intelligence source-owned readers.

## Task 4 — Prospective publication in the existing worker

- Files: growth-projection-publisher.ts/.test.ts; src/trigger/revenue-snapshots.ts/.test.ts; revenue-snapshot.ts/.test.ts only for the small verified candidate handoff; growth-progress-access.ts/.test.ts; src/lib/env.ts and .env.example.
- Consumes: Tasks1–3 and D08. Produces safe per-horizon publication results under a server allowlist, with no extra model calls.
- [ ] Load the installed Trigger authoring skill. Keep task registration/imports on @trigger.dev/sdk; do not import task instances into application/UI modules.
- [ ] Add OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS parsing using the existing strict UUID allowlist pattern, max100 entries, no duplicate/empty identifiers. Blank→disabled.
- [ ] Write tests for bootstrap next-day origin, independent horizon rollover, original-day month anchoring, not-due bypass, disabled org, failed source, replay, retry after boundary and timezone change.
- [ ] Implement the publisher as a dependency-injected application function. Pass validated candidate material from the existing worker without a second proposal/model invocation. If candidate unavailable, return a typed skipped result.
- [ ] Preserve existing snapshot outputs/callers or add a backwards-compatible result field; expose projection publication failure separately from snapshotStored. Do not hide a failed freeze behind stored:true.
- [ ] Ensure explicit allowlist organizations outside the legacy500-org scan are included, with deduplication. Test501st-org coverage using fixtures.
- [ ] Apply SDK-appropriate transport idempotency and retain DB uniqueness as authority. Test duplicate task deliveries and retries cannot move the frozen line or duplicate its audit event.
- [ ] Run pnpm exec vitest run src/modules/organizations/application/growth-projection-publisher.test.ts src/modules/organizations/application/growth-progress-access.test.ts src/modules/organizations/application/revenue-snapshot.test.ts src/trigger/revenue-snapshots.test.ts.
- [ ] Do not deploy merely to run unit tests. For an authorized staged worker run, verify environment/project/version, source freshness and expected publication identity; record DB before/after and a replay with unchanged digest. No paid extra model call introduced by this verification.
- Gate: AC02/06/08/11. A Trigger “Completed” label without persisted immutable identity does not pass.

## Task 5 — Advice, permissions and home composition

- Files: growth-advice.ts/.test.ts; growth-advice-reader.ts/.test.ts; growth-progress-service.ts/.test.ts; growth-progress-view.ts; home-types.ts; home-service.ts/.test.ts; home-loader.ts/.test.ts.
- Consumes: actual/projection ports, current source-owned recommendation readers, permission flags. Produces sanitized four-horizon GrowthProgressSection and at most2 qualified advice rows per view.
- [ ] Inventory registered detector/action keys actually present in source contracts. Write the explicit recovery/expansion/general mapping in growth-advice.ts with tests for each admitted key and an unknown-key general fallback. Do not classify by free-text guesses.
- [ ] Write tests proving permission-denied readers are never called; forbidden titles/counts/links are absent; later evidence is not stated as known at an older observation date; Planned is never completed.
- [ ] Build the advice adapter through existing module readers. Resolve real source-owned links; use the known Growth Intelligence workspace when no deep link is provided. No invented route.
- [ ] Implement compare-first advice selection from D06, preserving general useful recommendations and uncertainty copy when no supported reason exists.
- [ ] Compose projection IDs, actual points, latestComparison, scope labels, source cutoffs, limitations and advice into each view. Batch union-period reads; preserve independent errors and latest valid view information.
- [ ] Add growthProgress to OrganizationHomeView while retaining revenue for rollback. With flag ON, bypass the legacy revenue read/recalculation path; with flag OFF, preserve legacy behavior exactly.
- [ ] Replace old source-denial behavior for the new path with hidden/denied projection, not viewer-specific totals. Test two viewers cannot get different numbers for the same projection id.
- [ ] Add safe logs using existing allowed fields organizationId/correlationId/durationMs/errorCode; do not extend logger with raw payload/amount fields. Durable publication event remains in SQL, not logger-only.
- [ ] Run pnpm exec vitest run src/modules/organizations/application/growth-advice.test.ts src/modules/organizations/infrastructure/growth-advice-reader.test.ts src/modules/organizations/application/growth-progress-service.test.ts src/modules/organizations/application/home-service.test.ts src/modules/organizations/infrastructure/home-loader.test.ts.
- Gate: AC03/04/05/08/10; lower home sections/permissions unaffected.

## Task 6 — Approved visual shell and two-line chart

- Files: home-revenue.tsx/.test.tsx; home-growth-chart.tsx/.test.tsx; home-growth-insight.tsx/.test.tsx; organization-home.tsx/.test.tsx; organization-home.module.css revenue/growth rules; fixture/harness files listed above.
- Consumes: GrowthProgressView; V00–V04/V06/V08. Produces sparse behind/ahead render matching frozen reference geometry with correct arithmetic.
- [ ] Build the test-only fixtures from V08 as presentational view DTOs. Confirm projected points/id/digest are identical between behind and ahead. They never import into production loaders.
- [ ] Build the isolated browser harness outside src/app using the existing Next/shadcn/Tailwind/Manrope rendering pipeline or an existing test host. If a temporary dev route is required for inspection, keep it uncommitted, remove before completion and prove production build has no such route. Never expose a fixture route publicly.
- [ ] Write component tests for header labels, independent coloured/marked series, actual stopping date, same-date summaries, right-panel state and blocked production fixture imports.
- [ ] Implement Card header, restrained summaries, 68.25/31.75 canonical grid, correct typography and footer from V01–V03. Use installed primitives; do not modify global Card or font tokens.
- [ ] Implement Recharts time-scale plotting with explicit dates, common y domain, solid blue/dashed emerald, independent dots, label collision rules, gap breaks, latest-date guide and same-date bracket. Use linear segments and isAnimationActive=false.
- [ ] Use existing money formatting helpers. Write chart-coordinate tests: a30000 difference occupies the proportional y distance on the same domain, unequal date intervals occupy proportional x distance, and current future values are null.
- [ ] Render behind/ahead fixtures at canonical dimensions and inspect the actual browser screenshot. Compare the untouched originals immediately; do not postpone visual mismatch to final QA.
- [ ] Keep correct data geometry even where AI reference pixels are slightly inaccurate; document each such deviation, not a blanket redesign allowance.
- [ ] Run pnpm exec vitest run src/components/organizations/home/home-revenue.test.tsx src/components/organizations/home/home-growth-chart.test.tsx src/components/organizations/home/home-growth-insight.test.tsx src/components/organizations/home/organization-home.test.tsx.
- Gate: AC01/04/09; independent visual review required before a secondary browser regression baseline is accepted.

## Task 7 — Interaction, disclosure, responsive and degraded states

- Files: home-growth-chart.tsx/.test.tsx; home-growth-details.tsx/.test.tsx; home-growth-insight.tsx/.test.tsx; home-revenue.tsx/.test.tsx; scoped CSS.
- Consumes: Task6 shell and V05–V07. Produces working accessible interactions without model calls or projection mutation.
- [ ] Write keyboard/touch tests for transient/pinned tooltip, Escape, arrows, Home/End, first/latest/future dates and unavailable current values.
- [ ] Implement the chart interaction state machine. Hovering historical dates must not silently update the right panel's “AS OF latest” evidence.
- [ ] Implement horizon switching with atomic period/chart/advice updates, clear tooltip selection and polite announcement; assert original id/digest persists when returning to a horizon.
- [ ] Add method Dialog with assumptions, source coverage, fixed issue time and accessible value table. Test focus trap/restore, full amounts, currency, low/central/high and permissions.
- [ ] Implement loading, initial error, retry with retained old data, original missing, upcoming, awaiting reports, sparse/partial, stale, mixed-currency and source-denied states from V07.
- [ ] Implement container-query breakpoints exactly. Verify390/320px overflow, summary wrapping,44px targets and sparse mobile point labels without reducing legibility.
- [ ] Testwithin_range/equal/zero-midpoint/negative adjustments and long recommendation text. No alert solely because an actual lies below midpoint but inside the range.
- [ ] Run the four changed component suites; run focused ESLint and pnpm typecheck. React review is limited to this TSX slice and must not restyle unrelated cards.
- Gate: AC05/06/07/09; neither controls nor claims imply execution, certainty or completed action status.

## Task 8 — Full verification, delivery and rollback record

- Files: e2e/overview-growth.spec.ts; e2e/overview-growth.visual.spec.ts; supporting test fixtures; docs/verification/overview-growth/; narrow README/module-map/spec/ADR status updates.
- Consumes: completed Tasks1–7. Produces separate visual, functional, database, worker and live-route evidence plus a final non-claims list.
- [ ] Write Playwright fixture scenarios for both PNG states and all V07 states. Freeze locale en-GB, timezone Asia/Dubai, clock, deviceScaleFactor1, fonts and motion. Run pnpm exec playwright test e2e/overview-growth.visual.spec.ts.
- [ ] Generate side-by-side and overlay artifacts against the original PNGs. Measure anchors and review every non-arithmetic deviation. Record reviewer decision before committing browser baselines.
- [ ] Run V09 viewport matrix, light/dark adaptation, 200%zoom, reduced motion, keyboard and touch. Check full route with sidebar expanded/collapsed as well as isolated card.
- [ ] Add authenticated operator/viewer/nonmember routes to e2e/overview-growth.spec.ts using the existing e2e/support/authenticated helpers. No credentials in artifacts. If fixtures/auth are missing, report skips and retain the live acceptance gate; do not call fixture rendering authenticated acceptance.
- [ ] Run pnpm exec playwright test e2e/overview-growth.spec.ts e2e/organization-home.spec.ts.
- [ ] Re-run hosted projection pgTAP and source-permission denial checks; capture only safe ids/codes/counts. Verify a new reported fact changes blue only and reload preserves projection id/digest.
- [ ] Verify an authorized staged publication task, its exact deployed version, DB row and replay. With currently stale canary data, verify the honest blocked path; a populated real comparison requires eligible fresh source reports or an explicitly designated test tenant. Never plant PNG numbers in the client organization.
- [ ] Run pnpm typecheck, pnpm lint, pnpm test and pnpm build once after focused suites pass. Categorize any pre-existing failure from Task0 separately; do not silently skip required checks or repeatedly rerun unchanged failures.
- [ ] Run a production import/route check proving no fixture DTO/harness path is shipped. Check that no source code imports the worker service client through the chart/view barrel.
- [ ] Verify flag rollback restores the old section without changing stored projections, and existing mutable snapshot/proposal tests still pass. Record that legacy forecasts are not newly relabelled actual.
- [ ] Update docs from proposed to implemented only for work actually completed; preserve unresolved live/credential/provider gates explicitly. List files changed, migrations applied/not applied, executed commands/exits, safe run/projection identities, known limitations and rollback.
- [ ] Use git diff --check and inspect the exact diff. Stage/commit only owned slice changes if authorized and separable; never git add . or git push.
- Gate: AC01–AC12 mapped to actual evidence. User handoff approval is not a substitute for tests; passing fixtures is not proof of live outcomes.

## Acceptance traceability

- AC01 → Tasks6/8, V01/V02/V09, frozen reference hashes and overlay review.
- AC02 → Tasks1/2/3/4/5/8, immutable key/digest/replay and viewer invariance.
- AC03 → Tasks1/3/5/8, exact coverage, currency/branch/overlap tests.
- AC04 → Tasks1/5/6/7, numeric vectors, range classification and plotted positions.
- AC05 → Tasks5/7/8, source qualification, advice links and no unsupported causes.
- AC06 → Tasks1/4/7, independent periods/rollovers and selector immutability.
- AC07 → Tasks7/8, interaction/assistive/table/responsive matrix.
- AC08 → Tasks2/3/4/5/8, hosted RLS, tenant/source denial and worker boundary.
- AC09 → Tasks1/3/6/7, gaps, coarse endpoints and no future actuals.
- AC10 → Tasks0/5/8, baseline comparison and lower-home/snapshot/proposal regression.
- AC11 → Tasks0/4/8, persisted evidence and explicit skips/non-claims.
- AC12 → Task8, execution report and rollback exercise.

## Risks, containment and rollback

- Data readiness: canary has historical reports and no fixed original; explicit no-projection/awaiting-report states are required.
- Timing: late worker publication cannot become an earlier original. Prospective DB check and unavailable missed-period state contain hindsight.
- Measurement: incomplete scope can falsely look behind. D05 complete-coverage checks prevent that claim.
- UI drift: generative PNG antialiasing is not browser geometry. Frozen originals, measured anchors and independent review prevent baseline replacement.
- Migration: new table/RPC only; existing snapshots untouched. Forward repair if needed, never edit an applied migration.
- Privacy: source-permission-aware RLS and sanitized DTOs prevent a fixed document bypassing module access.
- Rollback: disable the server allowlist for reads and publication; retain immutable history; restore legacy section semantics. No destructive rollback SQL.
