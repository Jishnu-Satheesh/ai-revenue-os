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

## Pending-push items (do NOT run before push)
- Push `20260920153000` to staging, then run the pgTAP file: pre-push it
  fails at `has_function` 8-arg + every 8-arg call (`function does not
  exist`). Post-push expect 33/33 green.
- After push, call the new 8-arg overload once against staging (plpgsql
  first-call rule) before considering it done.
- No grant/RLS, failure-code, or schema changes beyond the new overload.
