# Coding Standards

## Language and framework

- TypeScript strict mode.
- Next.js App Router.
- React Server Components by default; client components only when interactivity requires them.
- Zod for validation.
- Tailwind CSS and shadcn/ui for interface primitives.

## IMPORTANT: shadcn/ui component rule

All user-facing UI must use shadcn/ui components or compositions of shadcn/ui components. Do not use bare HTML buttons, inputs, selects, textareas, checkboxes, badges, menus, sidebars, dialogs, alerts, empty states, or cards when an appropriate shadcn/ui component exists. Custom wrappers must delegate to the shadcn/ui primitive and preserve its variants and accessibility behavior. Add missing primitives with `pnpm dlx shadcn@latest add <component>`, keep semantic CSS variable tokens in `src/app/globals.css`, and use the full Card and Field compositions where applicable. This is a critical rule for every feature.

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

## Frontend data, state, and forms

- Use React Server Components and Next.js data APIs for server-owned reads by default.
- Use TanStack Query v5 for server state in interactive Client Components. Query keys must be domain-shaped and organization-scoped; mutations use targeted invalidation.
- Use optimistic updates only for reversible, low-risk mutations and provide rollback/error states.
- Keep server data out of global client state.
- Use TanStack Form v1 with Zod and shadcn/ui for complex or multi-step forms. Local React state is acceptable for small forms.
- Use TanStack Table v8 for advanced grids and add TanStack Virtual only after measured need.
- Do not introduce deferred TanStack libraries without a concrete requirement and documented decision. See ADR 0008.

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
