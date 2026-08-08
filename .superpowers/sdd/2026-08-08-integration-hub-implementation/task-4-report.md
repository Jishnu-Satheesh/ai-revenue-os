# Task 4 report: scoped Integration Hub persistence and read model

## Delivered

- Added `IntegrationRepository` and `IntegrationWorkerRepository` ports with organization-scoped inputs for every lookup, mutation, and worker transition.
- Added a health-first `IntegrationHubSnapshot` that orders connections and activity newest first, selects the latest health check per connection, includes health-check/run/audit activity, and omits credential references.
- Added an authenticated Supabase persistence adapter with explicit safe connection columns. It never uses `select("*")` on integration connections and never requests `credential_reference`.
- Added a fail-closed `IntegrationTransactionPort` for fixture reconnect, capability-grant replacement, mapping replacement, and disconnect. The Task 3 schema has no matching RPCs yet, so those methods reject with `CONFLICT` rather than pretending separate writes are atomic.
- Added worker terminal-run guards, source/connection verification before health append, scoped scheduling, and idempotent ingestion-run lookup/create behavior (including unique-constraint retry lookup).
- Follow-up review fix: worker start and completion now require an atomic compare-and-set `IntegrationRunTransitionPort` (`queued → running` and `running → terminal`). They fail closed when the RPC/port is absent; interleaved stale workers cannot revive or overwrite a terminal run.
- Follow-up review fix: removed the direct `appendAuditEvent` repository/persistence API. Authenticated roles only have audit-event `SELECT`; audit writes must remain in existing trigger/security-definer paths until a dedicated scoped RPC is introduced.

## Provisional generated-type boundary

`src/lib/supabase/database.types.ts` remains untouched because no local Supabase/Docker runtime is available to regenerate it. `src/modules/integrations/application/ports.ts` is the clearly isolated provisional schema boundary for the six Integration Hub tables. The authenticated adapter contains the single stale-generated-type compatibility cast; replace the provisional rows/adapter casts with regenerated `Database` table types after `pnpm db:types` succeeds.

## Verification

```text
pnpm vitest run src/modules/integrations/infrastructure/repository.test.ts src/modules/integrations/infrastructure/repository.integration.test.ts
# 2 files passed, 9 tests passed
pnpm typecheck
# passed
pnpm lint
# passed
git diff --check
# passed
```

## Risks and blockers

- Database runtime verification remains blocked by the previously recorded absence of Docker/Podman/local Supabase. pgTAP, migration reset/lint, generated types, and RPC implementation/verification are still required before staging.
- Atomic reconnect/grant/mapping/disconnect and worker run-transition methods deliberately cannot execute until their database transaction/RPC ports are backed by a migration. This is fail-closed by design.
- No standalone audit append is available until a tenant-scoped security-definer RPC is designed and verified.
