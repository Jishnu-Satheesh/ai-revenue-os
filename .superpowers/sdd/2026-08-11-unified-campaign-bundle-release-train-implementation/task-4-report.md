# Task 4 report — Decision Engine and opportunity ledger prerequisite

## Assumptions

- The approved release-train brief is the execution plan and approval for this Tier 3 slice.
- The pre-existing `src/domain/decisions` commit `fe62987` is authoritative and was preserved unchanged.
- The remote version collision at `20260812120000` was confirmed to be the unrelated `organization_last_access` migration. Per release-train direction, Task 4 begins at `20260813120000` and all follow-up fixes are forward-only.

## Implemented behavior

- Added the application ports, role permission map, decision service, and repository adapter. The service validates the already-deterministic `DecisionRecord`, persists it through the worker-only boundary, and emits identifier-only proposed, recorded, or needs-data events.
- Operators can read an organization-scoped opportunity projection and append feedback through a constrained RPC; the browser repository exposes no ledger-write method.
- Added nine organization-owned ledger tables: playbook definitions/versions, artifact versions, cycles, records, candidates, feedback, suppressions, and opportunities.
- Added stable safe event payload contracts for all nine requested Decision/Opportunity events.

## Files changed

- `src/domain/events/types.ts`
- `src/modules/decisions/application/{authorization,ports,service}.ts` and tests
- `src/modules/decisions/infrastructure/repository.ts` and tests
- `supabase/migrations/20260813120000_decision_engine_and_opportunities.sql`
- `supabase/migrations/20260813121000_harden_decision_rpc_privileges.sql`
- `supabase/migrations/20260813122000_audit_decision_ledger.sql`
- `supabase/tests/database/decision_engine_test.sql`

## Migration, schema, RPC, grant, and RLS changes

- Every new table has `organization_id`, composite `(organization_id, id)` references, RLS enabled and forced, and `anon`/`authenticated` table privileges revoked by default.
- The feed alone grants authenticated read access through a membership RLS policy. Feedback is appended only through `append_decision_feedback`, which verifies membership, actor identity, and opportunity ownership.
- `start_decision_cycle` and `persist_decision_record` are `security definer`, use `search_path = ''`, validate the target organization/references, and are executable only by `service_role`. The follow-up ACL migration explicitly revokes concrete `anon` and `authenticated` default grants discovered on staging.
- Records, candidates, feedback, and artifact versions are append-only. Active playbook/artifact versions use partial uniqueness; decision retention has a 400-day floor; feed/suppression indexes are organization-scoped.
- Audit triggers record only identifiers, operation, and bounded status, not evidence payloads, feedback diffs, provider data, or PII.

## RED → GREEN evidence

- RED app command: `PATH=/home/spy/.local/node/bin:$PATH pnpm vitest run src/modules/decisions/application/service.test.ts src/modules/decisions/infrastructure/repository.test.ts` failed as expected with two `Cannot find module` errors for the missing service/repository.
- GREEN app command: the same command passed: 4 tests across 2 files.
- RED migration command: `PATH=/home/spy/.local/node/bin:$PATH pnpm db:test supabase/tests/database/decision_engine_test.sql` failed before migration because `public.opportunities` did not exist.
- GREEN migration command: focused pgTAP passed 21/21 after the forward-only base, ACL, and audit migrations.
- Security regression RED: focused pgTAP initially found authenticated `EXECUTE` on both worker RPCs; catalog inspection showed explicit API-role default ACLs. The `20260813121000` correction produced GREEN worker-RPC denial assertions.
- Audit regression RED: the focused suite failed 4 audit-trigger assertions; `20260813122000` produced GREEN 21/21.

## Commands and results

