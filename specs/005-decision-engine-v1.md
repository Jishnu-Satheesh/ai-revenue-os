# Feature Specification: Decision Engine V1

## Status

Draft. Governed by `adrs/0014-decision-value-and-evidence-tiers.md`. Resolves the six open questions in `specs/011-learning-ledger.md` section 12, which unblocks the ledger migration.

## 1. Business outcome

Produce a small number of evidence-backed, prioritized opportunities whose value is stated in the organization's own currency, and record every decision in a form that later work can measure rather than assert.

V1 is recommendation-only. It proposes; it never executes.

## 2. What V1 can honestly produce

The decision loop in `context/08-decision-engine.md` opens with *observe: normalized metrics, events, facts, health states*. Only some of that exists.

Present in the schema today: `business_facts`, `goals`, `constraints`, `policies`, `branches`, Business Memory, and the Integration Hub's connection, capability, health, and ingestion-run tables. Absent: any normalized metric store, any signal store, any playbook table, and any opportunity table. `context/20-roadmap.md` lists normalized metrics under Milestone 3, but no specification or migration exists for them.

This has a consequence that must be stated rather than discovered during implementation. **Until the channel economics ledger supplies contribution margin at a `complete` or `partial` grade, the engine has no money-denominated input, and under ADR 0014 an opportunity with no defensible value estimate is a `needs_data` decision rather than an opportunity.** A Decision Engine built before the ledger would emit `needs_data` almost exclusively.

Two things follow:

1. `specs/012-channel-economics-ledger.md` and the detective mode of `specs/013-margin-firewall.md` move ahead of this specification in the build order. `context/20-roadmap.md` is amended in section 16.
2. This specification defines the **mechanism** — cycle, candidates, screening, scoring, policy, feed, feedback — behind a source port, so that opportunity classes activate as their inputs arrive rather than requiring the engine to be rewritten.

The Signal Engine, a Milestone 4 sibling in the roadmap, has no specification. V1 defines only the port it reads through, in section 5.3, and does not design its storage.

## 3. Scope

### 3.1 Included

- The decision cycle, its slot budget, and its termination conditions.
- Candidate identity, the two-stage screening and scoring funnel, and deterministic ranking.
- Evidence tiers and the money-denominated value model of ADR 0014.
- Rule-derived confidence resolved through the version tuple.
- The policy check, risk tier assignment, and approval path selection.
- `no_action` and `needs_data` as first-class recorded outcomes.
- Opportunity creation with evidence, assumptions, assertions, and an evaluation plan.
- Suppression and the declared resurfacing predicate.
- Expiry and the revalidation contract that the Tool Gateway will later enforce.
- Playbook definitions and versions as control-plane rows.
- The decision-side ledger tables from `specs/011-learning-ledger.md`: decision records, candidates, feedback, and a seeded artifact version registry.

### 3.2 Explicitly excluded

- **Execution.** Every side effect belongs to the Execution Plane behind the Tool Gateway.
- **Outcome measurement.** V1 declares the evaluation plan; measuring it requires executed actions and lands with Milestone 5.
- **Exploration.** Selection is deterministic. Propensity is `1.0` and `is_exploration` is `false` throughout, recorded rather than omitted, per section 7.
- **Model-generated candidates.** A model may not introduce an action the playbook registry does not already contain.
- **Multi-action plans.** A V1 opportunity recommends exactly one action. Sequenced plans land with the Execution Plane.
- **Learning.** No optimizer, no proposal generation, no calibration fitting. Milestone 7 per ADR 0013.
- **Cross-organization reads** of any kind.

## 4. Domain language

**Decision cycle** — one evaluation pass for one organization from one trigger, producing one or more decisions.

**Decision** — one selection of a single action, or of `no_action` or `needs_data`, from one candidate set. Produces exactly one `DecisionRecord`.

**Candidate** — a playbook version bound to a concrete subject and a concrete parameter set.

