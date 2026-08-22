# ADR 0029: Projection declarations beyond exact-range sums

## Status

Proposed. Extends ADR 0027 rather than replacing it.

## Context

ADR 0027 limited the first projection declaration language to exact-range
`money` and `count` sums, with no expressions, filters, dimensions, temporal
coercion, or ratios. That was a deliberate floor: ship the narrowest thing that
can be reasoned about, and widen it against real evidence rather than
imagination.

The real evidence arrived. Profiling the pilot client's exports showed that most
of their data is one row per day, not a single period total, and that dates
arrive in at least three encodings across providers. A language that can only
emit one exact-range sum per file can express the minority of the client's
reports and none of their daily series.

## Decision

The declaration language gains exactly three capabilities, and no more:

- **A period grain.** A declaration may state that its output is daily, weekly,
  or monthly, in which case it projects into `normalized_metrics` per
  `specs/018` section 10.1 instead of the exact-range ledger. The grain is
  declared in the approved contract and is never inferred from the data. A file
  whose rows do not match its declared grain is a typed failure.
- **A date field parser.** A declaration may bind one source field as the period
  key, with an explicitly named encoding — ISO date, the compact integer form,
  or a named textual form. Ambiguous encodings are rejected rather than guessed;
  the contract states which one this provider uses.
- **A money control total.** A declaration may name a figure the source states
  as a total, with a tolerance, and the projection fails if the rows it
  projected do not reconcile to it. This is what makes a mapping error arithmetic
  rather than trust, and it is what allows a PDF-derived grid to be admitted at
  all under ADR 0028.

Everything ADR 0027 forbade stays forbidden: no expressions, no arbitrary code,
no ratios, no cross-field arithmetic, no currency inference, no economics
calculation. A revenue that exists only as volume multiplied by unit price is
still not projectable, and stays honestly absent.

## Consequences

Daily series become projectable, which is what makes trend and cross-channel
analysis possible at all — the detector catalogue in section 11 has nothing to
run against a single figure per channel per month.

Two projection targets now exist, and a period could in principle receive both a
daily series and an exact-range total covering the same days. Section 10.5's
overlap rules apply across both: they cannot both contribute to one rollup, and
an ambiguous case is a reconciliation failure for an owner or admin to resolve,
not a precedence rule buried in code.

The control total is opt-in per declaration, so existing approved declarations
keep their current meaning and are not silently reinterpreted. A new declaration
over a source that states a total is expected to use it.
