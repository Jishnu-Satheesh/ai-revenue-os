# Feature Specification: Decision Engine V1

## Business outcome

Generate a small number of evidence-backed, prioritized revenue opportunities rather than overwhelming users with analytics.

## Mode

Recommendation-only, with optional automatic creation of drafts or internal tasks.

## Inputs

- Active goals.
- Constraints and policies.
- Integration capabilities.
- Data freshness.
- Normalized metrics and signals.
- Relevant Business Memory.
- Eligible playbooks.

## Outputs

A structured Opportunity containing:

- title and summary
- hypothesis
- evidence
- expected incremental gross-profit range
- confidence and rationale
- cost and required budget
- effort
- risk class
- guardrails
- recommended action
- approval requirement
- evaluation plan
- expiry

## Ranking

Start with deterministic weighted scoring. A model may explain and compare candidates but cannot secretly replace policy or value calculations.

## Acceptance criteria

- No opportunity is created without evidence and an evaluation plan.
- Stale or missing data produces `needs_data`, not invented analysis.
- Capacity and margin constraints influence eligibility.
- Rejected recommendations capture reasons.
- The engine limits active recommendations to an operator-configurable number.
- Every opportunity can be traced to signals, playbook version, and decision record.
