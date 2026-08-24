# Anti-Patterns

## Product anti-patterns

- Selling "AI automation" without tying it to measurable outcomes.
- Building a workflow builder before proving repeatable revenue playbooks.
- Showing static dashboards without recommended actions.
- Treating higher order volume as success when margin falls.
- Promising fully autonomous growth before reliable data and attribution exist.

## Architecture anti-patterns

- One table or JSON blob containing the entire Digital Twin.
- Industry-specific columns in core organization tables.
- A separate codebase per client.
- Provider SDK calls scattered across UI and business logic.
- Trigger.dev becoming the only source of business state.
- n8n containing core policy or decision logic.
- Premature microservices.
- A hashing or filesystem call living in the same module as the schemas or pure
  helpers a screen imports. A `node:*` import fails a browser build outright, even
  when nothing on the page calls it, so the split has to hold at the module level.
  `src/lib/client-module-boundary.test.ts` fails the build if a client component
  can reach one.
- Widening a Zod document schema without widening the Postgres validator that
  guards the same write. The validator works from an allow-list, so an unknown
  key refuses the whole document rather than being ignored, and the refusal only
  appears when a person clicks approve.
  `src/domain/reports/provider-library/database-agreement.test.ts` compares the two.

## AI anti-patterns

- One unrestricted agent with every tool.
- Prompts as the only policy layer.
- Model-generated SQL or arbitrary code execution.
- Executing unvalidated model output.
- Treating semantic search as authoritative truth.
- Storing every conversation as permanent memory.
- Confidence numbers with no calibration.

## Data anti-patterns

- Cross-tenant vector indexes without tenant filters.
- Silent schema coercion.
- Merging imported rows without provenance.
- Using stale data without warning.
- Training cross-client intelligence on raw identifiable data.

## Delivery anti-patterns

- Building five modules at 60% completion.
- Skipping tests because AI generated the implementation.
- Accepting migrations without review.
- Shipping sensitive actions without audit records.
- Measuring output volume instead of business outcomes.
