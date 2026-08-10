# Feature Specification: Metric Registry and Normalized Metrics

## Status

Draft. Prerequisite for `specs/005-decision-engine-v1.md` goal-alignment screening, for baselines in `specs/011-learning-ledger.md`, and for the variance estimates `specs/014-switchback-experiments.md` requires.

## 1. Business outcome

Give every downstream consumer one trustworthy, dimensioned time series per business quantity, with a declared unit, declared aggregation semantics, and a quality tier — so that a playbook eligibility rule, a baseline, and an outcome measurement all read the same number the same way.

`context/20-roadmap.md` has listed normalized metrics under Milestone 3 since the roadmap was written, with no specification and no migration. `specs/003-integration-hub.md` explicitly excludes "cross-provider normalized business schemas beyond the typed `IngestionSink` handoff", so the hub stops at the handoff and nothing picks it up. This specification is that missing consumer.

## 2. Industry neutrality

The core owns the **structure** of a metric: key, unit, value kind, aggregation semantics, dimensions, grain, quality tier, and revision history.

The core does not own the **vocabulary**. "Orders", "preparation time", "stockout rate", and "review velocity" are restaurant concepts, listed under `RestaurantMetric` in `industry-packs/restaurant/domain-model.md`, and they are registered by the Restaurant Industry Pack as metric definitions. A core table must never gain an `orders_count` column.

This is the same boundary `specs/012-channel-economics-ledger.md` drew for cost components, and it is deliberately the same mechanism. Per ADR 0006, the second vertical is the test: a distributor registers `shipments.count` and `on_time_delivery_rate` through the identical path.

## 3. Scope

### 3.1 Included

- A metric definition registry: core-seeded, pack-extensible, organization-extensible.
- A dimension registry with cardinality bounds.
- Period-grain normalized metric observations with revision history.
- Quality tiers and freshness, aligned with the ledger and Business Memory.
- Declared aggregation semantics, including correct handling of ratios.
- Baseline definitions computed over a metric series.
- Binding `goals.metric` to a registered metric key.
- The consumer read port that the Decision Engine, readiness score, and experiment design read through.

### 3.2 Explicitly excluded

- **Transaction-grain economics.** Owned by `specs/012-channel-economics-ledger.md`. This store holds period aggregates; the ledger holds per-transaction contribution margin. They reference each other, and neither recomputes the other.
- **Provider adapters and ingestion.** Owned by `specs/003-integration-hub.md`. This specification consumes the `DataIngestionPort` handoff and does not fetch anything.
- **Forecasting and anomaly detection.** The Signal Engine's territory, still unspecified.
- **Customer-level metrics and identity resolution.** Requires consented first-party identity; separate and later.
- **Cross-organization benchmarks.** Remains in `context/22-opportunity-backlog.md` behind the privacy path.
- **Fixed-cost or overhead allocation**, matching the ledger's exclusion.

## 4. Domain rules

### 4.1 Metric keys

A key matches `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$` — a dotted, lower-case path such as `orders.count`, `revenue.gross`, or `listing.conversion_rate`. Keys are stable identifiers and are never renamed; a superseded key is deprecated with a pointer to its replacement.

Each definition carries an owning scope of `core`, `pack`, or `organization`, and a pack-owned key carries its pack slug. Keys are unique per organization across all scopes, so an organization-defined key that collides with a later pack key is a registration conflict surfaced for resolution rather than silently shadowed.

### 4.2 Value kinds and why ratios are different

Every definition declares a value kind:

| Kind | Storage | Aggregation |
| --- | --- | --- |
| `count` | integer | additive |
| `money` | integer minor units with ISO currency | additive, within one currency |
| `ratio` | **numerator and denominator, both stored** | ratio of sums |
| `duration` | integer milliseconds | percentile or mean, never additive |
| `rating` | bounded scale with declared bounds | weighted mean over its count |

