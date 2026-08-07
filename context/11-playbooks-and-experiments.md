# Playbooks and Experiments

## Playbook definition

A playbook is a versioned, testable business strategy. It is more durable than a prompt and more adaptable than a hard-coded workflow.

## Playbook schema

A playbook should define:

- ID, name, industry pack, version, and owner.
- Business objective.
- Eligibility conditions.
- Required data and capabilities.
- Trigger signals.
- Hypothesis template.
- Action stages.
- Risk class.
- Approval policy.
- Primary metric and guardrails.
- Minimum sample size or duration.
- Attribution method.
- Rollback criteria.
- Historical evidence.

## Example

```yaml
id: restaurant.marketplace.menu-photo-refresh
version: 1.0.0
objective: increase_profitable_marketplace_orders
eligibility:
  - menu_item.impressions >= 500
  - menu_item.conversion_rate < category_benchmark
  - menu_item.margin_percent >= organization.minimum_margin_percent
requires:
  - marketplace_listing_edit
  - approved_brand_assets
risk: medium
primary_metric: item_conversion_rate
guardrails:
  - refund_rate
  - average_preparation_time
  - contribution_margin
measurement_window_days: 14
```

## Experiment principles

- Prefer controlled tests when channel capabilities permit.
- Predefine the primary metric.
- Use guardrails to prevent local optimization from harming the business.
- Avoid changing multiple major variables simultaneously unless the test is designed for it.
- Record exposure, audience, variant, and timing.
- Mark results inconclusive when evidence is insufficient.

## Cross-client learning

Aggregate outcomes only after normalization and privacy safeguards. The system may learn that a playbook tends to work for a business pattern, but must not reveal another organization's raw data, creative, customer list, or proprietary strategy.
