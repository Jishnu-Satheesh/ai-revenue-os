# ADR 0039: Advise freely, execute narrowly

## Status

Accepted. Amends the prohibition in `AGENTS.md` section 6 on declaring business
impact, and adds the advisory rule to section 2. Supersedes the reasoning behind
the two hardcoded refusals described below.

## Context

The Decision Engine has never produced an opportunity. Not because it is
unfinished — it is roughly four thousand lines with near-complete test coverage,
three fenced RPCs, leases, cancellation, and a Meta playbook — but because two
of its evidence gates are closed by construction:

- `load_campaign_decision_context` overlays
  `evidence.measurement_plan_registered = false`, with the comment "No governed
  baseline and attribution plan is registered yet."
- `mapCampaignEvidence` sets `impactEvidence: null`, with the comment "Governed
  impact arithmetic/comparable-intervention evidence does not yet exist."

`campaign-opportunity-source.ts` then refuses on any missing evidence key:

```ts
if (missingEvidenceKeys.length > 0) {
  return { outcome: "needs_data", missingEvidenceKeys, missingCapabilityKeys };
}
```

So every cycle returns `needs_data`, `/opportunities` is empty, and the campaign
module — the largest in the repository at ten thousand lines — has never been
given anything to act on.

Each of those refusals was written in good faith to honour section 6's
prohibition on declaring business impact without a baseline, an attribution
method, and a measurement window. But that prohibition governs **claims about
what happened**. It says nothing about proposing an action, and nothing about
estimating a range. The implementation conflated three separate things and
applied the strictest of them to all three:

1. proposing an action,
2. estimating its likely impact,
3. claiming a realized, attributed result.

Only the third is what section 6 was written about. The engine required the
evidence apparatus of the third before it would perform the first.

The decisive argument is the client's. Restaurant operators on this platform
cannot perform their own data analysis; that incapacity is the reason the
product exists. A system that computes "you were closed for 48.3% of your
scheduled hours" and then declines to say what recovering those hours is
plausibly worth has not been rigorous. It has handed the analysis back to the
person who cannot do it, and called the silence a standard.

## Decision

### The fence moves from advice to execution and to realized claims

A recommendation may be made whenever the evidence supports one. It carries the
citations that produced it, so the operator can check the reasoning rather than
trust it. Nothing about the quality of a proposal depends on whether its impact
has already been measured.

### An estimate is not a measurement, and is permitted

A forward-looking estimate may be offered when two conditions hold: its inputs
are cited, and its assumptions are stated on the same surface as the figure. It
is labelled an estimate. "Recovering half of your closed hours at your observed
average order value would be worth roughly X" is an estimate with a visible
method; "this recommendation earned you X" is a realized claim and still
requires a registered baseline, an attribution method, and a measurement window.

The distinction is not the size of the number or its confidence. It is the
tense. A claim about the past asserts something happened and can be wrong about
history; an estimate proposes something might happen and is honest about being
a projection.

### Missing evidence qualifies a proposal rather than suppressing it

`missingEvidenceKeys` becomes two sets. **Blocking** gaps still refuse: a
currency disagreement between components, a margin firewall breach, a missing
capability grant, evidence that is stale beyond the playbook's freshness bound.
These describe a proposal that would be wrong or unsafe, and a wrong proposal
is worse than none.

**Qualifying** gaps no longer refuse: no registered measurement plan, no
computed impact range, no approved impact source. These describe a proposal
whose *outcome cannot yet be measured*, which is a fact about our instrumentation
rather than a defect in the advice. The proposal is emitted and states its own
limits.

### What does not change

Section 2's separation of decision from execution stands. No model may call a
destructive or money-moving tool. No autonomous budget, price, discount, or
public-brand change beyond configured policy. Every AI output remains
schema-validated, attributable, and auditable.

These were never what blocked the engine. Nothing in the opportunity path
executes anything: it writes a proposal to a table a human reads. Loosening them
would buy no capability and would give away the property that makes the advice
safe to act on.

## Consequences

`/opportunities` can show proposals for the first time, each carrying its
citations and, where impact is not yet measurable, saying so in its own words
rather than by being absent.

The measurement stack — specs 011, 013, 014, 016 — stops being a precondition
for the product working at all and becomes what it should always have been: the
thing that upgrades an estimate into a measured result. `campaign_measurement_plans`
already exists and is empty; registering plans into it now improves proposals
instead of unblocking them.

The risk accepted is that an operator acts on an estimate that proves wrong.
That risk is mitigated by the citation requirement and by the labelling rule,
and it is smaller than the risk this decision removes — a platform that charges
for analysis and then declines to give any.

A second risk is drift: "estimate" is easier to write than to justify, and a
future surface could fill with confident projections whose assumptions are one
click away instead of on the page. The assumptions-on-the-same-surface condition
is the guard, and it is a review point, not a runtime check.
