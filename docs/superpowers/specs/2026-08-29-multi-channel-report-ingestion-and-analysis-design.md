# Multi-channel report ingestion and analysis

## Status

Proposed for user approval on 2026-08-29. This is a Tier 3 companion design for
`specs/018-governed-channel-intelligence.md`; it does not authorize production
code, migrations, RLS changes, Trigger.dev changes, fixture mutation, or hosted
staging writes.

`specs/018-governed-channel-intelligence.md` is currently claimed by another
active channel task in the shared worktree. Before implementation starts, this
document's accepted decisions must be reconciled into that canonical spec and
the companion document retained as design history.

## 1. Business outcome

An organization can upload the real reports it receives from Keeta, Noon,
EatEasily/Smile, and its offline store; approve exactly how each report is read;
and see the strongest analysis each source shape can truthfully support beside
the existing Talabat analysis.

The result is one Channels workspace with four honest states:

- a supported metric or analysis backed by current governed evidence;
- a report-window summary that is explicitly not a trend;
- a named data gap explaining which report is required next; or
- evidence held for mapping, reconciliation, scope, or privacy review.

The program optimizes for trusted decisions, not the number of files imported.
A provider is not considered supported merely because a workbook opens or a
template exists in code.

## 2. Success criteria

Release completion means all of the following are true:

- Keeta, Noon, EatEasily/Smile, and Offline each have at least one real-fixture
  path from private upload through approval, deterministic projection, current
  evidence, and an operator-readable channel result.
- Talabat continues to use its existing path without provider-specific branches
  being added to platform-core workflow or database code.
- Keeta daily revenue, orders, impressions, and promotion funding can support a
  daily or monthly audit when their periods and branches are comparable.
- Noon and EatEasily/Smile exact-range totals support a cited report-window
  summary and derived average order value, but never a fabricated daily trend.
- Offline monthly P&L values support a cited monthly finance summary only after
  source scope is explicitly attested. If the P&L includes marketplace trade,
  the Offline channel remains `needs_data` until a POS or offline-only sales
  export is supplied.
- Every visible number resolves to a current normalized metric or exact-range
  observation, its approved contract and projection, its source package, and
  its calculation version.
- Another organization cannot read metadata, results, evidence, report-set
  membership, private objects, or signed URLs belonging to the pilot tenant.
- No model reads or writes financial values, approves mappings, assigns data
  quality, chooses source authority, or converts an unavailable metric into a
  business fact.

## 3. Current starting point

The implementation already has the common governed spine:

- organization-owned channels, aliases, and branch mappings;
- private CSV/XLSX/PDF package intake and structural profiling;
- immutable contract and projection versions with human approval;
- deterministic validation, exact-range and period-grain projection;
- duplicate/overlap reconciliation and append-only lineage;
- current-evidence analysis runs, cited findings, recommendations, and human
  triage; and
- five checked-in, inert provider definitions proven against the private real
  fixtures by `provider-library.integration.test.ts`.

The five existing definitions are Talabat performance, Keeta billing summary,
Keeta restaurant daily, Noon sales summary, and EatEasily/Smile branch sales.
They are mapping templates, not tenant approvals. The remaining gap is not a new
ingestion engine; it is report-shape-aware analysis, provider-family
qualification, multi-file authority, and the offline matrix layout.

## 4. Real-fixture inventory and support boundary

The fixture directory is private and gitignored. Tests may read it locally, but
tests, logs, snapshots, documentation, and client responses must contain only
structural facts and hand-derived synthetic examples, never business values,
customer rows, contact details, or source filenames beyond the already-approved
fixture names.

