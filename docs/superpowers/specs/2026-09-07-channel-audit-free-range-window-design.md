# Channel Audit Free-Range Window Design

**Date:** 2026-09-07

**Status:** Approved design; awaiting written-spec review

**Route:** `/organizations/[organizationId]/channels/[channelId]` (Channel Audit only)

**Supersedes:** `docs/superpowers/specs/2026-08-28-month-year-channel-analysis-window-design.md`

**Reverses in part:** ADR 0043 (month-and-year selection). Retains ADR 0043's
evidence-resolved grain and content-addressed cache in full.

**Requires:** a new ADR 0047.

## 1. Purpose

A pilot client asked, in a meeting, whether the Channel Audit can be read
weekly. Today it cannot be read as anything but one whole calendar month.

The ask is not really "add a week preset". It is that the period is the
client's question to pose, not ours to enumerate. They may want the four days
around a promotion, or the fortnight either side of a menu change. So the
Channel Audit accepts a free `from`–`to` range, bounded to the dates the
organization's approved reports actually cover, and answers it with a real
analysis run and real recommendations for exactly those dates.

A second, unplanned benefit settles a defect found on 2026-09-07 during the
Nostaza channel intake. Auto-analysis after a projection runs over the
*declared* window of the report — Keeta's was 1 Jan – 28 Feb 2026 — and no
single calendar month ever equals that window, so the page could never display
the run. Its findings and recommendations existed and were unreachable. Once
the picker speaks in ranges, that run is directly selectable.

## 2. Scope and tier

Tier 3. It changes a public API contract, changes a URL contract, reverses part
of an accepted ADR, and adds a runtime dependency and an external service to a
request path.

It adds **no table, column, RLS policy, RPC, or database type**. `claim_channel_analysis`
already accepts `p_window_start`, `p_window_end` and `p_cache_key` and contains
no month logic; `channel_analysis_runs` already permits any window up to 400
days. There is no migration.

**In scope**

- A free `from`–`to` range picker on the Channel Audit page, bounded by report coverage.
- Presets: Last 7 days, This month, Last month, All reported.
- A pre-run warning when the range is finer than the channel's reports can answer.
- The window-shaped API contract and cache key, replacing the month-shaped ones.
- A staged, honest progress loader driven by real run status.
- Redis caching of immutable completed-run views, and of coverage with a short TTL.
- A per-organization rate limit on windows that are not already computed.
- Pointing auto-analysis at the same cached path so its runs carry a cache key.

**Out of scope**

- Organization Overview, Economics, and Growth Intelligence keep whatever
  windowing they have. Confirmed with the user on 2026-09-07.
- The channels list page keeps `MonthYearPicker`; that component is shared and
  is not retired.
- Reviving ADR 0033's evidence-density day shading.

## 3. Decisions taken

All five confirmed with the user on 2026-09-07.

1. **Surface:** Channel Audit only. "The Chapter page" means the chapter cards
   on that same page, not the Overview route.
2. **The month picker is replaced, not supplemented.** One control carrying
   presets, so "pick January" stays one click. Two window paths that can
   disagree with each other are not maintained.
3. **A range finer than the evidence warns before it runs.** Any range inside
   coverage stays selectable; a range the channel's reports cannot resolve
   shows an inline note naming the real figures and offers a one-click widen.
   Calendar-level snapping was rejected: Keeta files three report families at
   once, so "the channel's grain" is a majority vote rather than a fact, and
   snapping would block ranges that would have worked.
4. **An explicit Apply, and no permission gate.** One deliberate choice starts
   one run, so no runs are minted mid-drag. Any member who can see the channel
   may start one. This reverses today's `report.retry` gate on the route and
   the `channel.manage` gate on the button, and is the reason for the rate
   limit.
5. **The default window is the most recent window the channel can answer.**
   The last 7 days when covered. Otherwise: the most recent 7 covered days on a
   daily-reporting channel, the most recent covered month on a monthly one, and
   the whole span on a channel that files a single figure. The page never opens
   on a warning.

## 4. The window contract

### 4.1 What replaces the month

