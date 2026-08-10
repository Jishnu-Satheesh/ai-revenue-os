# AGENTS.md

This file is the primary instruction contract for every AI coding agent working in this repository.

## 1. Mandatory reading order

Before changing code, read only the context needed for the task, starting with:

1. `README.md`
2. `context/00-vision.md`
3. `context/01-project-overview.md`
4. `context/03-architecture.md`
5. `context/04-domain-model.md`
6. The relevant module document in `context/05-module-map.md`
7. The assigned file in `specs/`
8. Related ADRs in `adrs/`
9. `context/14-coding-standards.md`
10. `context/15-ai-coding-standards.md`
11. `context/18-anti-patterns.md`

Do not read every document automatically. Load context deliberately to reduce noise and stale assumptions.

## 2. Non-negotiable product rules

- Optimize for measurable incremental gross profit and customer acquisition, not automation volume.
- Keep the platform core industry-neutral. Restaurant-specific logic belongs in the Restaurant Industry Pack.
- Enforce tenant isolation at the database and application layers.
- Separate decisions from execution. The Decision Engine proposes actions; the Execution Plane performs validated actions.
- No model may call a destructive or money-moving tool directly. Every side effect must pass through a deterministic Tool Gateway and policy check.
- Every AI action must be explainable, attributable, auditable, measurable, and reversible where practical.
- Prefer deterministic code for known logic. Use models only where judgment, interpretation, ranking, extraction, or generation is genuinely useful.
- Treat client data, credentials, customer PII, budgets, and advertising permissions as sensitive.

## 3. Development workflow

For each task:

1. Restate the acceptance criteria in your working notes.
2. Inspect current implementation and related schemas.
3. Identify the smallest production-complete vertical slice.
4. Implement domain types and validation before UI wiring.
5. Add tests before declaring the task complete.
6. Run linting, type checking, unit tests, integration tests, and relevant end-to-end tests.
7. Verify tenant isolation and authorization paths.
8. Update documentation when behavior, architecture, schemas, or decisions change.
9. Add an ADR when a durable architectural decision is introduced or reversed.
10. Summarize changed files, risks, migrations, and follow-up items.

## 4. Prohibited behavior

Never:

- Invent an API, database field, integration capability, or platform permission.
- Bypass RLS with a service role in user-facing request paths.
- put business-critical policy only inside prompts.
- create a single "god agent" with unrestricted tools.
- allow LLM output to be executed without schema validation.
- hard-code restaurant concepts into platform-core tables or services.
- hide errors, silently discard events, or mark uncertain data as verified.
- declare business impact without an explicit baseline, attribution method, and measurement window.
- make autonomous budget, price, discount, or public-brand changes beyond configured policy.
- log secrets, access tokens, raw payment details, or unnecessary customer PII.

## 5. Definition of done

A feature is done only when:

- Acceptance criteria pass.
- Authorization and tenant boundaries are tested.
- Data validation and error states are implemented.
- Audit events are emitted for sensitive changes.
- Observability exists for failures and latency.
- AI outputs have evaluation or review hooks when applicable.
- User-facing copy explains uncertainty and required approvals.
- Documentation and migrations are included.
- No known critical or high-severity issue remains.

## 6. Repository conventions

- TypeScript strict mode is mandatory.
- Prefer feature folders with explicit public exports.
- Use Zod schemas at every external and AI boundary.
- Use domain-specific error types rather than generic exceptions.
- Use idempotency keys for retried side effects.
- Store timestamps in UTC and render in the organization's configured timezone.
- Use stable event names in past tense, such as `organization.created` or `integration.connected`.
- Store money in integer minor units with an ISO currency code.
- Use structured logging with `organizationId`, `runId`, `workerId`, and `correlationId` when available.

## 7. Documentation maintenance

When implementation contradicts documentation, stop and resolve the contradiction. Do not silently treat documents as aspirational. Update the relevant context, spec, or ADR in the same change.