| Channel                       | Real source shape                                                       | Initial governed outputs                                                   | Program treatment                                                     |
| ----------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Keeta billing                 | Four-sheet XLSX; daily billing sheet with three header rows             | `revenue.gross`; commission and bank fee bound but not yet projected       | Core Keeta source; daily projection                                   |
| Keeta restaurant              | Daily XLSX; compact dates and dash-as-absence                           | `transactions.count`, `promotion.funding`, `listing.impressions`           | Core Keeta source; daily projection                                   |
| Keeta orders                  | Order-detail XLSX                                                       | Bounded aggregate order and cancellation counts after filter support       | Later Keeta family; no row persistence                                |
| Keeta promotions              | Daily XLSX with a duplicated normalized header                          | Bounded promotion totals after exact header-occurrence selection           | Later Keeta family; no silent first-column choice                     |
| Keeta items                   | Item-detail XLSX                                                        | None in this program                                                       | Intake/profile only until governed menu-subject matching exists       |
| Keeta PDFs                    | Commission invoices, statement, POS-fee invoice; all text-layer PDFs    | Arithmetic controls only where an XLSX is authoritative                    | Control documents, not duplicate primary sources                      |
| Noon sales                    | Exact-range sales sheet with descriptive rows before the value row      | `revenue.gross`, `transactions.count`                                      | Exact report-window summary                                           |
| Noon customer                 | Exact-range customer-funnel sheet                                       | Approved event counts; provider rates ignored                              | Later Noon family; derive rates only from counts                      |
| EatEasily/Smile branch sales  | Exact-range branch rows plus declared totals row                        | `revenue.gross`, `transactions.count`                                      | Core Smile source; exact report-window summary                        |
| EatEasily/Smile day orders    | Daily rows with an organization-specific branch name as a heading       | Tenant-approved daily order mapping                                        | Guided mapping, not a global checked-in header                        |
| EatEasily/Smile agent handled | Small exception/support subset                                          | Named exception count only after semantic approval                         | Supplementary evidence, never authoritative sales                     |
| EatEasily/Smile customer-wise | Customer names and contact numbers                                      | None                                                                       | Excluded from this program because it carries PII                     |
| EatEasily/Smile compensation  | Header-only/empty workbook                                              | None                                                                       | Visible `needs_data`; no support claim from an empty fixture          |
| Offline P&L                   | Multi-page text-layer PDF; months across columns and accounts down rows | Sales and finance rows by month after matrix support and scope attestation | Offline-only source if attested; otherwise not projected to a channel |

EatEasily and Smile are treated as aliases for one organization-owned channel
unless the operator explicitly creates separate channels because the business
receives independently settled trade from each name. A provider label never
creates or merges a channel by itself.

## 5. Governing decisions

### 5.1 Support is qualified per report family and organization

A checked-in provider definition is an inert proposal. It becomes usable only
after an owner/admin approves the exact tenant contract and projection for the
real package fingerprint. A new provider export, changed fingerprint, changed
financial sign, or changed source-scope statement pauses for review.

Support states are:

- `provisional`: a real fixture passes pure validation and projection tests;
- `tenant_approved`: the organization approved the exact contract/projection;
- `staging_proven`: hosted staging completed validation, projection,
  reconciliation, analysis, RLS, and worker checks; and
- `needs_review`: the schema, scope, control, or semantics changed.

UI copy may say a report family is recognized at `provisional`, but may say its
data is available only from `tenant_approved` current evidence.

### 5.2 Report shape determines which analysis is allowed

There are three supported analytical shapes:

1. **Period series** — one governed value per day, week, or month. It may support
   coverage, movement, funnel, mix, and other compatible time analysis.
2. **Exact report-window summary** — one governed value for an inclusive start
   and end date. It may support totals and ratios whose inputs cover the exact
   same window, channel, branch, timezone, and currency. It may not support a
   daily/monthly trend, period movement, missing-day claim, or proration.
3. **Matrix period series** — row labels identify metrics and columns identify
   months. After a versioned matrix contract reconstructs those cells, the
   result becomes ordinary monthly `normalized_metrics`; downstream analysis
   does not learn that the source was a matrix or PDF.

Current exact-range observations are added to the pure analysis evidence model.
A detector must declare which shapes it accepts. It may never combine a series
and a window total into one calculation or treat an arbitrary overlapping total
as one period.

### 5.3 Exact-range summaries are visible but never masquerade as trends

The channel workspace may show a `Report summary` for Noon or Smile with its
declared inclusive dates. A summary can report gross revenue, successful orders,
and average order value derived as a ratio of those two cited totals.

The summary has no sparkline, period movement, daily coverage percentage, or
month-over-month language. If its dates do not exactly match the requested
summary window, the detector returns `needs_data`. Monthly analysis introduced
by ADR 0043 remains separate: a January-to-February total cannot answer January
or February individually.

