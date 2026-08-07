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

### NormalizedMetric

A time-series metric with organization, branch, channel, dimensions, value, currency, source, and quality status.

### Signal

A normalized observation that may indicate an opportunity or risk.

## Intelligence

### Playbook

A reusable, versioned strategy containing eligibility rules, required capabilities, steps, metrics, policies, and evaluation windows.

### Opportunity

A proposed business action with evidence, expected impact, confidence, cost, risk, effort, and status.

### Hypothesis

A falsifiable statement linking an action to an expected measurable outcome.

### Plan

A validated sequence of actions generated from an opportunity and playbook.

### DecisionRecord

The full reasoning artifact: inputs, evidence, selected action, alternatives, assumptions, policy checks, and model metadata.

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
