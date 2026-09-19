# Task 2 persistence record — immutable projection schema and tenant boundaries

Date: 2026-09-18. Worktree `.worktrees/governed-channel-intelligence`, branch
`feat/governed-channel-intelligence`. No secrets, amounts beyond synthetic test
figures, or customer fixtures appear below.

## 1. Migration identity

- File: `supabase/migrations/20260918120000_organization_growth_projections.sql`
  (new, no collision; latest pre-existing file is `20260917170000`).
- Contents: `public.organization_growth_projections` (20 D04 columns, unique
  `organization_id/horizon_months/cycle_index`, active-period index),
  `private.refuse_organization_growth_projection_change()` + BEFORE UPDATE
  trigger (PGR06, every role), `public.publish_organization_growth_projection`
  (SECURITY DEFINER, empty search_path, EXECUTE service_role only),
  ENABLE/FORCE RLS, one SELECT policy (channel.read + conditional
  growth_intelligence.read/campaign.read), SELECT-only grant to authenticated,
  all other grants revoked (incl. direct service_role DML).
- Error vocabulary: PGR01 invalid envelope, PGR02 tenant mismatch, PGR03
  nonprospective period, PGR04 scheduling mismatch, PGR05 invalid curve,
  PGR06 immutable row.

## 2. Pending-list evidence (read-only commands)

- `pnpm db:migrations:list` before the change: every local migration matched
  remote; **zero pending**. Note: the brief expected unrelated peer
  migrations (incl. `organization_invitations`) NOT PUSHED, but staging
  already holds through `20260917170000` — `20260917090000` shows in both
  columns. Recorded as observed, not as expected.
- `pnpm db:migrations:dry-run` before: `Remote database is up to date.`
- `pnpm db:migrations:dry-run` after writing the file: would push exactly
  one migration — `20260918120000_organization_growth_projections.sql`.
- `pnpm db:migrations:push` was NOT run (hard gate). Nothing was applied to
  staging by this task.

## 3. pgTAP suite — written, NOT executed

- File: `supabase/tests/database/organization_growth_projections_test.sql`
  (rollback-wrapped, `no_plan` + `finish`, isolated `a1000000` fixtures, two
  tenants plus a nonmember stranger, fixed 2030 calendar dates so schedule
  assertions never depend on run day).
- Coverage maps to the brief list: column contract, identity uniqueness,
  active index, forced RLS, zero write policies, all table grants (member /
  worker / anon), RPC existence + definer + execute grants, pre-publish
  absence, authenticated RPC denial, service publication + canonical digest,
  same-identity replay, changed-candidate replay, 20-case rejection matrix
  (PGR01/02/03/04/05), cross-tenant channel/branch/definition/source,
  estimated/superseded/future/foreign-currency/unadmitted/missing sources,
  off-grid/second-origin/timezone schedule rejections, per-flag reads,
  tenant-B and nonmember and anon denial, trigger refusal via a momentary
  policy+grant (dropped in-suite), worker update/delete denial, member update
  denial, audit field + payload allowlist, single-trigger trim isolation.
- NOT executed because: the migration is unapplied so the suite cannot pass
  yet; `pnpm db:test` runs against shared staging and this suite performs
  writes (rolled back) plus a momentary grant/policy swap; no local Postgres
  exists in this environment (`/usr/lib/postgresql` absent, hosted-only rule
  forbids standing one up). Execute at the authorized push gate, after apply.
- First-call rule: the RPC and trigger run inside the suite above; evidence
  (first publication + every rejection branch) is collected at the gate, not
  here. A clean apply alone does not pass AC02/08.

## 4. Explicit skips (not passes)

- Two-session concurrent publication (two connections, one identity, assert
  one row/id/event): cannot run in `scripts/run-pgtap.mjs` (single
  connection, `max: 1`) and cannot run before staging apply. The suite now
  asserts the in-session mechanism (advisory xact lock still held after a
  publish, unique identity key via `col_is_unique`) and records the exact
  gate procedure (two psql sessions, BEGIN both, one fresh identity each,
  COMMIT both, assert one row/id/event). Gate item.