### 5.4 Derived average order value stores its numerator and denominator

`order.average_value` is derived from `revenue.gross` minor units divided by
`transactions.count`, with both inputs carrying the same channel, branch,
inclusive period, source shape, and—in a period series—the same observed period
set. It is represented as a ratio with the money currency retained; the quotient
is formatted only at the presentation boundary.

Zero transactions, mixed currency, mismatched periods, unequal series coverage,
mismatched branches, held evidence, or one missing input produces `needs_data`.
A provider's own AOV or conversion percentage is not copied when its component
counts are available.

### 5.5 A report set groups files; it does not silently sum them

A provider can issue several files for one channel and period. An
`integration_report_set` records that shared channel, branch, period, timezone,
and currency. Members have one declared role:

- `source`: eligible to project metrics the member's approved declaration owns;
- `control`: supplies checks against a source package and does not project the
  duplicated business figure; or
- `supplementary`: supplies distinct metrics but is not a financial total for
  the set.

Membership does not override ledger reconciliation and does not create source
precedence by filename or upload time. If two sources project the same metric
over an overlapping range, the existing reconciliation path still holds the
candidate. A human changes the contract/member role; code never picks a winner.

### 5.6 The declaration language grows only against observed shapes

Existing v1 row-oriented contract and projection documents remain immutable.
The next version adds only these bounded capabilities:

- select a duplicated normalized header by one-based occurrence;
- apply an approved equality/inclusion row predicate over a bound field;
- count admitted rows without persisting them;
- normalize a validated money source sign with `preserve` or `absolute` only;
- declare a matrix sheet with one row-label column and one period-column axis;
- parse an explicit `month_name_year` period heading; and
- validate one declared add/subtract arithmetic identity over projected money
  outputs with a minor-unit tolerance.

There is no arbitrary expression language, regular-expression transform,
generated code, SQL, model calculation, cross-file join, currency inference,
fuzzy row-label matching, or unbounded grouping.

### 5.7 Offline P&L requires source-scope attestation

The supplied P&L contains delivery-partner commission, so its filename is not
proof that every number belongs only to offline trade. The mapping approval must
ask one explicit question: does this statement cover only the selected offline
branch/channel?

- If yes, the decision records the actor, contract version, selected branch,
  channel, period, and attestation version. The monthly matrix may project.
- If no or unknown, the package remains retained/profiled but returns
  `SOURCE_SCOPE_NOT_CHANNEL_SPECIFIC`; no sales or cost row is written to the
  Offline channel. The next input is an offline-only POS/daily-sales export.

The program does not add a fake “all channels” channel, subtract marketplaces
from the P&L to infer offline trade, or introduce organization-wide accounting
scope under a channel ID.

### 5.8 Financial statements and contribution margin stay separate

The P&L may report Sales, Cost of Goods Sold, Packing & Consumables, Gross
Profit, Operating Expenses, Operating Profit, and Net Profit/Loss. These are
finance observations. Fixed operating expenses are never inserted as variable
cost components or allocated across orders.

Keeta commission/bank fee, Smile commission, and offline food/packing amounts
may be projected as measured cost metrics after their tax/sign semantics are
approved. This program may show those measured costs in the Money/Finance
chapter. It does not compute or display contribution margin until the currently
draft portions of `specs/012-channel-economics-ledger.md` are explicitly
approved and the sourced-cost precedence rule is implemented and tested.

### 5.9 Detail rows are transient; PII is excluded

Order, item, promotion, and customer workbooks are untrusted private inputs.
Workers may transiently aggregate an approved set of non-PII fields, but no raw
row, order ID, customer name, phone number, formula, cell value, signed URL, or
provider document text enters Postgres, application logs, events, snapshots, or
model prompts.

The EatEasily customer-wise export is not admitted to projection in this
program. Keeta item data remains profile-only until a separate governed
menu-subject matching design exists; arbitrary item names are neither bounded
dimensions nor stable subject IDs.

## 6. Operator experience

### 6.1 Upload and mapping

1. The operator selects the organization channel and branch, declares the
   inclusive period/currency, and uploads directly to private Storage.
