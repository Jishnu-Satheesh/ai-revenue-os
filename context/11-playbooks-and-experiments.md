# Playbooks and Experiments

## Playbook definition

A playbook is a versioned, testable business strategy. It is more durable than a prompt and more adaptable than a hard-coded workflow.

## Playbook schema

A playbook should define:

- ID, name, industry pack, version, and owner.
- Business objective.
- Subject kind, from the registered vocabulary shared with decision candidates.
- Eligibility conditions, expressed over registered metric keys.
- Required data and capabilities.
- Maximum input age, beyond which candidates are screened out.
- Trigger signals.
- Hypothesis template.
- Action stages.
- Risk class.
- Approval policy.
- Primary metric key and guardrail metric keys.
- Minimum sample size or duration.
- Attribution method.
- Rollback criteria.
- A prior impact range with its author and basis, or none.
- A resurfacing condition, naming the signal and threshold that permit re-proposal after a rejection.
- Historical evidence.

## Example

Metric names in a playbook are **registered metric keys**, never free text, and the subject they apply to is declared rather than implied. See `specs/015-metric-registry-and-normalized-metrics.md`.

```yaml
id: restaurant.marketplace.menu-photo-refresh
version: 1.0.0
objective: increase_profitable_marketplace_orders
subject_kind: marketplace_listing
eligibility:
  - listing.impressions >= 500
  - listing.conversion_rate < category_benchmark
  - margin.contribution_percent >= constraint.margin_floor
freshness_max_age_hours: 48
requires:
  - marketplace_listing_edit
  - approved_brand_assets
risk: medium
primary_metric: listing.conversion_rate
guardrails:
  - order.refund_rate
  - kitchen.preparation_time
  - margin.contribution
prior:
  impact_low_minor: 0
  impact_high_minor: 0
  author: unset
  basis: unset
resurface_condition:
  metric: listing.impressions
  change_pct_min: 25
measurement_window_days: 14
```

The `prior` block is deliberately unset in this example. Under `adrs/0014-decision-value-and-evidence-tiers.md` a playbook without a defensible prior yields `needs_data` rather than a guessed value, and the prior must record its author and basis before it can be used.

## Experiment principles

- Prefer controlled tests when channel capabilities permit.
- Predefine the primary metric.
- Use guardrails to prevent local optimization from harming the business.
- Avoid changing multiple major variables simultaneously unless the test is designed for it.
- Record exposure, audience, variant, and timing.
- Mark results inconclusive when evidence is insufficient.

Where customer-level randomization is impossible, which is the normal case for a single-location business, use a switchback design that randomizes treatment across time blocks. Eligibility is restricted: the treatment must be togglable at block granularity and its effect must substantially decay within one block. `specs/014-switchback-experiments.md` defines the design, its eligibility rules, and the pre-registration requirement.

## Cross-client learning

Aggregate outcomes only after normalization and privacy safeguards. The system may learn that a playbook tends to work for a business pattern, but must not reveal another organization's raw data, creative, customer list, or proprietary strategy.
