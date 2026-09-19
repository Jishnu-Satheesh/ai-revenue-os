# Overview growth — data, calculation and persistence contract

## D00 — Status and naming

- Product decisions approved: actual versus projected lines; separate colours/points/values; contextual advice; original projection fixed for the selected period.
- The technical decisions below are the proposed execution contract. Review them with the implementation plan before writing feature code.
- A new symbol/table/RPC named here is PROPOSED, not a claim that it already exists. Existing seams are identified in the discovery report.
- Proposed initial timing assumption A01: start on the next organization-local day and use rolling monthly periods. The timing question was presented separately; if the user selects calendar months, revise D01 and its tests before execution. Do not silently support two modes.
- Money fields ending Minor are signed safe integers in ISO currency minor units; displayed totals are not floats. Use BigInt intermediates for sums/rational rounding, reject results outside Number.MAX_SAFE_INTEGER. Do not serialize BigInt to the browser.
- All local dates use validated YYYY-MM-DD, not lexical labels parsed from chart text. Store instants as UTC timestamptz. Store the organization's IANA timezone with the projection and never reinterpret it later.

## D01 — Fixed periods, bootstrap and rollover

- Allowed horizonMonths: 1, 3, 6, 12. Default selected horizon: 1.
- First successful eligible build establishes scheduleOriginDate = the NEXT local calendar day after issuedAt. All four horizons start at that same prospective origin.
- If no valid candidate exists, do not establish an origin or fabricate a projection. Show the supported actual-data state and missing-input reason.
- A period uses startDate inclusive and endDateExclusive exclusive. UI prints endDateExclusive minus one day.
- Period dates for horizon H and cycle N: start = addLocalMonths(scheduleOriginDate,H×N); end = addLocalMonths(scheduleOriginDate,H×(N+1)). Always calculate from the original origin to avoid January31→February28→March28 drift.
- Each horizon rolls only when ITS own period ends. Selecting 3M does not start it over just because the 1M period rolled. Exact dates visibly change with the selector.
- During the local day before a period starts, the nightly worker may publish that next period using eligible source evidence available at issuedAt. DB publication rejects starts at/before the current local date and source evidence created after issuedAt.
- Retry on the same identity returns the original record. A later model result, source correction or feature-gate change cannot replace it.
- If a scheduled boundary was missed, leave that period without an original projection; do not backfill after its start. Retain actuals, identify the missing original and prepare the next scheduled period. This limitation must be visible; it is not a reason to use hindsight.
- No prior daily snapshots are silently converted into past fixed projections.
- A timezone change is shown as a scope/configuration change for active periods; retain frozen timezone and dates. New periods use the organization's new zone only at their next prospective boundary with that zone stated.
- On initial bootstrap show an upcoming projection until startDate; no current amount or ahead/behind comparison for a future period.
- There is no historical-period picker or revised-outlook switch in this slice. Storage preserves originals for audit and later product work.

## D02 — Scope and source qualification

- Projected and actual revenue must share revenue.gross, one effective definition/meaning, ISO currency, timezone and frozen reporting scope.
- Frozen ScopePartition fields: partitionKey, channelId, branchId (UUID or null for an explicitly organization-level total), metricDefinitionId, dimensionsDigest, periodTimezone.
- partitionKey is a server-generated canonical digest of those fields. Do not hash source order, labels or personal preference state.
- Read registry definitions by key with organization override precedence. Require active money-kind, sum aggregation and verified minor-unit convention. Do not assume any numeric numerator is revenue.
- Initial admitted shape is undimensioned revenue totals (dimensions empty object). Dimensioned item/campaign totals are excluded; no generic summing over potentially overlapping dimension values.
- Never add an organization-level channel total to its branch subtotals. Freeze either the admitted aggregate partition OR an explicitly exhaustive, disjoint branch set. If that relationship cannot be established, return SCOPE_NOT_COMPARABLE.
- Freeze the supported channel/branch set, and state partial organization coverage on the surface. New channels/branches do not join an active fixed period. Removed/inaccessible partitions prevent a complete comparison; they do not shrink the denominator.
- Normalize exact-range inclusive end dates to end-exclusive internally. For normalized timestamp facts, convert boundaries in the fact's recorded timezone; require complete local-day boundaries. Do not clip an observation crossing a period edge.
- Facts require current reconciliation, nonnull reconciliation digest, no superseding row and money-kind integer shape. Estimated/assumed observations do not become blue recorded revenue. Derived figures are eligible only when the source contract identifies them as deterministic aggregation of reported facts.
- Facts retain row ID, source table, source revision/digest, tenant, channel, branch, dates, currency and scope partition until arithmetic is complete.
- Do not use loadDailyMetricAggregates directly for this contract: it discards branch/dimension identities and adds spans on top of period rows. Keep that existing public API and its callers unchanged.

