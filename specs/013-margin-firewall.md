# Feature Specification: Margin Firewall

## Status

Draft. Depends on `specs/012-channel-economics-ledger.md`.

## 1. Business outcome

Prevent the organization from selling below its own margin floor, and detect when it already is.

Prevented loss is the platform's most defensible claim. It is arithmetic rather than inference: it needs no attribution window, no control group, and no statistical power, which makes it the one impact statement that survives the evidence rules in `AGENTS.md` trivially. At single-organization scale, where most growth effects are smaller than the platform can detect, this is the capability that demonstrates value honestly in the first weeks.

## 2. Design stance

The firewall is **deterministic**. No model participates in a block decision, in either direction.

It operates in two modes against the same rule set:

- **Preventive** — a veto inside the policy check, before any plan reaches the Execution Plane.
- **Detective** — a scheduled sweep over observed economics that raises a loss-prevention signal when something already live is below floor.

The second mode matters more than it first appears. Marketplaces change commission tiers, promotion funding splits, and delivery fee structures unilaterally, and a business can be losing money on every order of a popular item for weeks without noticing.

## 3. Scope

### 3.1 Included

- Margin floor rules expressed as `Constraint` records, per organization, branch, channel, and optionally per item or category via pack mapping.
- Preventive evaluation of any proposed plan with a computable margin effect.
- Detective sweeps over live promotions, prices, listings, and channel economics.
- Loss-prevention signals and opportunities, with the corrective action attached.
- Avoided-loss accounting, bounded and labelled per section 7.
- Operator surfaces: active breaches, blocked plans, and floor configuration.

### 3.2 Explicitly excluded

- Automatic price changes, promotion termination, or listing edits. The firewall blocks and proposes; it never executes. `AGENTS.md` forbids autonomous price and discount changes beyond configured policy, and this capability is deliberately not the exception.
- Fixed-cost or overhead-based profitability judgments. Contribution margin only.
- Anything requiring a margin graded `indicative` by the economics ledger.

## 4. Domain rules

### 4.1 Floor definition

A floor is a `Constraint` with a scope, a comparator, and a threshold expressed either as a contribution margin percentage or an absolute minimum in integer minor units. Floors are effective-dated and versioned; a floor change is an artifact change and is attributable.

Resolution is most-specific-wins: item, then category, then channel, then branch, then organization. The resolved floor and its origin are recorded on every evaluation so a block is always explainable by pointing at one rule.

### 4.2 The three outcomes

Every evaluation returns exactly one of:

- `pass` — projected or observed margin is at or above the resolved floor, computed from a `complete` or `partial` grade.
- `breach` — margin is below the floor, with the shortfall quantified.
- `unknown` — the margin is `indicative`, meaning a component required for this evaluation is missing.

### 4.3 Handling `unknown`

This is the rule that determines whether the firewall is usable by real small businesses.

The firewall does **not** fail closed on missing data. Blocking every margin-sensitive action for a client who has not yet supplied cost data would make the platform unusable precisely for the clients who need it most, and would train operators to disable it.

Instead:

- For **preventive** evaluation, `unknown` on a margin-sensitive action produces `needs_data`, consistent with `specs/005-decision-engine-v1.md`. The plan is not blocked, it is held with a named missing input and a one-step path to supply it. An operator with authority may proceed on an explicit, recorded override that names what was unknown.
- For **detective** sweeps, `unknown` raises a data-gap signal rather than a breach signal. The two are never merged, because a data gap is a platform problem and a breach is a business problem.

The firewall fails closed on **breach**, not on ignorance.

### 4.4 Promotion-specific rules

A discount is evaluated on the margin after the discount, including the funding split where the marketplace funds part of it, and including any commission recalculated on the discounted price rather than the list price. Getting the commission base wrong is the single most common way a promotion looks profitable and is not.

Where a promotion is expected to shift mix, the evaluation uses observed mix, not the assumed mix in the plan. An assumed-mix argument is recorded as an assumption on the decision record and never as a fact.

### 4.5 Capacity interaction

A plan that passes the margin floor may still be rejected by capacity constraints. The firewall does not evaluate capacity, and a `pass` is never presented as an endorsement — only as the absence of a margin objection.

## 5. Data model

- `margin_floor_evaluations` — append-only. Subject reference, mode, resolved floor and its origin, computed margin, grade, outcome, shortfall, decision record reference.
- `margin_breaches` — open breaches with first-detected, last-confirmed, current shortfall, exposure, and resolution state.
- `avoided_loss_records` — see section 7.

Overrides are recorded as `AuditEvent` entries with the actor, the named unknown or accepted shortfall, and the justification.

## 6. Integration points

