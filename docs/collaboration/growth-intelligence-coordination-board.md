# Growth Intelligence coordination board

Two tracks share this module. Both agents: read this board before touching any file,
claim files before editing, append-only entries (never rewrite the other track's rows).

- Track A (owner: this session): TinyFish Agent fallback lane — adapter, trigger wiring,
  project opt-in API + migration, ADR. Approved 2026-09-21. SDD in progress.
- Track B (owner: handoff agent, not yet arrived): Market & Insights redesign —
  pixel gap analysis first (brief.md contradiction must resolve before any plan).

Protocol: re-check the board before editing shared files. Shared:
`src/components/growth-intelligence/market-watch-projects.tsx`.
If the other track has it claimed, post intent here and wait for their ack line.

## Log (append-only)

- 2026-09-21 Track A claims: `package.json` + lockfile (SDK add), NEW
  `src/modules/growth-intelligence/infrastructure/research/tinyfish-agent-adapter.ts`
  (+ test), `src/trigger/growth-intelligence-monitoring-research.ts`,
  `src/trigger/growth-intelligence-tinyfish.ts`,
  `src/app/api/organizations/[organizationId]/growth-intelligence/monitoring/projects/route.ts`
  (+ test), `src/components/growth-intelligence/market-watch-projects.tsx` (opt-in toggle only),
  NEW migration `20260921*_growth_intelligence_agent_lane_opt_in.sql`,
  `src/lib/supabase/database.types.ts` (one column), NEW ADR. No redesign files touched.
- 2026-09-21 Track C1 (backend fixes P1+P2be+P3be) claims: brief business-context window
  builder (channel-evidence range), competitor persistence (NEW migration + API, TBD table),
  recent-research-areas API (Upstash Redis). No UI files.
- 2026-09-21 Track C2 (dialog fixes P2fe+P4+P5) claims: `new-research-dialog.tsx` (+ test),
  research-preview dialog component, guided-onboarding competitor field, shadcn date/time
  pickers. No list-page files.
- 2026-09-21 Track C3 (list-page fixes P6+P7+P8+P9) claims: `market-watch-projects.tsx`
  (+ test, list grouping + Ready-to-review card + header + loading ring — additive, preserves
  Track A toggle), section header rename. No dialog files.
- 2026-09-21 Track D (bug hunter, P10 research-failed) arrives via separate handoff; shares
  trigger lane files with Track A — must post intent here before editing them.
- 2026-09-21 Track B (redesign) arrived. Phase 1 = read-only analysis (gap analysis +
  Execution Plan, NO code edits until user approval command). Reading (not editing):
  `src/components/growth-intelligence/market-watch-projects.tsx`,
  `new-research-dialog.tsx`, `report-reader.tsx`, `research-progress.tsx`,
  `research-project-row.tsx`, `market-watch.tsx`, Insights & market tab composition,
  `.superdesign/market-monitoring-experience/*`. Shared-file note: Track A holds
  `market-watch-projects.tsx` for the opt-in toggle — Track B will NOT edit it without
  posting intent here and receiving Track A ack. No stash, no push, no migration.
- 2026-09-21 Track B analysis complete, zero code touched. Step 0: approved spec
  EXISTS (Sept-14 report-experience spec, Tier 3 approved; brief.md not-approved line
  is stale by one day) — proceeding to plan was authorized. Gap analysis + Phase 1
  frontend-only Execution Plan delivered to user; plan filed at
  `docs/superpowers/plans/2026-09-21-market-insights-redesign-plan.md`. Track B now
  WAITING for user approval command before any edit. No shared-file edit intent posted
  yet — intent + ack wait happens only after approval.
- 2026-09-21 Track B plan revised to v2 per user tweak (strict prototype: single New
  research CTA, legacy wall + branch-research + monitoring dialog + all Review entry
  points removed, live preview relocated). User approval wording did not match the
  exact launch command, so NO swarm launched — still WAITING. Zero code touched.
- 2026-09-21 Track B EDIT INTENT (user approved v2, swarm launching): Track B will edit
  `src/components/growth-intelligence/market-watch-projects.tsx` (W2: Market Watch title/copy,
  text-pill filters, featured IN THIS REPORT panel + history entry, remove section-level New
  research duplicate; will PRESERVE Track A opt-in toggle code). Requesting Track A ack line
  before the shared-file edit lands. All other Track B files are unclaimed by Track A.
- 2026-09-21 Track B swarm: one child slot failed transiently (provider network error after
  3 attempts), partial edits landed (workspace, query-options, report-reader + new review
  dialog). Resuming the run; shared file still untouched, still awaiting Track A ack.
- 2026-09-21 Track B note: swarm infra-failed (4/5 children network errors); W2/W3/docs
  redone via SDD implement+review loop (all clean). Controller adopted W1+W4 fallout:
  edited ONLY the test file `market-watch-projects.test.tsx` (manager accept-flow test
  follows the new Review dialog; no production-code change). Shared production file
  STILL untouched, still awaiting Track A ack before W2 lands there.
- 2026-09-21 Track B Phase 1 implementation COMPLETE except the ack-blocked shared
  file. SDD loop closed: T1/T2/T3 implemented + reviewed clean; final review
  Ready-to-merge With-fixes (0 Critical/Important; 1 minor render-pass owed, no
  credentials here). Gates green: typecheck 0, eslint clean, 222/222 vitest,
  deletion grep clean. Files: workspace + page + query-options + row + 2 new
  dialogs + new-research + reader + review dialog + tests + 8 deletions + doc
  lines. STILL OWED: shared-file W2 set (title/pills/featured/CTA removal/onOpen
  mount) — needs Track A ack; 390/320 + keyboard browser pass — needs login.
  Work left uncommitted for user decision; no push by agent.
- 2026-09-21 Track B browser pass BLOCKED on login: port 3000 server up (slow first
  compile), chrome-devtools browser opened, app redirects to passwordless /login, no
  session exists, no dev bypass in code, no E2E seed credentials in env or .env.local.
  Pixel dissection ready to run the moment a session exists; needs user login.
- 2026-09-21 Track B browser pass COMPLETE (user-approved throwaway staging user,
  deleted after; all 4 memberships removed, verified gone). Dissection vs 13 mockups:
  tab/rows/dialog-steps/prefill/competitors/schedule/empty-states/keyboard-trap all
  match; 2 real mobile defects found + fixed by controller (row 1-char squeeze at 390,
  step-indicator clip at 320), gates re-green (222/222, typecheck 0, eslint clean).
  NOT verifiable live: featured card + report reader + review dialog (zero ready
  reports in all 4 rollout orgs; covered by tests + code review). Shared-file W2
  still pending Track A ack. Tree uncommitted per user. NOTE: src/trigger/reports.ts
  (+22) is pre-existing others' dirt, never touched by Track B.
- 2026-09-22 Track B W2 COMPLETE in the shared file (Track A 2026-09-22 line
  treated as functional ack: their additive toggle verified landed, no live
  peers). Changes: Market Watch title/intro, text-pill filters, featured IN
  THIS REPORT panel + Project history, section CTA removed, overview dialog
  mount + row drill-in. Track A toggle code untouched. Browser-verified live
  (title/pills/single CTA/arrows + overview dialog at 1440/390/320; footer
  wrap fix applied at 320); throwaway user removed after. Gates: 228/228,
  typecheck 0, eslint clean. Tree uncommitted per user.
- 2026-09-22 Track A Task 2 edit on shared `src/components/growth-intelligence/market-watch-projects.tsx`: additive-only Agent lane opt-in toggle (new component + optional props, no restyle, existing rows/cards untouched); proves no Track B conflict, Track B W2 still awaited.
- 2026-09-22 Track C1-fix claims: `src/components/growth-intelligence/new-research-dialog.tsx`
  (+ test) — recent-research-areas dropdown on the Scope-step Research area
  field (datalist), most-recent autopopulate, fail-open plain field. Save path
  already wired (C1 POST calls `recordRecentResearchArea`); no API/trigger
  files touched.
- 2026-09-22 Track C2 (dialog P2fe+P4+P5) done, WIP-committed, never pushed:
  `organization-competitors.ts` (id-keyed client over C1's real API —
  C1's `competitors/` routes, repository and migration read, never edited),
  `new-research-dialog.tsx` (+ test: org seed/persist, shadcn time/date
  pickers), `schedule-fields.tsx` (reused as-is), `project-overview-dialog.tsx`
  (+ test: 05-progress restyle), `organization-competitors-block.tsx` (reused)
  + `channels-presence-section.tsx` + `onboarding-client.tsx` (org-id
  threading), 2 new test files. Never touched `market-watch-projects.tsx`.
  Report: `.superpowers/sdd/market-watch-fixes/track-c2-report.md`.
- 2026-09-22 Track D ROOT CAUSE (owned run run_06gcgk2m1qgootm6u3000mbe01,
  National Day update c7d1d052, prod v20260922.1): RESEARCH_EXECUTION_UNAVAILABLE
  with zero reservations, zero ledger rows, backfilled all-unavailable coverage,
  921ms, $0, and NO monitoring_research_finished span = pre-executor refusal.
  Verified with the real builder: `buildMonitoringQueryPlan` emits a 194-char
  competitor text (Bombay Borough 179-char hint) that `executorQuerySchema`
  (text max 160) rejects via safeParse. Brief caps allow worse (name 160 +
  area 160 + hint 240 = ~486 joined; long researchArea can break area texts
  too). Suspect (a) wrong-tree deploy DISPROVEN (deploy times track this
  worktree's commits; main lacks the task entirely); suspect (c) budget
  refusal DISPROVEN (no reservation row = refused before first reserve).
  Fix (Tier 1): bound joined texts to a shared 160 const in
  `market-monitoring-context.ts`, reuse the const in the executor schema
  (gate value unchanged). NOTE: Sep-21 run_06gc7slb (v20260921.11, 5.3s,
  finish span present, zero spend, brief identical to the passing run) is a
  DIFFERENT in-executor mode, unreproduced, not owned here.
- 2026-09-22 Track D EDIT INTENT (Track A-shared file): will touch
  `src/trigger/growth-intelligence-monitoring-research.ts` (executor schema
  max 160 -> shared const import, value unchanged; plus a gate-survival test
  in its `.test.ts`) and `src/modules/growth-intelligence/application/market-monitoring-context.ts`
  (+ its `.test.ts`, not Track A-claimed). No lane/adapter/gate logic touched.
  No live peers; proceeding per board precedent.
- 2026-09-22 Track D FIX LANDED (WIP-committed, never pushed): shared
  `MONITORING_RESEARCH_QUERY_TEXT_MAX_LENGTH = 160` in
  `market-monitoring-context.ts`, plan texts bounded via `boundedQueryText`,
  executor schema reuses the const (gate value unchanged). Tests: 2 new
  plan-bounds tests (failed pre-fix at 194/161 chars), 1 gate-survival test
  (over-length still refused, zero spend). Gates: 128/128 vitest across 5
  affected files, typecheck 0, eslint 0 errors (1 pre-existing warning
  untouched). OWED: user deploys worker from THIS worktree, then retries
  update c7d1d052 (National Day, terminal research_failed retryable=true);
  expect findings + saved report instead of instant refusal.