## D03 — Projection candidate and fixed curve

- Read a complete, comparable PREVIOUS calendar month's reported revenue over the frozen scope. The month must end no more than 45 local days before issue. This conservative proposed freshness bound is a named constant GROWTH_BASELINE_MAX_AGE_DAYS, covered by tests.
- A count of rows or the latest arbitrary analysis bucket does not prove that month's coverage. Use D05's interval-cover algorithm.
- Build a new RevenueScenarioInput for the existing buildRevenueScenario using that complete monthly baseline, not the old mapper's most recent arbitrary-grain point.
- Candidate action assumptions may be reused only if the source-owned action and cited finding are in the same tenant, frozen scope, compatible currency and that baseline window; existing validation/joint-group rules remain in force.
- Preserve explicit low/high response assumptions and qualified source identities. Do not sum ranking quantities, historical loss twice, gross profit into revenue, or a saved organization goal.
- If action amounts cannot be qualified, retain useful advice but do not count those amounts. A baseline-only fixed projection is allowed, labelled “Action impact is not included in this estimate.”
- This slice does not add model calls. The existing nightly candidate path may already propose ranges; publication consumes its validated results or a labelled baseline-only candidate.
- Freeze monthlyLowMinor and monthlyHighMinor from the deterministic candidate. Store central/range points at day-end dates through the selected horizon; at most 367 daily points plus the start anchor.
- Initial curve method version: even_pace_v1. Each complete local monthly segment carries the same frozen monthly low/high amounts, with no compounding.
- Within a monthly segment, cumulative bound = completedSegments×monthlyBound + floor(monthlyBound×elapsedCalendarDays/segmentCalendarDays). Use mathematical floor with BigInt even for negative values, not JavaScript truncation. The final day of a segment reaches its exact total.
- Segment boundaries use the original schedule origin and local calendar arithmetic. Calendar days, not milliseconds/86,400,000, determine DST-sensitive pacing.
- Central point = rounded rational midpoint of that day's low/high bounds; tie rule is half away from zero. low ≤ central ≤ high at every point.
- Store calculated points and the method/version. Browser reads them; it does not rebuild them using current model outputs, source values or a later algorithm version.
- The even-pace assumption must appear in details and briefly on the surface. It describes the estimate only. Actual monthly/weekly totals are NEVER spread into daily observations.
- A curve may have a declining expected increment if a later approved estimator supports it. Do not force monotonically growing actuals or hide negative adjustments.
- Numerical fixture for real algorithm tests: 30-day segment, monthly bounds11200000/12800000 minor; day21 bounds7840000/8960000, central8400000; final day11200000/12800000. The PNG's earlier illustrative 24k/52k points are VIEW fixtures, not outputs expected from this formula.
- Reject inconsistent/overflowed currency, dates, range ordering, point counts, digest or source lineage with fixed safe codes; never repair a frozen row on read.

## D04 — Proposed immutable storage and publication

