# Fix chain: report uploads, GI synthesis failures, snapshot baseline skips, stuck packages

Approved Execution Plan (user-approved 2026-09-24, branch corrected to `staging`).
 Diagnosed from Trigger runs run_06gcpdpb12djdufnmdid1f0401, run_06gcpbnerll69o05hpe24plr01,
 run_06gcpakfoper2ovmuvjvphhm01, run_06gcpahelj5h2s8flt325o2s01 (GI synthesis, all
 outcome failed SYNTHESIS_CANDIDATE_INVALID) and run_06gcvmp6i2e5n4u98vt983om01,
 run_06gcvmp8abvebobjq8qog8p301 (revenue snapshots, stored but growth publication
 skipped CANDIDATE_BASELINE_INCOMPLETE on all horizons).

## Global Constraints

- Work only in the staging worktree `/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence`, branch `staging`. Never touch the main checkout or any other worktree.
- Never `git stash`. Never `git push`. Never run `pnpm db:migrations:push` — applying migrations is the user's step after review.
- Staging is shared and live on apply: migrations are additive only and reviewed before apply; pgTAP suites run against staging and are not hermetic.
- TypeScript strict mode, no `any`. Zod schemas at every external and AI boundary. Store timestamps in UTC. Money in integer minor units with ISO currency code.
- Tenant isolation via `organization_id` in every query; no service-role bypass in user-facing request paths.
- Path-limited commits: `git add` only the task's own files. One commit per task after its review is clean.
- Verification org is `2dda45b8-82db-4f5f-b17d-611b9bbb7846` (Al Noor Kitchen). Tenant-isolation check org is `859cf039-1cd8-41b0-bd09-66c6c52e9c52`.
- Never deploy Trigger workers and never trigger real worker runs to verify; verify with unit tests, pgTAP suites, and read-only staging checks. If a staging data read is needed beyond pgTAP, report NEEDS_CONTEXT with the exact query — the controller runs it.
- No model may call a destructive or money-moving tool directly. Every side effect passes through the deterministic Tool Gateway and policy check.
- Do not dispatch subagents. Do not spawn reviewers. Review arrives from the controller after the report.

## Task 1 — Pin the exact synthesis rejection reasons (diagnose-only, read-only)

- Reproduce, without model calls and without database writes, the validation path for the four failed synthesis runs and report the exact `SynthesisValidationReason` per run:
  - runId `d295cac5-b9a2-47ac-a50e-11b62b3530f1`, request `1e3ff0f0-3bc8-442e-9dd4-794d05cfa815`, profile version `0d45226e-f6e3-4a20-8dae-07a4c3b3dfce`, channel `b4f83dd2-3035-4676-9cf3-cedc9b9e7884`
  - runId `880df421-d94c-48da-b102-456682a5e8b8`, request `bd671a9d-7f37-498e-ab77-5280bf0664e2`, profile version `0d45226e-f6e3-4a20-8dae-07a4c3b3dfce`, channel `b4f83dd2-3035-4676-9cf3-cedc9b9e7884`
  - runId `813e4adf-b172-45d4-be56-4997269b2d59`, request `3c9919d7-8ca3-4fa2-8c14-d461149e3e23`, profile version `7d9f4327-8abe-40eb-ae0b-2004b7e561e0`, channel `0aef3ea7-0a0c-4fa9-a438-8074818acfd9`
  - runId `6182a870-c4d4-44f0-b5fa-b817fef66b10`, request `f33838c9-974e-466a-b64f-280e85c998b5`, profile version `7d9f4327-8abe-40eb-ae0b-2004b7e561e0`, channel `0aef3ea7-0a0c-4fa9-a438-8074818acfd9`
- Known staging facts to use verbatim, not re-derive: the org holds exactly 2 market evidence claims (`seed.competitor-offer`, `seed.ramadan-demand`), both with `stale_at` 2026-09-06; validator is `validateSynthesisCandidate` in `src/domain/growth-intelligence/synthesis.ts`, which rejects insight/recommendation candidates with zero cited claims (`MISSING_CITATION`).
- Drive the loaders in `src/trigger/synthesis-loaders.ts` plus the validator over these inputs in a test harness. No production code change. If the reproduction exposes a service or validator bug rather than thin evidence, do not fix it — report it with proof and stop.
- Acceptance: report maps each runId to its rejection reason(s) and states whether fixing market evidence (Tasks 2-3) suffices or a service change is required.

## Task 2 — Fix the Tinyfish zero-source research path

- Explain and fix why market research runs `43c62aa3-ab30-44da-9a7d-1f019c132309` and `2fa8e579-7ec9-4fad-9ea7-d996d518dca8` (adapter `tinyfish`, model `gemini-3.6-flash`) ended `partial` with `source_attempt_count = 0` and `source_success_count = 0`.
- Owned files: `src/trigger/growth-intelligence-tinyfish.ts`, the market evidence loaders feeding `src/trigger/synthesis-loaders.ts`, and their test files. Do not touch the Brave adapter or run-lease recovery — that is Task 3. If both tasks need the same shared registry edit, make the minimal change here and note it in the report so Task 3 builds on it.
- The Tinyfish path must either return sources or record a truthful reason; silent zero-source `partial` is the defect.
- Acceptance: unit tests pin the fixed behavior (sources returned for a known-good query shape; truthful reason recorded when the adapter yields nothing); focused vitest files plus `pnpm typecheck` clean.

## Task 3 — Fix the Brave adapter failure and recover orphaned research runs

