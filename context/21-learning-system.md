# Learning System

How the platform becomes more useful over time without any component silently changing its own behavior.

## Design stance

Nothing in this platform learns by mutating itself. Every layer of judgment is a **versioned data artifact**, and scheduled jobs **propose** new versions that must survive an offline gate before they are promoted.

The reason is structural rather than stylistic. A background job can safely author a row: the row is inspectable, attributable, diffable, and revertible. A background job cannot safely author behavior, because behavior that changes without a recorded cause is neither explainable nor reversible, and `AGENTS.md` requires both of every AI action.

This yields the operating rule that governs the rest of this document:

> **The improvable surface must be data, not code.**

The proposal pattern already exists in the codebase. Business Memory writes `memory_items` with `memory_type = 'fact_proposal'` and `verification_state = 'proposed'`, and promotion into `business_facts` happens only through a governed transition (ADR 0011). The learning system extends that same shape from facts to every artifact listed below.

## The five levels

Levels are adopted in order. Each one requires the level beneath it to be in place and trustworthy. Skipping ahead produces a system that changes constantly and cannot demonstrate that any change was an improvement.

### L1 - Accumulation

The system is more useful tomorrow because it knows more today. Memory items, verified facts, normalized metrics, and connection history accumulate.

No statistics required. Works from the first organization onward. This is Business Memory, already specified in `specs/004-business-memory.md`.

### L2 - Feedback capture

Every human touch on an AI output is a label. Approved, edited, or rejected; the edit diff; the stated reason. Captured at the approval surface and stored against the decision that produced the output.

This is the highest value per unit of engineering in the entire plan and it requires no intelligence at all. An operator rewriting a draft is supplying a preference pair for free. Failing to record it discards the only high-quality supervision the platform will have for months.

### L3 - Offline optimization with a gate

Scheduled jobs mine L2 labels into versioned evaluation sets, propose an improved artifact, score the proposal against a frozen set, and write a `learning_proposal`. Promotion is a separate, gated act.

This is the level at which "improves every day" becomes both true and measurable.

### L4 - Outcome learning

Playbook priors and impact estimates updated from measured incremental gross profit over declared attribution windows. Requires real outcome measurement and enough completed runs per playbook to say anything honest.

### L5 - Online adaptive allocation

Contextual allocation across variants that have **already** passed L3 and L4 gates. Never introduces a new action; only shifts traffic among approved ones.

Adopted last, because without L2 labels and an L3 gate there is no way to distinguish adaptation from drift.

## Improvable artifacts

Each row is a versioned artifact with its own evaluation history. Nothing outside this table is self-improving.

| Artifact | What it governs | Improves from | Level |
| --- | --- | --- | --- |
| Memory items | What the organization knows | Ingestion, reflection over episodes | L1 |
| Retrieval ranking weights | What is recalled at decision time | `memory_retrieval_log` joined to decision acceptance | L3 |
| Worker prompts | Draft, extraction, and classification quality | Evaluation cases mined from edits and rejections | L3 |
| Judge rubrics | How automated quality scoring is applied | Human-labeled holdout | L3 |
| Playbook eligibility and priors | Which plays fire, for whom, with what expected effect | Outcome measurements | L4 |
| Impact and confidence calibration | Whether the platform's own numbers can be trusted | Predicted versus actual, per playbook | L4 |
| Policy thresholds | What requires a human | Approval and reversal history | L4 |
| Model routing | Cost per accepted output | Quality, latency, and cost per worker | L3 |

Two artifacts deserve explicit note.

**Judge rubrics are artifacts.** An automated quality score is itself a model output and drifts like any other. It is re-calibrated against a human-labeled holdout on a schedule, and a judge that fails calibration invalidates every gate decision made with it since the last passing calibration.

**Policy thresholds are the most sensitive artifact in the table.** Loosening an approval requirement is a governance change. It is never auto-promotable regardless of evaluation delta.

## The gate rule

A `learning_proposal` is promoted to an `artifact_version` only when **all** of the following hold:

1. **Positive delta.** The proposal outperforms the incumbent on the artifact's declared primary evaluation metric, on a frozen evaluation set.
2. **No holdout regression.** It does not regress on a held-out set that was not used to generate the proposal.
3. **No guardrail regression.** No declared guardrail metric is worse, including schema validity, policy violation rate, unsupported-claim rate, and latency.
4. **Cost within budget.** The projected cost delta stays inside the organization's model budget per `context/17-observability-cost-governance.md`.
5. **Risk class permits it.** The artifact's risk class is auto-promotable under ADR 0007. Policy thresholds, spend limits, and anything affecting customer-facing communication are never auto-promotable.
6. **Serialized.** At most one artifact is promoted per organization per cycle. Two promotions in the same window make both outcomes uninterpretable.
7. **Rollback recorded.** The superseded version is retained and the new version stores a pointer to it before it takes effect.

Anything failing any condition queues for human review with its evaluation report attached. A proposal is never partially applied.

Post-promotion, a monitoring job compares live guardrails against the pre-promotion baseline and automatically reverts to the recorded rollback target on breach.

## What must be logged at decision time

The following cannot be reconstructed after the fact and must be written when the decision is made, not later:

- **Candidate set.** Every action considered, not only the one chosen.
- **Propensity.** The probability with which the chosen action was chosen.
- **Exploration flag.** Whether the choice was deliberate exploration rather than the ranked best.
- **Version tuple.** The exact artifact versions in force: prompt, policy, playbook, ranking weights, and model.

Without the candidate set and propensity, the logs only contain outcomes for actions the system already believed in, and every estimate fitted to them is confounded by its own past preferences. Without the version tuple, an outcome change can never be attributed to a cause.

There is no backfill for a counterfactual. This is why `specs/011-learning-ledger.md` lands with Decision Engine V1 rather than with the optimization work that eventually consumes it.

## Scale honesty

At single-organization volume, most effects worth claiming are smaller than the platform's ability to detect them within normal week-to-week variance.

Consequences that are accepted deliberately rather than engineered around:

- **L1 and L2 carry the early product.** Daily improvement in the pilot phase comes from accumulating knowledge and capturing human feedback, not from statistical learning. This must be stated plainly in internal reporting so that an accumulating memory is not mistaken for a learning model.
- **Partial pooling, not per-tenant fitting.** Playbook-level priors are shared across organizations and shrunk toward the prior, with per-tenant evidence gaining weight only as it accumulates. Cross-organization aggregation is subject to the privacy rules in `context/11-playbooks-and-experiments.md` and requires a minimum contributing-organization floor.
- **Inconclusive is a correct verdict.** Applied honestly, the evidence rules in `AGENTS.md` will produce `inconclusive` for a large share of activity. Suppressing that verdict to produce a satisfying number is prohibited.
- **Fixed windows are honored.** A nightly job must not re-read a fixed-horizon experiment looking for significance. Either the declared measurement window is respected, or a sequential design is declared before the experiment starts. See `specs/014-switchback-experiments.md`.

## Feedback-loop hazards

**Self-consumption.** AI-authored content must never become an input to artifact optimization. `memory_items.source_tier` already ranks `ai_proposed` and `outcome_learned` at the lowest tier; the learning system additionally excludes them from evaluation sets and proposal inputs unless a human verified the item or an outcome measurement confirmed it.

**Selection bias.** Outcomes are observed only for actions taken. Mitigated by propensity logging, a small deliberate exploration budget, and holdouts.

**Judge drift.** Covered above; judges are artifacts and are gated like any other.

**Co-promotion confounding.** Covered by gate rule 6.

## System scorecard

Self-improvement is unfalsifiable without an instrument. The following are reported per organization per day, and exist **before** any optimization job is built:

- Proposal acceptance rate, and edit distance on accepted drafts.
- Retrieval precision at k, derived from `memory_retrieval_log` joined to the items cited in accepted decisions.
- Decision-to-validated rate, and the share of outcomes returning `inconclusive`.
- Guardrail breach count and auto-rollback count.
- Cost per validated opportunity.
- Evaluation set size and age per artifact.

A degradation in any of these is treated as an incident, not as noise.

## References

- `adrs/0013-gated-artifact-learning.md`
- `specs/011-learning-ledger.md`
- `specs/014-switchback-experiments.md`
- `context/08-decision-engine.md`
- `context/16-testing-evaluation.md`
- `context/11-playbooks-and-experiments.md`
- `specs/004-business-memory.md`
- `adrs/0011-business-memory-read-through-facts.md`