- Table: public.organization_growth_projections.
- Columns: id uuid PK; organization_id uuid NOT NULL FK organizations(id); schedule_origin_date date NOT NULL; cycle_index integer NOT NULL ≥0; horizon_months smallint NOT NULL in(1,3,6,12); period_start date NOT NULL; period_end_exclusive date NOT NULL; issued_at timestamptz NOT NULL; source_cutoff_date date NOT NULL; timezone text NOT NULL; currency text NOT NULL length3 uppercase; metric_key text NOT NULL fixed revenue.gross; scope_digest text NOT NULL SHA256; input_digest text NOT NULL SHA256; document_version integer NOT NULL fixed1; method_version text NOT NULL fixed even_pace_v1; requires_growth_read boolean NOT NULL; requires_campaign_read boolean NOT NULL; frozen_document jsonb NOT NULL; created_at timestamptz NOT NULL default now().
- Unique key: organization_id,horizon_months,cycle_index. Enforce one scheduleOriginDate per organization inside the publication transaction. Projection rows are not deleted by the old 13-month snapshot trim.
- Index for active-period reads: organization_id,horizon_months,period_start DESC. Source rows need existing tenant/time indexes; inspect EXPLAIN on staging before adding any additional index.
- frozen_document keys: organizationId, scheduleOriginDate, cycleIndex, horizonMonths, startDate, endDateExclusive, issuedAt, sourceCutoffDate, timeZone, currency, metricKey, scopePartitions, baselineWindow, monthlyLowMinor, monthlyHighMinor, points, sources, actionAssumptions, limitations.
- Point keys: date, lowMinor, centralMinor, highMinor. Start anchor is zero before the first day's activity and explicitly distinguished from day-end observations in the document.
- sources contain opaque table/row/revision/digest identifiers, observation bounds and partition key, not raw workbook cells or customer payloads. actionAssumptions contain source kind/id/revision, cited finding id and validated low/high fractions; do not copy recommendation titles/descriptions into immutable storage.
- Bounds: ≤100 scope partitions; ≤2000 source references; ≤50 action assumptions; ≤368 points; ≤512 KiB document; ≤300 chars per limitation; ≤20 limitations.
- Validate identical tenant/date/currency/scope metadata between columns and JSON in Postgres as well as Zod. Finite safe-integer amounts, ISO dates, sorted unique points, end date, horizon and range order are mandatory.
- ENABLE/FORCE RLS. Revoke all client DML; grant authenticated SELECT only. Policy requires private.has_organization_permission(organization_id,'channel.read') and, when corresponding flags are true, growth_intelligence.read / campaign.read.
- No anon grant. No user-facing service-role client. Revoke direct service_role INSERT/UPDATE/DELETE so the worker uses the publication RPC.
- New public RPC publish_organization_growth_projection(p_organization_id uuid,p_document jsonb,p_correlation_id uuid) returns id,digest,published (boolean). SECURITY DEFINER with empty search_path, schema-qualified names, EXECUTE revoked from PUBLIC/anon/authenticated and granted only to service_role.
- The RPC acquires an organization-scoped transaction advisory lock, validates active organization/timezone, validates envelope/tenant-owned source references and schedule/period eligibility, and computes canonical digest server-side. All referenced metric definitions must be shared or owned by the same tenant; channels/branches/source observations must match the tenant. Derive requires_growth_read/requires_campaign_read from the admitted source kinds; never trust client/worker flags that claim fewer permissions than the stored document requires.
- New identity: verify source observations are not future-created, all date/scope qualification and arithmetic document checks pass; insert row and publication audit event atomically.
- Existing same identity: after tenant/envelope identity validation, return the existing row without any UPDATE, even if a new candidate digest differs. No second audit publication event. Log candidate conflict as a bounded diagnostic without source amounts.
- BEFORE UPDATE trigger refuses changes even for service_role. Direct DELETE denied by privileges; controlled organization deletion may cascade under owner privileges according to existing lifecycle policy. Do not introduce a retention/delete endpoint.
- Use the verified existing audit_events columns organization_id, event_name, actor_type, actor_id, entity_type, entity_id, correlation_id, payload. Set event_name=organization.growth_projection_published, actor_type=system, actor_id=null, entity_type=growth_projection, entity_id=projection id. payload contains only period dates, method version and digests. Recheck the live enum/columns before applying; do not invent action or metadata columns.
- Failure must leave neither a projection nor its audit event half-written. SQLSTATE/domain codes distinguish invalid envelope, source tenant mismatch, nonprospective period, scheduling mismatch and invalid curve.
- Migration filename: 20260918120000_organization_growth_projections.sql; pgTAP: organization_growth_projections_test.sql; type database.types.ts manually.
- Every new PL/pgSQL publication/validation/trigger function must be called in the rollback-wrapped hosted pgTAP suite at least once. A clean migration apply is not sufficient.

## D05 — Actual revenue and coverage algorithm

