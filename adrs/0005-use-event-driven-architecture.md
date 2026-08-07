# ADR 0005: Use Event-Driven Workflows Where Meaningful

## Status

Accepted.

## Decision

Publish normalized domain events for meaningful state changes and trigger workflows from them. Use schedules only for periodic analysis and freshness checks.

## Consequences

- Lower unnecessary polling.
- Better traceability and modularity.
- Requires event schema versioning, deduplication, and idempotent consumers.
