# Core Domain Model

The core domain remains industry-neutral. Restaurant entities are defined in the Restaurant Industry Pack.

## Identity and tenancy

### User

A human identity authenticated through Supabase Auth.

### Account

The tenant root: the agency. It owns organizations. User-facing copy calls this level **Agency**;
code and schema call it `account`.

### AccountMembership

Links a user to an account. It carries two separate things: `accountRole`, which is authority over
the agency, and `defaultOrganizationRole`, which is the role that member holds inside every
organization of the account they hold no explicit override for. The second is why organization access
never has to be written per organization, including for organizations created later.

### Organization

A tenant representing a client business, belonging to exactly one account. It owns data, policies,
integrations, goals, and runs. `accountId` is immutable after creation.

### OrganizationMembership

Links a user to a single organization with a role. Since ADR 0022 this is an **override** that raises
authority above what the account grants, not the only route to access.

### Branch

A physical or virtual operating location belonging to an organization. Branches have timezone, currency, service area, hours, contact details, and capacity metadata.

### Role and Permission

Roles exist at two levels, because authority over the agency and authority inside a client business
are different questions.

**Account roles** — what you are in the agency:

- `owner` — everything, including deleting the account and transferring ownership. An account always
  keeps at least one.
- `admin` — invites and removes members, manages roles strictly below their own, creates
  organizations. An admin may only admit members; only an owner may appoint an owner.
- `member` — holds a seat. No agency administration; what they can do is their organization role.

**Organization roles** — what you can do inside one client:

- `owner` — everything in this client, including archiving it and changing policy and budget.
- `admin` — all operations plus configuration: integrations, policies, constraints, member roles.
- `operator` — the daily work: campaigns, memory, verifying facts, *requesting* approvals. Cannot
  approve money-moving or public actions, and cannot change policy or budget.
- `viewer` — read only, and barred from `confidential` and `customer_content` memory.

Effective access is a **union of grants**: the highest-ranked grant that applies wins, and a grant
never subtracts authority. See ADR 0022.

Roles are bundles of **permissions**, held as seeded rows in `public.permissions` and the two
role-mapping tables rather than as conditionals in code, so changing what a role may do is a data
change reviewed as a migration. Organization roles nest strictly — `viewer ⊂ operator ⊂ admin ⊂
owner` — and account roles nest `member ⊂ admin ⊆ owner`. See ADR 0023.

Two roles named in earlier drafts of this document are deliberately absent:

- **Reviewer** — a genuine separation-of-duties need given `specs/010-human-approval-governance.md`,
  deferred until role-to-permission mapping is data (ADR 0023), at which point it costs one enum
  value and a few rows.
- **Platform Admin** — staff or support access into customer tenants is its own security design
  (consent, bounded duration, session recording). Out of scope rather than approximated.

## Digital Twin

### BusinessProfile

Industry, business model, value proposition, customer segments, brand, languages, operating model, and strategic context.

### BusinessFact

A single fact with value, source, verification status, confidence, effective dates, and freshness.

### Goal

A measurable target with baseline, metric, target value, deadline, scope, owner, and priority.

### Constraint

A business limitation or rule, such as budget, kitchen capacity, delivery radius, operating hours, forbidden claims, or minimum margin.

### Policy

Machine-enforceable governance for approvals, spend, channels, customer communication, data use, and risk.

### AIReadinessAssessment

A scored assessment of data, integrations, tracking, permissions, creative assets, operational capacity, and governance.

## Integrations and data

### IntegrationConnection

Provider connection metadata, scopes, health, credential reference, branch mapping, and sync state.

### DataSource

A logical source such as a POS export, marketplace report, ads account, review feed, or spreadsheet.

### IngestionRun

An import or sync attempt with status, counts, validation results, and errors.

### MetricDefinition

A registered metric key with label, unit, and owning scope. The core owns the structure; Industry Packs supply the vocabulary, following the cost component registry pattern. Goals, playbook primary metrics, and guardrails reference metric keys. Free-text metric names are never consumed by the Decision Engine.

### NormalizedMetric

A period-grain observation of a registered metric, with organization, branch, subject reference, registered dimensions, value kind, declared aggregation semantics, currency where applicable, quality tier, source, and revision. Ratio metrics store numerator and denominator rather than a quotient. Period boundaries are computed in the branch timezone. A missing period has no row and is never read as zero.

### MetricBaseline

A versioned, declared function over a metric series: comparison window, aggregation, filters, minimum observation count, and exclusion set. Returns `insufficient_data` rather than a number below its minimum.

