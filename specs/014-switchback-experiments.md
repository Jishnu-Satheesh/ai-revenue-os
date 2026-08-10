# Feature Specification: Switchback Experiments

## Status

Draft.

## 1. Business outcome

Produce defensible causal evidence for a single-location business, where customer-level randomization is impossible and observational before-and-after comparison is confounded by weather, holidays, competitor promotions, and normal week-to-week variance.

A switchback randomizes **time**, not customers. Treatment alternates across time blocks on a randomized schedule, and the effect is estimated by comparing blocks within the same unit. This converts a large share of `inconclusive` verdicts into real ones at pilot scale, which is the difference between a platform that claims impact and one that proves it.

## 2. Design stance

Switchback design becomes a first-class field of the playbook schema in `context/11-playbooks-and-experiments.md`, alongside `measurement_window_days`. It is not a one-off analysis script.

The design is **pre-registered and frozen before the first block runs**. Design, primary metric, guardrails, block length, planned duration, and analysis method are written once and are immutable for the life of the experiment. Everything in this specification exists to make that immutability enforceable rather than aspirational.

## 3. Scope

### 3.1 Included

- Switchback design records with randomized, balanced treatment assignment.
- Eligibility rules governing which interventions may use the design at all.
- Block-level exposure logging.
- Block-level analysis with pre-declared inference.
- Guardrail monitoring and stop rules.
- Verdict production into `OutcomeMeasurement`.

### 3.2 Explicitly excluded

- Customer-level A/B testing. Available only where a channel supports consented, identified audiences, and is a separate design.
- Geographic holdouts. Requires multiple comparable branches; a later addition for multi-branch clients.
- Adaptive allocation within a running switchback. Changing allocation mid-experiment invalidates the design. This belongs to L5 in `context/21-learning-system.md` and is not this.
- Cross-organization pooled analysis.

## 4. Eligibility — which interventions may use this design

A switchback is valid only when the treatment can be toggled at block granularity **and** its effect substantially decays within one block. Applying it elsewhere produces confident, wrong answers.

### 4.1 Eligible

- Promotion activation and discount depth.
- Daypart-scoped offers and menu availability.
- Messaging cadence and send timing.
- Delivery-fee and minimum-basket settings where the provider allows scheduled change.
- Paid-media budget pacing at block granularity.

### 4.2 Prohibited

- Anything with persistent state or long carryover: listing photos and descriptions, menu structure, brand assets, local search profile content.
- Anything affecting a provider ranking algorithm that adapts over days, where toggling teaches the algorithm rather than measuring the treatment.
- Review responses and reputation work.
- Anything affecting a customer's durable perception of fairness. **Price switchbacks require explicit policy approval and are prohibited by default**, because a customer who sees two prices in two days experiences an inconsistency, not an experiment.
- Anything whose reversal is not clean within the block boundary.

Eligibility is declared on the playbook and validated at experiment creation. An ineligible playbook cannot be assigned a switchback design.

## 5. Domain rules

### 5.1 Randomization unit

The unit is **branch × time block**. Blocks are contiguous, non-overlapping, and aligned to the organization's configured timezone, never to UTC — a daypart boundary is a local business concept.

### 5.2 Block length

Block length must be at least the declared **carryover window** for the intervention: the time for the treatment's effect to substantially dissipate, including order fulfillment time and any provider-side propagation delay.

Block length is declared per playbook with a documented rationale. Shorter blocks give more observations and more contamination; longer blocks give cleaner separation and less power. The tradeoff is decided at design time and recorded, not tuned during the run.

### 5.3 Balanced randomization

Assignment is randomized, not alternating. Strict alternation is predictable and confounds with any weekly or daily cycle.

Randomization is **balanced within strata** of day-of-week and daypart, so treatment does not disproportionately land on Fridays or dinner service. The assignment schedule is generated once, from a recorded seed, and stored in full before the experiment starts.

### 5.4 Minimum size

An experiment cannot start without a pre-computed minimum number of blocks derived from the historical variance of the primary metric and the minimum effect worth detecting. Where the required duration exceeds the client's tolerance, the honest output is that the effect is not detectable at this volume, and the experiment is not run.

The minimum detectable effect is displayed to the operator before they start. Running an underpowered experiment to produce activity is prohibited.

### 5.5 Analysis

- Inference is at the **block level**. Transaction-level tests treat orders within a block as independent when they are not, and will report significance that does not exist.
- Block-level observations are aggregated to the primary metric, and the estimator accounts for within-unit correlation across blocks.
- The analysis method is declared at design time: either a **fixed horizon** with analysis only at the declared end, or a **sequential design declared in advance** with its stopping boundaries.
- **Peeking is structurally prevented.** Interim results are not exposed to operators or to scheduled jobs during a fixed-horizon run. `context/21-learning-system.md` prohibits nightly jobs re-reading fixed-horizon experiments; here that prohibition is enforced by withholding the read.
- Blocks adjacent to a treatment change may be marked as a **washout** and excluded, if and only if the exclusion rule was declared before the run.

### 5.6 Guardrails and stopping

Guardrail metrics are monitored continuously — this is not peeking, because guardrails can only stop an experiment, never declare it successful.

On breach, the experiment aborts, treatment reverts, and the verdict is **`inconclusive` with a recorded abort reason**. An aborted experiment never reports a directional result, however the partial data looked.

### 5.7 Contamination

Repeat customers span blocks and carry experience across them. This is a known limitation of the design at small scale, is recorded as a stated limitation on every verdict per `context/16-testing-evaluation.md`, and is not silently ignored. Where first-party identity is consented and available, repeat-customer share is reported alongside the result so the reader can judge it.

