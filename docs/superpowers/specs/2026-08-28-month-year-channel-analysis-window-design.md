# Month-and-year channel analysis windows

## Status

Architecture approved by the user on 2026-08-28. No production code, migration,
RLS change, Trigger task change, or staging mutation has been made.

The linked Superdesign revision could not be generated because the project has no
remaining generation credits. The existing approved draft remains unchanged; the
visual review is therefore a release gate, not a substitute for this document.

## Problem and outcome

The current workspace offers one declared package range. It cannot ask about a
single calendar month inside a report, hides an internal gap when no current row
survives, and keeps the page on the latest completed run after the operator has
selected a different window. ADR 0033 describes a free-range day calendar, but
that control was never implemented and is not the product direction now chosen.

An operator can select a Month and Year in the channel's known report timeline.
Every month in that contiguous timeline is visible, including a month without
current governed rows. Selecting a gap runs a normal audit whose explicit result
is "no governed evidence", not zero and not a blocked control. An exact,
unchanged evidence set reuses its completed immutable run; any changed evidence
starts a new run.

## Decisions

### 1. A selection is one local calendar month

- The public selection is a canonical `YYYY-MM` value, carried in the page URL
  as `?month=YYYY-MM`.
- The server derives the inclusive first and last local calendar dates. The UI
  never accepts a start date, end date, day click, or a period-grain choice.
- Month names are rendered in the organization-configured timezone. The exact
  resolved timezone remains part of the run and cache identity; the UI does not
  convert or combine provider periods that have a different timezone.
- The analysis scope is channel-wide (`branchId = null`) because the approved
  control exposes only Month and Year. Detectors that cannot honestly combine
  branches must return their existing `needs_data` state rather than choosing a
  branch silently.

### 2. The known timeline is bounded, contiguous, and includes gaps

- It begins at the calendar month containing the earliest declared start and
  ends at the calendar month containing the latest declared end among projected
  packages for this organization and channel.
- It is expanded month by month between those bounds. A package with no current
  normalized metric rows still contributes its declared dates; otherwise a gap
  would disappear from the control precisely when it is useful to inspect.
- The Year control lists only years in that horizon. The Month control always
  shows the twelve month names, but disables pairs outside its first/last edge
  year. Every in-horizon pair is selectable, even when its evidence count is
  zero. This keeps Month and Year independently understandable without allowing
  invented past or future windows.
- A channel with no projected package has no known timeline. It receives a
  direct empty state explaining that an approved report is needed, not a fake
  year picker.

### 3. The server, not the picker, resolves the analysis input

- A monthly resolver validates `YYYY-MM` against the known timeline and
  calculates `windowStart`, `windowEnd`, timezone, channel-wide branch scope,
  and a supported analysis grain.
- Month is the audit scope, not a request to resample evidence. The resolver
  uses the finest supported current grain available for the selected month; for
  an empty month it inherits the channel's known primary grain. If no surviving
  metric row exists anywhere in the known timeline, it uses day grain only to
  let the coverage detector state that no evidence exists. The resolved grain is
  recorded and shown in the run provenance, never chosen by the operator.
- A grain or timezone mismatch stays an explicit detector limitation. The
  resolver never aggregates, converts, or rounds evidence to force a result.

### 4. Empty is a successful, cacheable audit result

- A selected gap creates a completed run whose coverage/finding state says that
  no governed evidence was recorded for that month. It is not a transport
  failure, a disabled button, or a zero-valued business result.
- The VerdictBand replaces its package dropdown and day calendar with adjacent,
  accessible Month and Year Select controls. It explains that a blank month can
  be analysed and renders a calm outlined no-evidence notice when applicable.
- The page loads the completed run matching the URL's selected month. It never
  leaves a February selection above the latest run for a different month.

### 5. Reuse is content-addressed, never time-based

The existing run idempotency key stays an operation key. It does not say that a
past answer is current. A completed run is reusable only when the server derives
the same cache key from all of the following:

- organization, channel, channel-wide branch scope, local month bounds and
  timezone;
- resolved grain, analysis resolver version, registry version, detector version
  tuple, and metric-definition version tuple;
- a canonical SHA-256 evidence digest. The digest sorts and includes every
  candidate normalized metric's identity, revision, period, timezone, metric
  identity, value/dimensions, quality and reconciliation state/digest, plus
  package declaration/projection identity needed to distinguish absent evidence
  from a changed package;