**A ratio metric stores its numerator and denominator and never only the quotient.** This is the rule that makes the store usable. A conversion rate stored as a scalar cannot be aggregated across days, branches, or channels without being wrong: the mean of daily rates is not the period rate unless every day carried identical volume. A playbook eligibility rule such as `conversion_rate < category_benchmark` is meaningless if the two sides were aggregated differently.

The quotient is derived on read and is never the stored value.

### 4.3 Declared aggregation semantics

Each definition declares how it aggregates over time and over dimensions: `sum`, `ratio_of_sums`, `mean`, `weighted_mean`, `percentile` with its p-value, or `last`. Declaring it removes the guess from every consumer. A definition whose aggregation is undeclared cannot be registered.

Aggregating a metric by an operation other than its declared one requires an explicit, named override at the call site and is recorded.

### 4.4 Grain, timezone, and period boundaries

Observations are stored at a declared period grain of `hour`, `day`, `week`, or `month`, with `period_start` and `period_end` as UTC instants.

**Period boundaries are computed in the branch's timezone, not in UTC.** A Dubai branch's day runs from local midnight; bucketing on UTC would shift every daypart by four hours and corrupt exactly the analysis the platform exists to do. The timezone in force is recorded on the row, so a later timezone change on the branch does not silently reinterpret history.

Repository convention still holds: instants are stored in UTC and rendered in the organization's configured timezone.

### 4.5 Gaps are not zeros

**A period with no observation is absent, not zero.** A closed Monday is not a Monday with zero orders, and the difference determines whether a baseline is right or catastrophically wrong.

Absence is represented by the absence of a row. The read port reports gaps explicitly and never fills them. A consumer that requires a dense series must state its gap policy — the port offers `reject`, which returns `insufficient_data` when any expected period is missing, or `mark_missing`, which aggregates the observed periods and returns the gap count alongside the result. The choice is recorded on whatever decision consumes it. Silent zero-filling is prohibited.

An `interpolate_with_flag` policy was considered and deliberately not built. Every honest interpolation needs an assumption about why the period is missing — a closed branch, a broken integration, a provider yet to report — and the store cannot distinguish them. Inventing values before that distinction exists would manufacture exactly the false confidence these rules protect against.

### 4.6 Quality tiers

Each observation carries a tier, in descending trust, mirroring `specs/012-channel-economics-ledger.md` section 4.3 and the source hierarchy in `context/09-business-memory.md`:

1. `measured` — from a system of record or provider report.
2. `derived` — computed deterministically from measured inputs.
3. `estimated` — computed from a documented assumption the client accepted.
4. `assumed` — a platform default the client has not reviewed.

There is no `missing` tier here, because a missing observation has no row (4.5).

A series' tier for a period is the weakest tier among its contributing observations. Consumers may declare a minimum acceptable tier; the Decision Engine's screening uses this.

### 4.7 Revisions and restatement

Providers restate. A marketplace corrects last week's order counts; a POS export is re-uploaded with a fix.

Observations are **append-only with revisions**. A restatement writes a new revision that supersedes the prior one for the same `(metric_key, subject, dimensions, period)` tuple, carrying the reason and the ingestion run that produced it. Reads resolve to the current revision by default and can resolve as-of a timestamp.

A restatement has exactly one valid statement order: **retire the incumbent, then insert the successor, in one transaction.** Inserting first collides with the partial unique index on current rows, which is checked per statement and cannot be deferred. Retiring first leaves the supersession pointer briefly dangling, so that foreign key is deferred to commit. Any writer that reverses the order will fail, and that is intended rather than incidental.

This mirrors the revision pattern already implemented for memory items. It also settles an open caveat elsewhere: `specs/005-decision-engine-v1.md` section 5.3 noted that reconstruction of a screened-out candidate set is exact only up to restatement of the underlying data. With pinned revisions in the decision record's inputs digest, reconstruction becomes exact, and that section is amended accordingly.

### 4.8 Dimensions

Dimensions are registered keys, not free-form tags. Each carries a declared cardinality bound; an ingestion that would exceed it is rejected with the offending dimension named rather than silently accepted. The bound is enforced at the write boundary, since a limit on distinct values across a table is not expressible as a database constraint.