2. Structural matching offers one recognized family only when the profile
   matches exactly. Otherwise guided mapping shows detected structural labels.
3. The approval summary states the source shape, mapped metrics, financial sign,
   period source, ignored sheets/fields, totals/controls, report-set role, and
   source-scope attestation where required.
4. Owner/admin approval creates immutable contract and projection versions.
5. Validation, projection, reconciliation, and analysis run behind their
   existing deterministic fences.

The operator never edits raw JSON. Advanced evidence remains available as a
receipt, not as the primary interaction.

### 6.2 Channel workspace

The existing route `/organizations/[organizationId]/channels/[channelId]`
remains the canonical destination. It renders only chapters supported by the
selected channel's current evidence:

- **Verdict / Summary:** governed revenue, orders, AOV, current window, evidence
  shape, coverage qualification, and trust state.
- **Revenue:** series/trend only for period-grain evidence; report-window total
  otherwise.
- **Funnel:** only from approved count pairs. Missing stages remain explicit.
- **Orders / Operations:** only from admitted aggregate evidence.
- **Promotions:** funding/order facts; no incrementality or ROI without a
  registered baseline.
- **Money / Finance:** measured commission/fee/food/packaging and P&L facts,
  clearly separated from contribution margin.
- **Items / Customer voice:** `needs_data` until a separate safe source exists.

Every chapter shows `reported`, `derived`, `partial`, `needs_data`, or
`held_for_review`. An empty chapter is never interpreted as an all-clear.

### 6.3 Cross-channel portfolio

Portfolio comparison uses only compatible channels with the same inclusive
dates, grain/shape, timezone, and currency. Incompatible channels stay visible
with the reason they were excluded. The current fixture periods do not permit a
marketplace-versus-offline comparison: marketplace files cover January/February
2026 while the P&L columns cover later months. The UI must not align them by
position or call them one window.

## 7. Architecture and data flow

### 7.1 Provider library

Provider definitions remain pure checked-in data under
`src/domain/reports/provider-library`. Recognition uses structural profile and
declared context only. Definitions may include a `qualificationStage`, `shape`,
and default report-set role for presentation, but none grants tenant approval.
`qualificationStage` is limited to `provisional`, `staging_proven`, or
`needs_review`; `tenant_approved` is derived from the organization's immutable
database decisions and never checked into a global template.

Organization-specific dynamic headings, such as an EatEasily branch name, use
guided mapping and an organization-scoped approved contract. They are not
checked into a global template or normalized into a provider-wide wildcard.

### 7.2 Contract, projection, and validation

The v2 schemas are discriminated unions. V1 documents parse unchanged and keep
the same digest. Unknown v2 operations fail closed. Database JSON validators,
TypeScript Zod schemas, canonical digests, approval copy, pure projectors,
workers, and completion RPCs must widen together; the database-agreement test
is a release gate.

Matrix projection produces ordinary monthly observations with:

- metric definition and output key;
- branch/channel identity from the approved package;
- local month start/end and recorded timezone;
- integer minor-unit money and ISO currency;
- current reconciliation state, version, lineage, contract/projection IDs; and
- no raw row label or PDF cell text beyond bounded approved structural labels.

### 7.3 Analysis evidence and detectors

`AnalysisEvidence` gains current exact-range points beside period-grain points.
Both carry current-state, period, channel, branch, metric, value, currency, and
projection lineage. Series points retain their metric quality tier. Exact-range
points retain the exact ledger's `quality_state` and `completeness_state`; those
states are not relabelled as metric quality tiers. Exact-range points cite
`exact_range_metric_observation`; series points continue to cite
`normalized_metric`.

Detector declarations state accepted shapes and exact-range quality states.
They also separate `inputMetricKeys`, which the evidence loader reads, from
`outputMetricKeys`, which the completion fence admits as derived result
vocabulary. The first new detector is `commerce.average_transaction_value`,
calculation version 1; it reads `revenue.gross` and `transactions.count` and
emits `order.average_value`. Existing `revenue.window_gross` gains a new
calculation version that may use exactly one matching current exact-range total
only when no series is being combined with it. Trend, coverage, funnel, and
other detectors remain shape-specific.