### Signal

A normalized observation that may indicate an opportunity or risk.

## Intelligence

### Playbook

A reusable, versioned strategy containing eligibility rules, required capabilities, steps, metric keys, policies, evaluation windows, a human-authored prior with its basis, and a declared resurfacing condition. Exactly one version is active per definition per organization.

### DecisionCycle

One evaluation pass for one organization from one trigger, carrying a single correlation ID and a slot budget. It runs sequential decisions until the budget is spent or no candidate clears.

### Candidate

A playbook version bound to a concrete subject and parameter set, identified by a fingerprint over those three. The fingerprint keys suppression, deduplication, and outcome joins.

### Opportunity

A proposed business action carrying evidence, an expected impact range in integer minor units with its evidence tier, rule-derived confidence, cost, risk tier, effort, time to impact, guardrails, assertions that must hold at execution time, an evaluation plan, an expiry, and status. An action with no defensible value estimate is not an Opportunity; it is a `needs_data` decision.

### Hypothesis

A falsifiable statement linking an action to an expected measurable outcome.

### Plan

A validated sequence of actions generated from an opportunity and playbook.

### Campaign

A stable, organization-scoped campaign identity created from either a Decision Engine opportunity or a manual operator brief. It summarizes lifecycle only; executable intent lives in immutable bundle versions.

### CampaignBundleVersion

An immutable, normalized, cross-channel proposal containing strategy, evidence, creative directions, asset provenance and content hashes, copy and hashtags, channel actions, schedule, capability blockers, execution mode, spend ceiling, policy assertions, and a registered measurement plan. Its canonical digest plus exact version ID binds review, approval, execution, and evidence. Every material edit creates a new version.

### CampaignChannelAction

A provider-independent desired action owned by one Campaign Bundle Version, with placement, prerequisites, payload digest, schedule, required/optional state, spend limit where applicable, and independent lifecycle. It becomes executable only through a current organization capability grant and Tool Gateway claim.

### DecisionRecord

The full reasoning artifact for one decision: inputs digest, evidence, the scored candidate set with component values exposed individually, the screening rejection histogram, the selected action or an explicit `no_action` or `needs_data`, assumptions, policy checks, propensity and exploration flag, the artifact version tuple, and model metadata.

### ApprovalRequest

A human decision requirement tied to a specific plan version and risk level.

### CampaignApprovalEnvelope

Append-only informed consent for one exact Campaign Bundle Version and digest. It binds the approver, action IDs, capability-grant and policy versions, audience and schedule boundaries, factual assertions, measurement prerequisites, attestations, expiry, and spend ceiling. A material edit cannot reuse it.

## Execution and learning

### WorkerDefinition

A versioned worker contract with inputs, outputs, capabilities, permissions, model policy, and evaluation hooks.

### ExecutionRun

A durable run with trigger, status, correlation ID, organization scope, worker version, cost, and timestamps.

### ToolInvocation

A validated provider action with idempotency key, request summary, result, and audit metadata.

### ProviderContract

A checked-in, versioned, expiring external-truth boundary for one provider: official sources, account prerequisites, exact scopes, verified placements and actions, content limits, idempotency, webhook signature and replay rules, retry classification, unknown-outcome reconciliation, and stable restrictions. Registration does not grant an organization access.

### ProviderReceipt

Sanitized evidence of a provider request and state, including an external reference when available. Raw credentials and unnecessary provider payloads are excluded.

### ExposureRecord

Evidence that a person or aggregate audience could have received one approved campaign action, with source, time, scope, and confidence. Assignment without verified execution is not exposure.

### OutcomeMeasurement

Measured business impact over a defined attribution window.

Campaign outcome measurement binds the exact approved version, provider receipts, exposures, registered metric and baseline, attribution method, window, evidence quality, uncertainty, and economics. Its conclusion is one of `validated_outcome`, `inconclusive`, `guardrail_breach`, or `execution_only`.

### Experiment

A controlled comparison with variants, audience allocation, primary metric, guardrails, and analysis plan.

### MemoryItem

A retrievable fact, event, decision, outcome, lesson, or document with scope, provenance, confidence, and retention policy.

### AuditEvent

Immutable security and business audit record.

### CampaignLearningProposal

A campaign-scoped observation proposed for separate promotion into reusable memory, brand guidance, or a playbook. It carries supporting and contradicting evidence, affected scope, limitations, and review/expiry. It never changes live policy or another campaign directly.