**Branch, channel, and currency are first-class columns on an observation, not dimensions.** Row-level security needs the branch, the money checks need the currency, and period bucketing needs the branch timezone, so all three have to be structural. `specs/012-channel-economics-ledger.md` treats channel the same way. The dimension registry exists for what packs add on top.

A metric may additionally carry a typed `subject_ref` of `(subject_kind, subject_id)`, using **the same registered subject-kind vocabulary as decision candidates** in `specs/005-decision-engine-v1.md` section 5.2. This is what lets a playbook screen menu items on their own metrics without the core learning what a menu item is.

The `public.subject_kinds` registry already exists, seeded with the core kinds and reachable by foreign key; this slice registers pack kinds into it rather than creating a second vocabulary.

Two prohibitions carry forward from `specs/003-integration-hub.md`: provider account labels and customer PII are never dimensions. Neither is any free-text field.

### 4.9 Baselines

A baseline is a **declared function**, versioned and referenced by identifier, not an ad-hoc query. It names the metric key, the comparison window, the aggregation, the subject and dimension filters, a minimum observation count below which it returns `insufficient_data`, and an exclusion list.

Baselines cannot currently exclude calendar events. Local calendar and seasonality intelligence is item 6 in `context/22-opportunity-backlog.md` and is not promoted. Until it is, **every baseline records that no calendar exclusions were applied**, so a Ramadan-corrupted baseline is visible on its face rather than silently wrong. This is the concrete harm that backlog entry predicted, and naming it is what makes the omission safe to ship with.

`insufficient_data` is a first-class return and is never coerced to a number.

### 4.10 Goal binding

`goals.metric` is free text today, so a goal cannot be joined to a playbook's primary metric and the Decision Engine's goal-alignment screening is inactive.

This slice adds `goals.metric_key` referencing the registry. Existing rows are migrated by proposing a mapping from the free-text value onto a registered key, which requires human confirmation before it takes effect — precisely the model role `specs/005-decision-engine-v1.md` section 9 permits and no more. An unmapped goal is reported as unmapped and does not participate in screening; it is never guessed at read time.

Goal-alignment screening activates when the registry exists and the organization has at least one mapped goal.

## 5. Data model

- `metric_definitions` — key, label, owning scope, pack slug, value kind, unit, aggregation semantics, percentile p-value, declared bounds for `rating`, default quality tier, replacement pointer, effective dating.
- `metric_dimension_definitions` — key, label, owning scope, cardinality bound.
- `normalized_metrics` — organization, branch, subject reference, channel, dimensions, metric definition, period grain, period start and end, timezone in force, numerator and denominator, currency, quality tier, revision, superseded-by pointer, source ingestion run, observed and ingested timestamps.
- `metric_baselines` — the declared functions of 4.9, versioned.

**Definitions are vocabulary, not tenant data.** A row with no organization is core or pack vocabulary visible to every tenant; a row with an organization is that organization's custom key. Shared keys are globally unique, custom keys are unique within their organization, and a custom key that would shadow a shared one is rejected as the registration conflict 4.1 describes. This follows `public.subject_kinds` and avoids seeding one definition row per organization.

Uniqueness on observations is `(organization_id, metric_definition_id, subject_kind, subject_ref, channel, dimensions, period_grain, period_start, revision)`, with a partial unique index on the same tuple less `revision` enforcing one current revision. **Current is `superseded_by_id is null`**, with no second boolean to disagree with it.

The observation carries a denormalized `value_kind` under a composite foreign key to `(metric_definition_id, value_kind)`. That is what makes the ratio, currency, and integrality rules declarative checks rather than a trigger.

Definitions and dimensions are effective-dated, matching the ledger's treatment of cost components.

## 6. Inputs

The sole write path is the `DataIngestionPort` handoff from `specs/003-integration-hub.md`, which delivers `IntegrationRecordEnvelope` records carrying `recordType`, `observedAt`, `fetchedAt`, and an opaque payload.

