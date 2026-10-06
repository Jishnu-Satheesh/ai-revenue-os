# ADR 0063: Business-performance card reads governed aggregates, not analysed findings

## Status

Accepted. Rulings 1B–6A user-approved on 2026-09-18; implemented unpushed on
`feat/governed-channel-intelligence`.

## Context

The Overview performance card stated only what a completed analysis had already
said: every tile, delta, and trend bucket came out of detector findings for
exact windows, and a range nobody had analysed read empty behind an auto-build
that dispatched fresh analyses. Against real staging data this gate describes
a card that waits on work its figures never needed. The figures the card
states -- sales, orders, menu views, cancellations -- are governed report rows
in `normalized_metrics` and `exact_range_metric_observations` long before any
detector runs, and an analysis run writes findings without ever writing a new
figure. Auto-building analyses behind an empty card therefore spent detector
passes and narrations that could not fill it.

ADR 0055 settled the card's range aggregation and ADR 0048 its cache pattern;
both assumed the analysis-gated read. This decision moves the source while
keeping the card's contract: same four tiles, same deltas, same honest absences.

## Decision

The card reads two governed aggregate loads -- the picked covered range plus
its previous equal range -- over `revenue.gross`, `listing.placed_orders`,
`listing.menu_views`, `order.avoidable_cancellation_count`, and
`cost.commission` (the one cost line both cost-context detectors read, used
only as cost presence for the footnote and sources note).

Range totals dedup per channel and key: fully-inside period rows read at the
finest grain available (day, then week, then month) and fully-inside
exact-range rows add once each on top; rows merely overlapping the range never
arrive clipped or split. The read carries each row's grain and span so the
builder -- not SQL -- applies the rule. Daily bars sum single-day facts per
day with gaps left absent; the cancelled share is cancellations over placed
orders from the same totals, with its point change; mixed currencies refuse
with a reason on tiles, bars, and shares alike.

Caching still follows ADR 0048, but the live currency verdict changes: a hit
is served only while the evidence-window fingerprint still matches, because a
report arrival -- not a completed analysis -- is what moves these figures.
The cache key version moves to v2; v1 envelopes never validate.

An empty range states the gap and points at the Channel Audit. The auto-build
dispatch is removed: it spent analyses that write no figures.

## Consequences

Week/month-only history still states its tile totals through the dedup, but
plots no bars until day facts exist -- the coverage note says exactly that.
`loadChannelRangeCardFindingsForWindow` and `loadChannelCardFindingsForWindow`
stay on the port, tested, for the Channel Audit surfaces that still read
findings; `loadCompletedRunCountSince` stays for the same reason. The picker's
`resolved` plumbing and analysed-window fallbacks stay for the filter row and
its honest-empty states only. The workspace's "no finished analysis" copy now
overstates the card's requirement and is recorded as a follow-up, not fixed
here: the workspace was explicitly out of scope for this change.

Rollback is a code revert plus cache clear -- no migration is involved and no
finding, run, or governed row is written by this change.
