# ADR 0069 — Per-partition baselines from available reported days

## Status

Accepted 2026-09-24 (user-approved). Supersedes the affected parts of ADR
0066 (the 7-day floor and the reconciled-only evidence gate); notes ADR 0060
below. Display-actuals semantics (D05), the frozen document shape (D04), the
publication RPC and the schedule grid are unchanged.

## Context

The live-verified nightly refusal (run_06gd49531c279r26angbq4cv01) forced
this rework: rung 1 held 3 reconciled days, below the 7-day floor, and rungs
2–4 died on ghost scope partitions minted from 208 unreconciled rows. The
result was a total refusal across all growth horizons even though the
organization had reported revenue days available. The user approved all four
rework requirements — per-partition baselines, use of the available
reported-day count with a 1-day floor, reporting scope counting as evidence,
and the first rung publishing on its own — plus mandatory honesty labels on
every surface.

## Decision

- Per-partition assessment: each scope partition is assessed independently;
  the baseline covers exactly the qualifying partitions. The frozen document
  scope names those partitions and the surface states coverage per partition.
  Non-qualifying partitions are excluded and named, never silently dropped.
- Floor: minimum 1 reported day at every rung; the first rung with at least
  1 reported day builds on its own. Rung window sizes (30/60/90/120 days)
  and the 45-day freshness bound on the latest reported day are unchanged.
- Reporting-as-evidence: the reconciliation-digest, reconciliation-state and
  quality-tier gates are removed from the revenue-fact readers. Money kind,
  real currency, midnight alignment, empty dimensions, integer safety,
  conflict rules and currency uniformity stay hard gates. Facts sourced from
  unreconciled rows carry an unreconciled provenance flag end to end, from
  reader through frozen document to display.
- Honesty labels compensate for the thinner evidence: frozen documents and
  UI labels state scope partitions, exact reported-day counts with latest
  date, and unreconciled provenance wherever a projected figure appears.
  Uncertainty is labelled, never hidden.
- Refusal vocabulary stays distinct: no-data, conflict, mixed-currency and
  invalid-input refusals keep their own codes and details. A partition-level
  conflict refuses only its partition unless every partition conflicts.

## Relation to ADR 0060

ADR 0060 (transparent action scenario for the home revenue section) remains
authoritative for candidate estimation and the deterministic scenario
arithmetic. Only the baseline input it consumes changes: the monthly level
now comes from per-partition available reported days with unreconciled
provenance under this ADR, instead of the reconciled-only 7-day-floor
window. No display meaning from Spec 027 is relabelled.

## Rejected

- Silently narrowing scope: publishing a baseline that quietly covers fewer
  partitions than the frozen scope claims. Excluded partitions are always
  named on the surface.
- Presenting unreconciled rows as reconciled evidence: provenance travels
  with every fact and label; nothing unreconciled is shown as verified.
- Interpolating gaps or zero-filling missing days (invented money):
  missing days stay excluded and disclosed, as under ADR 0066.
- Confidence-interval bands: a schema and display expansion for a problem
  the coverage label already carries.
- Keeping the total refusal: honest but useless — the snapshot refused all
  horizons while usable reported days existed.

## Consequences

- Horizons publish from the first day of usable reporting, labelled with
  exactly what they rest on; thin baselines (1 reported day scaled to a
  month) are noisy estimates, and the mandatory exact-count label says so.
- Frozen rows stay immutable and single-purpose; the per-partition conflict
  rule and the kept currency/integrity gates bound how wrong an early
  baseline can be.
- No migration: the document schema already admits scope, limitations and
  provenance labelling; Tasks 2–4 implement the builder, assembly/reader
  and publisher/display changes.