**Screening** — deterministic, set-based elimination over the eligible universe, before scoring.

**Scored set** — the survivors that were individually valued, ranked, and policy-checked.

**Assertion** — a named predicate an opportunity depends on, which must still hold at execution time.

## 5. Domain rules

### 5.1 The decision cycle

A cycle is scoped to `(organization_id, trigger, cycle_id)` and carries one correlation ID through every record it writes.

The cycle computes a **slot budget**: `max_active_recommendations` from the organization's policy configuration, less the count of currently active opportunities. `specs/005` previously required only that the engine limit active recommendations; the budget makes that limit the cycle's termination condition rather than a filter applied afterwards.

The cycle then runs up to *slot budget* sequential decisions. Each decision selects one action from the candidate set, and the chosen candidate is removed from the set before the next decision runs.

**One decision selects one action.** The alternative — one decision selecting a top-K set — was rejected because propensity is then the probability of a set rather than of an action, and the counterfactual for any single member becomes uninterpretable. Sequential single-choice decisions preserve a clean counterfactual at no modelling cost.

A cycle that produces nothing still writes exactly one `DecisionRecord`, with outcome `no_action` or `needs_data` and its reason. A cycle with a slot budget of zero writes one record with reason `slot_budget_exhausted` and does not screen.

### 5.2 Candidate identity

```
candidate_fingerprint = digest(playbook_version_id, subject_ref, parameter_digest)
```

`subject_ref` is a typed pair of `(subject_kind, subject_id)`. Subject kinds are registered, not free text; the core registers `organization`, `branch`, and `channel`, and Industry Packs register their own, following the registry pattern `specs/012-channel-economics-ledger.md` established for cost components. The core never learns pack subject kinds.

`parameter_digest` is a stable digest of the canonicalized action parameters, so that a differently-parameterized proposal over the same subject is a genuinely different candidate rather than a repeat.

The fingerprint is the key for suppression, deduplication, and outcome joins. It is stable across cycles and unstable across playbook versions, which is correct: a new playbook version is a new proposal even over an identical subject.

### 5.3 The two-stage funnel

Candidate generation reads through an `OpportunitySource` port. Each source declares the inputs it requires and yields candidates for one playbook. A source whose inputs are unavailable yields nothing and records why; it never yields a candidate with invented inputs.

**Stage A — screening.** Deterministic and set-based, over the eligible universe for each active playbook version. Screening predicates come from the playbook version's eligibility rules, plus three engine-level predicates:

- **Freshness.** Inputs older than the playbook's declared bound screen out. `context/08-decision-engine.md` already forbids generating opportunities from data stale beyond policy.
- **Capability.** A required capability that is not granted screens out, with the missing capability named.
- **Goal alignment.** Where the organization has active goals and a metric key registry exists, a playbook whose primary metric key matches no active goal screens out. An organization with no active goals is never screened on this predicate.

**Stage B — scoring.** The top `max_scored_candidates` survivors are individually valued, confidence-weighted, policy-checked, and ranked.

The two stages are logged at different grains, and this is a deliberate departure from the literal wording of `specs/011-learning-ledger.md` section 13:

- Stage A writes **counts and a rejection-reason histogram** on the `DecisionRecord`. No per-row writes.
- Stage B writes **one `DecisionCandidate` row per candidate**, including the chosen one and every candidate rejected at the policy check, with component values exposed individually.

The justification is reconstructability. A candidate eliminated by a deterministic threshold is reproducible from the playbook version, the screening rule, and the recorded inputs digest; it was never a live alternative and carries no counterfactual information. A candidate that was *scored and ranked* is not reproducible, because its value, confidence, and rank were computed in the moment from artifact versions that will change. Writing a row per screened-out subject would add hundreds of rows per cycle per playbook — one playbook over a two-hundred-item menu across three channels is six hundred — while making the propensity denominator misleading rather than informative.

