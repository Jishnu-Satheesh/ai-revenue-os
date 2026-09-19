# Task 8 final report — verification, delivery and rollback record

Date: 2026-09-19. Branch `feat/governed-channel-intelligence`. Terminal gate
for the Overview growth-progress slice (Tasks 0–7 complete). No credentials,
URLs, payloads, prompts, customer rows, or amounts in this file.

## 1. Parked MUST-DO wiring — DONE (narrow scope only)

- `growth-progress-view.ts`: `failed` union gains `retainedView:
  GrowthProgressView | null` (+ schema); `failedGrowthProgressSection` takes an
  optional retained view (default null).
- `home-loader.ts`: `LoadOrganizationHomeInput` gains optional
  `retainedGrowthView`; a throwing growth read degrades with the retained view
  attached, still logging only the fixed `growth:home_read_failed` code.
- `home-service.ts`: no code change needed — composition already passes the
  section through untouched; a new test pins failed-with-retained passthrough.
- `home-revenue.tsx`: the `failed` branch renders `HomeGrowthFailed` with the
  retained view (report-date label) and router-refresh retry; initial failure
  (null) keeps the shaped copy. Safe today = honest initial failure, unchanged.
- Covering tests: loader retained carry-through, service passthrough, rendered
  retained date + retry, null shape updates. Slice: 19 files / 358 tests green.

## 2. Commands and exits

| Command | Exit | Result |
|---|---|---|
| 6-file focused vitest (wiring) | 0 | 163 passed |
| 19-file slice vitest | 0 | 358 passed |
| `playwright test overview-growth.spec + visual.spec` | 0 | 24 passed (1 expected-fail touch), 4 skipped |
| `playwright test organization-home.spec` | 1 | 2 failed = pre-existing peer login-copy drift; 16 skipped (no seed env) |
| `db:test` (2 growth suites) | 1 | 0 assertion failures; 2 environmental ERRORs (staging collision; table absent pre-push) |
| `typecheck` | 2 | exact 4 pre-existing Task 0 peer errors; zero slice errors |
| `eslint` slice paths | 0 | clean |
| `eslint .` (full tree) | 1 | 24 errors, all peer/pre-existing, none in slice |
| `test` (full unit) | 1 | 7584 passed; 5 transient failures incl. 1 slice flake (passes isolated + in slice combo) |
| `build` | 1 | compiles OK; blocked by peer `settings/page.tsx` tsc (Task 0 error, unfixed per rules) |
| `git diff --check` | 0 | clean |

## 3. Pass / fail / skip ledger

- PASS: parked wiring, visual anchors (table in visual-review.md), V09 isolated
  matrix (except touch finding), route protection, production import/route
  check, rollback composition check.
- EXPECTED-FAIL (tracked finding): real-touch tap opens no tooltip (hover +
  keyboard + mouse-click work). Fix outside Task 8 file map.
- SKIPPED with reason: 3 authenticated E2E (no seed env/creds, invention
  forbidden), sidebar expanded/collapsed at 1440 (needs live route + flag),
  pgTAP first-call proof (needs push gate), staged publication run + migration
  push + worker deploy (user-gated), missing/upcoming/awaiting/stale browser
  states beyond unit level (harness served behind/ahead/failed only).
- FAILED (not owned): org-home route-protection x2 on peer login-copy drift.

## 4. Migrations performed / not performed

- Performed: NONE. No `db:migrations:push`, no dry-run mutation, no seed.
- Not performed (deferred with procedure): `20260918120000` push
  (owner-sequenced) → pgTAP first-call evidence → worker deploy with version →
  staged run with before/after identities → replay-digest proof (worker.md).

## 5. Rollback result

- Flag OFF (`isOverviewGrowthProgressEnabled` false): loader returns the
  `disabled` section and bypasses the growth path; composer passes it through;
  legacy revenue section renders exactly (unit-pinned: lower-home identical
  with/without growth; flag-off legacy suite green in the 358).
- Stored projections untouched by rollback (immutable table, refuse trigger,
  no destructive SQL written or run). Legacy forecasts keep their
  "Reported"/"Rough estimate" labels — never relabelled actuals.
- Rollback exercise verdict: RESTORES via the allowlist alone. PASS.

## 6. Blockers and live gates (explicit, preserved)

1. Migration push + pgTAP first-call + worker deploy + staged run (user gate).
2. Authenticated operator/viewer/nonmember E2E (seed env gate).
3. Sidebar 1440 matrix + full-route isolated-vs-route checks (live gate).
4. Real-touch tooltip fix (follow-up implementer, chart file).
5. Peer red: settings/page tsc (blocks build), login-copy drift (blocks 2
   org-home E2E), full-tree lint errors, 4 full-suite flakes incl. peer files.

## 7. AC01–AC12 evidence map (actual, not claimed)

- AC01: visual-review anchors + overlays; Task 6 geometry; no baseline adopted.
- AC02: digest/identity pins (unit + browser digest equality); first-call live
  proof still gated — no live immutability claimed.
- AC03: coverage/exact-scope/currency/overlap suites green (Tasks 1/3/5).
- AC04: numeric vectors + range classification + plotted positions green.
- AC05: advice links/qualification suites green; no unsupported causes.
- AC06: independent periods/rollovers + selector immutability green.
- AC07: interaction matrix above; touch finding open.
- AC08: RLS/denial suites green at unit level; hosted denial proof gated.
- AC09: gaps/coarse-endpoint/no-future-actuals suites green.
- AC10: lower-home/snapshot/proposal regression green (358).
- AC11: this file + visual/functional/persistence/worker reviews; skips listed.
- AC12: this file + task-8-report.md; rollback exercised (flag path).
