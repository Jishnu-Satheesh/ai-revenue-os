# Integration Hub Design

**Status:** Approved design direction; implementation not started.

**Goal:** Give an agency operator a health-first, tenant-safe workspace for understanding and governing external data availability before the platform relies on it.

**Source requirements:** `specs/003-integration-hub.md`, `context/12-integrations.md`, `context/13-ui-ux-context.md`, and the approved Superdesign drafts.

## Approved direction

- Use the **health-first** workspace, not the capability-first variant.
- Route: `/organizations/[organizationId]/integrations`.
- Tabs: Connections, Catalog, Data sources, and Activity.
- Default view leads with operational health, action required, freshness, source list, and selected-source detail.
- Google Business Profile is the reference provider, using a deterministic fixture until Google API approval.
- Manual and CSV sources are `DataSource` records, not provider connections.
- Provider writes and webhooks are excluded from V1.
- Supabase Vault sits behind a `CredentialStore`; the real OAuth path is gated by security review because Vault is Public Alpha.
- Trigger.dev performs tests, syncs, imports, freshness checks, and disconnect cleanup while Postgres remains the source of business state.

## Superdesign references

- Approved health-first draft: <https://p.superdesign.dev/draft/035fe2fe-c036-4158-afb8-972e4222c075>
- Rejected capability-first alternative: <https://p.superdesign.dev/draft/f32836d6-83cf-427e-b7ad-2b94a69b638c>
- Canvas: <https://superdesign.dev/teams/c3d56832-bb79-49b6-910a-6450fc30e0a4/projects/d461af9e-eca9-4d1e-a3bd-67bbb122ca5b>

The approved draft is a visual reference, not implementation source. Product copy, permissions, tenant boundaries, status semantics, and shadcn composition in the feature spec are authoritative.

## Page structure

### Connections

- Operational health, action-required count, and freshness summary.
- Compact source list with health and maturity.
- Selected connection detail with safe account metadata, capability grants, branch mappings, recent activity, and governed actions.
- Test and Sync actions show queued/running state before terminal outcome.
- Disconnect uses an explicit destructive confirmation and explains retained history.

### Catalog

- Provider cards show rollout state, required access, supported capabilities, and why an unavailable provider is blocked.
- Google Business Profile copy is **“Fixture mode — Google API access pending.”**

### Data sources

- Manual source registration.
- UTF-8 CSV upload, validation, mapping, status, import history, retry, and archive.
- Imported source maturity is distinct from provider read-only maturity.

### Activity

- Chronological test, sync, import, health, disconnect, and cleanup events.
- Safe error summaries, correlation identifiers, and recovery actions.
- No credentials, token fragments, or raw provider response bodies.

## UI system

All interactive and user-facing surfaces compose shadcn/ui. Use Sidebar, Breadcrumb, Tabs, full Card composition, Badge/StatusBadge, Button, Spinner, Alert, Empty, Skeleton, AlertDialog, Sheet, Field, Select, Separator, and Sonner. Add missing primitives with pnpm. Bare buttons, inputs, selects, dialogs, cards, badges, menus, sidebars, alerts, or empty states are prohibited.

Use semantic tokens, built-in variants, `gap-*`, `cn()`, and the configured Lucide icon library. Health never relies on color alone. React Server Components own initial reads; TanStack Query owns interactive server state; TanStack Form and Zod own mapping forms.

## Data and control flow

`UI → organization-scoped route → authorization service → repository → Postgres`

`manual/scheduled request → persisted run → Trigger.dev → provider adapter → Zod validation → IngestionSink → persisted outcome/health/events`

Provider definitions live in versioned TypeScript. Connections, capability grants, account mappings, data sources, ingestion runs, and health checks live in Postgres with organization RLS. Adapter-specific data does not leak into the platform core.

## Security and recovery

- Organization scope is checked in route, service, repository, foreign keys, and RLS.
- User-facing paths do not use service-role access to bypass RLS.
- Secrets never enter the browser, model prompts, logs, analytics, or audit payloads.
- Disconnect disables grants before asynchronous cleanup.
- Retryable work uses stable idempotency keys and bounded backoff.
- Historical data is retained according to organization policy after disconnect.
- Real Google OAuth remains disabled until API approval and credential security review.

## Verification direction

Test capability and health derivation, tenant isolation, idempotency, adapter/error contracts, upload isolation, worker terminal states, all user-visible states, and disconnect recovery. Chrome DevTools verification at desktop and narrow viewports is mandatory before implementation sign-off.
