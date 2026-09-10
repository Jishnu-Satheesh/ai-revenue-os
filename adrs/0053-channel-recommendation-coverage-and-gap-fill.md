# ADR 0053: Narrator covers every chapter with data, and empty chapters get a retry

## Status

Accepted. User-approved fix (2026-09-10) for the March Talabat gap, forward only.
Implemented on `feat/governed-channel-intelligence` as narration prompt version 8,
a gap-fill second narration, and a per-run cap of 8 items. ADRs 0050–0052 stand as
history. The March Talabat run (`72a4cbe1`) keeps its two bare chapters permanently:
no backfill, by explicit user call.

## Context

The March 2026 Talabat run filed 5 items citing four chapters' findings and left
the funnel and retention chapters bare, although both held real observation
findings and a free slot remained (5 of 6). The narrator simply chose other
findings; nothing required it to cover every chapter. The workspace then showed
"No advice was written for this section in this run" on both chapters with no
way forward: the generate button renders only when a run has zero narrations,
and the `claim_channel_recommendations` fence answers `completed` to any second
submission for an already-narrated run, so even a hand-made retry press writes
nothing. The user verdict was both: the narrator must cover every section with
data, and empty sections need a manual retry.

## Decision

- Coverage rule (prompt v8): every chapter holding observation findings gets at
  least one citing item. The six detector chapters are cancellations,
  availability, funnel, retention, money, and trust. The `needs_data` rule is
  unchanged: missing inputs still never become recommendations.
- Cap 6 to 8: six chapters plus two spare slots for `needs_data` notes, so
  coverage never forces a trade-off between a chapter and an honest data gap.
- Gap-fill narration: one second submission per run, restricted to findings no
  existing item cites. The fence gains a new outcome for an acquired gap-fill
  claim instead of the silent `completed`; the lease, conflict, and attempt
  guards are unchanged. The route accepts presses on narrated runs only while
  uncovered chapters remain, under the same `report.retry` permission and the
  same completed-run check. The workspace shows a per-section generate button
  only on uncovered chapters, only to members who may retry.
- Coverage is checked deterministically, not by the judge: the finding-to-chapter
  mapping is fixed (`WORKSPACE_CHAPTERS`), so the worker logs uncovered detector
  keys and the fence enforces the uncited-only restriction. The judge stays at
  version 3 — this deviates from the approved plan's judge-coverage sketch, for
  the reason above: deterministic code for known logic, models only for judgment.
- No backfill: runs narrated under prompt v7 keep whatever they filed.

## Alternatives rejected

- Keep the cap at 6 and force trade-offs — rejected; it guarantees repeats of
  the March gap whenever needs-data notes compete with chapters.
- Allow an unrestricted second full narration — rejected; it doubles model cost
  and could file items contradicting the first narration. Gap-fill cites only
  previously-uncited findings, so the two narrations cannot overlap.
- One worker run per chapter — rejected; it multiplies dispatches and leases
  for a gap one extra submission already closes.

## Consequences

- Prompt v8 and the cap of 8 apply to every future run on all channels; the
  section 14 no-tools exception is unchanged (gap-fill grounds exactly like a
  first narration, user-consented, findings the only cited evidence).
- One new migration, live on push; the Trigger worker must be redeployed or
  gap-fill claims sit unclaimed — the section button stays hidden until the
  worker version confirms, so no dead button ships.
- The one-narration-per-run era stays readable: silence after the first filing
  was the rule, gap-fill is the named exception, and the March run is the
  example of why.
