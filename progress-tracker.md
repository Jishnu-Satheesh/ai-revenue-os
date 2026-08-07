# AI Revenue OS Progress Tracker

> This file is the fast orientation point for future AI agents. Read it before starting work.

## Current state

- Date: 2026-08-08
- Package manager: **pnpm** (`pnpm@11.20.0`); Node 22 is required.
- Product stage: foundation plus Organization + Digital Twin vertical slice.
- Current active work: Guided Onboarding + AI Readiness Score implementation is complete pending live Supabase verification.
- Primary user: agency operator.
- Approved UI direction: section rail with an animated focused work panel.
- Implementation plan: `docs/superpowers/plans/2026-08-08-guided-onboarding-implementation.md`.

## Completed

- Next.js App Router + TypeScript foundation.
- Supabase tenancy schema, auth boundary, RLS patterns, and organization context.
- Organization creation and Digital Twin editor.
- shadcn/ui New York/Radix primitives installed and feature UI migrated away from bare controls.
- Critical shadcn rule documented in `context/14-coding-standards.md`, `context/15-ai-coding-standards.md`, and `README.md`.
- Superdesign repository context in `.superdesign/init/` and approved design system in `.superdesign/design-system.md`.
- Visual companion session: `.superpowers/brainstorm/42386-1786126676/` (ignored; canvas mockups are exploratory).

## Approved onboarding decisions

- Agency operator owns the flow; missing information can be assigned to client contacts.
- All ten sections in `specs/002-guided-onboarding.md` are in scope.
- Six visual phases group the ten sections: Foundation, Commercial context, Customer context, Governance, Data intake, Review.
- The persistent rail exposes all ten sections and their status.
- The focused panel uses directional slide transitions, dynamic height, animated connectors, shadcn controls, and reduced-motion support.
- Save is allowed for incomplete sections. Unknown and needs-attention are explicit states.
- AI extraction is suggestion-only until operator confirmation.
- Implementation uses TanStack Query v5 for the onboarding client snapshot/mutations and TanStack Form v1 for section editors; server reads remain RSC-owned.
- The onboarding control plane is recorded in `adrs/0009-guided-onboarding-control-plane.md` and migration `supabase/migrations/20260807193344_guided_onboarding.sql`.

## Canonical documents

- Product requirements: `specs/002-guided-onboarding.md`, `specs/008-ai-readiness-score.md`.
- Approved design: `docs/superpowers/specs/2026-08-08-guided-onboarding-design.md`.
- UI language: `context/13-ui-ux-context.md`, `.superdesign/design-system.md`.
- Architecture: `context/03-architecture.md`, `context/04-domain-model.md`, `context/05-module-map.md`.

## Architectural decisions and notes

- ADR 0008 adopts TanStack selectively: Query v5 for interactive Client Component server state, Form v1 for complex forms, Table v8 for advanced grids, and Virtual only after measured need.
- React Server Components remain the default for server-owned reads. TanStack is not an application-wide stack.
- Vercel AI SDK and Trigger.dev remain the V1 AI/orchestration choices; TanStack AI, DB, Store, Charts, Hotkeys, Pacer, and Table v9 are deferred.
- Core platform remains industry-neutral; restaurant menu behavior belongs to the Restaurant Industry Pack.
- No model may directly execute destructive or money-moving actions.
- Every AI output requires schema validation, provenance, review hooks, and explicit verification for trusted facts.
- Every organization-owned record must be tenant-scoped in application queries and RLS.
- User-facing UI must compose shadcn/ui primitives. Add missing primitives with `pnpm dlx shadcn@latest add <component>`.
- Use semantic CSS tokens and `cn()`. Do not use `space-y-*`, raw controls, manual color literals, or hidden state changes.

## Blockers and risks

- Supabase CLI can be invoked through `pnpm dlx`, but the local Postgres container is unavailable (`127.0.0.1:54322 ECONNREFUSED`), so migrations have not been reset/linted against a live local instance.
- Next 16.0.0 reports an inherited security warning during dependency installation; upgrading it is intentionally deferred from this scoped implementation.

## Next implementation sequence

1. Run local Supabase migration/RLS verification when Docker/Postgres is available.
2. Add authenticated two-tenant database and browser fixtures when the local Supabase test environment is available.

## Verification record

- Previous foundation checks passed: `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- Passing focused checks: onboarding domain, service, route, rail/workspace, section editor, extraction, and candidate-review tests; `pnpm typecheck`; `pnpm lint`.
- Passing full checks: `pnpm test` (38 tests), `pnpm format:check`, `pnpm build`, and guided onboarding E2E (2 protected/reduced-motion tests).
- Chrome DevTools MCP verification completed against the running Next.js app: auth redirect/login rendering and the fixture-backed onboarding workspace screenshot were inspected; all ten rail sections and six phases rendered with shadcn controls.
- Live Supabase migration lint/RLS verification remains blocked by Docker/Postgres only.

## Notes for future agents

- Read `AGENTS.md`, this tracker, the relevant spec, and the approved design before editing.
- Do not begin implementation until the user explicitly approves the written implementation plan.
- Preserve the approved hybrid layout and operator-first ownership unless the user explicitly changes the decision.
