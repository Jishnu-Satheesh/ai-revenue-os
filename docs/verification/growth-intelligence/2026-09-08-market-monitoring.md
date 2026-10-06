# Market monitoring baseline — 2026-09-08 (Task 1, 12-task plan)

Date: 2026-09-08. Plan approval: user replied "Approve, start Task 1".
Scope of this record: read-only orientation and baseline. No migration was pushed,
no provider was called, no paid canary ran, no feature code was written.

## Worktree state

- Branch: feat/governed-channel-intelligence. HEAD: 481ca76 (unrelated cache commit).
- `git status --short`: 111 dirty paths, all preserved untouched.
- Already-changed GI paths (not this task's work): growth-intelligence page, GI API routes,
  workspace/cards/timeline components and tests, api-schemas, read-model, read-service,
  triage-service, read-repository, synthesis-repository and their tests, plus a new
  feedback route dir and intelligence-actions component.
- Design inputs, all uncommitted revisions preserved:
  - docs/superpowers/specs/2026-09-08-market-monitoring-research-completion-design.md (modified)
  - docs/superpowers/plans/2026-09-08-market-monitoring-research-completion.md (untracked)
  - adrs/0047-branch-scoped-grounded-market-research.md (modified)
  - specs/022-growth-intelligence.md (modified)
- Commit 9c01270 holds the superseded Google-Grounding design; it is history only.

## Staging migrations

- `pnpm db:migrations:list`: 242 local rows, 242 remote rows, 0 mismatched, 0 pending.
- Task 13 synthesis persistence migration 20260903120000 is applied remotely, including
  begin/complete/fail_growth_intelligence_synthesis, decide_growth_intelligence_item and
  set_growth_intelligence_preference (service-role fenced; decisions/preferences also
  granted to authenticated).
- Existing market RPC surface confirmed in migration files (signatures, not payloads):
  propose/decide_market_profile_version, enqueue/claim/complete/fail/cancel/retry
  _growth_intelligence_request, begin/record/complete/fail market research run and
  evidence-recorder functions, market_evidence_claim_current_state.
- New RPCs from the 12-task plan do NOT exist yet: start_branch_market_research,
  complete_market_research_pipeline, retry_market_research_synthesis, budget
  reserve/settle functions, branch-profile and pipeline tables.

## Test baseline

- `pnpm exec vitest run src/domain/growth-intelligence src/modules/growth-intelligence
  src/workflows/growth-intelligence src/components/growth-intelligence`:
  40 files passed, 334 tests passed, 0 failed.
- `pnpm typecheck`: 5 errors, all pre-existing in unrelated channel month-window work
  (channels [channelId] page, channels analysis route, src/trigger/reports.ts).
  Zero errors mention growth-intelligence. These files carry other sessions' uncommitted
  changes and are not this slice's to fix silently.

## Provider qualification (names only, no secrets)

- No Brave key in .env.local or process env: Brave storage/reuse qualification BLOCKED.
- Gemini key names present in .env.local, but pinned model, rate table and enforceable
  billable bounds are NOT qualified: paid extraction/synthesis BLOCKED.
- No market-research provider selector configured; research adapter stays fail-closed.
- Consequence per plan: implement and test with synthetic fixtures only. No silent
  substitution of Google Grounding, Exa, Tavily, or page scraping.

## External launch prerequisites (still open)

- Actual Brave account agreement covering retained snippets, commercial Gemini inference,
  organization display, derived claims, reuse, retention/deletion.
- Qualified paid Gemini model with pinned rates and bounded billable tokens.
- Credentials through the established secret mechanism (not source files).
- Controlled staging canary proving eligible sources/claims, unique synthesis child,
  branch-fenced items, final UI state, reconciled cost/coverage.
- Authenticated browser verification of the dialog-to-recommendation flow.

## Next

Task 2 (compatible scope, lifecycle and budget contracts) is unblocked on fixtures.
Tasks 3+ need forward migrations against shared staging, one reviewed migration at a time.

---

# Task 12 completion verification — 2026-09-09 (12-task plan, Tasks 2–11 done)

BASE `1433327`. No feature code, no migration, no provider enablement, no paid canary.
Gates stay OFF; new starts stay disabled. Full evidence in
`.superpowers/sdd/2026-09-08-market-monitoring-research-completion/task-12-report.md`.

## Gates (baseline vs slice, commands + outcomes)

- `pnpm typecheck` → 0 errors (exit 0). No pre-existing errors remain; peer channel files fixed.
- `pnpm lint` → FAILS: 11 errors, 42 warnings. 9 errors sit in committed slice files (Tasks
  7/8/11 never ran lint): `run-market-research.ts` 3× no-restricted-imports + 1× prefer-const,
  `market-monitoring-dialog.tsx` 3× setState-in-effect, `research-progress.tsx` 2× (ref-in-render,
  setState-in-effect). 2 errors are peer-owned (`dev-loader-preview`, `analysis-progress`).
  None are mine to fix in a docs-only task — recorded as open release blockers.
- `pnpm test` (full) → 4822 passed, 6 skipped, 2 failed (451 files, 437 s). Both failures are
  non-slice: `database.types.test.ts` (5 unaccounted `creative_*` tables from peer's untracked
  `20260909124757` migration) and `project-report-package.test.ts` (reports workstream).
  Every growth-intelligence/market-monitoring suite passed.
- `pnpm build` → clean (exit 0).
- `pnpm db:test` (all 12 GI/market-evidence suites, hosted staging, rolled back) → 11 PASS, 1
  FAIL: `growth_intelligence_item_decisions_test.sql` test 25 expects the old
  `market_evidence_immutable` DELETE refusal, but Task 5's retention rewrite
  (`20260908140000`) renamed it to `market_evidence_delete_forbidden`. Slice-attributable,
  needs a code/test owner. Partial alphabetical full run also showed 2 failures in peer
  `decision_engine_behavior_test.sql` (tests 29/53, feed projection — outside the slice).
- Migrations: every slice migration paired Local|Remote (Tasks 3, 4, 5, 7, 8, 9); dry-run would
  push only peer-local `20260909124757` (not mine, not pushed). Every new PL/pgSQL path executed
  at least once on staging via the pgTAP runs above; zero residue (rolled-back transactions,
  SELECT-only probes).

## Browser + provider (honest outcome)

- `pnpm exec playwright test e2e/growth-intelligence.spec.ts` → 8 passed, 12 skipped, 0 failed.
  New research route-protection tests prove strangers get 401 without leaks on start/read/retry.
  The 12 authenticated scenarios (workspace + Start→outcomes, concurrency, reload,
  partial/no-findings, retry, viewer denial) skip: no `E2E_GROWTH_ORGANIZATION_ID` seed and no
  staged qualification exist here. First cold run failed on a `pnpm dev` boot race
  (`ERR_ABORTED` on all navigations); green on retry against a warm server.
- Provider qualification BLOCKED: no Brave key in env, no Gemini rate/model qualification, zero
  staged qualifications. Paid canary BLOCKED. Real-browser 375px/desktop eyeball vs prototype
  remains open (jsdom class assertions only).

## Gap-row close-out (design §table, six rows)

1. Provider terms vs reusable evidence → gate + fail-closed default hold; account qualification open.
2. Branch replacement → atomic start, A/B pgTAP 40/40.
3. "Done" before recommendations → pipeline through synthesis, 68/68.
4. Crash loses handoff → atomic handoff + replay/sweeper, 68/68.
5. Branch-agnostic analysis → branch-fenced loaders + SQL, 24/24.
6. Cost/coverage promises → slots, coverage manifest, reservations, 60/60 + 31/31 + adapter suites.

## Remaining release acceptance (all blocked, none claimed)

Staged qualification + budget approval → one paid canary (receipts, links, unique child,
branch-fenced items, honest cost) → seeded-browser research flow incl. 375px/desktop eyeball →
fix lint (9 slice errors) + item-decisions test-25 expectation → re-run the five gates green.

## Browser verification 2026-09-09 (Chrome DevTools, staging canary org)

Authenticated agency-owner session, Al Noor Kitchen (3 branches), local dev server.
Dialog → Start (201) → status → actions chain verified against real staging rows.

- Deira start committed profile version + pipeline + request atomically; status reads back
  Queued/Deira/Dubai-AE with topics, coverage [] and ineligible retry; Your actions names
  the start with branch scope; Market Watch reports research running; reopening the dialog
  disables Start as Research in progress with the replacement-run explanation.
- Three anomalies found and fixed (commits 2c44917, 2ebb8f2): invisible blocked reason,
  missing legacy-draft fallback (dead end for legacy-only orgs), wrong `document` column
  in the status read (422 on real rows; mocks had mirrored the bug).
- Brave key live probe (4 single queries, nothing persisted): key authenticates; real
  envelope is `{web:{results},...}` siblings, not top-level `results` — parser fixed and
  re-proven live (`supported`). Single-shot unwired transport added with stubbed tests.
- Still blocked (unchanged): account storage/reuse agreement, Gemini model/rate
  qualification, budget approval, paid canary, seeded-browser full flow + 375px eyeball.
  Gates OFF. Staging side effects: one Deira v2 profile + queued pipeline + request.
