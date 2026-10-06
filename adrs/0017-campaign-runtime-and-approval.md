# ADR 0017: Use task-based generation, exact-version approval, and a deterministic Tool Gateway

## Status

Accepted.

**Amended 2026-09-12 — extended by
[ADR 0057](0057-campaign-preparation-approval-vs-exact-output-publication.md) (Proposed) and
[Spec 025](../specs/025-campaign-experience-and-marketing-loop.md) (Proposed).** Nothing here is
weakened. Approval still binds an exact immutable version and digest, and every listed material
change still creates a new version and invalidates approval. The new Campaign path splits approval
into two gates rather than one:

- **Gate 1, preparation approval**, binds the exact proposal version and digest and authorizes
  bounded creative preparation only. It reserves no media spend, publishes nothing, confirms no
  creative and grants no provider authority.
- **Gate 2, exact-output publication approval**, binds each finished deliverable version and its
  content hash together with every channel action term, and is what the Tool Gateway's preflight
  checks against. Every public or money-moving call still passes through that one deterministic
  Gateway; no second authorization path is introduced.
- The bootstrap ordering defect in finding F01 is in scope: a dependency or prerequisite failure
  raised *before* the workflow claims its run must still persist a typed terminal or recoverable
  blocked outcome. A forever-`queued` domain run beside a FAILED Trigger run is a violation of this
  ADR's "Postgres records are the authoritative checkpoints" rule.

## Context

Campaign qualification, generation, approval, scheduling, provider execution, and reconciliation need durable retries and waits. They also include public and money-moving effects that a model or mutable conversation must never authorize. Approval of a campaign name would leave the approved content and limits ambiguous after edits.

## Decision

- Trigger.dev `schemaTask` workflows are the durable Campaign Agent runtime for qualification, generation, regeneration, validation, scheduling, dispatch, reconciliation, measurement, and learning proposals.
- Vercel AI SDK calls may produce creative judgment and typed proposal artifacts inside those tasks. Every output is validated with Zod and deterministic policy. Models receive no provider credential or side-effect tool.
- Postgres records are the authoritative checkpoints. Trigger.dev remains execution-only.
- `chat.agent` is not the campaign orchestrator. A future conversational shell may only read review state, propose typed patches, request regeneration, and explain diffs through the same application services.
- Approval binds the exact immutable bundle-version ID and digest, action IDs, capability-grant versions, policy versions, schedule, audience boundaries, expiry, factual assertions, measurement prerequisites, attestation, and spend ceiling.
- Creative, copy, hashtags, CTA, asset, generation profile, audience, channel, placement, schedule, measurement, execution mode, or spend changes are material. They create a new version and invalidate approval.
- Every public or money-moving provider call passes through a deterministic Tool Gateway. Its atomic preflight checks organization scope, exact approval, policy, assertions, schedule, cancellation, capability, credentials, asset/destination/tracking readiness, idempotency, and budget reservation.
- A timeout after send becomes `provider_outcome_unknown`. The action is reconciled through the verified provider lookup before any retry. A provider write with no reconciliation strategy remains blocked.

## Consequences

- The model can draft a campaign but cannot approve, publish, spend, select credentials, or retry an ambiguous provider outcome.
- Approval remains understandable and bounded even when execution occurs later.
- Material revisions require another human decision, which adds friction deliberately.
- Provider adapters translate authorized actions but cannot alter campaign intent.

## References

- `adrs/0002-separate-control-and-execution-planes.md`
- `adrs/0003-use-triggerdev-for-durable-execution.md`
- `adrs/0007-risk-based-human-approvals.md`
- `specs/006-triggerdev-worker-runtime.md`
- `specs/010-human-approval-governance.md`
