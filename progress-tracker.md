# AI Revenue OS Progress Tracker

> This file is the fast orientation point for future AI agents. Read it before starting work.

## Current state

- Date: 2026-08-08
- Package manager: **pnpm** (`pnpm@11.20.0`); Node 22 is required.
- Product stage: foundation plus Organization + Digital Twin vertical slice.
- Current active work: Guided Onboarding + AI Readiness Score implementation plan is ready; application implementation is paused pending explicit approval.
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

- Supabase CLI is not installed in the environment, so migrations have not been reset against a local instance.
- Playwright Chromium was unavailable during prior verification; browser E2E remains pending.
- The current onboarding route only creates the organization across three steps; the ten-section workflow needs new persistence, upload/extraction contracts, readiness scoring, and UI composition.
- `framer-motion` is not yet installed; add it only during implementation after the approved design plan.

## Next implementation sequence

1. Obtain explicit approval for `docs/superpowers/plans/2026-08-08-guided-onboarding-implementation.md`.
2. Execute the approved plan using its test-first task sequence.
3. Install/enable local Supabase CLI and Playwright Chromium before attempting final database and E2E completion.

## Verification record

- Previous foundation checks passed: `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build`.
- Guided Onboarding implementation checks are not yet run because implementation has not started.

## Notes for future agents

- Read `AGENTS.md`, this tracker, the relevant spec, and the approved design before editing.
- Do not begin implementation until the user explicitly approves the written implementation plan.
- Preserve the approved hybrid layout and operator-first ownership unless the user explicitly changes the decision.
