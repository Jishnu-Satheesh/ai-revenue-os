# Implementation Readiness Checklist

## Before coding a feature

- [ ] Business outcome is measurable.
- [ ] User and permission are known.
- [ ] In-scope and out-of-scope behavior are explicit.
- [ ] Domain rules are written.
- [ ] Data ownership and organization scope are clear.
- [ ] Failure states are listed.
- [ ] Acceptance criteria are testable.
- [ ] Relevant ADRs are read.

## Before merging

- [ ] Type checking passes.
- [ ] Linting passes.
- [ ] Unit tests pass.
- [ ] Integration tests pass.
- [ ] RLS and authorization tests pass.
- [ ] Relevant end-to-end flow passes.
- [ ] Migration was reviewed.
- [ ] Audit events exist where required.
- [ ] Error and empty states are implemented.
- [ ] Observability is included.
- [ ] Documentation is updated.

## Before enabling an AI worker

- [ ] Input and output schemas are versioned.
- [ ] Model and fallback policy are defined.
- [ ] Tool allowlist is minimal.
- [ ] Cost and loop limits exist.
- [ ] Prompt-injection fixtures pass.
- [ ] Cross-tenant retrieval tests pass.
- [ ] Human review policy is configured.
- [ ] Evaluation fixtures and metrics exist.

## Before enabling an external side effect

- [ ] Capability and provider scope are verified.
- [ ] Policy check is deterministic.
- [ ] Approval version is immutable where required.
- [ ] Idempotency key is present.
- [ ] Provider result is verified.
- [ ] Rollback or stop mechanism exists.
- [ ] Budget and frequency limits exist.
- [ ] Audit event is emitted.
- [ ] Measurement window is scheduled.

## Before onboarding a live client

- [ ] Data-processing and privacy terms are reviewed.
- [ ] Client account ownership is confirmed.
- [ ] Secure credential workflow is tested.
- [ ] Support and incident contacts are known.
- [ ] Autonomy mode is agreed.
- [ ] Baseline metrics are captured.
- [ ] Pilot success criteria are signed off.
