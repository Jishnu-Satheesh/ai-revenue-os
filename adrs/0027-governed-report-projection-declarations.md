# ADR 0027: Governed report projection declarations

## Status

Accepted

## Decision

Report-contract schema v1 remains immutable and value-free. Deterministic
projection is enabled only by a separate immutable, owner/admin-approved
projection declaration bound to one exact approved contract version and active
binding. The first declaration language can emit exact-range `money` and
`count` sums only; it contains no expressions, filters, arbitrary code,
dimensions, temporal coercion, ratios, or economics calculation.

## Consequences

Workers re-read the private source only after Postgres claims the run. They
persist aggregate exact-range observations and bounded lineage, never workbook
rows, raw cells, customer information, formulas, signed URLs, or secrets.
Postgres owns leases, idempotency, state transitions, and audit events.
Existing v1 contracts are not silently reinterpreted; an owner/admin must
approve the projection declaration before a validated package can be queued.