The database already admits current exact-range citations. The read repository,
worker payload, pure types, result digest, tests, and registry-version admission
must be extended as one slice.

### 7.4 Report sets

Two organization-scoped tables are added:

- `integration_report_sets`: organization, channel, branch, inclusive local
  period, timezone, currency, lifecycle state, creator, correlation ID, and
  timestamps; and
- `integration_report_set_members`: organization, report set, report package,
  proposed member role, immutable approval/rejection outcome, deciding actor,
  and timestamp.

Every foreign key is tenant-composite and indexed. Tables force RLS. Signed-in
members with `report.read` may read; operator upload permission may create sets
and add unapproved members; only owner/admin approval permission may change a
member's authority role. There is no delete after a member participates in an
approved contract/projection; corrections create a successor set or membership
decision.

### 7.5 Workflow

Postgres continues to own claim, lease, retry, idempotency, eligibility,
transition, current-state, and audit decisions. Trigger.dev receives identifiers
only. Projection completion is authoritative only after the database rechecks
tenant, package, branch/channel, contract/projection binding, report-set context,
metric definition, declared period, value shape, lineage, and reconciliation.

Successful projection may dispatch analysis. Narration remains a separate
best-effort worker; a provider/model outage cannot remove deterministic findings.

## 8. Data model and schemas

### 8.1 New persistent records

Only report-set identity/membership requires new business tables in this
program. Exact-range analysis reuses `exact_range_metric_observations`,
`channel_analysis_runs`, `channel_findings`, and `channel_finding_evidence`.
Matrix outputs reuse `normalized_metrics` and existing projection lineage.

If implementation reveals that a proposed value cannot fit those existing
append-only records without weakening their constraints, the work stops for a
spec/ADR amendment rather than adding a generic JSON payload.

### 8.2 Metric vocabulary

Existing keys reused:

- `revenue.gross`
- `transactions.count`
- `listing.impressions`
- `listing.menu_views`
- `listing.cart_additions`
- `listing.placed_orders`
- `promotion.funding`
- `order.average_value`
- the existing cancellation/customer/operations metrics where a source truly
  supplies their components.

New finance/cost keys, if approved in their implementation slice, are
Restaurant Pack or core-finance registry entries rather than columns added to a
platform table. Their exact key, value kind, aggregation, economics role, and
cost-component relationship must be recorded in the spec 012/015 amendment and
migration seed before a provider definition may reference them.

### 8.3 Money and ratios

Money remains integer minor units plus ISO currency. Negative provider cost
columns retain their declared source sign in the contract, then project under
one approved canonical sign rule. A ratio stores numerator and denominator;
display division specifies a deterministic rounding rule and never writes the
quotient back as source evidence.

## 9. API and event changes

Existing report-package, contract, projection, reconciliation, analysis, and
recommendation routes remain organization-scoped.

New report-set routes:

- `GET /api/organizations/:organizationId/report-sets`
- `POST /api/organizations/:organizationId/report-sets`
- `GET /api/organizations/:organizationId/report-sets/:reportSetId`
- `POST /api/organizations/:organizationId/report-sets/:reportSetId/members`
- `POST /api/organizations/:organizationId/report-sets/:reportSetId/member-decisions`

Mutations require an idempotency key and return a typed domain outcome rather
than equating HTTP completion with success.

New stable events:

- `report_set.created`
- `report_set.member_added`
- `report_set.member_role_decided`
- `report.source_scope_attested`

Events contain identifiers, roles, safe states, actor, and correlation ID only.
They contain no workbook values, row labels beyond registered structural keys,
customer data, object paths, or URLs.

## 10. AI behavior

A model may:

- propose a bounded mapping from value-free structure after organization policy
  permits it;
- explain a stored deterministic finding in plain language with exact citations;
  and
- recommend a human investigation or operational action supported by that
  finding.

A model may not:

- read raw values for a checked-in or guided mapping in this program;
- approve a contract, projection, source-scope attestation, report-set role, or
  reconciliation decision;
- compute, alter, convert, interpolate, or allocate a financial value;
- decide that two reports are authoritative duplicates;
- infer an offline value by subtracting marketplace totals;
- expose or summarize customer-wise PII; or
- turn a missing stage, empty report, or incompatible period into zero.

