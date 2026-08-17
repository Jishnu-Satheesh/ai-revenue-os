# Business Memory Workspace Design

## Purpose

Create the organization-scoped Business Memory workspace at
`/organizations/[organizationId]/memory`. It makes trusted organizational
context searchable and reviewable without presenting memory as a generic
knowledge base or fabricating performance analytics. The workspace follows the
module's core principle: provenance, trust order, freshness, sensitivity, and
human governance remain visible at the point of use.

## Scope

This is a cache-free vertical slice that combines the unstarted API and UI
work from Business Memory plan Tasks 14–16:

- authenticated, RLS-bound workspace, search, timeline, item, supersession,
  proposal-confirmation, and proposal-rejection API routes;
- an authenticated server-rendered workspace with interactive client-owned
  reads and mutations;
- the four views—Search, Timeline, Lessons, and Review—and the shared item
  inspection experience;
- a Business Memory entry in the organization navigation group.

The slice deliberately does not introduce Redis, snapshot warming, search
ranking caching, or cache-derived timestamps. Every read is served from the
existing Postgres-backed service under the caller's session/RLS context.

## Visual direction

The approved Superdesign direction is the **Integrated Operator Workspace**:

- retain the compact operator-console density and slim snapshot row;
- make the workspace search bar the dominant action below the tabs, with
  query, submit action, and compact type, verification, sensitivity, and
  freshness controls;
- group results by visible trust rank and use text-plus-icon status labels;
- keep any operational count factual—item, review queue, retrieval health,
  freshness, and embedding state—not a synthetic revenue dashboard;
- use the existing New York shadcn/ui primitives, the current system sans
  typography, and the neutral/emerald token palette;
- show "Inspect chain" in a shadcn/ui `Dialog`, not a persistent second pane.

The accepted design is available in the Superdesign project as
**Business Memory – Integrated Operator Workspace**.

## Information architecture

The page header identifies the organization and retrieval health. Operators
with the appropriate permission also receive an Add note action; viewers do
not see mutation affordances.

The workspace uses four shadcn `Tabs`:

1. **Search** (default) has the search workbench, degradation notice when
   semantic retrieval falls back to lexical mode, trust-ranked results, and
   explicit empty states for no memory, no match, and withheld content.
2. **Timeline** presents episodic memory by `observed_at`, with branch/source
   filters and cursor pagination.
3. **Lessons** presents lessons, decisions, and outcomes, expanding
   `derived_from` evidence inline.
4. **Review** presents pending proposals and fact proposals. A fact proposal
   compares proposed and current Digital Twin values side by side. Confirmation
   and rejection are non-optimistic, idempotent mutations; rejection requires a
   reason.

Selecting Inspect chain opens a modal `Dialog` with full provenance, source
reference, verification state, freshness, sensitivity, embedding state, and
supersession chain. The dialog supports keyboard focus trapping and returns
focus to the invoking result card on close.

## Data and authorization

Server Components perform the first authenticated read using the session-bound
Supabase client. Interactive state uses organization-scoped TanStack Query
keys and typed API routes. Route handlers validate Zod request data, call the
existing memory service with the authenticated organization context, and never
construct a service-role client.

All user-visible result data is hydrated under RLS. Sensitivity ceilings remain
role-specific; a viewer never receives a withheld body or a mutation control.
Mutation routes require an idempotency key and retain the governed Task 10
proposal confirmation/rejection RPC boundary. Sensitive state is refreshed
only after a successful mutation; no optimistic verification, promotion,
rejection, or supersession UI is allowed.

## Error, loading, and accessibility behaviour

Each workspace request has a safe typed error response and a dedicated
loading/error route state. A degraded retrieval response renders an `Alert`
and still shows lexical results. Background refetches preserve last successful
content and show a compact refresh status rather than blanking the workspace.

All controls use existing shadcn/ui primitives or their compositions. Status,
trust, and freshness communicate in text as well as colour. The search result
summary receives focus after a submitted search; tabs, dialog, filters, and
mutation forms remain keyboard reachable. The compact console must adapt to
390px without horizontal page overflow; a dense desktop layout can become a
single-column stack on small screens.

## Verification

The implementation will add test-first coverage for route authorization,
organization/body mismatch, sensitivity ceilings, required idempotency keys,
and safe omission of withheld bodies. UI coverage will exercise the four tabs,
degraded search, three Search empty states, non-blanking refetches, Review
side-by-side comparison, required reject reason, dialog provenance and focus,
and viewer-only read access.

Before completion, run focused Vitest suites, full typecheck, lint, formatting
for touched files, build, and browser verification. Browser verification uses
Chrome DevTools if available; if the route first requires authentication, stop
and request the user's authenticated session rather than attempting to bypass
or manufacture access.
