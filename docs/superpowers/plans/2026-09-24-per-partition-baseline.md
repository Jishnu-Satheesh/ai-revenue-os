# Per-partition baselines from available reported days (user-approved direction 2026-09-24)

Reworks the trailing-baseline evidence rules after the live-verified refusal
(run_06gd49531c279r26angbq4cv01): rung 1 holds 3 reconciled days (< 7 floor)
and rungs 2-4 die on ghost scope partitions minted from 208 unreconciled rows.
User requirements (all four stand): per-partition baselines, use the available
reported-day count, reporting scope counts as evidence, keep the first rung
publishing on its own. Closes with ONE controller manual re-run + verify.

## Global Constraints

- Work only in the staging worktree `/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence`, branch `staging`. Never touch the main checkout or other worktrees.
- Never `git stash`. Never `git push`. Never run `pnpm db:migrations:push` — no migration is expected; if one proves necessary, propose it separately before applying.
- TypeScript strict mode, no `any`. Zod schemas at every external and AI boundary. Store timestamps in UTC. Money in integer minor units with ISO currency code.
- Tenant isolation via `organization_id` in every query; no service-role bypass in user-facing request paths.
- Path-limited commits: `git add` only the task's own files.
- Verification org is `2dda45b8-82db-4f5f-b17d-611b9bbb7846` (Al Noor Kitchen). Tenant-isolation check org is `859cf039-1cd8-41b0-bd09-66c6c52e9c52`.
- Never deploy Trigger workers from a task; the single manual re-run is the controller's step. Never trigger real runs from tests.
- Do not dispatch subagents. Do not spawn reviewers. Review arrives from the controller after the report.
- Honesty floor that no requirement overrides: frozen documents and UI labels must state scope partitions, reported-day counts, and unreconciled provenance wherever they appear. Uncertainty is labeled, never hidden.

## Locked semantics (assumptions stated, not silently resolved)

- Per-partition assessment: each scope partition is assessed independently; the baseline covers exactly the qualifying partitions. The frozen document scope names those partitions and the surface states coverage per partition ("covers channel X, branch Y only"). Non-qualifying partitions are excluded and named, not silently dropped.
- Floor: minimum 1 reported day at every rung; the first rung with at least 1 reported day builds. Every published baseline carries the mandatory coverage label with its exact reported-day count and latest date.
- Reporting-as-evidence: the reconciliation_digest, reconciliation_state, and quality-tier gates are removed from the revenue-fact readers; money kind, real currency, midnight alignment, empty dimensions, integer safety, conflict rules, and currency uniformity stay. Facts sourced from unreconciled rows carry an unreconciled provenance flag end to end.
- Refusal vocabulary stays distinct: no-data, conflict, mixed-currency, and invalid-input refusals keep their own codes and details.
- This amends the 2026-09-21 baseline rule in specs/027-overview-growth-progress.md and supersedes the affected parts of ADR 0066 and ADR 0060 with a new ADR. The data-contract plan gains a dated note pointing at the new ADR.

## Task 1 — Spec amendment plus new ADR

- Amend the baseline rule section of specs/027-overview-growth-progress.md: per-partition scope, 1-day floor with mandatory coverage label, reporting-as-evidence with unreconciled provenance, kept refusal vocabulary. Preserve the amendment history style (dated, approved-by note).
- Write the new ADR superseding the affected parts of ADR 0066 (and noting ADR 0060): what changes, why the live refusal forced it, what honesty labels compensate, what was rejected (e.g. silently narrowing scope).
- Update docs/superpowers/plans/2026-09-18-overview-growth-data-contract.md with a dated pointer to the new ADR.
- No production code. Acceptance: spec section, ADR, and plan pointer reviewed clean against the locked semantics above.

## Task 2 — Builder: per-partition assessment, floors, labels, refusals

