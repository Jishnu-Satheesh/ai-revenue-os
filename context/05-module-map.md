# Module Map

## Platform foundation

### Identity and Access

Authentication, memberships, roles, permissions, session security, and tenant context.

### Organization and Digital Twin

Organization creation, branch setup, business profile, facts, goals, constraints, policies, and readiness.

Guided onboarding is the organization-scoped control plane for resumable ten-section intake, missing-data requests, private uploads, bounded extraction candidates, and versioned AI-readiness assessments. It lives under `src/modules/onboarding`, `src/components/onboarding`, and `src/app/api/organizations/[organizationId]/onboarding`; confirmed values remain canonical in the Organization/Digital Twin module.

### Integration Hub

Connection catalog, OAuth or credential handoff, webhook registration, file imports, provider health, and branch mappings.

The approved V1 is a health-first organization workspace with a provider-agnostic adapter registry, a fixture-backed read-only Google Business Profile provider, manual/CSV data sources, capability grants, account mappings, ingestion-run metadata, and health checks. The Google path remains fixture-only with writes and webhooks deferred under ADR 0010. Capability-gated campaign providers may later register bounded writes and webhook intake only through a non-expired checked-in contract, installed adapter, organization-specific grant, deterministic policy, and Tool Gateway or verified webhook route. Credentials sit behind a server-only `CredentialStore`, now implemented over Supabase Vault alongside a generic OAuth session substrate: secrets are stored as Vault references, only a digest of the OAuth state is persisted, and consumption is a single atomic write that rechecks the caller's current role. No provider is registered as connectable, so every connect attempt fails closed; Meta appears in the catalog as a declared-blocked provider with the restriction codes from its checked-in contract. Trigger.dev executes durable work while Postgres remains authoritative. See `specs/003-integration-hub.md`, `docs/verification/campaigns/credential-security-review.md`, and ADRs 0010 and 0016.

### Data Ingestion and Normalization

Schemas, validation, deduplication, source quality, reconciliation, and normalized metrics.

### Business Memory

Facts, documents, events, summaries, decisions, outcomes, retrieval, freshness, and provenance.

## Intelligence

### Signal Engine

Converts raw events and metric changes into normalized business signals.

### Decision Engine

Detects, ranks, and explains opportunities. Initially recommendation-only.

### Playbook Engine

Selects versioned strategies based on eligibility, capabilities, goals, constraints, and evidence.

### Experiment Engine

Creates controlled tests, calculates guardrails, and records results.

### Evaluation Engine

Evaluates technical execution, output quality, business impact, and long-term playbook evidence.

### Campaign Bundles

Owns the industry-neutral campaign identity, immutable Campaign Bundle versions and digests, qualification, structured generation ports, revisions and diffs, channel-action manifests, exact-version approval envelopes, measurement plans, and campaign-scoped learning proposals. Decision Engine opportunities and manual briefs enter the same service. Studio and Telegram review are presentation adapters over the same version chain. See ADRs 0015, 0017, 0018, and 0019.

## Execution and governance

### Worker Runtime

Trigger.dev tasks and workflows with standard worker contracts.

### Capability and Tool Registry

Maps abstract capabilities to provider adapters and organization-specific availability.

Publishing, advertising, webhook-intake, metrics-read, and operator-review capabilities are independent. A provider contract records external truth; an organization grant records current usable authority. Missing scopes, account eligibility, mapping, credentials, policy, tracking, adapter, contract freshness, or controlled-account evidence keep only the affected capability blocked with a stable reason.

### Policy and Approval Engine

Risk classification, approval thresholds, spend controls, prohibited actions, and escalation.

Campaign approval binds one immutable bundle version and digest plus action, capability, policy, schedule, audience, attestation, expiry, and spend limits. Material edits invalidate approval.

### Campaign Tool Gateway

The only route from an approved Campaign Channel Action to a public or money-moving provider adapter. It atomically verifies tenant ownership, exact approval, current policy and capability, cancellation, idempotency, asset/destination/tracking readiness, and budget reservation. Unknown provider outcomes reconcile before retry.

### Audit and Decision Timeline

Human-readable history of observations, decisions, approvals, executions, failures, and outcomes.

## Experience

### Agency Portfolio

Cross-client health, readiness, opportunities, blocked actions, run failures, and incremental impact.

### Organization Workspace

Client-specific overview, goals, data, memory, opportunities, integrations, and outcomes.

### Revenue Opportunity Feed

Actionable cards rather than passive charts.

### Settings and Governance

Budgets, policies, approvals, credentials, data retention, and user access.

## Industry packs

Industry Packs register:

- Domain extensions.
- Onboarding sections.
- Metrics and signals.
- Playbooks.
- Worker definitions.
- Capabilities and integrations.
- UI panels.
- Evaluation methods.

The first pack is `restaurant`.
