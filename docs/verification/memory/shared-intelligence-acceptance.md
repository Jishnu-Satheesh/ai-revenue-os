# Shared Business Memory — acceptance record (Spec 023 Task 13, partial)

**Date:** 2026-09-13. **Scope:** source + staging-applied evidence only.
Worker-deployed and live-verified columns are NOT claimed here: the deployed
worker (`20260910.4`) predates every capture task, and no authenticated
browser or paid provider run has happened in this track. A later dispatch
fills those columns; nothing below may be read as end-to-end proof.

## Source-to-test matrix

Every pgTAP count below ran against hosted staging after push; every vitest
count ran in this tree. "Unit" means no staging I/O.

| ID | Scenario | Evidence |
|---|---|---|
| A01 | Source rollback leaves nothing | `memory_shared_capture_test` |
| A02 | Crash after commit projects once | `memory_capture_runtime_test` |
| A03 | Duplicate delivery / lost receipt replays | `memory_capture_runtime_test` |
| A04 | Old revision cannot replace newer | `memory_capture_runtime_test` |
| A05 | Plan then changed decision | `memory_channel_capture_test`, `memory_growth_capture_test` |
| A06 | Ack/plan/likes/pins stay distinct | `memory_growth_capture_test` (pins never read) |
| A07 | Same org, different branches | `memory_channel_capture_test`, `memory_growth_capture_test` |
| A08 | Cross-tenant isolation | every memory pgTAP suite (sibling tenants, forged orgs) |
| A09 | Sensitivity / revoked role | `memory_context_visibility_test` |
| A10 | Corrected / withdrawn / erased roots | `memory_growth_capture_test`, `memory_source_retention_test` |
| A11 | One root family, no corroboration | `memory_growth_capture_test`, corpus SXC-12–15 |
| A12 | Malicious refs rejected safely | `memory_capture_runtime_test`, `memory_channel_context_test` |
| A13 | Embedding outage degrades lexically | retrieval unit tests; live outage unwitnessed |
| A14 | Memory failure keeps evidence-only mode | `run-channel-recommendations` 35 unit tests |
| A15 | Stale manifest refuses, bounded retry | workflow unit tests (`changed` → one new attempt) |
| A16 | Channel coverage, cap, gap-fill intact | channel suites + `memory_channel_context_test` |
| A17 | Growth slots and public-query purity | `run-market-research` 36 unit tests |
| A18 | Memory alone cannot admit a claim | `claim-extraction` unit tests |
| A19 | Campaign boundaries hold | `campaign-memory-context` 7, `memory-source` 14 |
| A20 | Lesson review gates promotion | `memory_campaign_capture_test` |
| A21 | Health, retry, backfill honest | `memory_capture_backfill_test` 34, health-service unit |
| A22 | Toggles disable without data loss | settings RPC tests in `memory_shared_capture_test` |
| A23 | Reconcile repairs forward | `memory_capture_cursor_test` 44; first scheduled pass unwitnessed |
| A24 | Frozen quality corpus | `shared-context-cases` 47 unit tests (recall on live data pending) |
| 024-A01–A07 | Consent, allowlist, expiry, revoke, tenants | `memory_grounded_consent_test` 43 |
| 024-A08 | Provided/cited/shared labels honest | `context-used` drawer unit tests |
| 024-A09 | 8-entry / 4096-byte subset enforced | share-mode unit tests + SQL checks |
| 024-A10 | Identifiers only in logs/events | share-mode log-field unit tests |

## Frozen corpus

`src/domain/memory/__fixtures__/shared-context-cases.ts`: 40 cases plus 5
digest mates over the pure assembler, renderer, and digest — trust ordering,
quotas and the absolute AI cap, slot rescue (records are removed on rescue),
root dedup, intent supersession, scope, count/byte budgets, escaping,
request validation, and digest stability/sensitivity. Runner:
`src/domain/memory/shared-context-cases.test.ts` (47 tests, green).

## Browser

`e2e/business-memory-shared-intelligence.spec.ts`: unauthenticated boundary
runs anywhere; authenticated suites skip without `E2E_MEMORY_*` seed. No
authenticated run has happened.

## Canary (not run)

Paid grounded-share canary needs, in order: worker deploy with capture
tasks, owner capture enablement on the probe org, owner consent plus a
current Google qualification, and a spend allowance. The first paid call
must record latency, token/embedding usage, and failed-attempt cost. Until
then no profit, recall, or latency figure is claimed.

## Known gaps carried forward

- Judge v4 wired in source; live verdict quality unevaluated.
- Embeddings due-scan for projected items deferred; new items are lexically
  searchable immediately.
- 90-day janitor schedule undecided; rights-driven erasure path live.
- `subject_drafting` reader migrated (Slice 1); legacy `onboarding_assist`
  purpose retained for workspace search only.
- Full `pnpm test` hangs in this tree; scoped suites green (memory 257,
  analysis+growth 175, campaigns+trigger 971, corpus 47).