- the explicit empty-evidence shape when no current metric contributes.

A TTL, Next cache, browser memory cache, and an organisation-wide result cache
are rejected. A late correction, a held reconciliation, a supersession, or a
newly projected row changes the evidence digest and makes the prior run
ineligible immediately.

The route may resolve the current key through the signed-in session and return a
matching completed run as `cached`; dispatch is skipped for that snapshot. For a
`queued` request, the worker claim re-resolves the evidence and cache key under
its lease before using a prior result. If evidence changed between route handling
and the claim, a fresh immutable run is made. A page-level cache lookup is only a
display hint and never authorizes reuse by itself.

## Data and authorization boundary

- Extend the immutable `channel_analysis_runs` record with a constrained
  `evidence_digest` and `cache_key`. Reuse the run record as the cache entry;
  do not introduce a mutable cross-tenant cache table.
- Add a tenant-leading partial lookup index for completed exact cache keys. It
  is an optimization only; correctness comes from recomputing the key at claim.
- The user-facing page and route stay on the signed-in Supabase session and
  `report.read`/`report.retry` checks. No service role appears in the request
  path. Security-definer claim functions retain a fixed search path, revoked
  public access, explicit worker-only grants, and their existing lease fencing.
- Hashes, run ids, cache disposition and safe no-evidence copy are safe to show.
  Metric values, raw rows, workbook data, prompts, secrets and signed URLs are
  never part of cache copy, logs, URLs or client props.

## Required UI and API changes

- The detail page reads the `month` search parameter, requests the bounded
  monthly timeline, and loads the matching run's findings/evidence/
  recommendations.
- `ChannelWorkspace` receives monthly choices and selected-run/cache state,
  removes `ChannelEvidenceWindow` package selection, and uses the two existing
  shadcn Select primitives. URL navigation preserves a selected month across a
  refresh or share.
- The analysis route accepts `month`, not caller-supplied dates, grain or
  branch. It returns a safe cache disposition and run id. Existing raw-window
  callers must be migrated in the same slice; there is no client-side fallback
  that can bypass the resolver.
- The worker recomputes the resolved monthly input and evidence digest immediately
  before claim. Recommendation narration remains best effort and cannot hide the
  deterministic cached or fresh findings.

## Observability and failure states

- Record structured cache disposition (`hit`, `miss`, `invalidated_during_claim`),
  resolver version, month, organization/channel/run ids, evidence digest prefix,
  and elapsed resolver/claim time. Do not log evidence payloads.
- Invalid or out-of-horizon months return a safe validation error. A missing
  timeline is a normal explanatory page state. Permission failures remain
  indistinguishable from inaccessible channel data.
- A cache lookup failure does not invent a hit: it queues a fresh run only when
  authorization and the worker claim succeed. A worker failure remains a failed
  run with its existing safe failure code.

## Verification required before release

- Pure tests for canonical month parsing, leap years, first/last bounds, and
  disabled edge-month options.
- Repository tests prove declared-package bounds retain empty internal months,
  exclude arbitrary/future months, preserve tenant scope, and bound metric reads.
- Resolver/worker tests cover finest-grain selection, empty-month fallback,
  branch/timezone limitation states, and a selection/run URL mismatch.
- Cache tests prove a hit only for identical provenance; changing a metric row,
  revision, reconciliation state, package declaration, detector version or
  registry version misses. An empty month caches only its explicit empty shape.
- Route tests cover month validation, `report.retry`, session tenancy, `cached`
  versus `queued`, and no raw dates/grain/branch bypass.
- Hosted-staging pgTAP covers the new column/index/RLS/RPC contract and a first
  real invocation of every new PL/pgSQL function. Run Node 22/pnpm focused and
  full checks; browser acceptance remains an operator walkthrough.

## Non-goals

- No arbitrary date range, day-level calendar, month-to-month comparison, grain
  selector, resampling, timezone conversion, inferred branch selection, mutable
  cache, or provider/campaign action.
- No change to money ownership: the deterministic VerdictBand figures remain
  observations/derived estimates with cited inputs, not realized-result claims.

## Rollback

The migration is additive. A feature flag can retain the existing package-window
read path while the monthly resolver is disabled. New runs and their evidence
digests remain immutable and readable; rollback stops cache reuse and new monthly
dispatch without deleting them.