- **Policy check** in the decision path of `context/03-architecture.md`, step 6, as a deterministic evaluator.
- **Tool Gateway**, as a final pre-execution assertion. A plan approved hours earlier may have gone below floor since; the gateway re-evaluates before the side effect, because the approval attested to the numbers at approval time.
- **Signal Engine**, receiving `margin.breach_detected` for detective findings.
- **Learning ledger**, where every evaluation attaches to the decision record and every override becomes a labeled feedback row.

## 7. Avoided-loss accounting

The claim "we saved you X" is easy to inflate and will be audited. The following constraints are non-negotiable.

- Avoided loss is only recorded when a plan was **blocked or corrected**, and it is computed against an explicit counterfactual: the plan as configured, at a stated volume basis, over a bounded window.
- The volume basis must be observed history for the same item, channel, and daypart. A projected or aspirational volume may not be used.
- The window is capped at the shorter of the promotion's own declared duration and a configured maximum. Open-ended extrapolation is prohibited.
- Every record is labelled **estimated avoided loss** and states its counterfactual and volume basis wherever it is displayed.
- Avoided loss is **never summed into the same total as realized incremental gross profit.** They are different claims with different evidentiary standards and appear as separate lines in every report.
- A corrected-and-relaunched plan records avoided loss once, not once per evaluation.
- Detective findings record **realized loss to date**, which is measured rather than estimated, separately from avoided future loss.

## 8. UX flow

- **Blocked plan.** States the resolved floor, its origin, the computed margin, the shortfall, and the smallest change that would clear it — a price, a discount depth, or a funding split. A block that does not tell the operator how to unblock it will be routed around.
- **Active breaches.** Ranked by exposure, with realized loss to date and the corrective action.
- **Data gaps.** Separate surface, framed as readiness rather than risk.
- **Floor configuration.** Shows the resolution order explicitly so an operator can see which rule will apply.

## 9. AI behavior

None in the evaluation path.

Models may draft the operator-facing explanation of an existing breach and may propose corrective options for human selection. Neither can alter an outcome, a floor, or a computed number. A model is never asked whether something is profitable.

## 10. Security and tenancy

RLS on all tables. Floor thresholds are `confidential`. Only roles with policy-configuration permission may edit floors; overrides require an explicitly permissioned role and are always audited, never inferred from a general approval.

## 11. Observability

- Breaches open, by age and exposure.
- Blocks issued, and the override rate. A rising override rate means the floors are wrong or the explanations are poor, and is treated as a product defect rather than user error.
- Evaluations returning `unknown`, as a share of the total. This is the firewall's coverage metric.
- Time from breach detection to resolution.
- Gateway re-evaluations that reversed an earlier approval.

## 12. Failure states

- **Economics ledger unavailable.** Preventive evaluation returns `needs_data`; it does not silently pass. Detective sweeps skip and record the gap.
- **No floor configured.** The firewall is inactive for that scope and says so plainly. It does not invent a default margin floor.
- **Floor changed mid-window.** Evaluations use the floor in force at evaluation time and record its version.
- **Conflicting floors at equal specificity.** The stricter floor applies and the conflict is surfaced for resolution.

## 13. Acceptance criteria

- No model participates in any block decision.
- `unknown` never silently passes and never blocks; it produces `needs_data` or a data-gap signal.
- Commission is recalculated on the discounted price wherever a discount is evaluated.
- Every block names the resolved floor, its origin, and the smallest clearing change.
- Every override is audited with the named unknown or accepted shortfall.
- The Tool Gateway re-evaluates before the side effect.
- Avoided loss states its counterfactual and volume basis, is capped by window, and is never summed with realized incremental gross profit.
- Realized loss and avoided loss are separate figures.
- The firewall never executes a corrective action autonomously.

## 14. Test plan

- Unit: floor resolution order, equal-specificity conflict, the three outcomes, discount and funding-split arithmetic including the commission base, avoided-loss capping.
- Database: RLS, append-only evaluations, override auditing.
- Worker: detective sweep over a seeded organization with a live below-floor promotion; re-evaluation reversing a stale approval at the gateway.
- Integration: a plan that passes at approval and breaches at execution time.
- End-to-end: operator sees a block, applies the suggested correction, and the plan clears.

## 15. Migration and rollback

New tables plus a constraint subtype for margin floors. No changes to executed-action paths beyond an added evaluation step. Rollback disables the evaluator; historical evaluations are retained.

## 16. Documentation updates

- `context/08-decision-engine.md` — the firewall as a deterministic policy-check stage.
- `industry-packs/restaurant/playbooks.md` — the promotion optimizer's dependency on the firewall.
- `context/19-glossary.md` — margin floor, avoided loss.

## 17. References

- `specs/012-channel-economics-ledger.md`
- `specs/005-decision-engine-v1.md`
- `specs/010-human-approval-governance.md`
- `specs/011-learning-ledger.md`
- `adrs/0007-risk-based-human-approvals.md`
- `context/03-architecture.md`
