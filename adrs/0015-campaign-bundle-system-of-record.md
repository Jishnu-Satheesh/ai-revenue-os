# ADR 0015: Use immutable Campaign Bundle versions as the cross-channel system of record

## Status

Accepted.

## Context

Campaigns can begin as either a Decision Engine opportunity or a manual operator brief and can be reviewed in Studio or Telegram. If strategy, creative, channel actions, approval, and measurement are stored independently, two surfaces can display or execute different proposals under one campaign name. Trigger.dev state cannot resolve that ambiguity because it is an execution mechanism, not authoritative business state.

## Decision

- Postgres is authoritative for campaign, approval, policy, budget, provider state, execution evidence, and measurement evidence.
- Both entry points enter the same qualification service and create the same industry-neutral Campaign and immutable Campaign Bundle Version records.
- A Campaign Bundle Version is a complete normalized proposal: strategy, evidence, creative directions, assets and provenance, copy and hashtags, channel actions, schedule, capability blockers, execution mode, spend ceiling, policy assertions, and measurement plan.
- Every material edit creates a new version. Approved versions are never mutated.
- The canonical bundle digest is SHA-256 over RFC 8785-style canonical JSON of the immutable manifest plus ordered asset content hashes. Storage-only IDs, timestamps, labels, provider responses, and review-session IDs are excluded.
- Studio and Telegram are authenticated views over the same version chain and campaign application service. Neither owns a parallel campaign document.
- Trigger.dev run IDs never substitute for a campaign version, approval, execution claim, budget reservation, provider receipt, exposure, or outcome record.

## Consequences

- An operator can trace every review, revision, approval, action, and measurement to one exact proposal.
- Channel adapters cannot silently expand campaign intent.
- Version and evidence storage grow append-only, but auditability and rollback remain possible.
- A mutable scheduler record or provider campaign object cannot become the platform's source of truth.

## References

- `docs/superpowers/specs/2026-08-11-unified-campaign-bundle-design.md`
- `adrs/0001-use-postgres-and-supabase.md`
- `adrs/0002-separate-control-and-execution-planes.md`
- `adrs/0005-use-event-driven-architecture.md`
