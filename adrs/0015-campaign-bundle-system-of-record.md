# ADR 0015: Use immutable Campaign Bundle versions as the cross-channel system of record

## Status

Accepted.

**Amended 2026-09-12 — extended, not weakened, by
[ADR 0057](0057-campaign-preparation-approval-vs-exact-output-publication.md) (Proposed) and
[Spec 025](../specs/025-campaign-experience-and-marketing-loop.md) (Proposed).** Postgres remains
authoritative and every material edit still creates a new immutable version. Two additions apply to
the new Campaign path:

- An **immutable campaign proposal version** precedes the bundle. `campaign_proposals`,
  `campaign_proposal_versions` and `campaign_proposal_decisions` hold identity, immutable documents
  with digests, and an append-only decision log. Bundle provenance links to the exact proposal version
  and digest. The approved proposal owns intent until preparation; the immutable bundle and launch
  set own exact authorized execution. Neither may independently change offer, audience, channels or
  budget.
- Campaign source kinds gain `campaign_proposal` with a `proposal_id` and a check requiring exactly
  the appropriate source link. A qualified Decision opportunity must not be manufactured, and
  `manual_brief` must not be misused, to avoid that schema amendment. Existing manual and Decision
  campaigns remain readable unchanged.
- Campaign bundle manifest **version 3** is authorized for finished-deliverable identity **only
  together with a V2 backward reader**. Existing V2 records stay readable and unmodified.

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
