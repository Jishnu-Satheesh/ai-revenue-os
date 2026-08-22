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

## Critical rules — read before touching the database

**There is no local database, and there will not be one.** Do not run `supabase start`,
`supabase db reset`, or anything that expects a Docker Postgres. Do not try to stand one up.
Time spent on this is wasted; it has been tried.

The only database is the **hosted staging project**, reached through the connection string
and `DATABASE_URL` in `.env.local`. Everything below follows from that:

- `pnpm db:migrations:list`, `:dry-run`, and `:push` all target **staging**. A pushed
  migration is live for everyone immediately. There is no local rehearsal — get it right
  by reading the existing schema first.
- `pnpm db:test` runs the pgTAP suites against that same shared staging database. The
  suites do execute and do report real results, but they are **not hermetic**: they wrap in
  `begin`/`rollback` yet still share the database with live staging data and any other
  session. Treat them as staging integration checks, not as an isolated unit-test layer,
  and do not invest effort in making them isolated.
- `pnpm db:types` shells out to `supabase gen types --local` and therefore **cannot run**.
  `src/lib/supabase/database.types.ts` is maintained by hand. A new table must be either
  typed there or listed in `UNTYPED_TABLES` in `src/lib/supabase/database.types.test.ts`,
  which fails if a table is neither.
- A new `plpgsql` function that reads a table it did not create **must be called once
  against staging before it is considered done**. plpgsql resolves record fields only at
  execution time, so a function referencing a column that does not exist applies cleanly
  and fails on its first real call. This has already happened twice.
- `git push` is the user's step. There are no push credentials and no `gh` CLI here.

## 2. Non-negotiable product rules

- Optimize for measurable incremental gross profit and customer acquisition, not automation volume.
- Keep the platform core industry-neutral. Restaurant-specific logic belongs in the Restaurant Industry Pack.
- Enforce tenant isolation at the database and application layers.
- Separate decisions from execution. The Decision Engine proposes actions; the Execution Plane performs validated actions.
- No model may call a destructive or money-moving tool directly. Every side effect must pass through a deterministic Tool Gateway and policy check.
- Every AI action must be explainable, attributable, auditable, measurable, and reversible where practical.
- Prefer deterministic code for known logic. Use models only where judgment, interpretation, ranking, extraction, or generation is genuinely useful.
- Treat client data, credentials, customer PII, budgets, and advertising permissions as sensitive.

## 3. Communication Guardrails
- **Language Style:** Direct, simple, and entirely free of unnecessary technical jargon.
- **Problem Reporting:** Always explain code issues or missing logic using a brief, real-world analogy to highlight the actual impact.
- **Clarity over Complexity:** Prioritize clear, scannable bullet points over dense paragraphs of engineering theory.
- **Workflow:** Propose a lean plan -> Explain real-world impact -> Get approval -> Write code -> Run tests.


## 4. Spec-First Blueprinting

No feature code before an approved plan. Match the ceremony to the size of the change.

### Change tiers

**Tier 1 — Fix.** Typo, copy change, isolated bug, or a mechanical refactor with no behavior change. Make the change and summarize it afterwards. No plan required.

**Tier 2 — Slice.** New behavior that fits inside an existing spec, table, or module. Produce an Execution Plan, get approval, then implement.

**Tier 3 — Feature.** A new capability, a new table or migration, a new integration, a new agent or tool, or any change that moves a boundary between the control and execution planes. Produce an Execution Plan, get approval, then implement.

For a genuinely large Tier 3 feature, write or update the file in `specs/` from `specs/000-spec-template.md` **before** the Execution Plan, and have the spec approved first. For a smaller Tier 3 change, decide whether a spec is warranted from the constraints already established for the task, then state which way you decided and why before planning.

### Execution Plan format

Bullet points only. No code blocks.

- Impacted files, and what changes in each.
- New or changed schemas, migrations, events, and public exports.
- Blast radius: callers, RLS policies, consumers, and background tasks affected.
- Open assumptions, stated explicitly rather than resolved silently.
- Test plan, including how tenant isolation is verified.
- Risks and rollback.

### Approval gate

Wait for explicit approval before writing Tier 2 or Tier 3 code. If the plan changes materially during implementation, stop and re-confirm rather than widening scope on your own.

### ADR trigger

Add an ADR in `adrs/` when a durable architectural decision is introduced or reversed, and reference it from the spec.

## 5. Development workflow

For each task:

1. Restate the acceptance criteria in your working notes.
2. Inspect current implementation and related schemas.
3. Map the blast radius: callers, RLS policies, emitted events, migrations, background tasks, and any spec or ADR that describes what you are about to change.
4. State open assumptions explicitly in the plan rather than resolving them silently in code.
5. Identify the smallest production-complete vertical slice.
6. Implement domain types and validation before UI wiring.
7. Add tests before declaring the task complete.
8. Run linting, type checking, unit tests, integration tests, and relevant end-to-end tests.
9. Verify tenant isolation and authorization paths.
10. Update documentation when behavior, architecture, schemas, or decisions change.
11. Add an ADR when a durable architectural decision is introduced or reversed.
12. Summarize changed files, risks, migrations, and follow-up items.

## 6. Prohibited behavior

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
- write Tier 3 feature code before its Execution Plan, or its spec where one is required, has been approved.

## 7. Definition of done

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

## 8. Repository conventions

- TypeScript strict mode is mandatory.
- Prefer feature folders with explicit public exports.
- Use Zod schemas at every external and AI boundary.
- Use domain-specific error types rather than generic exceptions.
- Use idempotency keys for retried side effects.
- Store timestamps in UTC and render in the organization's configured timezone.
- Use stable event names in past tense, such as `organization.created` or `integration.connected`.
- Store money in integer minor units with an ISO currency code.
- Use structured logging with `organizationId`, `runId`, `workerId`, and `correlationId` when available.

## 9. Documentation maintenance

When implementation contradicts documentation, stop and resolve the contradiction. Do not silently treat documents as aspirational. Update the relevant context, spec, or ADR in the same change.

`CLAUDE.md` is a symlink to this file. Edit `AGENTS.md` only. Never replace the symlink with a copy.

## 10. Misc
<!-- TRIGGER.DEV SKILLS START -->
## Trigger.dev agent skills

This project has Trigger.dev agent skills installed in `.claude/skills/`. Before writing or changing Trigger.dev code (background tasks, scheduled tasks, realtime, or chat.agent AI agents), load the most relevant skill: `trigger-getting-started`, `trigger-realtime-and-frontend`, `trigger-authoring-chat-agent`, `trigger-authoring-tasks`, `trigger-chat-agent-advanced`, `trigger-cost-savings`.
<!-- TRIGGER.DEV SKILLS END -->

