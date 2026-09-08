# ADR 0048: A free-range window over a content-addressed cache

## Status

Accepted. User-approved on 2026-09-07. Reverses ADR 0043's month-and-year
selection in part; retains ADR 0043's evidence-resolved grain and
content-addressed cache in full.

Numbering note: the design spec
(`docs/superpowers/specs/2026-09-07-channel-audit-free-range-window-design.md`,
§11) calls this decision "ADR 0047", and implementation comments in
`analysis/route.ts`, `digest.ts`, and `view-cache.ts` cite that number from the
spec. It is filed here as 0048 because `adrs/0047-*` was already taken by an
unrelated decision. This record is the binding one.

## Context

The decision history on this axis matters and is recorded honestly:

- **ADR 0032** — a declared package is the only selectable window.
- **ADR 0033** — reversed it: a free-range calendar shaded by evidence density.
- **ADR 0043** — reversed *that*: month-and-year only, because operators need a
  question "inexpensive to repeat", and introduced the content-addressed cache.
- **This decision** — reinstates the free range. The second reversal on this
  axis.

What changed, and why this is not a third swing of the same pendulum:

1. **ADR 0043's own objection has been solved by ADR 0043.** Its complaint
   against free range was the cost of repeating a question. The
   content-addressed cache it introduced is what makes repeating one nearly
   free. The reason for the restriction was removed by the same decision that
   imposed it.
2. **The requirement now comes from a client**, in a meeting on 2026-09-07,
   asking whether the Channel Audit can be read weekly — four days around a
   promotion, a fortnight either side of a menu change — rather than from an
   internal estimate of what operators want.
3. The same intake surfaced a defect this reversal settles: auto-analysis after
   a projection runs over the report's *declared* window (Keeta's was
   1 Jan – 28 Feb 2026), and no single calendar month ever equals that window,
   so the page could never display the run. Its findings existed and were
   unreachable. Once the picker speaks in ranges, that run is selectable.

## Decision

The Channel Audit page accepts a free `from`–`to` range, bounded to the dates
the organization's approved reports actually cover, and answers it with a real
analysis run for exactly those dates. Presets (Last 7 days, This month, Last
month, All reported) stay one click; the month picker is replaced, not
supplemented, because two window paths that can disagree are not maintained.

**ADR 0033's length-derived grain is not revived.** ADR 0033 derived grain
from the length of the chosen range — thirty-one days or fewer meant day
grain — which lets the operator's drag decide what resolution the underlying
data has. Grain stays resolved from the governed evidence itself per ADR 0043.
A range finer than the channel's reports can answer stays selectable and shows
a pre-run warning naming the real figures, with a one-click widen.

**ADR 0033's evidence-density day shading is not revived either.** Bounding
selection to covered dates is a harder guarantee than a shade, and the warning
states something a shade cannot: not "thin here", but "this channel physically
cannot answer a question this fine, and here is the range that can".

**Admissibility is re-decided independently at the route and in the worker.**
The route checks the range against coverage read through the caller's
RLS-authenticated client; the worker checks it again under its own lease
before claiming. A range touching a single uncovered day is refused at both.
That double check is what makes browser-supplied dates safe, and the property
"you cannot analyse a window your approved reports do not declare" is
unchanged — only the vocabulary is.

**Authorization is kept; rate limiting is added alongside it.** Starting an
analysis still requires `report.retry` on the route and `channel.manage` on
the page's run control: authorization answers *who may*. A per-organization
sliding-window rate limit on ranges that are not already computed caps *how
often* someone who may ask can spend a detector pass and an AI narration.
Neither substitutes for the other. Whether to widen who may spend AI budget
beyond today's roles is an open product decision with the user, explicitly
not taken here.

**Redis holds answers, never verdicts about whether an answer is current.**
Immutable completed-run views are cached with a long TTL (a memory bound, not
a correctness device); coverage segments are cached for 60 seconds. The lookup
"has this range already been analysed?" is deliberately not cached: one query
against the existing index, because caching it keyed on the date range is how
a client gets served an audit the reports have since contradicted. Every cache
read fails through to the database, the limiter fails open, and every key is
namespaced by organization id.

## Consequences

The five month-label helpers (`parseAnalysisMonth`, `resolveAnalysisMonth`,
`analysisMonthBounds`, `enumerateAnalysisMonths`, `formatAnalysisMonth`) retire
from `src/domain/analysis/calendar.ts` with the Channel Audit month picker;
every period-arithmetic export stays. `src/components/analysis/month-year-picker.tsx`
is untouched — the channels list page still uses it.

The window cache key drops its `month` field and its resolver version is
bumped. Every run cached under the old key stops matching and recomputes once,
on first pick. This is deliberate and one-time: those keys answer a different
question, and reusing them would attach a month's arithmetic to a range's
heading.

`?month=` bookmarks land on a default window; the parameter is kept for one
release and translated to the equivalent range. Rollback is a code revert —
no migration — and runs written under the new key remain valid rows that
simply stop being cache hits.