- Exact-range happy-path quality gates are now covered (org-A chain +
  publication); the cross-tenant exact-range rejection is covered (org-B
  chain). Remaining exact-range branch gaps (e.g. superseded/partial on the
  normalized side equivalents) ride the shared code path; Task 4 worker
  tests own further vectors.
- `EXPLAIN` on staging for additional indexes (D04): deferred to post-apply;
  only the specified active-period index ships.

## 5. Deliberate contract choices for Tasks 3–5

- `timeZone` must equal the organization's current `default_timezone`
  (PGR04 otherwise); every partition `periodTimezone` must equal the document
  `timeZone` (PGR01 otherwise).
- `sourceCutoffDate` must not postdate the issue day in the org zone (PGR01).
- Archived organizations publish nothing (PGR01); unknown organization PGR01.
- `requires_campaign_read` derives from an assumption `sourceKind` starting
  with `campaign`; `requires_growth_read` from one starting with `growth`;
  any other kind sets BOTH (most restrictive; mapping reviewed with advice
  qualification later, never relaxed silently). Baseline-only → both false.
- Digests are `sha256` hex over the `jsonb::text` form (`extensions.digest`;
  keys normalized by jsonb). The RPC returns `input_digest` as `digest`.
- Lowercase currency is normalized (`upper`) at the boundary, mirroring the
  Task 1 Zod transform; anything else non-ISO is PGR01.
- Frozen source claims are BOUND to ledger truth, not just well-formed: the
  declared window must equal the row's day boundaries in its recorded
  timezone (normalized) or its stored dates (exact-range), the amount must
  equal the stored numerator, and the revision must equal the row revision —
  otherwise PGR01. Normalized sources must additionally be current
  (`superseded_by_id is null`), `measured|derived`, money-kind, same
  currency, created no later than `issuedAt`; exact-range sources must be
  `complete/complete` with the same standing rules. A corrupt recorded zone
  fails closed as PGR01 (probed before conversion).
