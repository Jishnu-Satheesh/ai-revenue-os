# Feature Specification: Learning Ledger

## Status

Draft. Design frozen. The questions that blocked the migration are resolved by `specs/005-decision-engine-v1.md`; the migration now ships in three groups. See section 12.

## 1. Business outcome

Make every platform decision reconstructable and every behavior change attributable, so that improvement can later be measured rather than asserted. The ledger produces no user-visible feature on its own. Its output is the ability to answer, months from now, "did that change help, and how do we know".

## 2. Why this lands with Decision Engine V1

Four fields cannot be reconstructed after the fact, because the information never existed outside the moment of the decision:

- the **candidate set** — every action considered, not only the one chosen
- the **propensity** — the probability with which the chosen action was chosen
- the **exploration flag** — whether the choice was deliberate exploration rather than the ranked best
- the **version tuple** — the exact artifact versions in force

Logs without a candidate set and propensity contain outcomes only for actions the system already preferred, so any estimate fitted to them is confounded by its own past preferences. Logs without a version tuple cannot attribute an outcome change to a cause.

There is no backfill for a counterfactual. Deferring this to Milestone 7 would produce months of decision history that is unusable for the purpose it was collected for. ADR 0013 records this decision; `context/20-roadmap.md` is amended accordingly.

## 3. Scope

### 3.1 Included

- Decision records with candidate set, propensity, exploration flag, and version tuple.
- Human feedback capture on AI outputs, including the edit diff.
- Outcome measurements with declared baseline, window, attribution method, and verdict.
- The artifact version registry and its rollback pointers.
- Learning proposals as the sole write target of scheduled learning jobs.
- Evaluation cases, runs, and results.
- The system scorecard defined in `context/21-learning-system.md`.

### 3.2 Explicitly excluded

- Any optimizer. Nothing in this slice generates a proposal; the table exists so that later work has somewhere to write.
- Prompt optimization, calibration fitting, cross-organization priors, and adaptive allocation. All Milestone 7.
- Automatic promotion. The gate is specified here and enforced by later work; this slice ships the registry and the manual promotion path only.
- Experiment design. Owned by `specs/014-switchback-experiments.md`.

## 4. Domain language

**Artifact** — a versioned unit of judgment that the platform may later improve. Enumerated in the artifact table in `context/21-learning-system.md`. Nothing outside that table is an artifact.

**Version tuple** — the set of artifact version identifiers in force when a decision was made.

**Propensity** — the probability the chosen action carried under the selection rule in force. Deterministic ranking records `1.0` and sets `is_exploration = false`; this is correct rather than a placeholder, and it is what makes a later move to stochastic selection legible as a change.

One consequence must be recorded rather than discovered later. In a recommendation-only engine, the engine's propensity is `1.0` but the probability the treatment was actually applied is `1.0 × P(human approves)`. The second factor is the one that matters for causal work, and it is not the engine's propensity. `DecisionFeedback` holds the raw material; the approval rate per `(playbook_version, risk_tier, actor_role)` is reported from the first day so the quantity exists as an observed rate rather than being reconstructed from rows nobody collected for that purpose.

**Learning proposal** — a candidate replacement for an artifact version, with evidence and evaluation results, that has not been promoted.

**Verdict** — the outcome of a measurement: `validated`, `failed`, or `inconclusive`.

## 5. Entities

### 5.1 `DecisionRecord`

One row per decision the Decision Engine makes, whether or not it results in an opportunity.

- Organization and optional branch scope.
- Correlation ID, decision cycle reference, and originating run reference.
- Decision type and the triggering signal references.
- Inputs digest: goals, constraints, freshness state, and the retrieval log reference so the recalled context is reachable.
- Outcome: `action_selected`, `no_action`, or `needs_data`.
- Screened candidate count and the screening rejection-reason histogram, per section 5.2.
- Chosen action reference, or an explicit `no_action` or `needs_data` with reason.
- `propensity`, `is_exploration`, and the selection rule identifier.
- The version tuple, as described in section 6.
- Model metadata: provider, model identifier, token counts, cost in integer minor units with currency, latency.
- Policy evaluation result and assigned risk class.
- Created timestamp in UTC.

### 5.2 `DecisionCandidate`

One row per **scored** candidate, including the chosen one and every candidate rejected at the policy check. Carries the candidate fingerprint defined in `specs/005-decision-engine-v1.md` section 5.2, the subject reference, component values from `context/08-decision-engine.md` exposed individually rather than as a single number, the evidence tier, eligibility and policy results, rejection reason where ineligible, and rank.

Candidates eliminated during **screening** are not written as rows. They are recorded on the `DecisionRecord` as a screened count and a rejection-reason histogram.

