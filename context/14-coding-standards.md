# Coding Standards

## Language and framework

- TypeScript strict mode.
- Next.js App Router.
- React Server Components by default; client components only when interactivity requires them.
- Zod for validation.
- Tailwind CSS and shadcn/ui for interface primitives.

## Module structure

Prefer feature-oriented modules:

```text
src/modules/organizations/
  domain/
  application/
  infrastructure/
  ui/
  index.ts
```

Keep domain rules independent from Next.js, database clients, and model SDKs where practical.

## Data access

- Centralize repositories and query builders.
- Never issue unscoped tenant queries.
- Use transactions for multi-record invariants.
- Use migrations for every schema change.
- Store money as integer minor units plus currency.
- Store timestamps in UTC.

## APIs and actions

- Validate input at boundaries.
- Return typed error codes.
- Use idempotency keys for retriable mutations.
- Avoid leaking provider errors or sensitive internals to clients.

## Error handling

Use domain-specific errors such as:

- `AuthorizationError`
- `TenantScopeError`
- `PolicyViolationError`
- `IntegrationUnavailableError`
- `StaleDataError`
- `ValidationError`

## Testing

- Unit tests for domain rules and scoring.
- Integration tests for repositories, RLS, and provider adapters.
- Contract tests for events, tools, and workers.
- End-to-end tests for onboarding, approvals, and critical execution flows.

## Quality gates

- Formatting.
- ESLint.
- Type checking.
- Unit and integration tests.
- Migration validation.
- Security and tenant-isolation checks.
- No critical accessibility regression.