- The source `digest` stays an opaque lineage identifier (D04's own word):
  neither ledger table has a digest column to bind it to; shape-checked
  only. The `revision` carries the binding instead.
- `citedFindingId` is carried as opaque lineage for the Task-5 advice join,
  uuid-shape only — explicitly NOT a trust anchor. Binding it to
  source-owned finding tables is a tracked Task-5 follow-up, never silent.
- RPC returns `published=false` replays BEFORE source/curve validation, so a
  replayed call never re-audits even when the candidate differs (D04:
  "even if a new candidate digest differs"). Divergence signalling is the
  worker's job from the `published=false` answer: tracked Task-4 follow-up
  is to emit the bounded replay diagnostic there, not a second DB event.
- An empty `sources` array is VALID (pinned by test): a projection that
  cites no observation is a claim about none, still gated on baseline
  window, schedule, and curve.

## 8. Task 8 hosted re-run (2026-09-19) — executed, environmentally blocked

- Command: `pnpm db:test
  supabase/tests/database/organization_growth_projections_test.sql
  supabase/tests/database/organization_growth_schedule_read_test.sql` → exit 1,
  0 failing assertions, 2 failed suites (both ERRORs, not assertion failures).
- Suite 1 (`organization_growth_projections_test.sql`): ERROR `duplicate key
  value violates unique constraint "normalized_metrics_revision_idx"` on a
  fixed `a1000000` fixture identity — shared-staging collision (another
  session's committed row or an earlier partial run; the runner rolls back its
  own work but cannot remove others'). No assertion ran. Retried? No — the
  collision is persistent staging state, and writes to clear it are forbidden.
- Suite 2 (`organization_growth_schedule_read_test.sql`): ERROR `relation
  "public.organization_growth_projections" does not exist` — expected: the
  migration push is still deferred (Task 2 gate), so the table is absent on
  staging. The suite cannot pass before the push gate.
- First-call rule status: UNMET — the new RPC has still never been called
  against staging (Task 5 RPC-first-call deferral carries forward). A clean
  apply alone will not pass AC02/08; first-call evidence belongs to the push
  gate. Nothing was pushed to make anything pass.
- Safe-ids disclosure: only suite paths, assertion counts (0), fixed fixture
  prefixes (`a1000000`), and the constraint/relation names above. No amounts,
  no customer rows.

## 6. Local checks (commands + exits)

- `pnpm exec vitest run src/lib/supabase/database.types.test.ts` → 109/109
  passed, exit 0 (hand types match migrations, new table included, no
  untyped exemption). Re-run after the fix round: still 109/109, exit 0
  (migration edits are body-only; no column changes).
- Both SQL files parse clean via `pgsql-parser` (libpg_query, offline
  equivalent of `pg_parse`): migration PARSE-OK, suite PARSE-OK. Scope is
  syntax only — semantic proof (first-call rule) still belongs to the gate.
  The parse check already paid once: it caught `CREATE TEMP FUNCTION`
  (invalid Postgres) in the suite, fixed to `pg_temp.` functions per the
  `campaign_bundle_test.sql` precedent.
- `pnpm exec eslint src/lib/supabase/database.types.ts` → clean, exit 0.
- `pnpm exec prettier --check src/lib/supabase/database.types.ts` → clean.
- `pnpm typecheck` → exit 2 with exactly the 4 pre-existing Task0 baseline
  errors (settings `segment` prop; 3× invitations LogContext/organization_id);
  zero errors in touched files; peer files untouched. Not re-run in the fix
  round (no TypeScript file changed); baseline stands.

## 7. Fix round (review b468ffa..256d88e) — what changed and what was disclosed

- Important 1 (suite abort under service_role): all direct projections-table
  reads moved out of `service_role` blocks — RPC calls return outputs only,
  captured via temp tables, verified as owner after `reset role`. The
  currency read moved likewise. Added `grant select on test_docs to
  authenticated, service_role`, without which every denial test would have
  passed for the wrong reason (temp-table 42501 instead of the intended
  RPC/table denial).
- Important 2 (unbound frozen claims): window/amount/revision now compared
  to the ledger row for both source tables (PGR01 on mismatch), revision is
  presence/shape/binding-checked (previously entirely unchecked), digest
  documented as opaque per D04, `citedFindingId` explicitly removed from the
  trust story with a Task-5 binding follow-up. New rejection cases for
  window/amount/revision mismatch; fixtures realigned (shared-def amount and
  revision text now match the cited rows).
- Important 3 (missing cases): exact-range cross-tenant rejection added with
  a real org-B chain (contract → package → versions → bindings → runs →
  observation); exact-range happy path + partial rejection added with a real
  org-A chain; two-session concurrency mechanism asserted in-session
  (advisory lock held + unique key) with the exact two-psql gate procedure
  recorded — true interleaving stays a gate item (single-connection runner).
- Minor: zero-source array pinned VALID by test (new publication + counts);
  trim isolation strengthened with a `pg_proc` negative assertion (only the
  RPC references the table); replay-before-validation kept deliberately per
  D04 with the worker-diagnostic follow-up tracked for Task 4.
- Minor (peer hunks in 256d88e): the `organization_invitations` table entry
  and six invitation RPC entries in `database.types.ts` arrived via the
  worktree's shared file, not this task. Verified against
  `20260917090000_organization_invitations.sql` (columns, all six
  signatures incl. preview/list shapes) — they match staging truth and the
  drift suite green-proves the table part. Deliberately NOT reverted (peer
  scope) and NOT expanded.
- Tracked follow-ups with owners: Task 4 — replay-divergence diagnostic on
  `published=false`; Task 5 — `citedFindingId`/sourceKind mapping binding;
  gate — two-session run, first-call evidence, post-apply EXPLAIN.