Reconstruction depends on the underlying data not having been restated since the decision. `specs/015-metric-registry-and-normalized-metrics.md` makes metric observations append-only with revisions, and the decision record's inputs digest pins the revisions it read, so reconstruction of the screened-out set is exact rather than approximate. Where an input has no revision history, the caveat stands and is accepted, since screened-out candidates have no outcome.

### 5.4 The value model

Per ADR 0014, the only ranking quantity is:

```
expected_contribution_minor = round(impact_point_minor * confidence) - execution_cost_minor
```

- `impact_point_minor` is the midpoint of the declared `impact_low_minor`..`impact_high_minor` range. Both bounds are always stored; the point estimate exists to sort and is never displayed without its range.
- `execution_cost_minor` is the sum of declared, computable costs of the recommended action. A playbook whose action has an unknown or unbounded cost — a media action with no configured budget, for instance — yields `needs_data`, not a zero cost.
- All three are integers in minor units with an explicit ISO currency code. A candidate whose components span currencies is a defect, not a conversion.

`strategic_fit`, `risk_penalty`, and `opportunity_delay_penalty` are removed. Goal alignment is a screening predicate (5.3), risk is a gate (5.7), and time to impact is a displayed field and an intra-tier tie-break.

### 5.5 Evidence tiers

Every valued candidate carries exactly one tier:

| Tier | Basis | Requirement |
| --- | --- | --- |
| `computed` | Arithmetic over the organization's own economics | A `complete` or `partial` completeness grade plus observed volume for the same subject |
| `observed` | The organization's own measured history for a comparable prior intervention | A declared attribution window and a stated sample basis |
| `prior` | A playbook-declared prior authored by a human | The prior's author, date, and basis recorded on the playbook version |

`indicative` completeness maps to no tier: it is `needs_data`, matching `specs/012-channel-economics-ledger.md` section 4.4.

**Ranking is by tier first, then by `expected_contribution_minor` descending within the tier, then by time to impact ascending.** Values from different tiers are never blended, summed, or compared. The feed renders tier boundaries visibly; a tier is not a tooltip.

Cross-organization portfolio priors are out of scope and remain in `context/22-opportunity-backlog.md`.

### 5.6 Confidence

`confidence` is a deterministic function of evidence tier, input freshness, completeness grade, and sample size where observed history is used. It is the `confidence_calibration` artifact in `context/21-learning-system.md`, resolved through the version tuple, and V1 ships a seeded human-authored version labelled as such.

**No model emits a confidence value.** A model-supplied confidence would make the model the author of the score while the specification claimed deterministic ranking.

### 5.7 Policy check and risk

After scoring, each candidate is evaluated against the organization's active policy version, producing a risk tier from `specs/010-human-approval-governance.md` and an approval path.

- Tier 4 removes the candidate from the set with a recorded reason.
- Tiers 0 through 3 select an approval path and **do not alter the score in either direction**, per ADR 0014.
- Where `specs/013-margin-firewall.md` is active, its preventive evaluation runs here as a deterministic veto. `breach` removes the candidate; `unknown` converts it to `needs_data` and never silently passes.

Budget availability is checked against the policy's `monthly_budget_minor` at this stage. A candidate whose execution cost exceeds the remaining budget is removed with reason `budget_exhausted`, not merely deprioritized.

### 5.8 `no_action` and `needs_data`

Both are recorded outcomes with a `DecisionRecord`, per the recommendation in `specs/011-learning-ledger.md` section 12. They are the majority class early, and their absence would bias every later estimate toward the actions the system happened to be able to evaluate.

They differ in where they surface:

- **`no_action`** — candidates existed and none cleared. Internal; visible in the decision timeline.
- **`needs_data`** — a named input was missing, with a one-step path to supply it. It emits `decision.needs_data_identified` and surfaces in the **readiness surface** of `specs/008-ai-readiness-score.md`, **not in the opportunity feed**, and it never creates an `Opportunity` row.

