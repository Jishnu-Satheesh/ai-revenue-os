# Module Map

## Platform foundation

### Identity and Access

Authentication, memberships, roles, permissions, session security, and tenant context.

Tenancy is two levels: an `Account` is the agency and owns `Organization` clients. Account membership
carries an account role and a default organization role, so a teammate admitted once reaches every
client of the agency, including clients created afterwards, without a row per client. Access is a
union of grants resolved by `private.effective_organization_role`, which the 219 existing policy
checks reach through the unchanged `private.is_organization_member` and
`private.has_organization_role`, and which the application reads through
`public.current_organization_role`. Lives in `supabase/migrations/20260817120000_account_tenant_root.sql`,
`src/domain/organizations/types.ts`, and `src/modules/organizations/application/authorization.ts`.
Roles are bundles of permissions held as seeded rows in `public.permissions`,
`public.account_role_permissions`, and `public.organization_role_permissions`, mirrored for the
browser in `src/domain/access/permissions.ts` with a drift test that fails if the two disagree.
Memory's `memory.*` keys are a view over that catalogue. Checks resolve through
`private.has_account_permission` and `private.has_organization_permission`, which go through the same
effective-role rule as every policy.

Invitations bind an email address, an account role, and a default organization role to an account for
seven days, once. Only a SHA-256 of each token is stored; the raw token exists in the response that
minted it and nowhere else, so "resend" is necessarily "reissue". The invitation is delivered by
email through Resend, carrying an admin-minted sign-in token so one click both authenticates the
recipient and accepts the invitation; the sender falls back to a no-op that returns the copy-link
when no API key is configured, which is what keeps tests from ever mailing a real person. Acceptance requires the signed-in
user's confirmed email to equal the invited address, so holding a link is not enough. `member.invite`
is the first permission enforced at a call site. Lives under `src/modules/accounts`,
`src/domain/access`, `src/app/api/account`, and the public `src/app/(invitation)` route.

The sidebar footer carries **Invite member**, shown only to holders of `member.invite`, opening a
dialog that assigns both roles, produces the link, and lists pending invitations with reissue and
withdraw. The footer identity is resolved from `/api/account`, which joins account, membership, and
profile into one shape so the UI never deals with the two tables separately.

See `specs/017-account-identity-and-access.md` and ADRs 0022 and 0023.

### Organization and Digital Twin

Organization creation, branch setup, business profile, facts, goals, constraints, policies, and readiness.

Guided onboarding is the organization-scoped control plane for resumable ten-section intake, missing-data requests, private uploads, bounded extraction candidates, and versioned AI-readiness assessments. It lives under `src/modules/onboarding`, `src/components/onboarding`, and `src/app/api/organizations/[organizationId]/onboarding`; confirmed values remain canonical in the Organization/Digital Twin module.

### Integration Hub

Connection catalog, OAuth or credential handoff, webhook registration, file imports, provider health, and branch mappings.

The approved V1 is a health-first organization workspace with a provider-agnostic adapter registry, a fixture-backed read-only Google Business Profile provider, manual/CSV data sources, governed report-package intake, capability grants, account mappings, ingestion-run metadata, and health checks. Governed report packages are a separate private Storage and Postgres lifecycle: an operator declares the dynamic business channel, branch, period, report type, and currency, the browser uses a signed resumable XLSX/CSV upload, and a Trigger worker records bounded structural evidence, an exact approved contract, validation summaries, and deterministic exact-range projection evidence. Postgres classifies matching digests as duplicate replay, keeps non-overlapping periods separate, blocks ambiguous intersecting periods from the current rollup, and lets only an owner/admin append a correction/supersession resolution. The Integration Hub exposes those safe identifiers, states, and next steps—not workbook cells or aggregate values. This does not create Channel Economics, a provider connection, credentials, Business Memory, benchmarks, or actions. The Google path remains fixture-only with writes and webhooks deferred under ADR 0010. Capability-gated campaign providers may later register bounded writes and webhook intake only through a non-expired checked-in contract, installed adapter, organization-specific grant, deterministic policy, and Tool Gateway or verified webhook route. Credentials sit behind a server-only `CredentialStore`, now implemented over Supabase Vault alongside a generic OAuth session substrate: secrets are stored as Vault references, only a digest of the OAuth state is persisted, and consumption is a single atomic write that rechecks the caller's current role. No provider is registered as connectable, so every connect attempt fails closed; Meta appears in the catalog as a declared-blocked provider with the restriction codes from its checked-in contract. Trigger.dev executes durable work while Postgres remains authoritative. See `specs/003-integration-hub.md`, `specs/018-governed-channel-intelligence.md`, `docs/verification/campaigns/credential-security-review.md`, and ADRs 0010, 0016, and 0026.

### Data Ingestion and Normalization

Schemas, validation, deduplication, source quality, reconciliation, and normalized metrics.

### Channel Economics

Contribution margin by channel, its cost component vocabulary, effective-dated tenant rates, and the completeness grade on every figure.

Ahead of any margin, a read-only **evidence readiness** model classifies each organization/channel/branch/exact-period tuple as `ready_for_economics`, `partial_evidence`, `needs_data`, `not_comparable`, or `blocked`. It is derived at request time from the governed exact-range ledger and from the governed cost-coverage function, stores nothing, computes no margin, and reads no workbook value. Cost inputs appear only as availability and quality tier, never as an amount. Organization-scoped and off by default behind `GOVERNED_ECONOMICS_READINESS_ORGANIZATION_IDS`, enforced in the page loader and the API boundary. See `specs/012-channel-economics-ledger.md` sections 6.3 and 7.5, `specs/018-governed-channel-intelligence.md` section 10.2, and ADRs 0026 and 0027.

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
