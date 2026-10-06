# ADR 0062: Tiered question context for autonomous campaign research

## Status

**Proposed — 2026-09-16.** Not accepted. It records the Campaign autonomous-question
swarm's working decision on what a derived question may be built from, and becomes
binding when the user accepts it together with the worker supply side in
`src/trigger/campaigns.ts` (Agent D) and the service-side read (Agent C).
Agent A owns the ordering implementation; this ADR records the rule it implements.

## Context

The NULL-branch deriver (ADR 0061) was blind: a run admitted without a staged
question derived its scope from the pinned Business Memory manifest and the trigger
kind only, with a hardcoded unprofiled source (`"Unprofiled organization."`, empty
objectives/capacity/constraints). The platform already owns richer scope material
at derivation time — the Digital Twin current state (profile, objectives,
verified-fact capacity notes, hard constraints) and the Growth Intelligence
channel recommendations with their human decision states (endorsed, untouched,
dismissed, snoozed) — and never consulted it at question time. So a derived
question could ignore an endorsed recommendation the organization already asked to
plan, or — worse — resurrect a recommendation a human already dismissed as a
brand-new question.

## Decision

### The ladder

When no staged question governs, the derivation scope is chosen down this ladder,
first non-empty rung wins, goals last:

1. **Business memory** — pinned manifest entries with non-empty bodies.
2. **Endorsed GI picks** — recommendations ordered planned > acknowledged >
   helpful-true (newest first within rank).
3. **Untouched GI picks** — recommendations with no decision (helpful-false with
   no decision counts as untouched, not interacted).
4. **Org details** — Digital Twin profile, verified facts, hard constraints.
5. **Goals** — organization objectives, last resort before admitting nothing.

When every rung is empty the scope is `none`: the run derives nothing and fails
honestly rather than inventing scope.

### Exclusion rule

Dismissed and snoozed picks are **never resurrected** — not even when newest, not
even when marked helpful. A human "no" stays a "no"; only a fresh recommendation
row may bring the topic back.

### Caps and provenance

- The worker reader caps at 20 raw picks (newest first); ordering caps at 6.
- The chosen tier travels in the derivation provenance alongside sourceIds,
  modelId, and derivedAt, so any derived question is attributable to the rung
  that supplied it.

### Spending

No allowance logic changes. Derivation inference stays metered, never gated
(ADR 0061): logged cost, no new gate, no threshold or currency change.
No migration.

## Consequences

- Derived questions reflect what the organization already endorsed first, fresh
  untouched material second, and bare goals only when nothing better exists —
  with gaps declared instead of hidden.
- A dismissed recommendation can never return wearing a new question; the
  exclusion is deterministic and tested, not a prompt wish.
- Every derived question names its tier, so reviewers can check the reasoning
  without trusting it.

## Alternatives

- **Prompt-only instruction** ("prefer endorsed picks, avoid dismissed ones") —
  rejected. A sentence in a system prompt is unenforceable: no test can prove
  what the model weighed, and a single ignored instruction resurrects a human
  "no". The ladder and the exclusion are deterministic code with tests.
- **Single-source scope** (memory-only, or picks-only) — rejected. Memory is
  absent for new organizations; picks are absent before the first analysis run.
  Either source alone strands runs that the ladder serves from org details or
  goals. The ladder degrades gracefully instead of failing where material exists.

## Tenant isolation note

- Both worker readers repeat the organization id on every query
  (`channel_recommendations`, `channel_recommendation_decisions`,
  `channel_recommendation_feedback`, plus the Digital Twin state read), so
  tenancy holds by explicit predicate even though the service client bypasses
  RLS. The service runs these readers only while the run holds its claim
  (`assertClaimLive` gates the contexts path beside them).
- Titles and bodies travel to the deriver only — never to logs, which keep the
  `derived` boolean alone. Provenance carries entry/recommendation ids and the
  tier — never another tenant's text.

## References

- Implemented by: `specs/025-campaign-experience-and-marketing-loop.md` (Research
  admission, D06 — a press of "Request a campaign" authorizes spend within
  policy and nothing else)
- Extends: `adrs/0061-autonomous-research-question-and-metered-tokens.md`
  (derivation + metered tokens); both gates of
  `adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md` stand
- Related: `src/trigger/campaigns.ts` research task (`readSourceForDerivation`,
  `readRecommendationPicks`), `src/modules/campaigns/application/research-service.ts`
  NULL branch (Agent C), ordering implementation + tests (Agent A)