- `pnpm db:migrations:list` before/during/after: confirmed aligned `20260812120000`; then remote/local alignment through `20260813122000`.
- `pnpm db:migrations:dry-run` before each push: only the intended pending migration was listed.
- `pnpm db:migrations:push`: applied `20260813120000`, `20260813121000`, and `20260813122000` incrementally to staging.
- `pnpm vitest run src/domain/decisions src/modules/decisions/application src/modules/decisions/infrastructure`: 70/70 passed.
- `pnpm test`: completed successfully during final full check.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm db:test`: all discovered remote pgTAP suites passed, including Decision Engine 21/21.
- `git diff --check`: passed before staging and before commit.

## Tenant and security implications

- Cross-tenant joins fail at composite foreign keys; user reads/feedback are membership scoped; no direct authenticated ledger writes or worker RPC execution is granted.
- Worker RPCs validate organization identity and referenced cycle/opportunity ownership before writing. Events and audit rows keep only IDs and bounded state.

## Documentation and events

- No spec/ADR change was needed: implementation follows `specs/005-decision-engine-v1.md` and the approved Task 4 brief.
- Added identifier-only event contracts for `decision.cycle_started`, `decision.recorded`, `decision.needs_data_identified`, `opportunity.proposed`, `opportunity.approved`, `opportunity.rejected`, `opportunity.snoozed`, `opportunity.expired`, and `decision.feedback_captured`.

## Self-review and known limitations

- Reviewed the staged diff against review base `6a21313`; Campaign demo UI was not touched. Only Task 4 files were committed.
- `tsconfig.tsbuildinfo` changed as a generated typecheck artifact and was intentionally not staged.
- This persistence prerequisite does not add the future opportunity-feed UI or execution/measurement flows. The pgTAP contract proves RLS activation, grants, worker-RPC denial, audit triggers, indexes, and table presence; a fully seeded multi-user RLS behavioral suite remains a useful next hardening increment.

## Commit

- `8b4e2d5 feat(decisions): persist deterministic opportunities`

## Fix round 1A — complete aggregate and append-only promotion contract

### Scope and assumptions

- Preserved the already-applied `20260813123000_decision_aggregate_and_version_tuple.sql` byte-for-byte; its SHA-256 during this repair was `184883a32e486a8b5523b33e8934745e156a5eb4a5edca89e71d6effe272f360`.
- Added only the forward correction `20260813124000_complete_decision_aggregate_contract.sql`; no Campaign demo UI was touched and comprehensive two-user/two-organization behavioral pgTAP remains Fix 1B.
- Encoded the approved pre-playbook rule explicitly: `needs_data` may omit `playbookVersionId` only when `scoredCount = 0` and the candidate array is empty. A scored `needs_data` decision must name its playbook version.

### Corrected behavior

- Replaced generic aggregate candidate/opportunity records with strict bounded Zod schemas over the actual ledger columns. Unknown top-level fields, null optional tuple references, malformed identifiers, oversized structured fields, and record/candidate/opportunity disagreement fail before persistence.
- `persist_decision_aggregate` now validates exact keys, JSON types and bounded values; validates the cycle correlation, active same-organization policy, same-organization playbook, and semantic artifact keys; inserts one record, every scored candidate, and exactly one matching opportunity only for `action_selected`, all in the RPC transaction.
- Candidate cardinality equals `scoredCount`; the selected fingerprint must identify exactly one persisted candidate; the opportunity id and shared scored values must agree with the record and selected candidate. `no_action` and `needs_data` persist no opportunity.
- Corrected the prior RPC's value-to-column shift: rejection histogram, screened/scored counts, inputs digest, and tuple now map to their intended columns.
- Removed service-role execution from the obsolete circular `persist_decision_record` RPC. Task 4 continues to emit only `decision.recorded`, `decision.needs_data_identified`, and `opportunity.proposed`, typed as `DecisionDomainEvent`.
- Converted artifact promotion into an append-only ledger in effect: promotion and rollback append rows with a mandatory pointer to the prior current version, historical rows reject update/delete, and a private current-resolution view selects the latest serialized entry.

### RED to GREEN evidence

- RED runtime: focused Vitest failed 3 assertions for unknown candidate/opportunity keys, aggregate candidate/id/fingerprint disagreement, and scored `needs_data` without a playbook version.
- GREEN runtime: `pnpm vitest run src/domain/decisions src/modules/decisions/application src/modules/decisions/infrastructure` passed 75/75 across 8 files.
- RED database: the focused aggregate pgTAP against the applied `123000` state failed 10/10; the broken RPC reported `42601: INSERT has more expressions than target columns`, and no record, candidate, or opportunity was written.
- GREEN database: applied `124000` and ran `decision_aggregate_contract_test.sql` in one hosted-staging transaction, then rolled it back. All 18 assertions passed: append-only promotion/current resolution, selected and no-action persistence, exact record/candidate mapping, unknown-key and semantic-artifact rejection, and mismatch atomicity.
- `pnpm typecheck` and `pnpm lint` passed. `git diff --check` is part of the final pre-commit gate.

## Fix round 1B — hosted behavioral trust-boundary proof

### Migration and remote state

- Before mutation, `pnpm db:migrations:list` showed local and hosted staging aligned through `20260813123000`; `pnpm db:migrations:dry-run` named only `20260813124000_complete_decision_aggregate_contract.sql`.
- Pushed `20260813124000`, then confirmed it aligned locally/remotely. The immutable applied `20260813123000` migration was not changed.
- The first hosted behavioral RED run passed 55/59 assertions and exposed two public-boundary gaps: `authenticated` could read every opportunity column, including `evidence_bundle`, and a 241-character feedback edit title was accepted. The extra row made the atomic rejection count fail, producing the remaining two failures.
- Added and pushed forward-only `20260813131440_harden_decision_public_projection_and_feedback.sql`. It replaces the table-wide opportunity read grant with the exact 15-column feed projection and adds database validation for strict feedback edit-diff keys, JSON types, title/summary lengths, and bounded assumption arrays.
- A final least-privilege RED assertion found 30 direct service-role write grants across the ten Decision tables. Forward-only `20260813132757_require_decision_worker_rpcs.sql` revokes those table grants while retaining only the intended worker RPC execution grants. Post-push migration listing is aligned through `20260813132757`, and a final dry-run reports no pending migration.

### Tenant, authorization, and atomicity evidence

- `pnpm db:test supabase/tests/database/decision_aggregate_contract_test.sql supabase/tests/database/decision_engine_behavior_test.sql` passed 18/18 and 60/60 hosted assertions.
- The transactional behavioral suite seeds two authenticated operators, two organizations, memberships, policies, playbooks, semantic artifacts, and decision cycles, then rolls everything back. It proves same-tenant projected reads, cross-tenant invisibility, actor-bound feedback, rejection of cross-tenant/unknown/oversized feedback, append-only ledgers, composite tenant foreign keys, and least-privilege table/function grants under reset JWT/role contexts.
- Service-role aggregate persistence writes one record, every scored candidate, and exactly one opportunity for `action_selected`; `no_action` and `needs_data` write no opportunity. Semantic mismatches and tenant mismatches reject without partial records, candidates, or opportunities. Anonymous and authenticated roles cannot invoke worker RPCs or write ledgers directly, and the service role has no direct write grant that could bypass the intended worker RPCs.
- Focused aggregate coverage continues to prove unknown aggregate/candidate keys, wrong semantic artifact keys, mapping, selected agreement, and atomic rejection without duplicating those cases in the behavioral suite.

### Hosted advisors

- Supabase security advisor: 38 notices total — 20 `INFO`, 18 `WARN`, no critical/error notice. Task 4 contributes eight `INFO` no-policy notices for intentionally fail-closed ledger tables whose direct client grants are revoked. The single Task 4 `WARN` is the intended authenticated `append_decision_feedback` security-definer RPC; pgTAP proves it requires operator membership, binds `actor_id` to `auth.uid()`, rejects invalid bounded inputs, and has no anonymous grant. No Task 4 critical/important finding required another correction.
- Final Supabase performance advisor: 63 `INFO` notices total — 34 unindexed foreign keys and 29 unused indexes. It currently reports 20 Decision-table foreign-key notices, including the ten already recorded as deferred minor indexing debt; no performance finding is above `INFO`, and indexing work remains outside this repair. Newly created indexes may appear unused because staging has no durable Task 4 fixtures after transactional tests.

### Full verification

- Focused Decision Vitest passed 75/75 across eight files.
- Full `pnpm db:test` passed every hosted pgTAP suite; fixtures were transactionally rolled back.
- Initial full `pnpm test` passed 1012/1013 and exposed a static database-type-accounting gap for the Decision tables plus a parser miss on the already-typed documented `organization_last_access` row. The accounting test now explicitly records the Decision module's narrow repository/RPC boundary and parses a row doc comment; its focused rerun passed 32/32. Final full `pnpm test` passed 1014/1014 across 106 files.
- `pnpm typecheck` passed; `pnpm lint` passed with zero errors and six pre-existing unused-variable warnings; `pnpm format:check` passed after mechanically formatting the Task 4 authorization signature.
- Task 4 event emission remains unchanged: only `decision.recorded`, `decision.needs_data_identified`, and `opportunity.proposed`, through the typed `DecisionDomainEvent` boundary. No Campaign demo UI path was touched.