- New RevenueFact DTO: sourceTable ('normalized_metrics' or 'exact_range_metric_observations'), rowId, organizationId, partitionKey, startDate, endDateExclusive, amountMinor, currency, createdAt, reconciliationDigest. Repository verifies grain/value-kind/quality and normalizes to this DTO.
- New reader must retain source row identity. Scope SQL predicates include organization, metric IDs, channels, standing reconciliation and intersecting date bounds; post-read validation enforces each exact frozen partition. Querying a UUID globally and filtering afterward is forbidden.
- Bounded reads: paginate 500 rows in deterministic id/time order, maximum10000 facts for one view; fetching the extra row detects truncation. At cap return SOURCE_LIMIT_EXCEEDED, not a partial total. Resolve all four periods over their union date window once when possible.
- Do not manufacture partial observations: a row extending beyond a comparison endpoint is unavailable at that endpoint.
- For each partition, represent whole reported intervals as directed edges from startDate to endDateExclusive carrying the amount and source identity.
- At any candidate observation endpoint D, a valid cumulative amount requires an exact, nonoverlapping cover from periodStart through D for EVERY frozen partition.
- Deduplicate repeated identical identities. For duplicate equal-interval equal-value records across stores, treat them as equivalent alternatives, never add both. Keep provenance of which equivalent representative was selected.
- Use a chronological DAG/dynamic-programming interval cover. At each reachable end date retain a canonical finest-grain cover and its exact total. If another complete cover gives a DIFFERENT total, mark that endpoint ambiguous; do not choose whichever is larger/newer.
- Partial-overlap edges cannot both be used. A coarse interval may bridge missing daily reports only when it exactly covers the missing interval or the whole prefix; it never creates intermediate daily values.
- A candidate cover whose two paths converge to the same total is numerically equivalent; choose more fine-grained intervals, then normalized over exact-range for equal intervals, then lexicographic row id for deterministic provenance. Store at most two distinct reachable totals per endpoint to detect conflict without enumerating paths. Ambiguity propagates through a chosen prefix; a coarse total cannot wash away conflicting complete covers. Only corrected/superseded source records can remove that conflict. Missing coverage and conflicting coverage are distinct states.
- Compare across partitions only when all have exact coverage to the same endpoint. An observation of zero satisfies coverage; absence does not.
- Example: day1=10, day2=20 and a 2-day span=30 yield30, not60. If that span=35, the endpoint is ambiguous. Day1/day3 facts alone do not yield a day3 cumulative total. A whole-month fact can establish the month-end cumulative total without inventing days2..29.
- Candidate plot dates are actual observation endpoints plus selected projection dates. At noncomparable dates Current is null; future dates Current is null. Projection values come only from frozen points.
- On a missing/unmeasured span, do not connect the blue line across the gap as if a measured path exists. An isolated coarse endpoint is a blue point without intermediate invented observations.
- Latest comparison date is the latest endpoint with complete matching coverage and a projection point. It is not now(), the last worker run, the newest single-channel report or the month-end forecast.
- Source correction: reread current reconciliation standing; current values may change. Carry changed source revision IDs into the view so a “Reported figures were updated” note can be shown. Projection stays fixed.
- Rows outside scope remain excluded with an explicit scope label. Cross-currency totals, branch/aggregate mixtures, unresolved overlaps and incompatible timezone boundaries return typed unavailable reasons.

## D06 — Comparison and advice

- New compareGrowthPoint input: actualMinor (number|null), projectedLowMinor, projectedCentralMinor, projectedHighMinor (number|null for unavailable projection).
- Result fields: state ('behind'|'ahead'|'within_range'|'equal'|'unavailable'), differenceMinor (number|null), differencePercent (number|null), reasonCode (string|null).
- Missing/invalid actual or any projected bound yields unavailable. Exact equality to central yields equal. Otherwise actual<low →behind; actual>high →ahead; inclusive bounds →within_range.
- Difference = actual−central. Percent = round(100×difference/central) only when central>0. Use full amounts for classification, not rounded display labels.
- Behind fixture: actual6000000, low8000000, central8400000, high8800000 →behind,−2400000,−29.
- Ahead fixture: actual9800000 against same projection →ahead,+1400000,+17.
- actual8200000 →within_range,−2000000,−2; equality8400000 →equal,0,0; central0 →percent null.
- Right-panel evidence must match tenant and have intersecting admitted scope; factual claims must refer to an observation window ending no later than the displayed comparison date. Current action status may be newer but is explicitly labelled current status, not historical cause.
- Use existing source readers: channel findings/recommendations; Growth Intelligence synthesized items; Campaign proposals through its source-owned reader. Do not query another module's tables directly for convenience.
- New GrowthAdviceCandidate fields: id, kind ('finding'|'recommendation'|'proposal'|'insight'), title, supportingText, href|null, sourceRevision, sourceWindowStart|null, sourceWindowEnd|null, channelIds, branchIds, sourceStatus, evidenceRefs, relation ('recovery'|'expansion'|'general'), permission.
- Qualify relation deterministically from existing registered source kind/detector/action keys. Maintain an explicit mapping for keys actually found at execution; unknown keys are general, not guessed from model prose. The mapping is reviewed in Task5.
- Existing registered order-cancellation-loss findings can support “Review cancellation findings”. They do not prove the whole projection gap is due to cancellations. Unsupported status/evidence claims are omitted.
- Exclude dismissed, rejected, expired, deleted, snoozed and unavailable source records. Planned is eligible with intent wording; completed actions are evidence only where outcomes/attribution permit.
- Sort behind: admissible recovery then general recommendations; ahead: admissible expansion then general; within-range: source priority order. Ties: existing source priority if present, newest permitted evidence window, then source id. Max2 rows. Never use speculative money as an invented ranking score.
- If no qualified relation mapping exists for an action, show its source-owned title as general advice. Do not manufacture tailored reasons. No extra model call needed.
- Every link must be an existing organization-scoped destination with the user's permission; no guessed detail URL. If the source reader lacks a deep link, use the known source workspace and preserve source identity in the detail dialog.
- Keep the neutral fallback specified in V06 when explanatory evidence is insufficient. Useful advice is still allowed when financial impact is unquantified.

