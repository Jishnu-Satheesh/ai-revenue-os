# ADR 0031: The first shipped detector slice

## Status

Accepted. Implements `specs/018` sections 11.1 and 11.3 for four core-owned
detectors, and defers the rest of the section 11.2 catalogue with reasons.

## Context

`specs/018` section 11.2 describes roughly fifty detector families for the
Restaurant Pack. Almost none of them can run today. The metric registry holds
`revenue.gross`, `transactions.count`, `units.count`, three delivery keys, and a
Restaurant Pack vocabulary that the governed report path does not populate — and
Channel Economics is not fed by a governed projection at all. A detector
registered against a metric nothing writes answers `needs_data` forever and
teaches an operator nothing, while making the platform look as though it is
analysing something.

What the report path does now demonstrably produce, after ADR 0029 and ADR 0030,
is a period-grain `revenue.gross` series per channel and branch, the projection
runs that wrote it with their recorded blank counts, and the reconciliation
records that hold colliding evidence back from every rollup.

## Decision

### Four detectors ship, chosen by what the evidence can support

- `evidence.period_coverage` — which whole periods in a window carry current
  governed evidence and which do not.
- `evidence.reconciliation_blocked` — evidence held for an owner or admin
  decision, named by the reconciliation record so the decision is findable.
- `revenue.period_movement` — period-over-period movement in `revenue.gross`
  for one channel, from the period-grain series only.
- `revenue.channel_share` — each channel's share of gross revenue in a window.

The first two come before the last two on purpose. Telling an operator what
their evidence can and cannot support is the honest opening move; showing them a
trend derived from fourteen of thirty-one days without saying so is not.

Everything else in section 11.2 — every margin, take-rate, fee, funnel, item,
promotion, review, and operational detector — is deferred by name rather than by
silence, because each needs economics inputs or metric vocabulary that no
governed report currently populates.

### A run names one channel or none, and a detector declares which it answers

`channel_analysis_runs.channel_id` is nullable. Two of the shipped detectors
answer a question about one channel; `revenue.channel_share` asks how the
channels compare and has no single channel to bind to. A run therefore names
either one channel or none, each detector declares a `scope`, and the registry
binds exactly the detectors whose scope matches.

The alternative — running a cross-channel detector inside a single channel's
window — would hand it one channel to compare, and running a channel detector
without a channel would hand it every channel's rows as one series. Neither is a
shape a detector can honestly refuse at calculation time, so the refusal is made
where the run is bound.

### All three outcomes are stored, `needs_data` included

`channel_findings.kind` is `observation`, `finding`, or `needs_data`. A
`needs_data` outcome is a record an operator can read, not a silence: absence
reads as "nothing wrong here", which is the opposite of what it means.

### Severity is omitted rather than invented

Severity and priority exist only on `kind = 'finding'`, enforced by a check
constraint and again by the completion RPC. Where a defensible severity rule
does not exist, the detector reports the observation without one.

That is why three of the four detectors emit observations. "Revenue fell by
30,000 fils" is a fact; "a 12% fall is high severity" is a threshold nobody in
this product has agreed to, and putting one in front of an operator under the
platform's own name would be inventing judgement.

The one severity rule that does ship is a case distinction on the evidence
rather than a tuned number: held evidence is `high` when it blocks a period the
window has no other evidence for, and `medium` when every period it covers is
already covered. Severity rules are versioned with the detector, so changing one
is a new calculation version rather than a silent reinterpretation of findings
already recorded.

### A finding may cite only current evidence

Citations into `normalized_metrics` and `exact_range_metric_observations` are
checked at write time for `reconciliation_state = 'current'` and no supersession.
Held evidence is not fact.

A finding may still cite a `report_projection_reconciliations` row, and
`evidence.reconciliation_blocked` exists to do exactly that. The distinction is
the point: the reconciliation record is a fact about the evidence — a decision is
outstanding — while the held figure it points at is not yet evidence about the
business. That detector never reports the held value.

### Monetary impact is declared, not assumed

Each declaration states whether monetary impact is computable and by what exact
method. Only `revenue.period_movement` declares it computable, and its method is
the movement itself in integer minor units. Nothing is extrapolated, modelled,
or annualised.

### The evidence contract refuses rather than reconciles

Two currencies are refused, never converted: a conversion needs a rate, a rate
needs a date and a published source, and the platform has neither. Mixed grains,
mixed recorded timezones, mixed branches, and mixed channels are refused the same
way. `revenue.period_movement` compares only periods adjacent in the calendar,
so a gap produces `needs_data` rather than a comparison that silently treats the
missing period as a zero.

### The write path is fenced exactly like the projection path

`claim_channel_analysis`, `complete_channel_analysis`, and
`fail_channel_analysis` are security-definer, revoked from everyone and granted
to `service_role` alone, with an idempotency row and a lease. The completion RPC
re-checks the detector version against what the run bound, the metric against
what the run resolved, the period against the declared window, the finding's
channel against the run's scope, and every citation against its own
reconciliation state. The worker is not the authority on what may be recorded.

The lease is keyed on the run rather than on the window, because re-analysing a
window is ordinary: new evidence arrives and the same days deserve a fresh
answer. A later run supersedes the earlier answers for the detectors it carried,
and the earlier ones stay readable.

## Consequences

An operator can now be told, in the platform's own records, what their governed
evidence covers, what is waiting on their decision, how gross revenue moved, and
how it splits across channels — with every number resolving to the ledger rows it
came from.

`channel_recommendations` and `channel_recommendation_decisions` are deferred.
They exist to hold a cited model explanation over selected findings under section
11.4. Shipping the tables before the narration path would be dead schema, and
shipping narration on top of an unproven detector layer would put an AI boundary
over numbers nobody has checked in production yet. Section 11.4 already requires
the deterministic finding to remain visible without narration, so nothing is
lost by waiting.

The workspace at `/organizations/[organizationId]/economics/channels/[channelId]` ships from the
approved Superdesign draft, with one route that starts a run. All nine chapters render, and the
seven with no detector say why in their own words: an empty panel reads as "nothing wrong here",
which is the opposite of what an operator should take from a chapter nobody can compute. The page
distinguishes reported, needs data, no detector yet, and not analysed, because all four look
identical as a blank frame and mean different things.

Findings are readable through RLS to anyone holding `report.read`, and are read server-side through
the caller's own session so the database decides visibility. Starting a run needs `report.retry`.

Recommendation triage controls are not shipped. `channel_recommendations` is deferred, and a button
that decides nothing would be worse than no button.

The risk most likely to need revision is the severity rule, which is why it is
versioned with its detector. The risk deliberately avoided is the other one: a
registry full of detectors that look satisfiable and never are.
