# Glossary

**AI Readiness Score** - Assessment of whether an organization has the data, access, tracking, assets, policies, and operational capacity needed for specific AI capabilities.

**Artifact** - A versioned unit of platform judgment that may be improved over time, such as a prompt, ranking weight, playbook prior, or calibration. Enumerated in `context/21-learning-system.md`. Nothing outside that list self-improves.

**Assertion** - A named, typed predicate an opportunity depends on, such as a freshness bound, margin floor outcome, budget availability, or capability grant. Declared at proposal time and re-evaluated by the Tool Gateway immediately before the side effect, because an approval attested only to the numbers as they stood at approval time.

**Avoided Loss** - Estimated loss prevented by blocking or correcting a plan, computed against an explicit counterfactual and volume basis, capped by window, and never summed with realized incremental gross profit.

**Aggregation Semantics** - The operation declared on a metric definition for combining observations over time and dimensions: `sum`, `ratio_of_sums`, `mean`, `weighted_mean`, `percentile`, or `last`. A definition without one cannot be registered, so no consumer has to guess.

**Baseline** - A versioned, declared function over a metric series, naming its window, aggregation, filters, minimum observation count, and exclusion set. Returns `insufficient_data` rather than a number when the count is not met.

**Business Memory** - Durable structured, episodic, semantic, and procedural context belonging to an organization.

**Candidate** - A playbook version bound to a concrete subject and parameter set. The unit the Decision Engine screens, scores, and ranks.

**Candidate Fingerprint** - A digest over playbook version, subject reference, and parameter digest. Keys suppression, deduplication, and outcome joins. Stable across cycles and deliberately unstable across playbook versions.

**Capability** - Vendor-neutral ability such as publishing an ad or reading orders.

**Carryover Window** - The time for an intervention's effect to substantially dissipate. Sets the minimum switchback block length.

**Completeness Grade** - Trust label on a computed margin: `complete`, `partial`, or `indicative`. An `indicative` margin is never presented as a scalar figure and never used as a decision input.

**Contribution Margin** - Gross revenue minus variable cost components at the same grain. Excludes fixed and overhead cost by design.

**Cost Component** - A registered variable cost that offsets revenue. Component vocabulary is supplied by Industry Packs; the core owns only the structure.

**Control Plane** - Application layer that owns configuration, governance, business state, and user experience.

**Governed Draft** - An internal, reversible Campaign created from a qualified Opportunity through the atomic draft-request path. It freezes the exact evidence, estimate, and assertions the operator saw. It is never generated, approved, scheduled, published, or measured by its creation.

**Draft Request** - The durable per-organization-per-opportunity record (`pending`, `processing`, `completed`, `retryable_failed`, `permanent_failed`, `cancelled`) tracking a governed draft from admission to completion. Concurrent admissions return the same row.

**Decision Cycle** - One evaluation pass for one organization from one trigger, carrying a single correlation ID and a slot budget. Runs sequential single-action decisions until the budget is spent.

**Decision Engine** - System that detects, screens, values, ranks, and explains opportunities. It proposes; it never performs a side effect.

**Digital Twin** - Structured, evolving representation of an organization's business model, branches, data, goals, constraints, policies, and operating state.

**Evidence Tier** - The basis of a value estimate: `computed` from the organization's own arithmetic, `observed` from its measured history, or `prior` from a human-authored playbook prior. Ranks above value in the feed ordering. Values from different tiers are never blended, summed, or compared.

**Execution Plane** - Durable workflow environment that performs validated actions.

**Expected Contribution** - The Decision Engine's only ranking quantity: the point estimate of impact multiplied by confidence, less execution cost, in integer minor units with an explicit currency. Never displayed without its impact range.

**Gross Profit** - Revenue minus relevant variable costs. The exact formula is organization-specific and must be documented.

**Industry Pack** - Modular package of domain entities, playbooks, workers, integrations, metrics, and UI extensions.

**Learning Proposal** - A candidate replacement for an artifact version, with evidence and evaluation results, that has not been promoted. The only row a scheduled learning job may write.

**Margin Floor** - A constraint expressing the minimum acceptable contribution margin for a scope, resolved most-specific-wins across item, category, channel, branch, and organization.

**Metric Key** - A stable dotted identifier for a registered business quantity, such as `orders.count`. The core owns the registry structure; Industry Packs supply the vocabulary. Free-text metric names are never consumed by the Decision Engine.

**Minimum Detectable Effect** - The smallest effect an experiment could distinguish from noise given historical variance and planned duration. Computed and shown before an experiment may start.

**Needs Data** - A decision outcome naming a missing input and a one-step path to supply it. Recorded as a decision, surfaced in the readiness view rather than the opportunity feed, and never converted into an opportunity. A data gap is a platform problem; a breach is a business problem.

**Opportunity** - Evidence-backed proposed action expected to improve a business outcome, carrying an impact range, an evidence tier, assertions, and an evaluation plan. An action with no defensible value estimate is `needs_data`, not an opportunity.

**Playbook** - Versioned strategy connecting eligibility, actions, policies, and evaluation.

**Propensity** - The probability with which a chosen action was selected under the selection rule in force. Recorded at decision time; deterministic ranking records `1.0`. This is the engine's propensity, not the probability the treatment was applied: in a recommendation-only engine the latter also depends on human approval, which is tracked as a separate observed rate.

**Quality Tier** - Trust label on a metric observation or cost component value: `measured`, `derived`, `estimated`, or `assumed`. Mirrors the source hierarchy in `context/09-business-memory.md`. A series reports the weakest tier among its contributors.

**Screening** - Deterministic, set-based elimination of candidates before scoring. Logged as counts and a rejection-reason histogram rather than per-candidate rows, because a candidate eliminated by a threshold is reproducible from the rule and was never a live alternative.

**Signal** - Normalized observation that may indicate risk or opportunity.

**Slot Budget** - The configured maximum of active recommendations less those already active. Sets how many decisions a cycle runs and is the cycle's termination condition.

**Switchback** - Experiment design that randomizes treatment across time blocks within a unit rather than across customers, used where customer-level randomization is impossible.

**Version Tuple** - The set of artifact versions in force when a decision was made. Required on every decision record; without it an outcome change cannot be attributed to a cause.

**Tool Gateway** - Deterministic layer that validates and governs side-effecting provider calls.

**Worker** - Bounded, versioned unit of intelligence or execution with typed inputs, outputs, tools, and policies.