- Explain and fix `ADAPTER_UNAVAILABLE` on market research runs `624a5052-be45-4515-8433-33924c0092ae` and `90745877-aed7-4db4-b07b-a4d0761d2f6c` (adapter `brave`): restore availability or remove Brave from the rotation with a logged reason.
- Recover or cancel the orphaned `running` runs `f7fa5a3a-7c9d-45f3-81d4-58baa144c4e1` (adapter `brave`) and `096144d6-d75b-45da-bf73-da5cd81ee05c` (adapter `tinyfish`), both stuck since 2026-09-21 with `model_version = 'unconfigured-review-model'` and zero source attempts. Use the existing guarded run transition only — never a raw status rewrite. If no guarded transition covers this, report NEEDS_CONTEXT with the exact RPC needed and stop.
- Owned files: the Brave adapter, adapter rotation/selection, run recovery path, and their test files. Do not touch the Tinyfish result mapping — that is Task 2.
- Acceptance: Brave path either succeeds or is excluded with a logged reason; both orphaned runs reach a terminal state through the guarded transition; tests pin the new behavior; `pnpm typecheck` clean.

## Task 4 — Implement the snapshot growth candidate (or keep a truthful refusal)

- `buildSnapshotGrowthCandidate` in `src/modules/organizations/application/growth-projection-publisher.ts` currently refuses every horizon with `BASELINE_INCOMPLETE` ("The nightly snapshot material carries no ledger-bound baseline facts"). Authority is `docs/superpowers/plans/2026-09-18-overview-growth-data-contract.md` (Task 5 owed: populate-vs-amend lineage bringing bound inputs to this boundary) and the ADR 0060 comment on `src/modules/organizations/application/revenue-snapshot.ts`.
- Implement the ledger-bound baseline candidate per that contract so due horizons publish. If the contract's Task 5 inputs are genuinely absent, keep the refusal but replace the reason with one that names the true blocker — do not keep reporting a baseline problem when the baseline is not the problem.
- Owned files: `growth-projection-publisher.ts`, `growth-projection-builder.ts` only if a baseline rule must change per the contract, `src/trigger/revenue-snapshots.ts`, and their test files.
- Acceptance: the nightly run for the dev org publishes due horizons from real baseline facts, or records the true blocker; all horizons no longer share one blanket skip; tests cover publish, skip, and refusal paths; `pnpm typecheck` clean.

## Task 5 — Stuck packages: verify operator flows, produce the runbook, no app code

- Package `917c1087-82f3-428d-a768-5669b39fa18c` (Aug 2026.csv, `projection_failed`): verify the operator label-naming flow (from commit `d9990da`, "let an operator name a label the provider wrote") covers declaring `TOO_BUSY_KITCHEN` for output `closed_days_by_reason` (failed dates include 2026-08-09). Produce the exact operator steps: declare label, then Retry projection. If the `22023 report projection observation evidence is invalid` refusal would still fire after declaration, do not fix it silently — report NEEDS_CONTEXT with the reproduction and stop.
- Package `c6e6ff13-1a8b-496a-8b14-45b02d316ecc` (Sep 2026.xlsx, `validation_failed`, `INVALID_INTEGER`, 1 failed field of 379): find where the field-level failure detail surfaces and name the exact cell/field the operator must correct, plus re-upload steps.
- No production code change in this task. Acceptance: report contains the verified step-by-step operator runbook for both packages and the `22023` verdict (needs-code with reproduction, or clears on declaration).

## Task 6 — Orphan-recovery migration draft plus blocked-lane label (draft only, no apply)

- Context: Task 3 proved no existing guarded transition settles the orphaned `running` market research runs `f7fa5a3a-7c9d-45f3-81d4-58baa144c4e1` and `096144d6-d75b-45da-bf73-da5cd81ee05c` (leases dead since 2026-09-21); all settling RPCs demand a live lease. Controller ruled mislabel hypothesis confirmed and authorized drafting this corrective migration; apply stays the user's step.
- Item 1: new additive migration `supabase/migrations/20260924090000_expire_stale_market_research_runs.sql` creating service_role-only `public.expire_stale_market_research_runs(p_older_than_seconds integer, p_safe_failure_code text default 'WORKER_ORPHANED')` per the exact SQL in `task-3-report.md` section 6. Before writing, verify every table and column name against the live schema (read migration `20260909090000` lines 918-1143 and `information_schema`) — never assume names. Guards: service_role-only, floor 3600 seconds, safe-code regex, settles only `running` rows whose request lease is already dead, idempotent on non-running rows. Grants: execute to service_role only.
- Item 2: pgTAP suite `supabase/tests/database/growth_intelligence_expire_stale_research_runs_test.sql` following existing `growth_intelligence_*_test.sql` patterns: expires an old running run with dead lease; spares a live lease; spares non-running rows; rejects invalid inputs; rejects non-service_role callers per the file's role conventions. The suite's own execution against staging counts as the mandatory first call of the new plpgsql.
- Item 3: blocked Tinyfish lanes must record `adapter_provider = 'tinyfish'`, not the legacy `'brave'` default, in `src/trigger/growth-intelligence.ts` `blocked()` path (Task 2's file — minimal one-line change plus test updates). Historical staging rows stay untouched.
- No `database.types.ts` change: no table added and no typed caller added (the settling call runs manually later).
- Never run `pnpm db:migrations:push`. Never run the settling select. Acceptance: migration file plus green pgTAP suite plus typecheck clean; report ends with the exact apply and settling SQL for the user (`select public.expire_stale_market_research_runs(259200, 'WORKER_ORPHANED');`).