`specs/013-margin-firewall.md` section 4.3 already separates data gaps from breaches on the grounds that a data gap is a platform problem and a breach is a business problem. V1 generalizes that split. A feed filled with things the platform cannot yet do reads as a list of excuses and trains operators to stop opening it.

### 5.9 Suppression and resurfacing

`context/08-decision-engine.md` requires that rejected actions are not re-proposed without new evidence. "New evidence" is made a checkable predicate rather than a judgement.

A rejection, a snooze, or an expiry writes a suppression row keyed by `candidate_fingerprint`, carrying the structured reason and a suppression window derived from that reason. A suppressed fingerprint is screened out in Stage A.

A candidate resurfaces only when one of the following holds:

1. The fingerprint changed — a different subject or different parameters.
2. The playbook version's declared `resurface_condition` is met. This is a named signal delta with a threshold, declared on the playbook version, never inferred at runtime.
3. The suppression window elapsed. Windows are per reason: a "not now" expires; a "this is wrong for my business" persists until the playbook version changes.
4. An operator explicitly un-suppressed it.

Each resurfacing records which of the four conditions fired.

### 5.10 Expiry and the revalidation contract

Every opportunity carries an expiry and a set of **assertions**: the named predicates it depends on. Assertions are typed and evaluable, and at minimum cover input freshness bounds, the margin floor outcome, budget availability, the required capability grants, and any capacity constraint the playbook declares.

`specs/013-margin-firewall.md` section 6 requires the Tool Gateway to re-evaluate the margin floor before the side effect, because an approval attested to the numbers at approval time. V1 generalizes that single re-check into the mechanism: **the Tool Gateway re-evaluates every assertion before execution, and any failure halts the action and returns the plan to the feed with the failed assertion named.** V1 declares and stores the assertions; Milestone 5 enforces them.

An expired opportunity cannot be executed without reassessment, per `specs/007-revenue-opportunity-feed.md`. Reassessment is a new decision with a new record, not a revived row.

## 6. Data model

New core tables, all carrying `organization_id` and RLS.

**Playbooks**

- `playbook_definitions` — stable key, name, owning scope (core, pack, or organization), industry pack slug, business objective.
- `playbook_versions` — semantic version, eligibility rules, required capabilities and data, trigger signal keys, hypothesis template, action definition, risk class, primary metric key, guardrail metric keys, measurement window, prior with author and basis, `resurface_condition`, and activation state. Exactly one active version per definition per organization.

**Decision path**

- `decision_cycles` — trigger, correlation ID, slot budget, screened and scored counts, started and completed timestamps, termination reason.
- `decision_records` — the entity in `specs/011-learning-ledger.md` section 5.1, plus cycle reference, outcome (`action_selected`, `no_action`, `needs_data`), the Stage A rejection histogram, and the inputs digest.
- `decision_candidates` — Stage B only, one row per scored candidate, with `candidate_fingerprint`, subject reference, impact low and high, confidence, execution cost, `expected_contribution_minor`, currency, evidence tier, eligibility and policy results, rejection reason, and rank. Component values are stored individually, never only as a total.
- `decision_feedback` — the entity in section 5.3 of the ledger spec, append-only, including the edit diff.
- `candidate_suppressions` — fingerprint, reason, window, source decision, resolution state.

**Opportunities**

- `opportunities` — title, summary, hypothesis, subject reference, playbook version, evidence bundle, assumptions, impact range with currency, confidence and its rationale, evidence tier, execution cost, time to impact, risk tier, approval path, guardrails, assertions, evaluation plan, expiry, status, and the originating decision record.

Statuses follow the candidate states in `context/08-decision-engine.md`. V1 uses `proposed`, `awaiting_approval`, `approved`, `rejected`, `snoozed`, and `expired`; the execution and measurement states are written by later milestones.

**Artifact registry**

