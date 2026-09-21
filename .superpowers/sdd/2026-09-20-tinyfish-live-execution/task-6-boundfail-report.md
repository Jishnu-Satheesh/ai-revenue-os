# Task 6 — bound-run failure handoff (canary-blocking)

## Root cause
For pipeline-bound requests the worker's post-begin `failRun` called the
run-level RPC `fail_market_research_run` first. That RPC refuses bound
requests (`market_research_pipeline_bypass_forbidden`; bound runs settle only
via `complete/fail_market_research_pipeline`). Proven live on canary run
`run_06gc3fnb6ct9j50qcoegvrfl01`: direct fail call raises bypass_forbidden,
so `failRun` threw before `requests.fail` / `failPipeline` ran — request
stayed claimed, pipeline stayed queued forever. Pre-begin `failRequest` also
did a redundant double-settle (`requests.fail` then `failPipeline`).

## Change
- Migration `20260920153000_growth_intelligence_research_pipeline_fail_run_settle.sql`
  (dry-run clean, NOT pushed): new 8-arg overload of
  `fail_market_research_pipeline` with `p_adapter_cost_micros_usd bigint` /
  `p_adapter_latency_ms integer` (bounds 0..50000000 / 0..600000, else 22023).
  When run id is not null the run row moves to failed with code + costs;
  already-failed with same code + costs replays true; terminal with different
  values raises 23505. All existing checks, service_role-only grant on the new
  overload, and request/pipeline/audit behavior otherwise identical. Old
  6-arg overload untouched.
- `run-market-research.ts`: bound pre-begin `failRequest` calls ONLY
  `evidence.failPipeline` (run null, ledger costs); legacy null-pipeline path
  unchanged (`requests.fail` + event). Bound post-begin `failRun` calls ONLY
  `evidence.failPipeline` (run id + ledger costs) then the
  `market_research.failed` event; legacy path unchanged
  (`evidence.fail` + `requests.fail` + event). No other worker flow touched.
- `evidence-repository.ts`: `failPipeline` takes required
  `adapterCostMicrosUsd` / `adapterLatencyMs` with Zod bounds, passed as the
  two new RPC params.

## Tests + outputs
- `pnpm vitest run src/workflows/growth-intelligence/run-market-research.test.ts src/modules/growth-intelligence/infrastructure/evidence-repository.test.ts` — 61 passed (41 + 20).
- New unit coverage: bound post-begin failure uses one `failPipeline` RPC
  (no `evidence.fail`, no `requests.fail`) and publishes the event; bound
  pre-begin uses only `failPipeline`; replayed `failPipeline` still publishes;
  claim_lost publishes nothing; legacy paths assert `failPipeline` untouched;
  repository rejects cost > 50M / latency > 600k without RPC.
- `pnpm eslint` on 4 touched TS files — 0 errors (5 pre-existing warnings in
  test file). `pnpm typecheck` — clean.
- `pnpm db:migrations:dry-run` — would push only the new
  `20260920153000` migration.
- pgTAP `growth_intelligence_research_pipeline_fail_test.sql` rewritten to
  plan(33) with 8-arg calls, run-row assertions, replay + conflict + bound
  checks. Correct-by-construction against the migration text; NOT executed
  (see pending-push).

## Files
- `supabase/migrations/20260920153000_growth_intelligence_research_pipeline_fail_run_settle.sql` (new)
- `src/workflows/growth-intelligence/run-market-research.ts`
- `src/modules/growth-intelligence/infrastructure/evidence-repository.ts`
- `src/workflows/growth-intelligence/run-market-research.test.ts`
- `src/modules/growth-intelligence/infrastructure/evidence-repository.test.ts`
- `supabase/tests/database/growth_intelligence_research_pipeline_fail_test.sql`

## Follow-up: lane diagnostics on the run failure event

- Importing the key/gate readers into the workflow would violate the
  `growth-intelligence.ts:556-558` boundary (runners never import trigger or
  infrastructure modules), so the workflow takes an optional
  `laneDiagnostics` supplier on `MarketResearchDependencies` instead, wired in
  `createResearchDependencies` from the same `readTinyfishSearchApiKey` /
  `isTinyfishResearchGateOpen` readers the adapter assembly uses.
- `failRun` (both bound and legacy branches) now publishes
  `market_research.failed` with `laneKeyPresent`, `laneGateOpen`,
  `laneAvailable` (adapter availability), `laneProvider` (adapter provider).
  Booleans and short id only, never the key. Absent supplier reads as
  closed (fail-closed default). `failRequest` untouched; no behavior, code,
  or flow change. Publisher does not Zod-validate (passthrough), so no
  schema change needed.
- Tests: `vitest run run-market-research.test.ts growth-intelligence.test.ts`
  — 74 passed (43 + 31), incl. 2 new (supplied values land on the event;
  absent supplier reports closed with the live provider id).
- `tsc` clean; `eslint` 0 errors on touched files.
- Files (follow-up): `src/workflows/growth-intelligence/run-market-research.ts`,
  `src/trigger/growth-intelligence.ts`,
  `src/workflows/growth-intelligence/run-market-research.test.ts`, this report.

