# Task 8 worker record — staged publication DEFERRED (no deployment)

Date: 2026-09-19. Nothing below deploys, runs, or seeds anything. No
credentials, payloads, or prompts appear here.

## 1. Verified without deploying

- Task identity: prospective publication inside the existing worker
  (`src/trigger/revenue-snapshots.ts`, Task 4 commits `32f170b`+`42393d7`,
  last worker-file change `bd161bd` Task 5 passthrough).
- Rollout gate (reads AND publication, D08): `OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS`
  parsed in `src/lib/env.ts:50,112`, documented in `.env.example:95`, enforced
  in `isOverviewGrowthProgressEnabled` (loader) and the publisher (worker).
- Financial-input hygiene: worker run output carries the snapshot build only
  (`toSnapshotBuildOutput`, `42393d7`); server-only access gate in place.

## 2. Deferred gate procedure (exact, for the authorized run)

1. Push migration `20260918120000_organization_growth_projections.sql` at the
   migration gate (NOT done here — shared staging, needs owner sequencing).
2. Deploy the worker (`trigger deploy` equivalent for this repo) and record the
   exact deployed version/commit here.
3. Capture DB before/after: row count + projection id/digest for the designated
   test tenant (never the client org, never PNG numbers).
4. Trigger one staged publication run for an eligible fresh period; assert the
   immutable row, the canonical digest, the audit event, and a
   `published=false` replay returning the same id/digest.
5. With the current stale canary (historical facts only, no fixed original),
   the honest outcome today is the BLOCKED path: no eligible fresh source
   reports → no publication, `awaiting_reports`/missing states shown. A
   populated real comparison requires eligible fresh reports or an explicitly
   designated test tenant.

## 3. Pending list

- Migration push (owner-sequenced) → worker deployment with version record →
  staged run with before/after DB identities → replay-digest proof → live
  populated comparison. All five are user-gated; none ran in Task 8.