- `artifact_versions` — as specified in `specs/011-learning-ledger.md` section 5.5, seeded with baseline versions and manual promotion only. Required now because a version tuple with nulls is indistinguishable from an unknown, and the ledger depends on that distinction.

`learning_proposals`, `eval_cases`, `eval_runs`, `eval_results`, and `outcome_measurements` are **not** part of this slice.

## 7. Ledger-forward constraints

`specs/011-learning-ledger.md` section 12 required that V1 not ship a decision path that cannot later carry the ledger's fields. This specification satisfies that requirement and answers its six blocking questions:

1. **Opportunity shape, and whether a decision may exist without one.** Defined in section 6. Yes — `no_action` and `needs_data` decisions exist without an opportunity, and `needs_data` decisions must never create one.
2. **Whether V1 records `no_action` and `needs_data`.** Yes. Section 5.8.
3. **Candidate identity.** `(playbook_version_id, subject_ref, parameter_digest)`, digested to a fingerprint. Section 5.2. Playbooks are versioned in the database as of this slice.
4. **Where policy configuration lives and whether it is versioned.** `public.policies`, which already carries a `version` column. Section 15 adds the constraint that enforces exactly one active version per policy type, which the version tuple assumes and the current schema does not guarantee.
5. **Whether the selection rule is deterministic.** Yes. Propensity is `1.0` and `is_exploration` is `false` on every record, recorded rather than omitted.
6. **The retention floor.** The longest measurement window declared by any active playbook version, plus one full optimization cycle, with a floor of 400 days. Enforced per organization.

One subtlety belongs on the record. In a recommendation-only engine the propensity of the *engine* is `1.0`, but the probability the treatment was actually applied is `1.0 × P(human approves)`. For later causal work the second factor is the one that matters. `decision_feedback` already captures the raw material; V1 additionally reports approval rate per `(playbook_version, risk_tier, actor_role)` so that the quantity exists as an observed rate from the first day rather than being reconstructed from rows nobody intended for that purpose.

## 8. API and events

Events, past tense per repository convention:

- `decision.cycle_started`
- `decision.recorded`
- `decision.needs_data_identified`
- `opportunity.proposed`
- `opportunity.approved`
- `opportunity.rejected`
- `opportunity.snoozed`
- `opportunity.expired`
- `decision.feedback_captured`
- `playbook.version_activated`

Read APIs serve the feed and the decision timeline. There is no user-facing write path to `decision_records`, `decision_candidates`, or `artifact_versions`.

## 9. AI behavior

The boundary is explicit because "a model may explain and compare candidates" is too loose to implement against.

**A model may:**

- Phrase the hypothesis from a playbook's hypothesis template.
- Write the evidence narrative and the operator-facing explanation of an opportunity that already exists with all its numbers computed.
- Draft creative, copy, or briefs attached to a recommended action.
- Propose a mapping from a free-text goal metric onto a registered metric key, as a proposal requiring confirmation.
- Suggest that a novel signal may warrant a new playbook, written into a human-reviewed backlog and never into the candidate set.

**A model may not:**

- Determine an eligibility or screening outcome.
- Produce any money figure, including impact bounds and execution cost.
- Produce a confidence value.
- Assign a risk tier or an approval path.
- Alter a rank or reorder the feed.
- Return a policy pass, block, or override.
- Decide a suppression or a resurfacing.
- Evaluate an assertion.

Every model output crossing into the decision path is validated by a Zod schema at the boundary. An output that fails validation is discarded and recorded; it is never repaired into the path.

## 10. Security and tenancy

- RLS on every new table, following `context/06-multi-tenancy-and-security.md`.
- `decision_records`, `decision_candidates`, and `decision_feedback` are append-only. Corrections are new rows.
- `artifact_versions` is service-role write only and unreachable from any user-facing request path.
- Approval is bounded by permission. A user cannot approve above their role, per `specs/007-revenue-opportunity-feed.md`.
- Editing an opportunity's parameters creates a new version and invalidates any prior approval, per `specs/010-human-approval-governance.md`.
- Candidate subject references may point at customer segments; sensitivity classification follows Business Memory's rules, and raw customer PII is never denormalized into the decision tables.
- Tenant scope is never inferred from user-controlled text, including playbook parameters.

