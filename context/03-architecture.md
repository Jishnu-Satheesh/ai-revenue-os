# Architecture

## Architectural style

AI Revenue OS uses a modular monolith for the control plane, durable asynchronous workflows for execution, event-driven communication, and strict multi-tenant data isolation.

A modular monolith is the preferred starting point because it maximizes delivery speed and type safety while preserving clear boundaries that can later become services if scale requires it.

## Logical layers

### 1. Experience layer

Next.js web application for:

- Agency portfolio view.
- Organization and branch management.
- Guided onboarding.
- Integration setup.
- Goals and policies.
- Opportunity feed.
- Approvals.
- AI decision timeline.
- Analytics and outcome reporting.

### 2. Control plane

Owns authoritative business configuration and user-facing application logic:

- Authentication and authorization.
- Tenant context.
- Organizations and memberships.
- Digital Twin state.
- Integration metadata.
- Goals, constraints, policies, and budgets.
- Opportunity records.
- Approval requests.
- Playbook definitions and versions.
- Worker definitions and capability registry.

### 3. Intelligence plane

Produces interpretations and decisions but does not directly perform unsafe side effects:

- Signal normalization.
- Opportunity detection.
- Hypothesis generation.
- Opportunity scoring.
- Plan generation.
- Retrieval from Business Memory.
- Evaluation and learning.

### 4. Execution plane

Trigger.dev executes durable tasks and agent workflows:

- Retries and backoff.
- Schedules and event triggers.
- Parallel worker execution.
- Long-running waits.
- Human approval pauses.
- Idempotent side effects.
- Run status and trace propagation.

### 5. Tool and integration plane

Provider adapters expose governed capabilities:

- Meta Ads.
- Google Ads and Google Business Profile.
- WhatsApp Business providers.
- POS systems.
- Delivery marketplaces when supported.
- Email, SMS, analytics, storage, and webhooks.
- CSV, spreadsheet, and manual ingestion when APIs are unavailable.

### 6. Data plane

Supabase Postgres is the system of record. It provides relational integrity, JSONB for flexible attributes, Row Level Security, transactional updates, and optional vector retrieval.

## Request path

1. User request enters the Next.js application.
2. Authentication establishes user identity.
3. Organization context and role are validated.
4. Domain service performs authorized database operations.
5. If asynchronous work is required, an event or Trigger.dev task is created.
6. Execution runs with a scoped service identity and explicit organization context.
7. Tool Gateway validates policy, schema, idempotency, and credentials.
8. Result and audit events return to the control plane.

## AI action path

1. Signal arrives.
2. Deterministic rules filter obvious ineligible cases.
3. Retrieval provides relevant organization facts and historical outcomes.
4. A model may interpret, rank, or draft a plan.
5. Structured output is validated by Zod.
6. Policy engine assigns action risk and approval requirements.
7. Opportunity is stored with evidence and assumptions.
8. Approved plans become execution runs.
9. Outcomes are measured after an appropriate delay.
10. Learning records update playbook evidence.

## Campaign Bundle path

Campaigns use one immutable, cross-channel contract rather than separate scheduler, Studio, Telegram, and provider records:

1. A Decision Engine opportunity or manual brief enters the same deterministic qualification service.
2. Postgres stores an immutable Campaign Bundle Version containing the complete strategy, creative, channel-action, policy, spend, and measurement proposal.
3. Trigger.dev `schemaTask` workflows run bounded generation and lifecycle stages. Vercel AI SDK calls may generate only typed proposal artifacts that pass Zod and policy validation.
4. Studio and Telegram Mini App review the same exact version and digest. A material edit creates a new version and invalidates approval.
5. Approval binds the exact version, action set, capability and policy versions, schedule, audience boundaries, attestations, expiry, and spend ceiling.
6. A deterministic Tool Gateway atomically checks current authorization, approval, policy, budget, idempotency, credentials, capability, and readiness before one provider call.
7. Provider receipts and reconciliation evidence are stored before exposure and outcome measurement.
8. A registered measurement plan produces an evidence-qualified conclusion, and any reusable learning remains a separately governed proposal.

Postgres remains authoritative throughout. Trigger.dev run state, Telegram sessions, and provider objects never substitute for campaign, approval, budget, execution, or evidence records. See ADRs 0015 through 0019.

## Deployment topology

- Vercel: Next.js control plane and API endpoints.
- Supabase: Postgres, Auth, Storage, RLS, optional vector extension.
- Trigger.dev: durable workflow execution.
- External model providers: accessed through a provider abstraction.
- Sentry and OpenTelemetry-compatible backend: errors, traces, and metrics.

## Important boundaries

- UI components never call provider APIs directly.
- Models never receive raw long-lived credentials.
- Execution runs never infer tenant scope from user-controlled text.
- Service-role database access is limited to server and worker code with explicit organization filters.
- Provider webhooks are verified, normalized, deduplicated, and stored before downstream processing.
- A provider definition or visible connection never grants an action. Campaign actions require a non-expired verified provider contract and an organization-scoped capability grant with current account eligibility.
- Models never approve a Campaign Bundle, select credentials, reserve spend, publish, or retry an unknown provider outcome.
- Telegram is an operator-review identity surface only; it is not a customer campaign channel.

## Frontend data and state policy

Follow ADR 0008's selective TanStack policy:

- React Server Components and Next.js data APIs own server-rendered reads by default.
- TanStack Query v5 is the standard for server state used by interactive Client Components, including polling, background refresh, retry, and reversible optimistic mutations.
- TanStack Form v1 is the standard for complex and multi-step forms; Zod and domain services remain the authoritative validation boundaries, and shadcn/ui remains the rendered component layer.
- TanStack Table v8 is approved for advanced data grids. TanStack Virtual is added only after measured scale requires it.
- TanStack DB, Store, AI, Charts, Hotkeys, Pacer, and Table v9 are not default dependencies.
- Vercel AI SDK remains the model/agent SDK behind the provider abstraction; Trigger.dev remains the durable workflow runtime.

Do not duplicate server state in a global client store or add a TanStack package only for ecosystem consistency.
