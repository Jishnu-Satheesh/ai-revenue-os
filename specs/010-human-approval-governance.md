# Feature Specification: Human Approval and Governance

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