A **projection** maps a record type onto one or more metric observations. Projections are pack-owned, versioned, and deterministic. A record type with no registered projection is recorded as unprojected with a count, never dropped silently — `AGENTS.md` prohibits discarding events.

Manual and CSV import route through the same projections, with column mapping proposed by a model and confirmed by a human, mirroring the ledger's treatment of provider line-item labels.

## 7. Consumers

- **Decision Engine** — screening predicates, freshness bounds, and `observed`-tier value estimates.
- **Channel economics ledger** — period-grain revenue and volume where transaction data is absent.
- **AI Readiness Score** — coverage and quality tier distribution as direct readiness inputs.
- **Switchback experiments** — historical variance for the minimum detectable effect, which cannot be computed without a dimensioned series.
- **Outcome measurement** — primary and guardrail metric values over the declared window.

All read through one port. No consumer queries the tables directly, so that revision resolution, gap policy, and aggregation semantics are enforced in one place rather than reimplemented.

The port resolves current revisions only. An as-of read needs a `distinct on` per series tuple, which PostgREST cannot express and which therefore needs a database function; it ships with the projection slice. Until then a caller cannot reconstruct what a decision read at the time, and the decision record's inputs digest is the only record of it.

The port additionally refuses a series whose observations were bucketed in more than one timezone. That happens when a branch's timezone is corrected after data exists: historical rows keep the zone in force when they were written, precisely so the mismatch surfaces rather than being averaged away.

## 8. AI behavior

Minimal by design. The store is arithmetic over ingested records.

**A model may:** propose a CSV column to metric-key mapping for confirmation; propose a `goals.metric` to metric-key mapping for confirmation; propose a new metric definition into a human-reviewed backlog.

**A model may not:** compute, adjust, or interpolate any metric value; assign a quality tier; create a metric definition or dimension; fill a gap; or narrate a metric figure as a finding. Explanation of metrics happens in the Decision Engine's evidence narrative, over numbers that are already computed.

## 9. Security and tenancy

- RLS on every table per `context/06-multi-tenancy-and-security.md`.
- Observations are append-only. Corrections are revisions.
- Definitions and dimensions are writable only by roles with configuration permission; pack seeds are service-role and idempotent.
- Revenue and volume metrics are commercially sensitive and default to `confidential`.
- No customer PII and no provider account labels as dimensions or subject identifiers.
- Tenant scope is never inferred from a record payload.

## 10. Observability

- Coverage: registered metric keys with at least one observation in the trailing period, per organization. The readiness score's most direct input.
- Quality tier distribution over observations.
- Gap rate per series, which distinguishes a closed business from a broken integration only when combined with operating hours — and is reported as ambiguous when it cannot.
- Unprojected record types by count. A rising count means a provider changed its payloads.
- Restatement rate and mean lag from `observedAt` to `ingestedAt`.
- Dimension cardinality against bounds.

## 11. Failure states

- **No projection for a record type.** Counted as unprojected and surfaced. Never dropped.
- **Cardinality bound exceeded.** Rejected with the dimension named; existing observations are unaffected.
- **Currency mismatch within a series.** Rejected at write. No implicit conversion.
- **Restatement arriving after a decision consumed the prior revision.** Permitted and expected. The decision's inputs digest pins the revision it read, so the decision remains reconstructable and the divergence is reportable.
- **Branch timezone changed.** Historical rows retain the timezone in force at write. New rows use the new one. Periods are never rebucketed retroactively.
- **Baseline with too few observations.** Returns `insufficient_data`. Never a number.
- **Ingestion run partially succeeded.** Accepted observations are written; rejected records are counted against the run. A partial run never produces a dense series.

## 12. Acceptance criteria

