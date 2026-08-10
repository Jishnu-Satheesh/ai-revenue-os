# ADR 0013: Make the improvable surface data, not code, and require a promotion gate

## Status

Accepted; implementation not started.

## Context

`context/00-vision.md` names the compounding system as the moat and `context/08-decision-engine.md` ends its loop with "measure and learn". Neither document says how learning is applied, and the gap admits two very different implementations.

The first is a system that adjusts its own behavior directly: a scheduled job rewrites a prompt in place, retunes a ranking weight, or relaxes an approval threshold, and the system behaves differently the next morning. This is the common reading of "self-improving", and it violates rules the repository already treats as non-negotiable. `AGENTS.md` requires every AI action to be explainable, attributable, auditable, measurable, and reversible where practical, forbids business-critical policy living only inside prompts, and forbids autonomous budget, price, discount, or public-brand changes beyond configured policy. A behavior change with no recorded cause satisfies none of that.

The second is a system in which judgment is stored as versioned data and scheduled jobs propose replacements that must pass an offline gate. Business Memory already implements exactly this shape for facts. Provider divergence from a current fact becomes a `fact_proposal` rather than a write, `memory_items.source_tier` ranks AI-authored content lowest, and promotion into `business_facts` happens only through a governed transition (ADR 0011). The learning system has no reason to invent a second pattern.

There is also a timing problem that is independent of which pattern is chosen. Learning from a system's own logs requires the candidate set, the propensity of the chosen action, an exploration flag, and the artifact versions in force, all recorded at decision time. None of these can be reconstructed afterward, because the counterfactual was never observed. `context/20-roadmap.md` placed learning in Milestone 7, which would have meant accumulating months of decision history that is unusable for the purpose it was collected for.

A third consideration is scale. The pilot is a single organization. Statistical learning at that volume is not available for months, and a design that assumes otherwise will either sit idle or manufacture significance by re-reading fixed-horizon experiments until they look positive.

## Decision

- **The improvable surface is data, not code.** Prompts, retrieval ranking weights, playbook eligibility and priors, impact and confidence calibration, policy thresholds, judge rubrics, and model routing are versioned rows with evaluation history. Anything not enumerated in the artifact table in `context/21-learning-system.md` does not self-improve.
- **Scheduled learning jobs write proposals, never mutations.** A learning job's only write is a `learning_proposal` row. It has no authority to change live behavior, mirroring the `fact_proposal` boundary in ADR 0011.
- **Promotion is a separate, gated act** requiring all seven conditions in the gate rule: positive delta on a frozen evaluation set, no holdout regression, no guardrail regression, cost within budget, an auto-promotable risk class under ADR 0007, one promotion per organization per cycle, and a recorded rollback pointer. Failure of any condition queues the proposal for human review rather than applying it partially.
- **Policy thresholds are never auto-promotable.** Loosening an approval requirement is a governance change and requires a human regardless of evaluation delta.
- **Judge rubrics are artifacts** and are re-calibrated against a human-labeled holdout on a schedule. A judge that fails calibration invalidates gate decisions made with it since its last passing calibration.
- **AI-authored content is excluded from artifact optimization inputs** unless a human verified it or an outcome measurement confirmed it.
- **Decision-time logging lands with Decision Engine V1**, not with the optimization work. `specs/011-learning-ledger.md` defines the candidate set, propensity, exploration flag, and version tuple as required fields on every decision record.
- **The system scorecard ships before any optimization job**, so that improvement is falsifiable from the first day it is claimed.
- **Adoption is ordered by the five levels** in `context/21-learning-system.md`. Online adaptive allocation is last and may only shift allocation among variants that have already passed a gate.

## Consequences

- Every behavior change has a row, a diff, an evaluation report, an actor, and a rollback target. The improvement loop is itself auditable and reversible, which satisfies the platform's own rules at the meta level rather than only at the action level.
- Improvement is slower than direct self-modification and deliberately so. A proposal that would help must still wait for the gate.
- The gate is only as good as the evaluation sets behind it. Small or stale sets produce confident promotions of nothing, so evaluation set size and age are scorecard metrics rather than implementation details.
- Decision Engine V1 carries instrumentation cost for a capability it does not use. This is accepted because the alternative is unrecoverable.
- `context/20-roadmap.md` is amended: Milestone 5 owns instrumentation, Milestone 7 owns optimization.
- Serializing promotions limits throughput to roughly one artifact change per organization per cycle. At pilot scale this is not a constraint; at portfolio scale it will require per-artifact-class scheduling.
- Storing every candidate set and version tuple grows decision storage substantially faster than storing chosen actions alone, and needs a retention policy.
- Excluding AI-authored content from optimization inputs means the system cannot bootstrap from its own output. Early evaluation sets will be small and human-dependent, and that dependency is the point.
- Honest gating will report `inconclusive` frequently at pilot scale. Product surfaces and client reporting must present that verdict as a legitimate result rather than a failure.

## References

- `context/21-learning-system.md`
- `specs/011-learning-ledger.md`
- `specs/014-switchback-experiments.md`
- `adrs/0011-business-memory-read-through-facts.md`
- `adrs/0007-risk-based-human-approvals.md`
- `context/08-decision-engine.md`
- `context/16-testing-evaluation.md`
- `context/17-observability-cost-governance.md`
- `context/20-roadmap.md`