The two grains are deliberate. A candidate eliminated by a deterministic threshold is reproducible from the playbook version, the screening rule, and the recorded inputs digest; it was never a live alternative and carries no counterfactual information. A candidate that was scored and ranked is not reproducible, because its value, confidence, and rank were computed from artifact versions that will change. Writing a row per screened-out subject would add hundreds of rows per cycle per playbook while making the propensity denominator misleading rather than informative. Reconstruction of the screened set is exact only up to restatement of the underlying data, which is accepted because screened candidates have no outcome.

A decision with a single scored candidate is recorded as such. An empty candidate set with a `needs_data` outcome is a valid and important row.

### 5.3 `DecisionFeedback`

Human response to an AI output. Actor, action taken (`approved`, `edited`, `rejected`, `expired`), structured reason, free-text note, the edit diff where the output was modified, and elapsed time to decision.

Append-only. A later reversal is a new row, not an update.

### 5.4 `OutcomeMeasurement`

Measured effect of an executed decision. Baseline window, measurement window, attribution method, primary metric and its value, guardrail metric values, verdict, and the evidence limitations required by `context/16-testing-evaluation.md`.

A measurement without a declared baseline and attribution method cannot be written. `inconclusive` is a first-class verdict and is never rewritten to a directional claim.

### 5.5 `ArtifactVersion`

The registry of promoted artifacts. Artifact type, semantic version, content or content reference, risk class, promoted-at, promoted-by, the evaluation run that justified promotion, and `rollback_to_version_id`.

Exactly one version per artifact type and scope is active at a time. Activation and the rollback pointer are written in the same transaction.

### 5.6 `LearningProposal`

The only row a scheduled learning job may write. Artifact type, proposed content, generating job and its input window, evidence references, evaluation run reference, computed gate results per condition, and status in `proposed`, `approved`, `promoted`, `rejected`, `rolled_back`.

A proposal is never partially applied.

### 5.7 `EvalCase`, `EvalRun`, `EvalResult`

Versioned evaluation sets and their execution history. Cases carry a provenance reference to the production decision or feedback row they were mined from, a split assignment of `frozen` or `holdout`, and a human label where one exists.

Split assignment is immutable once written. A case may not move between frozen and holdout.

## 6. The version tuple

Every `DecisionRecord` carries, as non-null references where the artifact class applies:

| Field | Meaning |
| --- | --- |
| `prompt_version_id` | Worker instruction set in force |
| `policy_version_id` | Policy and threshold configuration in force |
| `playbook_version_id` | Playbook selected, at its exact version |
| `ranking_weights_id` | Retrieval and scoring weights in force |
| `model_id` | Provider model identifier and revision |
| `judge_version_id` | Judge rubric, where a judge scored the output |

Before the artifact registry exists, these resolve to a seeded baseline version rather than null. A null would be indistinguishable from "unknown", and the entire ledger depends on that distinction.

## 7. Security and tenancy

- Every table carries `organization_id` and is protected by RLS following `context/06-multi-tenancy-and-security.md`.
- Decision records, feedback, and measurements are append-only. Corrections are new rows.
- `LearningProposal` and `ArtifactVersion` writes are service-role only and never reachable from a user-facing request path.
- Candidate sets may reference customer segments; sensitivity classification follows the same rules as Business Memory, and raw customer PII is never denormalized into the ledger.
- Cross-organization reads are prohibited at this layer. Aggregation for cross-client priors is a separate, later, privacy-reviewed path.

## 8. Events

Past tense, per repository convention:

- `decision.recorded`
- `decision.feedback_captured`
- `outcome.measured`
- `learning.proposal_created`
- `artifact.version_promoted`
- `artifact.version_rolled_back`

## 9. Trigger.dev tasks

This slice ships only what the ledger itself needs. Optimization tasks are Milestone 7.

| Cadence | Task | Purpose |
| --- | --- | --- |
| Event | `learning.record-decision` | Durable write when the decision path is asynchronous |
| Hourly | `learning.close-measurement-windows` | Write outcome measurements whose declared window has elapsed |
| Nightly, per organization | `learning.scorecard` | Compute the scorecard in `context/21-learning-system.md` |
| On promotion | `learning.monitor-promotion` | Compare live guardrails to the pre-promotion baseline and revert on breach |

Tasks follow the runtime contract in `specs/006-triggerdev-worker-runtime.md`, reuse the lease and claim pattern established by `memory_embedding_leases` for exactly-once semantics, and are queued with a per-organization concurrency key.

## 10. Observability

Scorecard metrics per organization per day, per `context/21-learning-system.md`: proposal acceptance rate and edit distance, retrieval precision at k, decision-to-validated rate, `inconclusive` share, guardrail breach and auto-rollback counts, cost per validated opportunity, and evaluation set size and age per artifact.

Additional operational metrics: decisions recorded per hour, measurement windows closed on time versus overdue, ledger write failures, and storage growth per organization.

## 11. Retention