| Layer | Today | After |
| --- | --- | --- |
| API body | `{ month: "2026-01" }` | `{ from: "2026-01-01", to: "2026-01-04" }` |
| URL | `?month=2026-01` | `?from=2026-01-01&to=2026-01-04` |
| Cache key | `createMonthlyAnalysisCacheKey` | `createWindowAnalysisCacheKey` |
| Worker payload | `month` + `windowTimezone` | `windowStart` + `windowEnd` + `windowTimezone` |
| Admissibility | `resolveAnalysisMonth` against the month horizon | the range against merged coverage segments |

The cache key drops its `month` field and its resolver version is bumped. Every
run cached under the old key stops matching and recomputes once, on first pick.
This is deliberate: those keys answer a different question and reusing them
would attach a month's arithmetic to a range's heading.

### 4.2 The guarantee that survives

Today's design refuses browser-supplied dates outright, and the worker
re-resolves the window under its own lease so that an invented window cannot
pass the route. Dates now come from the client. The second half is kept, and it
is what preserves the guarantee:

- The **route** checks the range against coverage read through the caller's
  RLS-authenticated client.
- The **worker** checks it again, independently, under its lease, before
  claiming.

A range touching a single uncovered day is refused at both. The property "you
cannot analyse a window your approved reports do not declare" is unchanged.
Only the vocabulary is.

### 4.3 Coverage

Coverage is the union of `declared_period_start`–`declared_period_end` from that
channel's `projected` packages, which `loadEvidenceWindows` already returns
along with each package's grain and surviving governed row count. Merged into
ordered, non-overlapping, inclusive segments, it does three jobs:

- it is what the calendar greys out;
- it is what both admissibility checks test against;
- it is what the grain warning reads, so the warning can name the real figures
  rather than say something generic.

Coverage is taken from *declared* package dates, not from surviving evidence
rows, for the reason `loadAnalysisMonthTimeline` already documents: a package
whose rows were all superseded still declares the period, and a gap must stay
selectable so the coverage detector can report it.

### 4.4 New and changed code

**New** `src/domain/analysis/window-selection.ts` — pure date logic, no I/O:

- `mergeCoverageSegments(windows)` — ordered, non-overlapping inclusive segments.
- `isWindowCovered(from, to, segments)`.
- `defaultAnalysisWindow({ today, segments, windows })` — the decision-5 rule.
- `describeGrainMismatch({ from, to, windows })` — `null`, or the warning's
  facts: the offending package's grain, its declared range, and the widened
  range to offer.

**Changed**

- `src/domain/analysis/digest.ts` — `createWindowAnalysisCacheKey`, version bumped.
- `src/domain/analysis/calendar.ts` — keeps every period-arithmetic helper
  unchanged. The five month-label helpers (`parseAnalysisMonth`,
  `resolveAnalysisMonth`, `analysisMonthBounds`, `enumerateAnalysisMonths`,
  `formatAnalysisMonth`) retire with the Channel Audit month picker; the
  channels list page does not use them.
- `src/modules/analysis/application/ports.ts` — two port renames.
  `resolveMonthInput` becomes `resolveWindowInput`, returning the same
  `{ windowStart, windowEnd, timeZone, grain }`; the existing majority-grain
  vote is reused verbatim, over the picked window instead of a month's bounds.
  `loadAnalysisMonthTimeline` becomes `loadCoverageSegments`, returning merged
  inclusive segments instead of a first/last month pair.
- `src/modules/analysis/infrastructure/read-repository.ts` — the implementation
  of both ports. `loadEvidenceWindows` is unchanged and becomes the single
  source for coverage, grain and governed row counts.
- `src/trigger/analysis.ts` — passes `loadCoverageSegments` where it passes
  `loadMonthHorizon` today.
- `src/app/api/.../channels/[channelId]/analysis/route.ts` — the body schema,
  the coverage check, the rate limit, and the removal of the `report.retry` gate.
- `src/workflows/analysis/run-channel-analysis.ts` — the monthly path becomes
  the window path; it re-resolves coverage rather than a month horizon.
- `src/modules/reports/application/auto-analysis.ts` and `src/trigger/reports.ts`
  — auto-analysis moves onto the cached window path so its runs carry a cache
  key. Left alone, picking the exact range an auto-run already computed would
  recompute it from scratch.
- `src/app/(platform)/.../channels/[channelId]/page.tsx` — `searchParams` and
  the run selection.

## 5. Caching

Redis holds only what cannot go stale. This is the discipline that makes the
scheme safe: **Redis holds answers, never verdicts about whether an answer is
still current.**