## 11. Observability

- Decisions per cycle, and cycles per organization per day.
- Outcome distribution: `action_selected`, `no_action`, `needs_data`.
- Screening funnel: eligible universe, screened, scored, proposed — with the rejection histogram. A playbook that screens out everything every cycle is a defect, not a quiet no-op.
- Evidence tier distribution over proposed opportunities. A feed with no `computed` tier means the economics ledger is not yet earning its place.
- Approval rate and approval latency per playbook version and risk tier.
- Rejection reasons, and the resurfacing rate by condition.
- Expiry rate. A high rate means the engine proposes faster than the operator decides, and the slot budget is wrong.
- Model cost per proposed opportunity, per `context/17-observability-cost-governance.md`.

## 12. Failure states

- **No playbook active.** The cycle writes one `no_action` record with reason `no_active_playbook`. It does not invent a recommendation.
- **Economics ledger unavailable or `indicative`.** Value-bearing candidates become `needs_data` with the missing component named. They never fall back to a `prior` tier estimate.
- **Stale inputs.** Screened out in Stage A with the staleness bound named; never scored on old data.
- **Policy version missing.** The cycle halts for that organization and raises an operational alert. It does not default to permissive.
- **Currency mismatch within a candidate.** The candidate is dropped and the defect recorded. No implicit conversion.
- **Slot budget zero.** One record with reason `slot_budget_exhausted`; no screening performed.
- **Model unavailable.** Numbers are unaffected, since no number comes from a model. The opportunity is proposed with a templated narrative and flagged for later enrichment.

## 13. Acceptance criteria

- No opportunity is created without evidence, an evidence tier, an impact range with currency, assertions, and an evaluation plan.
- Ranking is by evidence tier before value, and no score blends tiers.
- The only ranking quantity is `expected_contribution_minor`, in integer minor units with an explicit currency.
- No risk term appears in any score; risk selects an approval path, and Tier 4 removes the candidate.
- No model produces a money figure, a confidence value, a risk tier, an eligibility outcome, a rank, or a policy result.
- Confidence resolves through the version tuple to a versioned artifact.
- Every decision, including `no_action` and `needs_data`, writes exactly one `DecisionRecord` with a complete version tuple and no null artifact references.
- Every scored candidate writes a `DecisionCandidate` with component values exposed individually; screening is logged as counts and a rejection histogram.
- Propensity `1.0` and `is_exploration` `false` are recorded on every record.
- `needs_data` never creates an opportunity and never appears in the feed.
- A rejected fingerprint is not re-proposed except by one of the four recorded resurfacing conditions.
- Active recommendations never exceed the configured maximum.
- Every approval surface writes `DecisionFeedback`, including the edit diff on modification.
- An edit creates a new opportunity version and invalidates prior approval.
- An expired opportunity cannot be executed without reassessment.
- Tenant isolation and permission boundaries are tested on every new table, including service-role paths.
- Every opportunity is traceable to its signals, playbook version, and decision record.

## 14. Test plan

- **Unit.** Fingerprint stability and instability across parameter and version changes; screening predicates including freshness, capability, and goal alignment; the value expression including rounding and currency handling; tier assignment from completeness grade; confidence resolution; tier-before-value ordering; slot budget arithmetic; suppression window and each of the four resurfacing conditions.
- **Database.** RLS on every table; append-only enforcement on records, candidates, and feedback; one active playbook version per definition; one active policy version per type; the retention floor.
- **Integration.** A seeded organization through a full cycle producing a mix of `computed`, `observed`, and `needs_data` outcomes, asserting the feed ordering, the readiness routing of `needs_data`, and reconstructability of every decision from the ledger tables alone.
- **Property.** Ranking is a total order and is stable under re-run with identical inputs; no candidate is ever proposed while suppressed.
- **Negative.** A model response asserting a money figure or a confidence value fails schema validation and is discarded, not repaired.
- **End-to-end.** An operator approves, edits, and rejects opportunities; feedback rows are written with edit diffs; an edit invalidates approval; the rejected fingerprint does not reappear in the next cycle.