Decision records and candidate sets grow far faster than chosen-action-only logging. Retention is set per organization with a floor long enough to cover the longest declared measurement window plus one full optimization cycle. Expiry summarizes rather than deletes: aggregate counts and outcome distributions survive, individual candidate rows do not.

## 12. Migration and rollback

The six questions that blocked this migration are resolved by `specs/005-decision-engine-v1.md`, which settles Decision Engine V1's shape. Their answers:

1. **Opportunity shape, and whether a decision may exist without one.** Defined in section 6 of that specification. A decision may exist without an opportunity: `no_action` and `needs_data` decisions never create one.
2. **Whether V1 records `no_action` and `needs_data`.** Yes, as recommended. They are the majority class early, and omitting them would bias every later estimate toward the actions the system happened to be able to evaluate.
3. **Candidate identity.** `(playbook_version_id, subject_ref, parameter_digest)`, digested to a fingerprint. Playbooks become versioned control-plane rows in the same slice, so the dependency this question named is discharged rather than worked around.
4. **Where policy configuration lives and whether it is versioned.** `public.policies`, which already carries a `version` column. It does not yet enforce a single active version per policy type; the Decision Engine V1 migration adds the partial unique index that this ledger's version tuple assumes.
5. **Whether selection is deterministic.** Yes. Propensity is `1.0` and `is_exploration` is `false` on every record, recorded rather than omitted.
6. **The retention floor.** The longest measurement window declared by any active playbook version, plus one full optimization cycle, with a floor of 400 days, set per organization.

### 12.1 What ships when

The ledger splits along the boundary its consumers actually have.

**With Decision Engine V1:** `decision_records`, `decision_candidates`, `decision_feedback`, and the `artifact_versions` registry seeded with baseline versions and a manual promotion path only. These carry the four unbackfillable fields and must exist the first time a decision is made.

**With Milestone 5:** `outcome_measurements`, which requires executed actions to measure, and the system scorecard.

**With Milestone 7:** `learning_proposals`, `eval_cases`, `eval_runs`, and `eval_results`, which have no writer until an optimizer exists.

The `artifact_versions` registry is in the first group despite having no optimizer, because section 6 requires the version tuple to resolve to a seeded baseline rather than null, and a null is indistinguishable from an unknown.

The three constraints on Decision Engine V1 remain in force and are satisfied by its specification: build an explicit candidate list before selecting, resolve artifact versions rather than reading configuration inline, and pass a correlation ID through the whole path.

### 12.2 Rollback

A table drop for each group. The ledger has no read dependency from user-facing paths, with one exception once Decision Engine V1 ships: the decision timeline reads `decision_records`, so dropping that group disables the timeline rather than degrading it silently.

## 13. Acceptance criteria

- Every decision, including `no_action` and `needs_data`, produces a `DecisionRecord`.
- Every `DecisionRecord` carries a complete version tuple with no null artifact references.
- Every scored candidate produces a `DecisionCandidate`, with component values exposed individually. Screening elimination is recorded as a count and a rejection-reason histogram on the `DecisionRecord`, never as candidate rows.
- Propensity and exploration flag are present on every record, including deterministic selection.
- Every approval surface writes `DecisionFeedback`, including the edit diff on modification.
- No `OutcomeMeasurement` can be written without a baseline, attribution method, and window.
- `inconclusive` is representable, reportable, and never rewritten.
- Scheduled learning jobs can write only `LearningProposal` rows; no job holds write access to an active artifact version.
- Every `ArtifactVersion` has a rollback pointer written in the same transaction as its activation.
- Evaluation split assignment is immutable.
- Tenant isolation is tested on every table, including the service-role paths.
- The scorecard renders before any optimizer exists.

## 14. Test plan

- Unit: version tuple resolution, propensity recording under deterministic selection, gate condition evaluation, edit-diff capture.
- Database: RLS on every table, append-only enforcement, single-active-version constraint, immutability of split assignment.
- Worker: measurement window closure at boundaries, lease contention, promotion monitoring and auto-revert.
- Integration: a full decision to feedback to measurement path with a seeded organization, asserting reconstructability of the decision from the ledger alone.

## 15. Documentation updates

- `context/21-learning-system.md` — companion.
- `adrs/0013-gated-artifact-learning.md` — governing decision.
- `context/04-domain-model.md` — `DecisionRecord` and `OutcomeMeasurement` gain the fields described here.
- `context/20-roadmap.md` — Milestone 5 instrumentation.
- `specs/005-decision-engine-v1.md` — must state the three constraints in section 12.

## 16. References

- `context/21-learning-system.md`
- `adrs/0013-gated-artifact-learning.md`
- `specs/005-decision-engine-v1.md`
- `specs/010-human-approval-governance.md`
- `specs/006-triggerdev-worker-runtime.md`
- `context/08-decision-engine.md`
- `context/16-testing-evaluation.md`
- `context/06-multi-tenancy-and-security.md`