## 11. Security and tenancy

- Every new public table enables and forces RLS.
- Policies use tenant membership/permission predicates and tenant-leading
  indexes; `TO authenticated` is never the authorization by itself.
- All tenant foreign keys include `organization_id` and their referencing
  columns are indexed.
- Request paths use the signed-in Supabase session. Service role appears only in
  fenced workers and cannot call member-decision RPCs.
- Security-definer functions set `search_path = ''`, validate `auth.uid()` or a
  worker-only boundary as applicable, revoke default `PUBLIC` execution, and
  grant only the exact caller role.
- Storage stays private and tenant-prefixed. Upload and download intents verify
  exact object identity and permission.
- The API and UI receive safe summaries and evidence identifiers, not raw
  workbook/PDF content.
- Every cross-tenant negative test uses two users and two organizations and
  attempts direct table, RPC, API, and signed-object access.

## 12. Failure states

- `REPORT_FAMILY_UNRECOGNIZED`: use guided mapping; no guessed provider family.
- `REPORT_FAMILY_SCHEMA_DRIFTED`: new approval required.
- `DUPLICATE_HEADER_SELECTOR_REQUIRED`: the contract did not identify the exact
  occurrence; no first-match fallback.
- `ROW_FILTER_VALUE_UNRECOGNIZED`: the provider changed an approved status
  vocabulary.
- `EXACT_RANGE_WINDOW_MISMATCH`: a report total cannot answer the requested
  dates.
- `ANALYSIS_SHAPE_INCOMPATIBLE`: the detector does not accept the evidence
  shape.
- `REPORT_SET_CONTEXT_MISMATCH`: member channel, branch, period, timezone, or
  currency differs from its set.
- `REPORT_SET_AUTHORITY_CONFLICT`: more than one member is declared source for
  the same governed output; projection remains held/reconciled.
- `SOURCE_SCOPE_NOT_CHANNEL_SPECIFIC`: offline P&L cannot be assigned to the
  selected channel.
- `MATRIX_PERIOD_HEADER_UNRESOLVED`: a declared month column is missing,
  duplicated, or ambiguous.
- `MATRIX_ROW_LABEL_UNRESOLVED`: a required exact row label is missing or
  duplicated.
- `MATRIX_ARITHMETIC_CONTROL_MISMATCH`: reconstructed money does not satisfy the
  statement's declared identity.
- `PII_REPORT_NOT_SUPPORTED`: the file is retained only according to failed
  upload policy and never projected or sent to a model.
- `EMPTY_REPORT_HAS_NO_PROJECTABLE_EVIDENCE`: package history is visible and the
  channel reports `needs_data`.

All failures are safe codes with operator guidance. Logs add organization,
package, set, run, worker, and correlation identifiers where available, never
source values.

## 13. Observability

Track, per organization and report family:

- packages by support stage and lifecycle state;
- recognized, guided, drifted, and rejected profiles;
- validation/projection latency and typed failure code;
- report-set completeness and authority conflicts;
- current, held, superseded, and excluded evidence counts;
- analysis outcomes by detector and evidence shape;
- exact-range summary refusals by mismatch reason;
- matrix reconstruction/control failures;
- PII/empty-report refusals; and
- model narration success separately from deterministic analysis success.

No metric label or trace includes organization names, filenames, business
values, customer identifiers, row contents, or signed URLs.

## 14. Delivery slices

### Slice 0 — canonical design and fixture qualification

- Reconcile this approved design into spec 018 and add the report-shape/source-
  authority ADR.
- Preserve all five existing provider-definition real-fixture tests.
- Add a value-free support manifest that names every fixture as recognized,
  guided, control-only, profile-only, PII-refused, or empty-needs-data.

### Slice 1 — Keeta core vertical slice

- Use the existing billing and restaurant definitions.
- Add the shape-safe AOV detector and exact evidence citations needed by later
  summaries.
- Prove tenant approval, validation, daily projection, reconciliation, analysis,
  UI, and hosted staging for the two real Keeta XLSX files.
- Do not wait for order/item/promotion detail or economics margin.

