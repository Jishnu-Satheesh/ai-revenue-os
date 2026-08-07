# Task 2 report — Integration Hub domain contracts and policy

## Status

Completed and committed as `feat(integrations): define domain contracts and health policy`.

## Acceptance criteria

- Added Zod schemas for all approved connection maturity, connection status, health state, integration record envelope, and exactly-one ingestion source vocabularies.
- Added provider-agnostic adapter, ingestion, and credential-store contracts with an opaque credential handle boundary.
- Added a closed provider registry that rejects duplicate keys, adapter-version mismatches, unregistered lookups, and V1 webhook/write definitions.
- Added deterministic capability grants with stable reason codes and immediate disablement for disconnected or revoked connections.
- Added health derivation with the required priority: revoked, stale, degraded, pending, healthy. It includes scheduling/freshness timestamps and supports the 65-minute Google fixture threshold.
- Added server-only normalized provider errors. Their public JSON omits `internalCause` and redacts credential-shaped metadata keys.

## Files changed

- `src/domain/integrations/types.ts`
- `src/domain/integrations/schemas.ts`
- `src/domain/integrations/provider-registry.ts`
- `src/domain/integrations/capabilities.ts`
- `src/domain/integrations/health.ts`
- `src/domain/integrations/errors.ts`
- `src/domain/integrations/schemas.test.ts`
- `src/domain/integrations/capabilities.test.ts`
- `src/domain/integrations/health.test.ts`
- `src/domain/integrations/provider-registry.test.ts`

## Verification

- RED: all four requested test modules initially failed because the public domain modules were absent.
- RED: health remained pending after its first scheduled sync window until the explicit scheduling policy was added.
- GREEN: `pnpm vitest run src/domain/integrations` — 4 files, 18 tests passed.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `git diff --check` — passed before commit.

## Security and tenancy

- This task has no database or migration change and therefore no tenant persistence path.
- Registry data is static TypeScript metadata; it has no tenant mutation operation.
- Credentials remain opaque and server-only; no credential resolution, provider API call, OAuth, webhook, or raw payload persistence was added.
- Public normalized errors never serialize the internal cause and remove keys containing `token`, `secret`, `authorization`, or `credential`.

## Limitations and follow-up

- The Task 2 contracts deliberately do not implement fixture adapters, credential storage, provider calls, ingestion persistence, workers, or API/UI routes; those remain for later tasks.
- The existing Vite CJS deprecation notice appears during Vitest execution, but it is unrelated to this change and does not affect the passing suite.
