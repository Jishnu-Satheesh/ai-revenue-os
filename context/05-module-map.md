# Module Map

## Platform foundation

### Identity and Access

Authentication, memberships, roles, permissions, session security, and tenant context.

### Organization and Digital Twin

Organization creation, branch setup, business profile, facts, goals, constraints, policies, and readiness.

Guided onboarding is the organization-scoped control plane for resumable ten-section intake, missing-data requests, private uploads, bounded extraction candidates, and versioned AI-readiness assessments. It lives under `src/modules/onboarding`, `src/components/onboarding`, and `src/app/api/organizations/[organizationId]/onboarding`; confirmed values remain canonical in the Organization/Digital Twin module.

### Integration Hub

Connection catalog, OAuth or credential handoff, webhook registration, file imports, provider health, and branch mappings.

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

## Execution and governance

### Worker Runtime

Trigger.dev tasks and workflows with standard worker contracts.

### Capability and Tool Registry

Maps abstract capabilities to provider adapters and organization-specific availability.

### Policy and Approval Engine

Risk classification, approval thresholds, spend controls, prohibited actions, and escalation.

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