### Slice 2 — Noon and EatEasily/Smile exact summaries

- Load current exact-range observations into analysis.
- Emit report-window revenue, order, and AOV outcomes with exact citations.
- Render explicit summary/no-trend UI and source-context limitations.
- Prove the real Noon sales and EatEasily branch-sales files separately on
  staging.

### Slice 3 — report sets and auxiliary provider families

- Add report sets, membership roles, approval, RLS, API, and UI.
- Add duplicated-header occurrence, bounded row filters, and admitted-row count.
- Qualify Keeta order/promotions aggregates and PDF controls.
- Qualify EatEasily day orders through organization-specific guided mapping.
- Keep Keeta items profile-only, EatEasily customer-wise refused, and empty
  compensation as `needs_data`.

### Slice 4 — measured cost and finance evidence

- Amend and approve specs 012/015 for named cost/finance metrics before seeding
  them.
- Project approved Keeta/Smile commission and fee evidence and display reported
  amounts without claiming contribution margin.
- Keep economics recomputation behind a separate explicit approval gate.

### Slice 5 — offline matrix/P&L vertical slice

- Add v2 matrix contract/projection and arithmetic controls.
- Add the exact Offline P&L provider definition and source-scope approval copy.
- Project monthly finance evidence only after offline-only attestation.
- Show revenue/finance facts and named margin/POS gaps; never allocate fixed
  overhead or compare non-overlapping fixture periods.

### Slice 6 — unified portfolio and release proof

- Make supported/summary/needs-data/held states consistent across all channel
  pages and the Channels portfolio.
- Run full automated, hosted-staging, RLS, worker, browser, documentation, and
  rollback gates one slice at a time.

## 15. Acceptance criteria

- Every provider family in the inventory has one explicit disposition; no file
  is silently ignored.
- Each enabled checked-in definition still matches only its own real fixture.
- Keeta daily files project all declared outputs and create no duplicate revenue
  or order authority.
- Noon and Smile totals render only for their exact declared range and create no
  daily points, period movement, or missing-day claims.
- AOV cites revenue and transaction evidence and refuses zero/missing/mismatched
  inputs.
- Report-set context and authority are human-approved, tenant-scoped, audited,
  and unable to bypass existing reconciliation.
- Duplicate normalized headers cannot project without an occurrence selector.
- Detail reports persist only aggregate evidence and bounded lineage.
- PII and empty reports produce explicit safe outcomes and no projection.
- Matrix extraction fails when a required row/month is ambiguous or its
  arithmetic control disagrees.
- Offline P&L cannot project without offline-only scope attestation; a negative
  attestation requests POS evidence.
- Fixed operating expenses never become variable cost components.
- Cross-channel comparison excludes incompatible periods/shapes/currencies with
  an explanation rather than coercion.
- Every new table/RPC passes two-tenant direct-access tests and least-privilege
  review.
- Every new PL/pgSQL function is invoked once against hosted staging after its
  reviewed forward-only migration is applied.
- Deterministic analysis remains visible when narration fails.

## 16. Test plan

### Pure and property tests

- Provider support-manifest completeness and one-definition-only recognition.
- Exact-range versus series detector eligibility, exact-period matching, AOV
  ratio-of-sums, zero denominator, mixed currency, branch mismatch, and held
  evidence.
- Header occurrence selection, approved row filters, unknown status refusal,
  row-count aggregation, and unchanged v1 document digests.
- Matrix month parsing, wrapped labels, duplicate/missing rows, sign handling,
  exact fixed-point arithmetic, add/subtract controls, and deterministic output.
- Absence remains absence and no projector creates a dense series from gaps.

### Database and RLS tests

- Report-set tables, composite foreign keys, indexes, forced RLS, read/mutate
  permission matrix, append-only history, idempotent replay, and role conflict.
- Registry-version admission and current exact-range citation fencing.
- Contract/projection v2 JSON allowlists agree with TypeScript schemas.
- Matrix completion rechecks tenant, lease, package, contract, projection,
  metric, period, currency, lineage, and reconciliation.
- Two organizations cannot cross-link a set, member, package, branch, channel,
  observation, or evidence citation.

### Integration and worker tests

