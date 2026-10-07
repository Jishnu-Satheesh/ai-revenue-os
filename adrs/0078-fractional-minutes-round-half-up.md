# ADR 0078: Fractional provider minutes round to the nearest whole minute

## Status

Accepted by the user on 2026-10-07 as a Tier 3 product decision
(round-to-nearest, halves up). Implements the approved governed-report
September recovery plan.

## Problem

The ledger records counts as whole units, and the projection guard enforces
it: a count numerator must match `^-?[0-9]+$`. Providers measure continuous
quantities in fractions -- Talabat's September export writes scheduled time
as `1139.9833333333333` minutes every day -- so the September and August CSVs
fail projection with `22023 report projection observation evidence is
invalid` (42 offending observations on the September file alone), while
whole-minute June and July files project cleanly. Refusing the import is
honest but leaves real months unmeasurable over sub-minute measurement
noise.

## Decision

- Period-grain count observations round to the nearest whole unit on
  emission, halves away from zero, in string arithmetic only -- the figure
  never passes through floating point.
- Rounding happens once per emitted figure (the period total), never per
  contributing row, so rounding then adding and adding then rounding cannot
  disagree.
- Money (minor units), categorical day counts, and exact-range sums are
  untouched: their numerators are integral by construction already.
- A window total stays within half a unit per contributing period of the
  provider's exact sum; the real-export regression pins this bound.

## Consequences

- September and August Talabat CSVs project instead of refusing; each
  affected day shifts by under 30 seconds, immaterial to every downstream
  money figure and rate.
- Future providers that write fractional counts get the same treatment
  without a new decision, and any caller needing exact fractions must argue
  for it explicitly.

## Rollback

Revert the rounding call; the guard restores the refusal with no migration
and no data change. Already-projected months are never rewritten.

## Verification

- New unit tests in `period-grain-projection.test.ts`: fractional days round
  to nearest, halves round up, multi-row periods round after summing, whole
  days pass through exactly.
- The September CSV replayed through the fixed projector emits 471
  observations with zero guard violations (was 42).
- Real-export regression updated to the rule: whole-unit numerators with
  drift bounded by half a minute per contributing day.
