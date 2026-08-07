# ADR 0002: Separate Control and Execution Planes

## Status

Accepted.

## Context

The Next.js application must remain the authoritative client and governance system, while AI and integration tasks require retries, long runtimes, waits, schedules, and parallel work.

## Decision

The Next.js application and Postgres form the control plane. Trigger.dev forms the durable execution plane. The Decision Engine creates governed plans; execution workers carry them out.

## Consequences

- Business state remains queryable and independent of workflow vendor state.
- Durable tasks can evolve without moving product logic out of the main repository.
- Every run requires correlation and synchronization back to Postgres.