- Every real recognized fixture validates and projects through the real parser;
  assertions reveal no values.
- Every unclaimed file receives its explicit support-manifest disposition.
- Keeta multi-file output remains idempotent and safe under retry/reordering.
- PDF controls never duplicate XLSX source evidence.
- No raw cells, rows, PII, prompts, object paths, or signed URLs appear in
  responses, events, traces, or logs.

### End-to-end and browser acceptance

- Owner/admin approves; operator uploads but cannot approve; viewer is read-only.
- Keeta shows daily evidence; Noon/Smile show exact summary/no trend; Offline
  requires scope confirmation and shows monthly finance only when approved.
- Drift, overlap, report-set conflict, PII refusal, empty report, and narration
  failure each have an actionable visible state.
- Desktop, 390-pixel mobile, keyboard, screen-reader labels, and 200% zoom are
  checked against real staging records.
- Browser acceptance remains a user/operator walkthrough when authenticated
  credentials are unavailable; automated checks are not reported as manual
  acceptance.

## 17. Migration, rollout, and rollback

Migrations are additive and forward-only on hosted staging. Each schema slice is
created with `supabase migration new`, reviewed before apply, dry-run, applied by
the migration owner, tested with focused hosted pgTAP, checked with database
advisors, and exercised through every new PL/pgSQL function.

Feature flags independently gate:

- exact-range summary analysis;
- report-set creation/authority decisions;
- advanced row-contract v2;
- measured cost/finance projection;
- offline matrix projection; and
- each provider family's auto-recognition.

Disabling a flag stops new work and hides unsupported calls; it does not delete
packages, contracts, projections, observations, findings, report sets, decisions,
or audit evidence. A provider definition can be removed from recognition while
already approved tenant contracts remain readable. Corrections use successor
contracts/projections/evidence, never mutation of history.

## 18. Documentation and durable decisions

Before implementation, update:

- `specs/018-governed-channel-intelligence.md` with this program and current
  provider matrix;
- `specs/012-channel-economics-ledger.md` only when measured cost/economics is
  approved;
- `specs/015-metric-registry-and-normalized-metrics.md` for any new registered
  finance/cost metrics;
- one ADR covering report-shape-specific analysis, report-set source authority,
  and bounded matrix projection;
- `README.md`, `context/03-architecture.md`, `context/04-domain-model.md`,
  `context/05-module-map.md`, `context/12-integrations.md`,
  `context/13-ui-ux-context.md`, and `context/19-glossary.md`; and
- the Restaurant Industry Pack report-family, metric, and cost catalogues.

The ADR must explicitly extend ADRs 0027–0031 and 0036 without changing the
principle that v1 declarations are immutable, exact-range totals are not time
series, and the model is never financial authority.

## 19. Locked assumptions and dependencies

- The existing real fixtures are private qualification inputs, not seed data or
  test snapshots committed to git.
- AED, the declared package period, selected branch, and organization timezone
  remain human-confirmed context where the source does not state them.
- EatEasily and Smile are aliases for one channel for this pilot unless the
  operator explicitly models them separately.
- The supplied offline P&L is treated as unproven channel scope. No implementation
  assumes it is offline-only from the filename.
- If the organization confirms that the P&L includes marketplace activity, an
  offline-only POS/daily-sales export becomes a release dependency for Offline
  revenue and orders; subtraction is not an alternative.
- Contribution-margin calculation remains outside this program until the draft
  authority in spec 012 is separately approved.
- ADR 0043 monthly analysis may land independently. It does not gain authority
  to split an exact January-to-February total into monthly values.

## 20. Non-goals

- Claiming every file a provider offers is supported.
- OCR, scanned PDFs, legacy `.xls`, arbitrary formulas, macros, external links,
  generated transforms, or model-read values.
- Persisting order/customer/item rows or adding customer identity analytics.
- Item profitability before menu-subject matching and cost evidence exist.
- Promotion incrementality/ROI without a registered baseline and comparison.
- Currency conversion, proration, inferred branch allocation, fixed-overhead
  allocation, accounting reconciliation, tax filing, or realized-impact claims.
- Provider writes, campaign execution, discounts, prices, budgets, menu changes,
  or any autonomous action.
