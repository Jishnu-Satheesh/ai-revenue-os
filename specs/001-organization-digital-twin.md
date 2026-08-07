# Feature Specification: Organization and Digital Twin

## Status

Ready for implementation.

## Business outcome

Create the trusted business context required for every downstream recommendation, automation, and measurement.

## User stories

- As an Agency Admin, I can create a client organization and one or more branches.
- As an Agency Operator, I can record verified facts, goals, constraints, budgets, and policies.
- As a Client Owner, I can review and correct the organization's Digital Twin.
- As the Decision Engine, I can retrieve current structured context with provenance and freshness.

## In scope

- Organization creation.
- Organization slug and status.
- Branch creation.
- Business profile.
- Business facts with source and verification status.
- Goals.
- Constraints.
- Initial approval and budget policies.
- Completeness summary.
- Audit events.

## Out of scope

- Provider account connection.
- Restaurant menu details.
- Semantic document retrieval.
- Autonomous recommendations.

## UX flow

1. Agency user chooses **Create organization**.
2. Enters minimum identity: name, industry, country, base currency, timezone.
3. Creates first branch or marks the business as branchless.
4. Selects installed Industry Pack.
5. System creates organization in `draft_onboarding` state.
6. User enters the guided onboarding flow.
7. Digital Twin page displays sections, source labels, freshness, and missing data.

## Domain rules

- Every organization has one base currency and default timezone.
- Every physical restaurant organization must have at least one branch before activation.
- Facts have source, verification status, and effective date.
- Inferred facts cannot overwrite verified facts.
- Goals require metric, baseline status, target, and scope.
- Organization activation requires minimum access policy and owner membership.

## Suggested data model

- `organizations`
- `organization_memberships`
- `branches`
- `business_profiles`
- `business_facts`
- `goals`
- `constraints`
- `policies`
- `audit_events`

## Events

- `organization.created`
- `branch.created`
- `business_profile.updated`
- `business_fact.verified`
- `goal.created`
- `constraint.created`
- `policy.updated`

## Security and tenancy

- RLS for all tenant tables.
- Only Agency Admin and Client Owner may activate an organization.
- Policy and budget changes are audited.
- Service-role access is prohibited from browser code.

## Acceptance criteria

- User can create an organization and branch end to end.
- Organization data is inaccessible to users outside its membership.
- Digital Twin shows verified, imported, inferred, stale, and missing states.
- Audit timeline records all sensitive changes.
- Deleting a draft organization follows a documented cascade or soft-delete policy.
- Type, unit, integration, RLS, and end-to-end tests pass.
