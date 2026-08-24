# ADR 0040: Who performs the action decides where it lives

## Status

Accepted. Extends ADR 0039, and supersedes the direction of
`docs/superpowers/specs/2026-08-24-decision-engine-unblock-design.md`, which
proposed a second opportunity source inside the Decision Engine. That spec is
correct about the Decision Engine and is retained; it is simply not the cheapest
route to advice a client can act on.

## Context

ADR 0039 moved the fence from advice to execution. The open question was where
advice should then live, because two surfaces could hold it.

The Decision Engine produces opportunities: deterministic, playbook-driven,
carrying an impact range, a confidence rationale, an expiry, an approval path,
guardrails, an evaluation plan, and a candidate fingerprint for idempotent
re-proposal. It feeds the campaign module.

The recommendation slice (ADR 0037, ADR 0038) produces narration over stored
findings: model-written, cited, capped at six per run, triaged by a human through
`acknowledged` / `planned` / `dismissed`, and audited by a scheduled judge.

Building operational advice into the Decision Engine would have required a second
opportunity source, a second playbook, an estimator module, a dispatch route, and
feed changes — because the existing source's shared `generate()` checks
`meta_account_mapped`, `active_goal_metric`, and `action_capabilities_granted`
before it reaches any playbook data. For an organization with no Meta connection,
no goals, and capability grants covering only Google Business Profile reads, all
three refuse regardless of anything ADR 0039 changed.

Meanwhile the recommendation slice already reads findings, is fenced, cites its
sources, carries a human decision vocabulary, and has a workspace surface — and it
was already being built.

## Decision

### The boundary is who performs the action, not how confident we are

**Operator-performed actions live in recommendations.** Marking items out of stock
before service, fixing a check-in routine, sending a first-reorder offer — the
platform executes nothing. There is no Tool Gateway call, no spend, no money
movement, and nothing to approve on the platform's behalf.

**Platform-executed actions live in opportunities.** A campaign the platform runs
with a budget passes through the Decision Engine, its approval path, its
guardrails, and the Tool Gateway.

This is what the guardrails already say. `AGENTS.md` separates decisions from
execution *because of execution*. Where nothing executes, the fingerprints,
approval paths, and spend ceilings buy nothing and only delay the advice.

ADR 0037's reasoning — narration is a separate, untrusted worker so a model
outage cannot corrupt verified numbers — holds exactly where model output can
reach an execution path. For operator-performed advice, it cannot.

### A recommendation may carry an estimate, and the model never writes it

Recommendations gain the fields ADR 0039 requires of an estimate: an impact range
in integer minor units, a basis, assumptions, a confidence rationale, and an
expiry.

**The impact figure is computed by the worker, deterministically, before the model
is called, and passed to it as an input the model may not alter.** The completion
RPC re-checks that the stored impact equals what the worker computed.

This is the load-bearing rule. A model that produces its own impact number would
pass every existing fence — citations, labels, count, digests are all checked, and
arithmetic is not — and would state figures the detectors deliberately refused to
compute. The narrator narrates; it never originates a number.

Version one of the estimator does no modelling at all: it sums the
`monetary_impact_minor_units` already carried by the cited findings, which the
detector layer computed and cited. Basis is `observed` when every contributing
figure came from the provider's own reporting, and `unavailable` when no cited
finding carries one — in which case no impact fields are stored and the
recommendation stands on its prose.

### The Decision Engine is unchanged and waits

Nothing in the decisions module is modified, relaxed, or deleted. ADR 0039 still
applies to it and still helps the day Meta App Review clears. We stop asserting it
can deliver client-visible value this month, which is a scheduling fact rather
than an architectural one.

## Consequences

Advice reaches the client through a path that already exists, is already fenced,
already cites its evidence, and already has a human decision vocabulary. The
marginal work is one additive migration and roughly six fields threaded through a
plan already in flight.

The cost is that two surfaces will eventually answer "what should I do next" — a
recommendation for things the operator does, an opportunity for things the
platform does. That division is defensible and explainable to a client, but it
must be visible in the interface, or it will read as two competing answers.

The risk accepted is that `planned` on a recommendation is a weaker commitment
than an approved opportunity: nothing verifies the operator actually did it. That
is correct for actions we do not perform, and it is the reason the judge
(ADR 0038) matters more here — quality of advice is the only thing we can measure
until an outcome loop exists.