## D07 — Proposed public interfaces and file ownership

- src/domain/organizations/growth-progress.ts: Zod schemas and pure types ScopePartition, RevenueFact, FrozenGrowthProjection, GrowthComparison, GrowthProgressPoint; compareGrowthPoint; buildActualGrowthSeries; buildEvenPaceProjection. No database, node:crypto or model imports.
- src/domain/organizations/growth-periods.ts: resolveGrowthPeriod(scheduleOriginDate,horizonMonths,cycleIndex), nextProjectionIssueDate, calendar-day stepping. Returns validated inclusive/exclusive local dates; no machine-local date parsing.
- src/modules/organizations/application/growth-progress-ports.ts: GrowthProgressReadPort, GrowthProjectionWritePort and qualified candidate DTOs. Explicit method contracts below; these are new proposed exports.
- GrowthProgressReadPort.readProjections({organizationId,asOfDate}) → readonly FrozenGrowthProjection[]; at most active/upcoming row per horizon. Returns typed missing/corrupt/denied/read-failed envelopes rather than laundering errors into no-data.
- GrowthProgressReadPort.readRevenueFacts({organizationId,from,toExclusive,scopePartitions}) → readonly RevenueFact[].
- GrowthProjectionWritePort.publish({organizationId,document,correlationId}) → {projectionId,digest,published}. It cannot update/delete an original.
- src/modules/organizations/application/growth-projection-builder.ts: buildGrowthProjectionCandidate({organizationId,period,sourceCutoffDate,issuedAt,scope,baselineFacts,qualifiedScenarioInput}) → ready document or typed refusal.
- src/modules/organizations/application/growth-projection-publisher.ts: publishDueGrowthProjections({organizationId,now,timeZone,correlationId},dependencies) → published/replayed/skipped results per horizon; dependency interfaces name reads, candidate builder and publish boundary.
- src/modules/organizations/infrastructure/growth-progress-repository.ts: session-only projection/fact reads; qualified row parsing; tenant and source permission checks.
- src/modules/organizations/infrastructure/growth-projection-repository.ts: worker-only publication RPC adapter, server-only digest utilities. Never browser-imported.
- src/modules/organizations/application/growth-progress-service.ts: loadGrowthProgress({organizationId,actorId,now,timeZone,permissions},dependencies) → GrowthProgressSection. Parallelize independent reads; catch/report safe failures per source.
- src/modules/organizations/application/growth-progress-view.ts: browser-safe view types. GrowthProgressSection is disabled|failed|ready; ready contains initialHorizon=1 and a views map with keys1/3/6/12.
- Each GrowthProgressView contains horizonMonths, state, projectionId|null, projectionDigest|null, period, currency|null, scopeLabel, issuedAt|null, sourceCutoffDate|null, latestComparableDate|null, points[], latestComparison, adviceRows[], limitations[], freshness, sources[]. A point contains date,currentMinor|null,projectedLowMinor|null,projectedCentralMinor|null,projectedHighMinor|null,currentCoverage ('complete'|'missing'|'incomparable'),breakBefore (boolean).
- No raw frozen document or denied source titles enter the client view. sources[] contains permission-safe labels and already validated references for the details dialog.
- Extend home-types.ts with growthProgress: GrowthProgressSection; retain revenue: HomeSection<RevenueScenario> for disabled-flag rollback. When enabled, do not schedule the legacy revenue read/model path as well.
- HomeRevenue remains a thin orchestrator. New home-growth-chart.tsx owns plotting/interaction, home-growth-insight.tsx advice, home-growth-details.tsx method/table. Each has its own focused tests; shared scoped styling remains in the existing CSS module's growth/revenue block.
- Import leaf modules internally. If modules/organizations/index.ts exports the new API, export browser-safe types only; do not create a barrel path that drags worker crypto/server dependencies into Client Components.