### 5.1 The completed run's view — long TTL

Key: `analysis:view:v1:{organizationId}:{analysisRunId}:{resultDigest}`.

A completed run is immutable, so there is no invalidation to forget and no
staleness window. TTL is a memory bound, not a correctness device. The entry
collapses `loadFindingsForRun`, `loadEvidence` and the recommendation text and
citations — three of the page's five round trips, plus the assembly — into one
`GET`.

**The viewer's own decisions are deliberately excluded.**
`loadRecommendationsForRun` filters `channel_recommendation_decisions` by
`actor_id = viewerId`, so the assembled view carries *"did **you** accept or
dismiss this"*. Caching the whole view under a run id would hand one operator
another's decisions. The cached half is viewer-independent; decisions are read
fresh per request and merged on top.

### 5.2 Coverage segments — 60-second TTL

Key: `analysis:coverage:v1:{organizationId}:{channelId}`.

This is what greys out the calendar. A newly projected report appearing in the
picker up to a minute late is harmless and self-corrects. A stale calendar can
never admit an uncovered range, because both admissibility checks read the
database.

### 5.3 What is deliberately not cached

The lookup *"has this range already been analysed?"*. It is one query against
the existing `(organization_id, channel_id, window_start desc, created_at desc)`
index. Caching it keyed on the date range is precisely how a client is served an
audit that the reports have since contradicted — the failure mode the
content-addressed key in ADR 0043 exists to prevent.

### 5.4 Availability

