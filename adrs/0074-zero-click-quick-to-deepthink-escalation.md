# ADR 0074: Zero-click Quick → DeepThink auto-escalation (L1)

## Status

Accepted (2026-09-27). Implements Task B2 of
`docs/superpowers/plans/2026-09-27-agent-task-b-autonomy.md`. Amends spec
§6/§8 of `docs/superpowers/specs/2026-09-24-universal-ai-agent-design.md`.

## Context

Platform clients are busy running their businesses and will not operate the
platform. Every research read behind a confirmation card is a click the
client never asked for — and Task B1 already put the calibrated router
(high/medium/low rubric, fail-closed) underneath, so the judgment is now
trustworthy enough to act on within grants.

## Purpose (binding)

The agent is the client's org Admin, acting in natural language with no
extra clicks — always within the caller's own role grants.

## Decision

Tiered autonomy doctrine (applies to B2–B4):

- L1 answer-escalation + L2 bounded research run zero-click.
- L3 watches/drafts are auto-prepared; exactly one inline tap creates.
- Approval/publish fences are untouched: a tap creates, never approves,
  never spends, never publishes.

B2 (this ADR) implements L1: a Quick thread whose message the router reads
as `research_once` with high/medium confidence flips to DeepThink
server-side for `growth_intelligence.manage` holders — no nudge card, no
tap. The router mints `DEEPTHINK_AUTO_ESCALATED` as the flip signal and
the thread service applies the server-owned mode flip to the returned
thread. Deterministic code owns the transition; the model only classifies.

Grant matrix (the agent never exceeds caller grants):

- Manage-holders escalate silently.
- Viewers stay read-only (`answer_memory` + `VIEWER_RESTRICTED`, never flip).
- Operators without the grant stay Quick with an honest note
  (`answer_memory` + `RESEARCH_REQUIRES_MANAGE`, rendered inline).

Confidence handling: high acts; medium acts with the assumption stated
inline in the routing note (deterministic platform copy — the proposal
carries no free text); low answers from memory with an honest note and
never guesses. Missing research scope still asks first via the generic
missing-fields card — the flip fires only on the direct route, never
blind. Genuinely ambiguous messages keep their clarify card.

The `deepthink_upgrade` questionnaire kind is deprecated: the router never
mints it for new turns, but old rows and saved specs still parse, render,
and submit.

## What reverses

Confirm-before-spend for L1/L2: spec §6 ("User confirms before any spend")
and router ruling T3a (Quick-never-spends nudge). L3 keeps its one tap;
approval/publish keep full confirmation. Rollback restores the nudge card
(the enum entry and card renderer stay in place, so rollback is a router
branch, not a rebuild).

## Consequences

- The flip is in-memory on the route response: RLS is forced with no
  thread-mode write policy and no mode RPC exists, so no migration was
  taken. The drawer holds the escalated mode for the session
  (`resolveLiveThread` merges it over the 3s poll, which still owns links
  and status). A reopened thread reads the persisted Quick row until its
  next route re-escalates — known limitation, marker returns on send.
- The answers-submit response carries no thread, so an escalation reached
  via a missing-fields re-route surfaces its codes but not the marker
  until the next send. Follow-up if B3 needs it surfaced there.
- No new events (`agent_thread.routed` carries the new code), no new
  dependencies, no schema change.
