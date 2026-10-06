# ADR 0066 — Trailing reported window replaces the complete-month baseline

## Status

Accepted 2026-09-21. Reverses the baseline half of ADR 0064 / data-contract D03
(2026-09-18). Display-actuals semantics (D05), the frozen document shape (D04),
the publication RPC and the schedule grid are unchanged.

## Context

The original rule froze each projection from the complete prior calendar month,
proven by exact cover: one missing day voided the month, and a new
organization waited out a full calendar month before its first projection.
That is honest but useless — a client watching a live business should see
roughly where it stands within days of reporting, not months.

## Decision

- Baseline = the observed daily mean over the 30 local days ending at the
  source cutoff, scaled to a 30-day standard month, from reported days only.
- A day counts as reported only when every frozen partition covers it exactly
  once at the finest granularity available. An exact day cover wins over a
  coarser containing span; a single containing span contributes its amount
  spread over its own reported days; disagreeing covers of one day refuse the
  candidate instead of picking a winner.
- Floors: at least 7 reported days (GROWTH_BASELINE_MIN_REPORTED_DAYS), latest
  reported day within 45 days of issue, uniform currency, conflict-free.
  Below any floor the worker skips honestly with BASELINE_INCOMPLETE/STALE.
- Every document carries the coverage in its limitations, e.g.
  "Baseline from 21 reported days (ending 2026-09-21); missing days excluded,
  monthly pace scaled from the observed daily mean."
- The spread is mean arithmetic only. It never creates daily actual
  observations: D05 still governs what blue draws, and the frozen document
  stores no per-day baseline breakdown.

## Consequences

- New organizations publish within ~a week of reporting; gapped months
  publish scaled and labelled rather than vanishing.
- Frozen rows stay immutable and single-purpose; the 7-day floor and the
  conflict refusal bound how wrong an early baseline can be, and the label
  says exactly what it rests on.
- No migration: the document schema already admits any valid window range.

## Amendment — fallback ladder (accepted 2026-09-21)

When the 30-day window holds fewer than 7 reported days, the worker widens
rung by rung — 14 reported days in the trailing 60 days, 21 in 90, 28 in
120 — and builds at the first rung that qualifies. Older data earns its
place with more of it; the 45-day freshness bound, uniform currency and
conflict-free coverage apply to every rung, and a rung that cannot trust
its days refuses outright instead of widening past the defect. Rejected:
lowering the floor below 7 (frozen fiction), interpolating gaps (invented
money), confidence-interval bands (schema and display expansion for a
problem a limitation line already carries). An empty window still refuses
at every rung: the ladder helps sparse reporters, never conjures data.