- Owned files: src/modules/organizations/application/growth-projection-builder.ts and its test file.
- assessTrailingBaselineWindow assesses each scope partition independently and returns per-partition reported days, totals, and conflicts; a partition-level conflict refuses only its partition unless every partition conflicts.
- GROWTH_BASELINE_FALLBACK_RUNGS keeps window sizes with the floor from the locked semantics; buildGrowthProjectionCandidate labels scope partitions, reported-day counts, and unreconciled provenance in the frozen document and limitation strings.
- Tests pin: single qualifying partition publishes with others named-excluded; 1-day baseline publishes with exact-count label; mixed reconciled/unreconciled facts carry provenance; partition conflict refuses only that partition; all-distinct refusal codes preserved.
- Acceptance: focused vitest plus pnpm typecheck clean.

## Task 3 — Assembly plus repository: scope from reporting, facts without digest gate

- Owned files: src/modules/organizations/application/growth-candidate-assembly.ts, src/modules/organizations/infrastructure/growth-progress-repository.ts, and their test files. No migration, no database.types.ts change.
- listBaselineCoordinates unchanged in shape (reporting scope still defines candidate partitions). readRevenueFacts/toPeriodFact/toSpanFact drop the digest, standing, and quality-tier gates per the locked semantics; every emitted fact carries reconciled/unreconciled provenance. Scope-tenancy, comparable-scope, midnight, money, currency, dimensions, and integer-safety checks stay.
- Tests pin: digest-null rows become facts with unreconciled provenance; ghost partitions from the live case (org-level and single-day channel rows) now contribute covered days instead of zeroing the assessment; tenancy and comparable-scope refusals intact.
- Acceptance: focused vitest plus pnpm typecheck clean.

## Task 4 — Publisher, schema, and display labels

- Owned files: src/modules/organizations/application/growth-projection-publisher.ts, the frozen projection schema and document builders, the home revenue display components showing baseline provenance, and their test files.
- Per-horizon results keep distinct skip/fail codes; published horizons expose scope partitions, reported-day counts, and unreconciled provenance to the display layer. The display states coverage plainly next to every projected figure.
- Tests pin: published horizons carry scope + provenance; mixed horizons differentiate; display renders the coverage label.
- Acceptance: focused vitest plus pnpm typecheck clean.

## Task 5 — Live-profile proof plus controller manual re-run

- No production code. Re-run the live-profile composition approach from the prior chain against the new rules with the dev-org row profile (3 August reconciled days plus the 208 unreconciled rows): prove horizons publish with labeled scope and provenance, or record the exact remaining blocker.
- Controller step (not the implementer): trigger ONE manual revenue-snapshots.build-org run for org 2dda45b8-82db-4f5f-b17d-611b9bbb7846 with a fresh idempotency key and verify publication rows plus frozen documents in staging.
- Acceptance: live proof recorded in the report; any remaining skip names its exact blocker.

## Blast radius

- Callers: nightly snapshot worker, home revenue outlook readers, growth-progress views. RLS policies: none changed. Consumers: organization home display (new labels), audit events (unchanged shape). Background tasks: snapshot dispatch cadence unchanged.

## Test plan, including tenant isolation

- Unit tests per task for assessment, assembly, readers, publisher, and display labels; pgTAP only if a migration proves necessary (not expected).
- Staging verification on the dev org after the manual re-run: frozen documents carry scope + provenance; second org shows zero cross-tenant reads or writes.
- Existing suites (typecheck, lint, affected vitest files, db:test for touched areas) green before handoff.

## Risks and rollback

- Thin baselines (1 reported day scaled to a month) are noisy estimates: mitigated by the mandatory exact-count coverage label on every surface.
- Unreconciled rows in frozen documents lower evidence grade: mitigated by per-fact provenance flags and display labels; nothing is presented as reconciled that is not.
- Scope narrowing per partition could confuse multi-branch owners: mitigated by named-excluded partitions on the surface.
- Rollback is revert of the task commits (no migration expected). If the manual re-run publishes misleading figures, supersede via the existing projection supersession path, never silent overwrite.
