# Decision Engine

## Purpose

The Decision Engine answers:

> Which eligible action should be proposed or executed next, for which organization, and why?

It does not directly perform provider side effects.

The value model, evidence tiers, and the treatment of risk are governed by `adrs/0014-decision-value-and-evidence-tiers.md`. The implementable contract is `specs/005-decision-engine-v1.md`.

## Decision loop

1. **Observe** - collect normalized metrics, events, facts, and health states.
2. **Detect** - identify deviations, gaps, risks, and opportunities.
3. **Form hypothesis** - express a falsifiable cause-and-effect statement.
4. **Screen** - eliminate ineligible candidates deterministically, in sets.
5. **Estimate value** - estimate incremental gross profit, cost, confidence, and time to impact.
6. **Check feasibility** - validate capabilities, data readiness, operations, and permissions.
7. **Check policy** - determine risk tier and approval path.
8. **Rank** - order surviving candidates.
9. **Propose or dispatch** - create an opportunity or execution request.
10. **Measure and learn** - evaluate outcome and update evidence.

## The decision cycle

A cycle is one evaluation pass for one organization from one trigger. It carries a single correlation ID and computes a **slot budget**: the configured maximum of active recommendations, less those already active.

**One decision selects one action.** A cycle runs up to *slot budget* sequential decisions, removing the chosen candidate from the set each time. Selecting a top-K set in one decision was rejected: propensity would then describe a set rather than an action, and the counterfactual for any single member would be uninterpretable.

A cycle that proposes nothing still records exactly one decision, with outcome `no_action` or `needs_data`.

## Candidates

A **candidate** is a playbook version bound to a concrete subject and a concrete parameter set:

```
candidate_fingerprint = digest(playbook_version_id, subject_ref, parameter_digest)
```

The fingerprint is the key for suppression, deduplication, and outcome joins. It is stable across cycles and deliberately unstable across playbook versions, because a new playbook version is a new proposal even over an identical subject.

Candidate generation runs in two stages, logged at two different grains:

- **Screening** is deterministic and set-based. It is logged as counts and a rejection-reason histogram on the decision record. A candidate eliminated by a threshold is reproducible from the rule and the recorded inputs, and was never a live alternative.
- **Scoring** applies to the survivors that are individually valued, ranked, and policy-checked. Each writes its own candidate row with component values exposed individually, because a computed rank cannot be reconstructed after the artifacts that produced it have changed.

## Value model

The only ranking quantity is expected contribution, in integer minor units with an explicit currency:

```
expected_contribution_minor = round(impact_point_minor * confidence) - execution_cost_minor
```

`impact_point_minor` is the midpoint of a stored low-high range and exists to sort. It is never displayed without its range. An action whose cost is unknown or unbounded produces `needs_data`, not a zero cost.

The earlier formulation multiplied by a `strategic_fit` term and subtracted `risk_penalty` and `opportunity_delay_penalty`. All three are removed. They had no unit, no data source, and — in the case of risk — the wrong shape entirely. In their place:

- **Goal alignment** is a screening predicate. A playbook whose primary metric key matches no active goal is screened out, and an organization with no active goals is never screened on it. This requires a registered metric vocabulary; free-text metric names are never consumed.
- **Risk** is a gate. See below.
- **Time to impact** is displayed on the opportunity and breaks ties within a tier.

Component values are always exposed individually, never only as a final score.

## Evidence tiers

Two species of opportunity exist, and their value claims are not commensurable. A margin breach is arithmetic and needs no attribution window. A projected conversion lift is inference with a wide range that single-branch volume may never validate. Sorting both into one number declares them equivalent, and when the inference misses it discredits the arithmetic beside it.

| Tier | Basis |
| --- | --- |
| `computed` | Arithmetic over the organization's own economics, at a `complete` or `partial` completeness grade |
| `observed` | The organization's own measured history for a comparable prior intervention |
| `prior` | A human-authored playbook prior, with author and basis recorded |

**Rank by tier first, then by expected contribution within the tier, then by time to impact.** Values from different tiers are never blended or summed. Tier boundaries are visible in the feed.

