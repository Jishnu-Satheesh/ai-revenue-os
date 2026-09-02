# ADR 0030: Period-grain projection into the metrics ledger

## Status

Accepted. Completes the second capability ADR 0029 declared and extends the
reconciliation rules in `specs/018` section 10.5 across two ledgers.

## Context

ADR 0029 added a period grain to the projection declaration language, and the
pure projector that reads a daily file was built and tested. The write path was
not. An approved `period_grain` declaration was therefore refused outright with
`PROJECTION_OUTPUT_KIND_UNSUPPORTED`, which meant three of the five report
families the platform knows — Talabat daily performance, Keeta billing summary,
Keeta restaurant data — could not be imported at all. Only Noon and
EatEasily/Smile worked, because they are single period totals.

The refusal was correct while it stood. Summing a month of daily rows into one
exact-range figure would have reported a clean import and been wrong about the
shape of every number in it.

## Decision

### A series is written to `normalized_metrics`, one row per period

A fenced, security-definer RPC, `complete_governed_report_package_period_grain_projection`,
is called by the worker under the claim token and lease it already holds, in the
same shape as the exact-range completion. It re-derives every rule the projector
applied — the grain, the period boundary, the currency, the metric definition,
the declared window — because the worker is not the authority on what may enter
the ledger.

### The branch's timezone governs the period boundary

`specs/015` section 4.4 is explicit: boundaries are computed in the branch's
timezone and the zone in force is recorded, so a later branch change cannot
reinterpret history. The package's `period_timezone` is a copy of the
*organization's* `default_timezone` taken at intake, not the branch's. For an
agency whose outlets span two countries, using it would shift an outlet's whole
trading day by an hour, every day, forever.

So the branch timezone governs, and it is what the row records. The exact-range
ledger keeps using the package's zone; it is unchanged.

`period_start` is local midnight of the first day and `period_end` is local
midnight of the day after the last — half-open, matching the table's own
`period_end > period_start` check and every existing reader of the series.

### Overlap is decided across both ledgers, in local dates

Two projection targets now exist, and a period can receive both a daily series
and an exact-range total covering the same days. Section 10.5 applies across
both: they cannot both feed one rollup, and an ambiguous case is an owner or
admin decision rather than a precedence rule buried in code.

The existing reconciliation machinery is reused rather than duplicated. Both
completion RPCs search both ledgers, and each side is compared in its *own*
recorded zone's local dates, so a branch zone differing from the package's
cannot hide a collision.

Only rows a governed report projection wrote are overlap candidates, identified
by a non-null `reconciliation_digest`. A series some other collector produced is
not evidence about this import, and blocking an operator's file against it would
be a refusal they could neither understand nor act on.

Every colliding prior becomes a decision of its own. Recording only the first —
which is what the exact-range path did — would leave the rest live after a
resolution, quietly double-counting exactly the days the reconciliation existed
to protect.

### A prior in the other ledger is excluded, not superseded

Supersession is a revision: a row points at its successor. That pointer cannot
cross tables, and inventing a way for it to would leave the history unreadable.
So an accepted correction supersedes priors in its own ledger and marks priors
in the other one `excluded`. Both are recorded in the resolution row and in
audit events, and neither destroys evidence.

### `normalized_metrics` gains a reconciliation state

Held evidence has to be stored — section 10.5 says overlapping packages are
stored — and it must not read as settled fact. The metrics ledger therefore
gains `reconciliation_state`, mirroring the exact-range ledger, and its
current-revision index requires it. Every existing row defaults to `current`, so
nothing already stored changes meaning.

This reaches outside the report-projection module: `normalized_metrics` is a
core table. Exactly one existing reader treated an unsuperseded row as current
and has been corrected — `get_cost_component_coverage` — along with three reads
in the metrics repository. The campaign readers reach the series through
`campaign_metric_observations`, which this path never writes, and are unaffected.

## Consequences

Daily series become importable, which is what makes trend and cross-channel
analysis possible at all.

An exact-range package can now be held for reconciliation where it would
previously have completed. That is the intended behaviour and can only be
triggered by a governed series this path wrote.

`absent_row_count` is recorded on the projection run. Blank is not zero, an
absent period stays absent, and the count of them is a fact about the evidence
rather than a log line — an operator has to be able to see that eleven of thirty
days said nothing.

Two failure codes are added, both actionable: `PERIOD_OUT_OF_DECLARED_RANGE`
when a row is dated outside the window the operator declared, and
`INVALID_LOCAL_DATE` when a row's date cannot be read, which across three date
encodings is the likeliest way a series fails.

`PROJECTION_OUTPUT_KIND_UNSUPPORTED` is kept. It no longer describes period
grain; it now means what it says, which is that some future projection target
has no writer yet.

### What this slice does not record

Lineage for a series names the sheet, the column, and how many rows contributed
to each period. It does not record a first and last data row, because the pure
projector does not compute one per period and a sheet-wide range would be a
claim about evidence nobody checked. Per-period row ranges are a follow-up that
requires the projector to return them.

Ratios, dimensions, filters, currency conversion, proration, and overlap-summing
remain forbidden, exactly as ADR 0027 and ADR 0029 left them.