## D08 — Worker, access and rollout

- New server-only env flag OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS, parsed with the existing allowlist convention; blank means disabled. Apply it to home loading AND publication, not navigation only.
- Reuse existing revenue-snapshots.dispatch and revenue-snapshots.build-org. Add a separately reported publication phase after validated candidate work, not a new paid generation job.
- Publication failure is not success merely because the mutable snapshot was stored. Return snapshotStored plus per-horizon projection result and safe code. Retry publication idempotently without silently regenerating/overwriting originals.
- Protect prospective timing at the DB boundary. If retry crosses the start boundary, return PERIOD_ALREADY_STARTED and leave the prior original intact or that missing period unavailable.
- Query active projection existence before optional candidate/model work for publication. Do not add extra model calls when no period is due.
- Existing dispatcher has a500-org cap. Ensure every allowlisted projection organization is considered via a bounded explicit allowlist lookup (≤100 entries) alongside the existing snapshot scan; deduplicate jobs by org/day. Do not silently truncate eligible projections.
- Trigger idempotency is transport protection; DB unique key/transaction lock is the authority. Use installed SDK global idempotency-key helper where global deduplication is needed; do not assume a raw string is global.
- Keep feature flags and permission requirements server-derived. Never accept organization/scope/permissions from a browser assertion.
- Read projection RLS under the member session; no privileged fallback for a denied row. Denial may leave actuals visible when channel.read is allowed but forecast source permissions are not.
- No schema backfill creates historical projections. No feature launch changes budgets, prices, campaigns, source metrics or approval status.
- No Trigger deployment during planning. During execution, verify target project/environment and deployed task version; the historical worker “complete” badge is not current deployment evidence.

## D09 — Limits, error codes and acceptance vectors

- Safe codes: PROJECTION_MISSING, PROJECTION_UPCOMING, PROJECTION_CORRUPT, PERIOD_ALREADY_STARTED, BASELINE_STALE, BASELINE_INCOMPLETE, SCOPE_NOT_COMPARABLE, CURRENCY_MISMATCH, SOURCE_LIMIT_EXCEEDED, SOURCE_READ_FAILED, PERMISSION_DENIED, POINT_OUT_OF_RANGE, MONEY_OVERFLOW, OVERLAP_CONFLICT.
- Preserve prior display on refresh failure with its period and observation date. Initial failures show a safe retry state; never a fake default revenue.
- User-visible retry refreshes reads only; it does not reforecast or publish.
- Property tests: serializable valid document; low≤central≤high; all periods/dates in bounds; no new actual future points; observation permutations leave totals unchanged; duplicate observation identities do not increase totals.
- Calendar tests: leapFebruary, January31 anchoring, DST23/25-hour days, UTC date different from org date, server clock independent from client locale.
- Tenant tests: A reads A, A cannot read B, anon/nonmember denied, channel-only viewer denied a projection requiring campaign source access, service-only RPC denied to every authenticated role including owner/admin.
- Immutability tests: concurrent same-key publish returns one id; changed candidate cannot alter row/digest/points; update blocked; old snapshot trim leaves projection intact; source corrections update only blue facts.
- Source tests: day/week/month/span exact covers, repeated identity, cross-store equivalent duplicate, conflicting full covers, partial overlaps, mixed branches, mixed currency, missing partition, known zero, negative correction, no daily facts, row-limit detection.
- Advice tests: forbidden source never fetched, denied titles absent from markup, same-time scope qualification, no unsupported causal text, unknown key stays general, Planned not completed, ahead state offers useful source-owned next steps.
- Operational tests: RPC audit is atomic, replay emits no duplicate, worker publication failure distinguishable from snapshot success, missed prospective cutoff not backfilled, new allowlisted org beyond legacy first500 still considered.
