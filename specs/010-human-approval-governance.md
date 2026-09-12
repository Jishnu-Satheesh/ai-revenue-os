# Feature Specification: Human Approval and Governance

## Status

**Amended 2026-09-12 by
[ADR 0057](../adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md) (Proposed) and
[Spec 025](025-campaign-experience-and-marketing-loop.md) (Proposed).** The risk tiers below are
unchanged. For the Campaign path, one approval becomes two gates, and the tiers apply to each
separately:

- **Gate 1, preparation approval**, is internal and reversible. It binds the exact campaign proposal
  version and digest and authorizes bounded creative preparation within an approved generation cost
  ceiling. It reserves no media spend, publishes nothing and grants no provider authority.
- **Gate 2, exact-output publication approval**, is the tier that governs public and money-moving
  effects. It binds each finished deliverable version and its content hash together with every channel
  action term, and it is required for every finished output including every later variation.
- Preparation authority, exact creative approval, publishing authority and spend authority are four
  distinct permissions. Manage permission is not launch or spend approval permission. Approval of a
  design as a reusable reference in Creative History is a separate decision again, in both directions.
- The two gates may share one confirmation surface, which must state exactly what it permits; the
  database transaction still binds every required exact identity.

## Business outcome

Allow a two-person agency to supervise many clients without manually approving every harmless task or surrendering control over high-risk actions.

## Risk tiers

### Tier 0 - Read only

Analysis, classification, and reporting. Automatic.

### Tier 1 - Internal or reversible draft

Create drafts, internal tasks, or non-public recommendations. Automatic within budget.

### Tier 2 - Low-risk external action

Approved templates, bounded review responses, or minor listing updates. Organization policy decides automatic versus approval.

### Tier 3 - Financial or public campaign action

Ad publishing, budget changes, discounts, broad outbound messaging, public brand changes. Human approval required initially.

### Tier 4 - Prohibited

Actions outside legal, ethical, provider, security, or organization policy.

## Approval object

- Plan version.
- Approver role.
- Expiry.
- Spend and scope.
- Exact tool capabilities.
- Conditions.
- Decision and reason.

## Acceptance criteria

- Approval applies only to the reviewed plan version.
- Material edits invalidate prior approval.
- Expired approval cannot execute.
- Approvers see cost, scope, evidence, and rollback plan.
- Every decision is audited.
- Organization policies can be stricter than platform defaults.