## 15. Migration and rollback

New tables per section 6, plus three corrections to existing schema that are cheap now and expensive once decision history exists.

**Applied** in `supabase/migrations/20260810120000_decision_engine_configuration_versioning.sql`:

1. **`public.constraints` was neither versioned, effective-dated, nor scoped.** `specs/013-margin-firewall.md` section 4.1 requires margin floors to be effective-dated and versioned, and requires every evaluation to record the floor in force along with its version. The table now carries `constraint_key` as a stable identity independent of the mutable display name, `scope_kind` and `scope_ref`, `version`, `effective_from`, `effective_to`, and a supersession pointer, with a partial unique index for one active version per key and scope.
2. **`public.policies` did not enforce a single active version.** It had `unique (organization_id, policy_type, version)` and an independent `is_active` boolean, and the write path inserted each new version as active without retiring its predecessor, so a policy type accumulated active rows. A partial unique index on `(organization_id, policy_type) where is_active` now makes that impossible, and both configuration writes moved behind RPCs that retire the incumbent in the same transaction.

The same migration introduces `public.subject_kinds`, the shared subject-kind vocabulary that section 5.2 requires and that `specs/015-metric-registry-and-normalized-metrics.md` section 4.8 reuses.

3. **`goals.metric` was free text with no registry**, so a goal's metric could not be joined to a playbook's primary metric. `supabase/migrations/20260810130000_metric_registry_and_normalized_metrics.sql` adds `metric_definitions` and `goals.metric_key`, keeping the free-text `metric` for display and audit. **The Decision Engine must never consume a free-text metric name.**

**Outstanding:** `metric_key` is populated only from confirmed mappings, and that confirmation path is not built. Goal-alignment screening stays inactive until goals carry keys, and reports itself as inactive rather than silently passing.

Rollback drops the new tables and disables the cycle trigger. The schema corrections are forward-only.

## 16. Documentation updates

- `context/08-decision-engine.md` — scoring model, evidence tiers, candidate definition, funnel, model boundary, `needs_data` routing, suppression.
- `specs/011-learning-ledger.md` — section 12 resolved and its migration unblocked; section 13 candidate logging relaxed to the two-stage grain.
- `context/20-roadmap.md` — the channel economics ledger and the firewall's detective mode move ahead of Decision Engine V1 within Milestone 4; the firewall's preventive mode and the gateway re-check stay with the Tool Gateway in Milestone 5.
- `context/04-domain-model.md` — `Playbook`, `Opportunity`, and `DecisionRecord` gain the fields defined here.
- `context/19-glossary.md` — candidate, candidate fingerprint, decision cycle, evidence tier, expected contribution, screening, slot budget, assertion.
- `adrs/0014-decision-value-and-evidence-tiers.md` — governing decision.

## 17. References

- `adrs/0014-decision-value-and-evidence-tiers.md`
- `adrs/0007-risk-based-human-approvals.md`
- `adrs/0013-gated-artifact-learning.md`
- `context/08-decision-engine.md`
- `context/11-playbooks-and-experiments.md`
- `context/21-learning-system.md`
- `specs/007-revenue-opportunity-feed.md`
- `specs/008-ai-readiness-score.md`
- `specs/010-human-approval-governance.md`
- `specs/011-learning-ledger.md`
- `specs/012-channel-economics-ledger.md`
- `specs/013-margin-firewall.md`
- `specs/014-switchback-experiments.md`