An `indicative` margin has no tier. It is `needs_data`.

## Confidence

Confidence is a deterministic function of evidence tier, input freshness, completeness grade, and sample size. It is a versioned artifact resolved through the version tuple, not a judgement made at runtime.

No model produces a confidence value. A model-supplied confidence would make the model the author of the score while the system claimed deterministic ranking.

## Risk

Risk assigns an approval path. It does not modify a score.

Tier 4 removes a candidate. Tiers 0 through 3 select who must approve and leave the value untouched. Subtracting a risk penalty would make risk purchasable — a sufficiently valuable unsafe action would outrank a safe one — which contradicts ADR 0007's decision that risk governs *who approves*, not *what something is worth*.

The policy check also hosts the deterministic vetoes. The margin firewall runs here in preventive mode: a `breach` removes the candidate, and an `unknown` converts it to `needs_data` rather than silently passing. Budget availability is checked here too, and a candidate whose cost exceeds the remaining budget is removed rather than deprioritized. No model participates in any of these outcomes, in either direction.

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
- Expected impact range and its evidence tier.
- Cost estimate.
- Confidence rationale.
- Guardrails.
- Assertions that must still hold at execution time.
- Evaluation window.
- Alternative actions considered.

## Assertions and revalidation

An approval attests to the numbers as they stood at approval time. Every opportunity therefore carries typed **assertions** — freshness bounds, margin floor outcome, budget availability, capability grants, capacity — and the Tool Gateway re-evaluates all of them immediately before the side effect. Any failure halts the action and returns the plan with the failed assertion named.

## `needs_data` and `no_action`

Both are first-class recorded outcomes. Early on they are the majority class, and omitting them would bias every later estimate toward the actions the system happened to be able to evaluate.

They surface differently. `no_action` is internal and appears in the decision timeline. `needs_data` names the missing input and a one-step path to supply it, and it surfaces in the readiness surface rather than the opportunity feed. A data gap is a platform problem; a breach is a business problem; a feed that mixes them reads as a list of excuses.

`needs_data` never creates an opportunity.

## Suppression and resurfacing

A rejection, snooze, or expiry suppresses the candidate fingerprint with a structured reason and a window derived from that reason. A suppressed fingerprint is screened out.

It resurfaces only when the fingerprint changes, the playbook version's declared `resurface_condition` is met, the window elapses, or an operator un-suppresses it. Which condition fired is recorded. "New evidence" is a checkable predicate, never a judgement made at runtime.

## Where models are allowed

A model may phrase a hypothesis, write the evidence narrative and operator explanation, draft creative attached to an action, propose a metric-key mapping for confirmation, and suggest a novel playbook into a human-reviewed backlog.

A model may not determine eligibility, produce any money figure, produce a confidence value, assign a risk tier, alter a rank, return a policy result, decide a suppression, or evaluate an assertion.

Every model output crossing into the decision path is schema-validated at the boundary. A failing output is discarded and recorded, never repaired into the path.

## V1 mode

Decision Engine V1 is recommendation-first. It may automatically execute only explicitly allowlisted, low-risk, reversible actions in sandbox or draft mode.

Selection is deterministic. Propensity is recorded as `1.0` with no exploration, because recording it is what makes a later move to stochastic selection legible as a change.

## Failure prevention

- Do not generate opportunities when source data is stale beyond policy.
- Do not recommend demand generation when capacity is constrained.
- Do not optimize revenue while ignoring minimum margin.
- Do not repeatedly propose rejected actions without new evidence.
- Do not confuse correlation with attribution.
- Do not present a value estimate without its evidence tier and range.
- Do not fall back to a weaker tier when a stronger one is unavailable. Fall back to `needs_data`.

## References

- `adrs/0014-decision-value-and-evidence-tiers.md`
- `specs/005-decision-engine-v1.md`
- `specs/011-learning-ledger.md`
- `specs/012-channel-economics-ledger.md`
- `specs/013-margin-firewall.md`
- `specs/010-human-approval-governance.md`
