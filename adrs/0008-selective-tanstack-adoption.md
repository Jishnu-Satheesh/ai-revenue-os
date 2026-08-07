# ADR 0008: Adopt TanStack Selectively

## Status

Accepted.

## Context

AI Revenue OS uses Next.js App Router and React Server Components, but Guided Onboarding and future operational dashboards need reliable interactive server-state and complex form handling. TanStack now offers many libraries with different maturity levels. Adopting the entire suite would duplicate framework capabilities and put beta or alpha packages on critical paths.

## Decision

Adopt TanStack per capability, not as a bundled platform choice.

- Use TanStack Query v5 as the standard for server state in interactive Client Components. Keep React Server Components and Next.js data APIs as the default for server-owned reads.
- Use TanStack Form v1 with Zod and shadcn/ui for complex or multi-step forms. Permit local React state for genuinely small forms.
- Use TanStack Table v8 for advanced data grids and TanStack Virtual only after measured scale requires it.
- Permit TanStack Query Devtools in development only.
- Defer TanStack DB, Store, AI, Charts, Hotkeys, Pacer, and Table v9 until a concrete need and acceptable maturity are demonstrated.
- Retain Vercel AI SDK behind the provider abstraction and Trigger.dev for durable orchestration. Re-evaluate TanStack AI after stable release or a proven need for its AG-UI/provider-neutral model.

Query keys must be domain-shaped and organization-scoped. Mutations use targeted invalidation; optimistic updates are reserved for reversible, low-risk actions. Server data must not be copied into a general client-state store.

## Consequences

- Onboarding gains typed form state and consistent save/refetch behavior.
- Server-first Next.js pages avoid unnecessary cache hydration and duplicate data ownership.
- The project accepts multiple focused libraries instead of forcing one ecosystem across every layer.
- Deferred tools require a later ADR or explicit documented need before adoption.

## References

- [TanStack Query advanced SSR guidance](https://tanstack.com/query/latest/docs/framework/react/guides/advanced-ssr)
- [TanStack Form v1](https://tanstack.com/blog/announcing-tanstack-form-v1)
- [TanStack AI beta](https://tanstack.com/blog/tanstack-ai-beta)
- [TanStack DB beta](https://tanstack.com/db/latest)
- [TanStack Store alpha](https://tanstack.com/store/latest)
- [TanStack Table v9 beta](https://tanstack.com/blog/tanstack-table-v9-taking-form)