## 6. Data model

- `experiments` — organization, playbook version, design type, primary metric, guardrails, block length, carryover window, planned block count, minimum detectable effect, analysis method, randomization seed, pre-registration timestamp, immutable design digest.
- `experiment_blocks` — block index, start and end in the organization timezone, assigned arm, washout flag, realized exposure, and a verification that the intended treatment was actually in force.
- `experiment_observations` — per-block metric and guardrail values.
- `experiment_results` — estimate, uncertainty interval, verdict, stated limitations, analysis run reference.

The design digest is computed at pre-registration and re-verified at analysis. A design mutation invalidates the experiment rather than silently changing its meaning.

## 7. Exposure verification

An assigned block is not an executed block. Provider changes fail, propagate late, or are reverted by a client mid-block.

Every block records whether the treatment was actually in force for the full block, verified against the Tool Gateway's invocation record. Blocks that failed verification are excluded under the pre-declared rule and counted separately. An experiment whose verified-exposure share falls below a declared threshold is reported `inconclusive` regardless of its estimate.

This is the difference between measuring an intervention and measuring an intention.

## 8. Trigger.dev tasks

| Cadence | Task | Purpose |
| --- | --- | --- |
| Per block boundary | `experiment.apply-block` | Apply or revert treatment through the Tool Gateway, idempotently |
| Per block boundary | `experiment.verify-exposure` | Confirm the treatment was in force |
| Hourly | `experiment.monitor-guardrails` | Stop-only monitoring |
| At declared end | `experiment.analyze` | Run the pre-declared analysis and write the verdict |

Treatment application is a governed side effect and passes through the Tool Gateway with an idempotency key per block. A missed block boundary is recorded as a failed block, never back-applied.

## 9. AI behavior

None in design, assignment, or analysis. All three are deterministic.

Models may draft the plain-language interpretation of a completed result, constrained to the computed estimate, its interval, its verdict, and its stated limitations. A model may not restate an `inconclusive` verdict as a directional finding, and the interpretation is validated against the verdict before display.

## 10. Security and tenancy

RLS on all tables. Experiments are scoped to one organization and one branch set. Assignment schedules are not exposed through any user-facing read path during a fixed-horizon run.

## 11. Observability

- Experiments running, completed, and aborted, with abort reasons.
- Verified-exposure share per experiment. The primary health metric.
- Verdict distribution, including `inconclusive` share, which is expected to be substantial and is not a defect.
- Blocks failed at boundary application.
- Realized versus planned duration.

## 12. Failure states

- **Provider rejects a treatment change.** Block marked failed, experiment continues, exposure share degrades, and the experiment auto-reports `inconclusive` if it crosses the threshold.
- **Client manually overrides treatment mid-block.** Block marked contaminated and excluded; a pattern of overrides aborts the experiment.
- **Data arrives late.** Analysis waits for a declared settlement period before running.
- **Insufficient power at design time.** The experiment is refused with an explanation, not started optimistically.
- **Guardrail breach.** Abort and revert per 5.6.

## 13. Relationship to the learning ledger

Every block-level treatment application is a decision and is recorded per `specs/011-learning-ledger.md`. The assignment probability is the **propensity**, and `is_exploration` is true for the treatment arm. A switchback is therefore the platform's first genuine source of unconfounded log data, which is what later off-policy estimation depends on.

## 14. Acceptance criteria

- A playbook not declared switchback-eligible cannot be assigned the design.
- Price switchbacks are prohibited without explicit policy approval.
- The assignment schedule is generated and stored in full before the first block, from a recorded seed.
- Randomization is balanced across day-of-week and daypart strata.
- Block boundaries respect the organization timezone.
- Minimum detectable effect is computed and shown before start; underpowered experiments cannot be started.
- Interim results are unreadable during a fixed-horizon run, by any actor or job.
- Guardrail monitoring can only stop an experiment.
- An aborted experiment reports `inconclusive` and never a direction.
- Every block records verified exposure, and low verified exposure forces `inconclusive`.
- The design digest is re-verified at analysis and a mutated design invalidates the experiment.
- Every verdict carries stated limitations, including repeat-customer contamination.

## 15. Test plan

- Unit: schedule generation and stratum balance from a fixed seed, block boundary computation across a daylight-saving change and across timezones, minimum-block computation, washout exclusion, digest verification.
- Database: RLS, design immutability, interim-read prohibition.
- Worker: boundary application idempotency, exposure verification against gateway records, guardrail abort and revert.
- Integration: a full seeded experiment producing each of `validated`, `failed`, and `inconclusive`, including an abort path and a low-exposure path.
- Property: over many seeds, assignment is balanced within strata and not alternating.

## 16. Migration and rollback

New tables plus a switchback design block on the playbook schema. Existing playbooks default to no design and are unaffected. Rollback stops scheduling new experiments; running experiments must complete or abort explicitly rather than being dropped mid-flight.

## 17. Documentation updates

- `context/11-playbooks-and-experiments.md` — switchback as a first-class design with its eligibility rules.
- `context/16-testing-evaluation.md` — switchback as an attribution method.
- `context/19-glossary.md` — switchback, carryover window, washout, minimum detectable effect.
- `industry-packs/restaurant/playbooks.md` — which tier-2 and tier-3 playbooks are eligible.

## 18. References

- `context/11-playbooks-and-experiments.md`
- `context/16-testing-evaluation.md`
- `specs/011-learning-ledger.md`
- `specs/013-margin-firewall.md`
- `specs/006-triggerdev-worker-runtime.md`
- `context/21-learning-system.md`
