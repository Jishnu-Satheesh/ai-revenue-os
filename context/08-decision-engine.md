# Decision Engine

## Purpose

The Decision Engine answers:

> Which eligible action should be proposed or executed next, for which organization, and why?

It does not directly perform provider side effects.

## Decision loop

1. **Observe** - collect normalized metrics, events, facts, and health states.
2. **Detect** - identify deviations, gaps, risks, and opportunities.
3. **Form hypothesis** - express a falsifiable cause-and-effect statement.
4. **Generate candidates** - select eligible playbooks and possible actions.
5. **Estimate value** - estimate incremental gross profit, cost, confidence, and time to impact.
6. **Check feasibility** - validate capabilities, data readiness, operations, and permissions.
7. **Check policy** - determine risk level and approval path.
8. **Rank** - prioritize candidates.
9. **Propose or dispatch** - create an opportunity or execution request.
10. **Measure and learn** - evaluate outcome and update evidence.

## Opportunity scoring

A practical initial scoring model:

`priority = expected_incremental_gross_profit * confidence * strategic_fit - execution_cost - risk_penalty - opportunity_delay_penalty`

The model should expose component values rather than only a final score.

## Candidate states

- Detected
- Needs Data
- Proposed
- Awaiting Approval
- Approved
- Scheduled
- Running
- Succeeded
- Failed
- Measuring
- Validated
- Inconclusive
- Rejected
- Expired

## Evidence requirements

An opportunity must include:

- Triggering signals.
- Baseline period.
- Relevant business facts.
- Assumptions.
- Expected impact range.
- Cost estimate.
- Confidence rationale.
- Guardrails.
- Evaluation window.
- Alternative actions considered.

## V1 mode

Decision Engine V1 is recommendation-first. It may automatically execute only explicitly allowlisted, low-risk, reversible actions in sandbox or draft mode.

## Failure prevention

- Do not generate opportunities when source data is stale beyond policy.
- Do not recommend demand generation when capacity is constrained.
- Do not optimize revenue while ignoring minimum margin.
- Do not repeatedly propose rejected actions without new evidence.
- Do not confuse correlation with attribution.
