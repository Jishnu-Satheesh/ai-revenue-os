# ADR 0017: Use task-based generation, exact-version approval, and a deterministic Tool Gateway

## Status

Accepted.

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