## Follow-up: lane snapshot on the failed run output

- The event-payload diagnostics are invisible: `createEventPublisher` only
  logs identifiers and drops payloads with no log-fetch channel. The same
  snapshot now rides the failed run output, which the Trigger run preserves
  where the controller can read it.
- `MarketResearchResult` failed shape gains optional `lane: { keyPresent;
  gateOpen; available; provider }`; `failRun` (bound + legacy) populates it
  from the existing supplier + adapter availability. Event fields stay.
  `failRequest`, success, and terminal shapes untouched; no behavior, code,
  DB, or key changes.
- Tests: 45/45 in `run-market-research.test.ts` (2 new: failed output carries
  supplied lane; completed has no `lane`, cancelled exact), 20/20 evidence
  repo, 31/31 trigger wiring. `tsc` clean, `eslint` 0 errors.
- Files: `src/workflows/growth-intelligence/run-market-research.ts`,
  `src/workflows/growth-intelligence/run-market-research.test.ts`, this report.

## Fix round 2/5: suite-only RLS rework (PASS 34/34)

- Live defect: the suite died at once with `permission denied for table
  market_research_runs`. The table forces RLS even for the owner and grants
  SELECT only to authenticated — direct INSERTs/SELECTs are impossible for
  every available role, so both run-row fixture INSERTs could never run.
- Fix (suite only, no production code): run rows are now created only through
  the governed RPCs like the worker — claim replays on the fixture token,
  `begin_market_research_run` opens the run with valid metadata, the run id
  is read back via definer-owned `pg_temp.fail_run_*` helpers (same pattern
  as the pipeline handoff suite). The pre-failed run is driven to failed
  through the new 8-arg RPC itself.
- One assertion changed for a logic reason (test was wrong, migration is
  right): a queued-pipeline + terminal-run state is unbuildable through
  governed paths — the legacy fail refuses bound requests, rebinding is
  blocked by the request-identity trigger, and the new RPC settles
  atomically — so the `23505` conflict branch is defensive-only. The
  divergent-cost redelivery now asserts convergence (`replayed:true`, first
  run costs stand), matching the preserved terminal-pipeline behavior.
- Plan 33 -> 34, verified by execution (not construction):
  `node scripts/run-pgtap.mjs ...pipeline_fail_test.sql` ->
  `--- PASS: 0 failing assertion(s)` (1..34, all ok) against staging.
- Files: only `supabase/tests/database/growth_intelligence_research_pipeline_fail_test.sql`.

## Pending-push items (do NOT run before push)
- Push `20260920153000` to staging, then run the pgTAP file: pre-push it
  fails at `has_function` 8-arg + every 8-arg call (`function does not
  exist`). Post-push expect 33/33 green.
- After push, call the new 8-arg overload once against staging (plpgsql
  first-call rule) before considering it done.
- No grant/RLS, failure-code, or schema changes beyond the new overload.

## Provider cutover: spend assert follows TinyFish (migration unpushed)

- Live defect: lane opens end to end but every reserve refuses
  (`research_provider_not_qualified`), all canary slots `skipped_policy`,
  pipeline `no_findings` with zero sources. The assert evaluated Brave-only
  blockers while the gate uses per-provider blockers; no brave row is staged
  by design.
- Migration `20260920154000_growth_intelligence_research_provider_tinyfish_cutover.sql`
  (dry-run clean, NOT pushed): `CREATE OR REPLACE
  private.assert_research_provider_qualified()` evaluating
  `research_provider_blockers_for('tinyfish')`. Brave-only semantics retired;
  legacy brave status RPC untouched; no table/grant/RLS change. All assert
  callers (request-scope reserves + repair copies, synthesis retries +
  coalesce copy) serve the TinyFish-only durable lane.
- Suites (assertions untouched, premises repaired): budget suite deletes the
  live tinyfish row before the refusal test, then stages brave (legacy RPC)
  + full tinyfish fixture for all later spend tests — plan stays 60.
  Pipeline suite stages the same tinyfish fixture next to its brave row for
  the retry/attempt success tests — plan stays 68. Retention audited: no
  gated calls, untouched.
- Pre-push execution baselines (migration absent on staging): budget 60/60
  PASS, pipeline 68/68 PASS — the rework is forward-compatible both ways.
  Retention errors pre-existing and unrelated (`memory source erasure is not
  authorized`, file untouched, deterministic across reruns).
- Pending-push verification: `pnpm db:migrations:push`, then
  `node scripts/run-pgtap.mjs supabase/tests/database/growth_intelligence_research_budget_test.sql supabase/tests/database/growth_intelligence_research_pipeline_test.sql`
  must report PASS with 0 failing assertions; without the push the refusal
  test would fail (live tinyfish lane qualifies).
- Files: `supabase/migrations/20260920154000_...cutover.sql`,
  `supabase/tests/database/growth_intelligence_research_budget_test.sql`,
  `supabase/tests/database/growth_intelligence_research_pipeline_test.sql`,
  this report.
