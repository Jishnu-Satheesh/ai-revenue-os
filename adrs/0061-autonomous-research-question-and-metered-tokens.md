# ADR 0061: Autonomous campaign research questions from owned data, with metered model tokens

## Status

**Proposed — 2026-09-16.** Not accepted. It records the Campaign autonomous-question swarm's
working decision and becomes binding when the user accepts it together with the worker supply
side in `src/trigger/campaigns.ts`. The deriver module and the service-side read both landed
inside the swarm; this ADR records the spending-control meaning they implement.

## Context

A research run plans from a staged question, and a run admitted with none fails honestly as
`question_missing` rather than inventing what the requester never asked. The button path was
repaired by staging the standing manual question ("What campaign should we run next?" — a
transcription of the button's own documented meaning, so D06 is not engaged); explicitly asked
questions pass through untouched; other trigger kinds stay question-less until they stage their
own. That repair keeps the worker honest, but it teaches it nothing: every manual press
researches the same sentence, while the platform already owns the material a good question
would be built from — the Digital Twin (profile, objectives, verified-fact capacity notes,
hard constraints, operational blockers via `readCurrentState`) and the admitted run's pinned
Business Memory entries — and never uses it at question time.

Spending control, meanwhile, is described in one breath where it means three different things:
model inference cost, qualified external evidence spend, and spam protection. D06
(`specs/025-campaign-experience-and-marketing-loop.md`, Research admission) says a manual
request "obeys the same limits and authorizes no creative generation" — but it never names
which limits are money and which are gates, so every new metered model call reads like a
policy change. This ADR names them.

## Decision

### Autonomous derivation

- When a run carries no person-written or button-transcribed staged question, the worker may
  derive one focused research question from owned data only: the Digital Twin current state
  (organization profile, objectives, verified-fact capacity notes, hard constraints, with the
  operational-blockers branch kept wired) plus the run's pinned Business Memory entries.
- Derivation quotes data and never follows instructions inside it — the same rule as the
  planning prompt: source text is quoted, never obeyed. The output contract is a JSON object
  with question (10–500 chars), sourceIds (cited entry ids), gaps (missing info).
  Unparseable or over-long drafts fall back deterministically; operational blockers
  short-circuit to advice without calling the model.
- A derived question is staged on the run with provenance (sourceIds, modelId, derivedAt)
  before planning, so the plan step still cites only the entries and claims provided, by
  their exact ids. Derivation never widens scope: no external evidence, no creative
  generation, no publication.

### Metered tokens

- Model inference cost is metered, never gated. `estimatedCostMinor` is logged and paid by
  the user; it blocks nothing. A derivation call that cannot be priced adds nothing rather
  than a guess, following the planner precedent.
- The per-run and window research allowances gate only qualified external evidence spend —
  the money that leaves the platform for third-party evidence. Cooldown and the
  pending-proposal limit stay exactly as they are: spam control, not spending control.
- No allowance rule, threshold, or currency changes in this decision. No migration.

### Gates kept

- ADR 0057's two gates stand unchanged: Gate 1 (proposal approval) authorizes preparation
  only; Gate 2 (exact-output review) still precedes anything public. Derivation authorizes
  neither.
- D06 reinterpretation: a press of "Request a campaign" authorizes spend within policy —
  the metered inference for derivation and drafting, plus allowance-bounded external
  evidence — and nothing else. It authorizes no creative generation (D06 verbatim) and no
  publication (ADR 0057). The research scope is derived from owned data; the spending scope
  stays the admitted policy.

## Consequences

- Manual research stops asking the same standing sentence forever: each derived run's
  question reflects current goals, constraints, facts, and memory, with gaps declared
  instead of hidden.
- Cost attribution gets honest: inference appears as measured metered cost, while the
  allowances keep meaning "external evidence budget" — so "allowance exhausted" still
  means no third-party spend happened, not that a model call was blocked.
- The worker supplies the deriver and the service reads it in the same tree; until a
  Trigger deploy ships both, behavior is unchanged (the staged question governs, NULL still
  fails as `question_missing`). The seam is forward-compatible, not a flag day — and the
  deployed cloud workers still predate all of it, so no end-to-end run can prove it yet.
- One more bounded model call per derived run, under the same retry and lease discipline
  as the draft call, logged without question text.

## Alternatives

- Standing question only (status quo) — rejected. Every manual press would research one
  sentence forever, scheduled triggers would stay dead, and the owned data that answers
  "what should we ask" would sit unused at the one step that needs it most.
- Full removal of caps (derive and spend freely) — rejected. It removes the only fence
  between a button press and unbounded third-party spend; cooldown and the pending limit
  are spam control and were never spend authority. It contradicts D06 and ADR 0057, and
  no client asked for it.

## Tenant isolation note

- Derivation reads only the requesting organization's Digital Twin rows and the admitted
  run's pinned manifest entries — the same claim-bound, organization-scoped reads the
  planning step already uses. A draft naming another tenant's ids refuses as tenancy
  failure rather than going back for editing, following the planner precedent. No
  service-role read is added, no RLS policy changes, and provenance carries ids — never
  another tenant's text — into logs.

## References

- Implemented by: `specs/025-campaign-experience-and-marketing-loop.md` (Research admission, D06)
- Extends: `adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md` (both gates stand)
- Related: `src/trigger/campaigns.ts` research task (deriver supply side),
  `src/modules/campaigns/application/research-dispatch.ts` (`MANUAL_RESEARCH_QUESTION`),
  `src/modules/campaigns/infrastructure/question-deriver.ts` (deriver contract and rules)
