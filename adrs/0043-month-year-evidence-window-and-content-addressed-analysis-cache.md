# ADR 0043: Month-and-year evidence windows use content-addressed analysis reuse

## Status

Accepted. User-approved on 2026-08-28. Supersedes ADR 0033's free-range,
day-shaded calendar. ADR 0032 remains historical context for declared package
boundaries.

## Context

ADR 0032 made a declared package the only selectable window. It protected an
operator from asking about data no one uploaded, but it also prevented January
inside a January-to-February report and made a missing February invisible when
its rows did not survive as current evidence.

ADR 0033 reversed that rule in favour of a free date-range calendar shaded by
daily evidence density. It was a good answer to an unconstrained date question,
but it is not the selected product: operators need a compact Month and Year
question that is inexpensive to repeat, exposes report gaps, and remains
governed by declared history.

The existing analysis idempotency key is deliberately keyed by run id. A window
can be re-analysed when corrected evidence arrives. Treating that key, a fixed
TTL, or browser cache as proof that a prior analysis is current would show a
stale answer after reconciliation.

## Decision

### One Month and Year, inside declared history

The workspace accepts one `YYYY-MM` selection. Its local date bounds are the
first and last days of that calendar month. There are no start/end fields,
free-range calendar, daily shading, or operator grain selector.

The selectable horizon is the contiguous set of calendar months from the
earliest to latest declared period of projected packages for the channel. It is
not the occupied metric extent. Every internal month is offered even when it
has no surviving current metric row. Months outside that horizon are not
invented, including future months.

The UI uses adjacent Month and Year controls. Each in-horizon month/year pair
is selectable; edge-year months outside the known horizon are visibly
unavailable. A channel with no projected declaration has no selection and says
why.

### No evidence is an answer

An empty selected month remains runnable. Its deterministic coverage result says
that no governed evidence was recorded. It is neither zero nor a failed request.
This matters because the absence may be an import, projection, or governance
gap worth documenting.

Month selection is a calendar scope only. The server resolves the actual grain
from governed evidence and retains existing honest needs-data states for grain,
timezone, and branch comparability. It does not resample, convert, or select a
branch to make an answer appear.

### An immutable completed run is a cache entry only for identical evidence

The platform derives a canonical cache key from the monthly scope, resolved
timezone/grain, version tuples, and an evidence digest over the current exact
ledger/package/reconciliation inputs. A completed run is reusable only when its
key equals the key recomputed now. The worker repeats this computation under its
lease, so a change between page render and claim cannot produce a stale hit.

The cache lives on the immutable analysis-run record. It is tenant-leading,
query-indexed metadata rather than a mutable shared cache. The signed-in read
path may announce a likely match, but the worker claim is authoritative. A
correction, supersession, held decision, new projection, metric/detector
version change, or empty-to-present transition changes the digest and creates a
new run.

## Consequences

ADR 0033's day-density read model and free-range length-to-grain rule are not
implemented. The existing declared-package picker is replaced rather than kept
as a parallel mode, because two window models would let a page show an answer
for one scope under the label of another.

The route no longer trusts client-provided dates, grain, or branch. It accepts a
month coordinate and resolves all operational inputs server-side. The page URL
becomes the stable, shareable selection and loads only the run for that exact
selection.

This requires an additive migration, new tenant/RLS/RPC tests, and staging
function invocation before release. It does not permit a service role in the
request path or turn a model narration failure into a missing deterministic
audit.
