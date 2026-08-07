# Selective TanStack Adoption Design

**Status:** Approved on 2026-08-08.

## Decision

AI Revenue OS adopts TanStack libraries individually, only when they solve a proven product need. TanStack is not a mandatory application-wide stack.

- **TanStack Query v5:** Standard for server state owned by interactive Client Components: polling, background refresh, optimistic mutation, retry, and client cache synchronization. React Server Components remain the default for initial reads and server-owned data.
- **TanStack Form v1:** Standard for complex or multi-step forms, including Guided Onboarding. It composes with Zod validation and shadcn/ui controls. Small forms may use local React state when a form library adds no value.
- **TanStack Table v8:** Approved for advanced data grids. Table v9 remains deferred while beta.
- **TanStack Virtual:** Approved only after measured list/grid scale requires virtualization.
- **TanStack Query Devtools:** Development-only when Query is installed.
- **TanStack DB, Store, AI, Charts, Hotkeys, and Pacer:** Deferred until a concrete requirement justifies each library and its maturity is acceptable.
- **Vercel AI SDK:** Retained behind the existing provider abstraction. Trigger.dev remains the durable workflow runtime. TanStack AI will be reconsidered after stable release or when AG-UI/provider portability creates a demonstrated advantage.

## Boundaries

- Query cache holds server state, not form state or general global UI state.
- Server Components do not fetch through TanStack Query merely for consistency.
- Query keys are domain-shaped and organization-scoped; invalidation is targeted.
- Optimistic updates are limited to reversible, low-risk mutations.
- TanStack Form owns form state; Zod/domain services remain authoritative validation boundaries; shadcn/ui owns rendered controls.
- No TanStack package is added before its first concrete use.

## Why

This gives complex onboarding and interactive dashboards consistent client behavior without duplicating Next.js server data features or coupling the product to immature libraries.

## Sources

- [TanStack Query and Next.js Server Components](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)
- [TanStack Form v1 production release](https://tanstack.com/blog/announcing-tanstack-form-v1)
- [TanStack AI beta](https://tanstack.com/blog/tanstack-ai-beta)
- [TanStack DB beta](https://tanstack.com/db/latest)
- [TanStack Store alpha](https://tanstack.com/store/latest)
- [TanStack Table v9 beta](https://tanstack.com/blog/tanstack-table-v9-taking-form)