Every cache read is wrapped so that a miss and a failure are indistinguishable:
fall through to the database. **The rate limiter fails open** for the same
reason — an Upstash outage must not stop a client seeing their numbers. Both use
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`, already present in
`.env.local`.

Every key is namespaced by `organizationId` so no key is reachable across
tenants.

### 5.5 Rate limit

A per-organization sliding window on runs for ranges that are **not** already
computed. Cached ranges stay instant and unlimited. On refusal the picker says
so plainly and every already-computed range keeps working.

## 6. The loader

The pipeline has real, observable stages, so the loader reports them rather than
animating a fake thinking indicator:

1. the run row does not exist yet — *Reading approved reports*
2. `status = 'running'` — *Running the checks*
3. `status = 'completed'`, recommendations not yet written — *Writing recommendations*
4. recommendations present — done; the page swaps in the result

Stages 3 and 4 are distinct because narration is a second Trigger task that
finishes after the detector run (ADR 0037).

A small authenticated `GET` returns `{ status, hasRecommendations }` for the
window; the client polls it every 1.5 seconds. This uses the auth already on the
page, needs no new dependency, and covers both tasks in one query.

Trigger Realtime was considered and rejected for this: it would mean minting a
browser-scoped access token per run and subscribing to two separate tasks to see
the whole story, for a loader that runs for a few seconds.

The loader dims the workspace region and leaves the navigation usable. A page
that goes entirely blank reads as a crash rather than as work.

## 7. UI

**New** `src/components/ui/calendar.tsx` — shadcn Calendar. This brings the one
new runtime dependency, `react-day-picker`; `date-fns` is already present. It is
client-only and never reaches the Trigger worker bundle.

**New** `src/components/analysis/window-range-picker.tsx` — a `Popover`
(already in the repo) holding the range calendar, the preset rail, the grain
warning, and **Apply**. Dates outside coverage are greyed. A preset that falls
outside coverage is rendered *disabled with its reason*, not hidden: an operator
should see that "Last 7 days" exists and why it is unavailable, which is the
common case for this client, whose reports cover Jan–Feb and May–Aug 2026 while
today is September.

**New** `src/components/analysis/analysis-progress.tsx` — the staged loader.

**Changed** `src/components/analysis/channel-workspace.tsx` — swaps the picker,
posts `{ from, to }`, and replaces the current "refresh in a moment to see the
result" message with the loader.

**Unchanged** `src/components/analysis/month-year-picker.tsx` — still used by
the channels list page.

### Flow on Apply

1. Range inside coverage?
2. Grain warning, if any, shown before the run is started.
3. Does a completed run exist for exactly this range?
4. Yes → render it. Redis hit; instant.
5. No → rate limit → start the run → loader → poll → render.

## 8. Test plan

**Pure logic** (`window-selection.test.ts`) — coverage merging across gaps,
overlaps and touching edges; the default-window rule against all three real
shapes with a frozen "today" (Keeta daily, Offline Store monthly, Noon
single-span); the grain decision and the range it offers; the 400-day ceiling;
reversed dates.

**Cache key** — changes with the window, is stable without, and is provably
different from the old monthly key for the same dates. That last assertion is
what makes the one-time recompute deliberate rather than accidental.

**Route** — accepts a covered range; refuses an uncovered one, a reversed one,
and an over-long one; enforces the rate limit; fails open when Upstash is down.

**Tenant isolation** — a range covered in one organization is refused in
another; a channel id belonging to another organization is refused; Redis keys
are asserted to carry the organization id.

**Worker** — re-checks coverage under its own lease and refuses an invented
window even when the route is bypassed entirely.

**Cached payload** — asserts it contains no decision fields, and that two
viewers of the same run each see their own decisions and not the other's.

**Components** — greyed dates; a disabled preset and its reason; the warning and
its widen button; Apply posting `{ from, to }`; the loader advancing on polled
status rather than on a timer.

**Browser** — exercised through chrome-devtools at both widths before the work
is called done.

## 9. Blast radius

- **Callers of the analysis route:** only `channel-workspace.tsx`.
- **`requestChannelAnalysis`:** called by the route, by `src/trigger/reports.ts`
  (auto-analysis), and by nothing else.
- **RLS:** unchanged. Coverage is read through the caller's authenticated
  client; the worker keeps its service client and its existing claim fence.
- **Background tasks:** `channel-analysis.run` payload shape changes;
  `channel-recommendations.generate` is untouched. Both require a Trigger deploy.
- **Migrations:** none.
- **Database types:** unchanged, so `database.types.ts` is not touched.
- **The channels list page:** untouched.

## 10. Risks and rollback

| Risk | Mitigation |
| --- | --- |
| Novel ranges cost AI runs, and the permission gate is being removed | Apply gate, per-organization rate limit, and the cache |
| Resolver-version bump recomputes every previously cached run once | Expected and one-time; called out here so the run count is not a surprise |
| Redis outage | Every read falls through to the database; the limiter fails open |
| `?month=` bookmarks would land on a default window | Keep the parameter for one release and translate it to the equivalent range |
| A new client-side dependency in a repo that was recently bitten by bundling | `react-day-picker` is client-only and cannot reach the worker bundle |
| Second reversal on this axis (ADR 0032 → 0033 → 0043 → 0047) | Recorded in the ADR with what changed; see below |

**Rollback** is a code revert. There is no migration. Runs written under the new
key remain valid rows; they would simply stop being cache hits.

## 11. ADR 0047

`0047-a-free-range-window-over-a-content-addressed-cache.md`.

The decision history on this axis matters and must be recorded honestly:

- **ADR 0032** — a declared package is the only selectable window.
- **ADR 0033** — reversed it: a free-range calendar shaded by evidence density.
- **ADR 0043** — reversed *that*: month-and-year only, because operators need a
  question "inexpensive to repeat", and introduced the content-addressed cache.
- **ADR 0047** — reinstates the free range.

What changed, and why this is not a third swing of the same pendulum:

1. **ADR 0043's own objection has been solved by ADR 0043.** Its complaint
   against free range was the cost of repeating a question. The
   content-addressed cache it introduced is what makes repeating one nearly
   free. The reason for the restriction was removed by the same decision that
   imposed it.
2. **The requirement now comes from a client**, in a meeting, rather than from
   an internal estimate of what operators want.
3. **ADR 0033's actual defect is not revived.** It derived the grain from the
   *length of the chosen range* — thirty-one days or fewer meant day grain —
   which lets the operator's drag decide what resolution the underlying data
   has. ADR 0043 replaced that with a grain resolved from the governed evidence
   itself. This design keeps ADR 0043's version and does not restore ADR 0033's.
4. **ADR 0033's density shading is not revived either.** Bounding selection to
   covered dates is a harder guarantee than a shade, and the pre-run grain
   warning states something a shade cannot: not "thin here", but "this channel
   physically cannot answer a question this fine, and here is the range that
   can".

The ADR also records the removal of the `report.retry` gate on starting an
analysis, and the rate limit that replaces it as the cost control.
