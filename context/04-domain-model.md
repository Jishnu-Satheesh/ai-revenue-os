# Core Domain Model

The core domain remains industry-neutral. Restaurant entities are defined in the Restaurant Industry Pack.

## Identity and tenancy

### User

A human identity authenticated through Supabase Auth.

### Organization

A tenant representing a client business. It owns data, policies, integrations, goals, and runs.

### OrganizationMembership

Links a user to an organization with a role and status.

### Branch

A physical or virtual operating location belonging to an organization. Branches have timezone, currency, service area, hours, contact details, and capacity metadata.

### Role and Permission

Roles map to explicit permissions. Initial roles:

- Platform Admin
- Agency Admin
- Agency Operator
- Client Owner
- Client Manager
- Reviewer
- Read Only

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

### DecisionRecord

The full reasoning artifact for one decision: inputs digest, evidence, the scored candidate set with component values exposed individually, the screening rejection histogram, the selected action or an explicit `no_action` or `needs_data`, assumptions, policy checks, propensity and exploration flag, the artifact version tuple, and model metadata.

### ApprovalRequest

A human decision requirement tied to a specific plan version and risk level.

## Execution and learning

### WorkerDefinition

A versioned worker contract with inputs, outputs, capabilities, permissions, model policy, and evaluation hooks.

### ExecutionRun

A durable run with trigger, status, correlation ID, organization scope, worker version, cost, and timestamps.

### ToolInvocation

A validated provider action with idempotency key, request summary, result, and audit metadata.

### OutcomeMeasurement

Measured business impact over a defined attribution window.

### Experiment

A controlled comparison with variants, audience allocation, primary metric, guardrails, and analysis plan.

### MemoryItem

A retrievable fact, event, decision, outcome, lesson, or document with scope, provenance, confidence, and retention policy.

### AuditEvent

Immutable security and business audit record.