- No core table contains an industry-specific metric column.
- Every definition declares a value kind and an aggregation semantic; one lacking either cannot be registered.
- Ratio metrics store numerator and denominator; no code path stores or reads a bare quotient.
- Period boundaries are computed in the branch timezone and the timezone is recorded on the row.
- A missing period has no row, and no read path fills a gap with zero.
- Every observation carries a quality tier; a series reports the weakest tier among its contributors.
- Restatements create revisions; the prior revision remains readable and an as-of read resolves correctly.
- Every baseline records its exclusion set, including the empty set, and returns `insufficient_data` below its minimum count.
- `goals.metric_key` is populated only by confirmed mappings; unmapped goals are reported as unmapped and excluded from screening.
- No model writes a metric value, tier, definition, or dimension.
- Unprojected record types are counted, never discarded.
- Dimensions exclude provider account labels and customer PII, enforced at the write boundary.
- Tenant isolation is tested on every table, including pack seed paths.

## 13. Test plan

- **Unit.** Key and dimension validation; value-kind constraints; ratio-of-sums aggregation against a hand-computed fixture where per-day mean and period rate differ; percentile and weighted-mean aggregation; period bucketing across a timezone with a non-hour offset; baseline `insufficient_data` at the boundary.
- **Database.** RLS on every table; one current revision per tuple; append-only enforcement; effective-dated definition resolution at boundaries; cardinality bound rejection.
- **Integration.** A seeded organization ingesting a provider report, then a restatement of the same period, asserting that an as-of read returns the original value and a current read returns the corrected one.
- **Property.** Aggregating a ratio series over any partition of a period yields the same result as aggregating it whole; gap-bearing series never aggregate as though gaps were zero.
- **Negative.** A record type with no projection is counted rather than dropped; a bare-quotient write is rejected; a model-proposed mapping does not take effect without confirmation.

## 14. Migration and rollback

**First slice applied** in `supabase/migrations/20260810130000_metric_registry_and_normalized_metrics.sql`: `metric_definitions`, `metric_dimension_definitions`, `normalized_metrics` with revisions and append-only enforcement, `goals.metric_key`, RLS and read-only grants, and a two-key industry-neutral core seed.

Deferred to later slices: `metric_baselines`, the pack definition seed, and the projection layer of section 6. Writes are service-role only until those exist, so nothing yet populates a series.

Remaining work per section 5, plus two changes to existing schema:

1. `goals.metric_key` — nullable reference to `metric_definitions`, with the existing free-text `metric` retained for display and audit. Not backfilled automatically; populated only by confirmed mappings. This is the one correction `specs/005-decision-engine-v1.md` section 15 left outstanding, because it cannot ship before `metric_definitions` exists.
2. The core metric definition and dimension seed, and the Restaurant Pack seed for the `RestaurantMetric` list, both idempotent and versioned. Pack subject kinds (`menu_item`, `marketplace_listing`) are registered into the existing `public.subject_kinds` table.

Rollback drops the new tables and the `metric_key` column. No existing consumer reads them until the Decision Engine ships, so rollback is clean until that point and forward-only after it.

## 15. Documentation updates

- `context/04-domain-model.md` — `MetricDefinition` is already recorded; `NormalizedMetric` gains value kind, aggregation, revision, and subject reference.
- `context/20-roadmap.md` — Milestone 3's normalized metrics line points at this specification; the metric registry becomes an explicit prerequisite of Decision Engine V1's goal-alignment screening.
- `specs/005-decision-engine-v1.md` — section 5.3's restatement caveat is resolved by pinned revisions; section 15 item 3's registry requirement points here.
- `context/19-glossary.md` — metric key, aggregation semantics, baseline, quality tier.
- `industry-packs/restaurant/domain-model.md` — `RestaurantMetric` becomes a registered definition set with keys, value kinds, and aggregation semantics.

## 16. References

- `specs/003-integration-hub.md`
- `specs/005-decision-engine-v1.md`
- `specs/008-ai-readiness-score.md`
- `specs/011-learning-ledger.md`
- `specs/012-channel-economics-ledger.md`
- `specs/014-switchback-experiments.md`
- `context/09-business-memory.md`
- `context/22-opportunity-backlog.md`
- `adrs/0006-use-industry-packs.md`
- `industry-packs/restaurant/domain-model.md`
