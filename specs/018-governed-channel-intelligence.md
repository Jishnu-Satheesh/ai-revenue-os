# Feature Specification: Governed Dynamic Channels and Marketplace Intelligence

## Status

Approved. The user approved ADR 0026, the comparison-led landing direction, and the chapter-indexed channel-workspace direction on 2026-08-20. Implementation is in progress; this document remains the source of truth for the release gates that are not yet complete.

This is a large Tier-3 program. ADR 0026 records the durable architecture decision. The
Superdesign comparison required by section 18 is a separate approval gate before production TSX.

## 1. Business outcome

Give every organization a trustworthy, industry-neutral way to define how it sells, import the
reports those channels actually provide, understand what each channel earns and costs, and act on
evidence-backed recommendations without giving a model financial or operational authority.

Release 1 succeeds when the pilot restaurant can compare Noon, Talabat, Keeta, Smile, direct web,
and offline trade in one workspace while every displayed result remains traceable to its source
workbook, approved mapping contract, deterministic calculation, and quality limitations.

The optimization target remains incremental gross profit protected or created. Gross sales,
orders, traffic, promotions, and ratings are diagnostic inputs rather than success by themselves.

## 2. Problem statement

The existing implementation has three production gaps:

- Channels are stored as free text in onboarding, normalized metrics, economics entries, and cost
  rates. This cannot provide stable identity, branch applicability, aliases, archival behavior, or
  safe joins as organizations add arbitrary channels.
- Integration Hub imports manual values and bounded CSV files, while real marketplace exports are
  commonly multi-sheet XLSX workbooks whose schemas vary by provider and sometimes by reporting
  period.
- Channel Economics accurately computes a narrow contribution-margin view, but it does not yet
  expose the broader money, funnel, operations, item, promotion, customer-voice, recommendation,
  and data-trust analysis clients need.

The system must absorb provider schema variability without replacing accounting rules with model
judgment. The useful mental model is: a model may propose how to read a new spreadsheet; an owner or
admin approves that exact recipe; deterministic code then reads every matching spreadsheet and
computes the business results.

## 3. Governing principles

- A business channel is not a report provider and is not an executable integration capability.
- Postgres is authoritative. Trigger.dev orchestrates identifiers and execution state only.
- Original uploads and row artifacts live in organization-private Storage, not unrestricted JSONB.
- Workbook content is untrusted data, never instructions.
- A model may propose a declarative mapping contract and narrate deterministic findings. It may not
  write business data directly, generate SQL or code, approve a contract, compute a financial
  result, invent a cause, or execute a recommendation.
- Known logic remains deterministic, versioned, idempotent, auditable, and reproducible.
- Missing, partial, stale, overlapping, ambiguous, or contradictory evidence stays visible.
- Core tables and services remain industry-neutral; the Restaurant Industry Pack supplies metric,
  detector, report-family, and cost vocabulary.
- All client-facing comparisons are currency-safe and period-safe. Currency conversion is explicit,
  rate-sourced, and preserved in lineage; it is never silently inferred.

## 4. Scope and releases

### 4.1 Release 1

- Organization-owned channels with optional templates and arbitrary custom channels.
- Channel-to-branch applicability and source-label aliases.
- Additive migration from legacy channel labels to stable channel IDs.
- Signed resumable XLSX and CSV uploads into private Supabase Storage.
- Immutable report packages, revisions, sheet manifests, validation results, digests, and retention.
- A pinned streaming ExcelJS adapter and the existing CSV parser behind one bounded parser port.
- Workbook fingerprinting and versioned, declarative report contracts.
- Isolated model-assisted contract proposal with exact owner/admin approval.
- Deterministic projection into normalized metrics, an exact-range metric ledger, and Channel
  Economics with cell-level lineage.
- Versioned deterministic detector catalogue plus cited AI explanations and recommendations.
- Channel management, portfolio comparison, detailed channel workspace, recommendation triage, and
  complete evidence drawers.
- Client 1 provider families: Noon, Talabat, Keeta, and Smile, after real redacted fixtures pass.

### 4.1.1 Delivered intake slice (2026-08-20)

- Operators and administrators can declare a channel, outlet, report type, inclusive period, and explicit currency before uploading one CSV or XLSX report.
- The browser uploads directly to the private `governed-report-packages` bucket with a short-lived signed resumable token; Next.js never receives workbook bytes.
- Immutable package metadata, object identity, SHA-256 digest, bounded sheet manifests, lifecycle state, and safe audit events are retained for 13 months by default.
- Structural profiling rejects rather than truncates files above 50 MiB compressed, 25 sheets, 250,000 rows, 2.5 million populated cells, or 250 MiB expanded content.
- This slice intentionally stops at `awaiting_contract`. It does not generate a contract, send workbook content to a model, project economics, write Business Memory, publish benchmarks, or execute actions.

### 4.1.2 Delivered schema-contract review slice (2026-08-21)

- The profiler records normalized sheet/header candidates, structural flags, parser/fingerprint versions, and a SHA-256 schema fingerprint that excludes workbook values, filenames, totals, and PII.
- Owner/admin users may author one bounded human declarative mapping document for an `awaiting_contract` package and approve or reject that immutable exact version.
- Approval writes an append-only decision, an exact active fingerprint binding, and safe audit events, then moves the package to `awaiting_validation`. No validation, projection, model route, Business Memory write, benchmark, or action is implemented by this slice.

### 4.1.3 Delivered deterministic validation slice (2026-08-21)

- A service-only worker may claim an `awaiting_validation` package only when its organization, approved exact contract version, active binding, schema fingerprint, declared currency, branch grain, retention window, and private Storage object identity still match.
- The worker re-reads the original private CSV/XLSX object, verifies its frozen SHA-256 digest, and applies only the approved sheet, header/data row, source-header, parser, required-field, money-sign, formula/merged-cell, and count-control rules.
- `integration_report_validation_runs`, `integration_report_validation_sheet_results`, and `integration_report_validation_control_results` retain only identifiers, typed codes, counters, quality/completeness, versions, timestamps, and a deterministic result digest. They never retain cells, rows, formulas, customers, URLs, prompts, or secrets.
- Postgres owns claims, leases, retries, idempotency, terminal status, and immutable audit events. Trigger carries identifiers only. The rollout defaults off through `GOVERNED_REPORT_VALIDATION_ORGANIZATION_IDS`; disabling it stops new dispatch without changing completed evidence.
- A validated or partially validated package is only prepared for a later projection slice. This slice writes no normalized metrics, Channel Economics, Business Memory, benchmarks, recommendations, or provider/campaign actions.

### 4.1.4 Delivered exact-range revision and reconciliation slice (2026-08-21)

- Postgres owns duplicate detection, exact-range overlap decisions, append-only observation revisions, worker leases, retries, and package/run state transitions. Trigger.dev carries identifiers only.
- A matching package context and reconciliation digest replays as `exact_duplicate`: it records safe audit evidence but creates neither a second observation nor another lineage row. A non-overlapping exact range remains independently current.
- A changed digest for an intersecting active exact range becomes `ambiguous_overlap`. Its observation is retained as `blocked_overlap`, does not enter the current rollup, and moves the package to `reconciliation_required` until an owner/admin resolves it.
- Accepting an approved correction makes the candidate the next observation revision and marks the prior current observation `superseded`; keeping existing evidence marks the candidate `excluded`. Both preserve readable history and write only identifiers, digests, counts, states, versions, and timestamps to reconciliation evidence.
- The Integration Hub shows current exact-range evidence, superseded history, duplicate replay, blocked overlap, and the next safe owner/admin step. It does not show workbook rows, cells, aggregate values, formulas, URLs, prompts, model output, or calculations.
- This remains a deterministic control slice only: it does not infer calendar grains, prorate, sum overlaps, write Channel Economics, run detectors, make benchmarks/recommendations, narrate with AI, or trigger provider/campaign actions.

### 4.1.5 Planned operator-usable ingestion slice

The four delivered slices above are complete and correct, and together they deliver no usable
value: the only way to map a report today is to hand-write two JSON documents into textareas, and
the pipeline ends at a status badge. Governance became the interface instead of the audit trail.
This slice inverts that, and widens ingestion to the shape the client's real exports actually take.

#### What the real exports turned out to be

Profiled on 2026-08-22 from the pilot client's own downloads across Talabat, Keeta, Noon, Smile, and
the offline store. Everything below is observed, not assumed:

- **Most of the data is daily, not period totals.** Talabat performance is one row per day over 56
  columns. Keeta's restaurant, item, and promotion exports are one row per day. Only Noon and Smile
  state a single period total. The exact-range ledger in 10.2 was built for the minority shape;
  10.1's period grain is the majority one and is not yet wired to the governed pipeline.
- **A provider delivers a set of files, not one file.** Keeta alone exports restaurant, item,
  order, promotion, and billing reports for a single period. One package equals one file today.
- **Costs frequently arrive measured rather than as rates.** Keeta states commission, bank fees, and
  delivery subsidies per day and per order; Smile states total commission. Those are `sourced`
  components under `specs/012` 4.2, not figures an operator should be asked to type. Rates remain
  necessary only where the provider is silent, which for this client is Talabat.
- **Headers are not always on row one.** Noon carries a field row, an English description row, and
  an Arabic description row before its single value row. Keeta's billing summary carries a category
  row and a subcategory row above its field names.
- **Dates arrive in at least three encodings** across providers: a real date, the integer
  `20260228`, and the text `1 Jan 2026`.
- **Blank and zero are genuinely different in the source.** Talabat records a true zero-sales day
  and a no-data day differently, which `specs/012` 6.2 already requires be preserved.
- **The period is sometimes only in the filename.** Noon and Smile state no period inside the file,
  which is why the declared period at upload is load-bearing rather than redundant.
- **Some inputs exist only as PDF.** The offline store's profit and loss is the only source for
  food cost and packaging — the inputs contribution margin has always lacked — and it is a
  wkhtmltopdf-rendered table. Keeta's commission invoices are iText-generated. None is a scan.

#### What the operator does after this slice

Three steps, replacing eleven:

1. Choose the channel and outlet, and upload the file. The declared period and currency are
   presented for confirmation rather than typed where the file or its name states them.
2. Confirm one plain-language mapping: *"This looks like a Keeta billing report. Total Original item
   price is your sales, Total Commission is a cost, and it arrives negative. Correct?"* Recognised
   report families are pre-filled from a checked-in contract; anything unrecognised falls back to a
   guided list of dropdowns over the detected columns. A model may propose the mapping under 8.4;
   it never reads a value into the database and its proposal is inert until a human approves it.
3. See the numbers.

The contract version, the projection declaration, the approval record, the digest, and the lineage
are all still written exactly as the delivered slices define them. They stop being questions put to
the operator and go back to being the receipt.

#### Capability changes this requires

- Period-grain projection into `normalized_metrics` per 10.1, alongside the existing exact-range
  path, with the grain declared by the approved contract and never inferred from a row.
- A date parser and a money control total in the projection declaration language, which ADR 0027
  deliberately limited to `money` and `count` sums. See ADR 0029.
- A report set: one channel and period owning several report types, each with its own contract.
- A machine-generated PDF adapter per 7.3 and ADR 0028.
- Checked-in report-family contracts keyed by schema fingerprint for the recognised providers.

#### What this slice still does not do

No contribution margin, no detectors, no recommendations, no benchmarks, no Business Memory writes,
no AI narration, no provider or campaign actions, no OCR, and no model-read values.

### 4.2 Release 2

- Provider-neutral public benchmark research, with Exa Search and Contents as the first adapter.
- Owner/admin source approval and deterministic comparability validation.
- Privacy-safe, opt-in anonymized peer benchmarks with minimum-cohort suppression.

### 4.3 Explicitly out of scope

- Automatic Decision Engine opportunities or automatic Business Memory promotion.
- Raw workbook rows or duplicated metric series in Business Memory.
- Recommendation execution, provider writes, spend, discounts, prices, menu changes, or campaign
  actions.
- Migrating the campaign-specific Instagram/Facebook action vocabulary. Those values represent
  verified executable capabilities, not organization channel identity.
- **Scanned or image-only PDFs, and OCR of any kind.** Machine-generated PDFs carrying a real text
  layer are in scope under 7.3 and ADR 0028; a document whose numbers exist only as pixels is not,
  and is refused rather than guessed at.
- Email inbox scraping, arbitrary document types, formulas as executable calculations, macros,
  external workbook links, or generated SQL/code transforms.
- Full accounting, tax filing, fixed-cost allocation, or guarantees that marketplace statements
  reconcile to the client's books.
- Talabat Partner API ingestion in Release 1. A future read-only adapter may use the same canonical
  contracts after its access and provider contract are approved.

## 5. Users and permission catalogue

Authorization uses explicit permission rows and the shared browser mirror. UI visibility never
grants access; application checks and RLS or governed RPCs enforce every operation.

New organization permissions:

- `channel.read`
- `channel.manage`
- `channel.map_branch`
- `report.read`
- `report.upload`
- `report.retry`
- `report.contract_approve`
- `report.download_sensitive`
- `recommendation.triage`
- `benchmark.read`
- `benchmark.approve`
- `benchmark.contribute`

Role mapping:

| Action                                                           | Viewer | Operator | Owner/Admin |
| ---------------------------------------------------------------- | -----: | -------: | ----------: |
| View channels, economics, findings, evidence, and report status  |    Yes |      Yes |         Yes |
| Upload reports, retry processing, and map outlets/aliases        |     No |      Yes |         Yes |
| Create, rename, categorize, archive, or restore channels         |     No |       No |         Yes |
| Approve contract versions, currency, or financial sign semantics |     No |       No |         Yes |
| Acknowledge, dismiss, or mark recommendations planned            |     No |      Yes |         Yes |
| Download original sensitive workbooks                            |     No |       No |         Yes |
| Approve benchmark sources or peer contribution                   |     No |       No |         Yes |

Existing `economics.read` and `economics.write` remain valid for legacy economics reads and cost-rate
capture. New surfaces check both the resource-specific permission and the relevant economics
permission where a response includes confidential financial data.

## 6. Organization-owned channels

### 6.1 Channel identity

`organization_channels` owns a stable organization-scoped channel identity:

- `id uuid`
- `organization_id uuid`
- `key text`, immutable and unique per organization
- `display_name text`, editable
- `category text`, an industry-neutral registered value such as `marketplace`, `owned_digital`,
  `physical`, `reseller`, or `other`
- `template_key text null`, a non-authoritative setup hint
- `status`: `active` or `archived`
- `created_by`, `archived_by`, `archived_at`, `created_at`, and `updated_at`

Templates may prefill display name, category, aliases, and likely report families for Talabat, Noon,
Keeta, Smile, Website, Amazon, Flipkart, Offline Shop, Swiggy, or Zomato. A template does not create
credentials, provider connections, capability grants, or campaign authority. Organizations may
create channels with no template.

Keys use normalized lower-case identifiers and are never renamed. Display names may change. A
channel with referenced history may be archived and restored but never hard-deleted.

### 6.2 Branch applicability

`organization_channel_branches` maps a channel to a branch with:

- composite tenant-safe foreign keys to channel and branch;
- `status`: `active` or `inactive`;
- optional effective local dates;
- creator and audit timestamps.

No mappings means organization-wide applicability. Once any active mapping exists, only mapped
branches are valid upload and projection targets for that channel.

### 6.3 Source aliases

`channel_source_aliases` binds a case-normalized source label to one channel:

- organization and channel IDs;
- alias as originally observed and a deterministic normalized alias;
- source scope: onboarding, normalized metric, economics entry, cost rate, report package, or manual;
- optional source record reference and effective dates;
- creator, confirmation state, and audit timestamps.

Normalization performs Unicode normalization, trim, whitespace collapse, and locale-independent
case folding. It does not remove semantic punctuation or guess fuzzy matches. One normalized alias
cannot bind two active channels in the same source scope. Ambiguity fails closed for owner/admin
resolution.

### 6.4 Legacy migration

Backfill discovers distinct labels from onboarding channel presence, `normalized_metrics.channel`,
`channel_economics_entries.channel`, and `cost_component_rates.channel`.

- Exact normalized matches become one channel and several source aliases.
- Collisions or materially different labels produce unresolved migration rows; they are not merged.
- Add nullable `channel_id` plus immutable `channel_label_snapshot` to legacy metric, economics, and
  rate records using composite organization foreign keys.
- Backfill IDs in bounded batches, verify unresolved counts, then require `channel_id` in every new
  governed write path.
- Legacy readers continue during the feature-flagged rollout. They display the immutable snapshot
  when an ID remains unresolved.
- Historical labels are never rewritten after a channel rename.

## 7. Governed report ingestion

### 7.1 Upload contract

Release 1 accepts `.xlsx` and `.csv` only. Before an upload intent is issued, the operator selects:

- channel;
- branch/outlet, or explicit organization aggregate where the channel is organization-wide;
- declared inclusive report start and end dates;
- ISO currency;
- report family from the registered channel/pack catalogue, or `custom` with a bounded label;
- whether this package corrects or supersedes an earlier package.

The API creates an immutable pending package and a unique storage object path. The browser uploads
directly to the Supabase Storage TUS endpoint using a short-lived signed upload token. The Vercel
function never proxies workbook bytes. Uploads never use upsert and every revision gets a new path.

Initial configurable hard limits are:

- 50 MiB compressed object size;
- 25 worksheets;
- 250,000 physical rows across the workbook;
- 2.5 million populated cells;
- 250 MiB estimated expanded content.

The parser rejects the complete package when a hard limit is exceeded. It never truncates.

### 7.2 Package records

`integration_report_packages` is the immutable package identity and revision chain:

- organization, channel, branch, data-source, and ingestion-run IDs;
- declared report family, inclusive local dates, timezone, currency, and outlet context;
- original filename, media type, size, private storage path, SHA-256 content digest;
- package status and current stage;
- revision number, `supersedes_package_id`, and correction reason;
- parser and fingerprint versions;
- retention policy version, `retain_until`, legal-hold flag, and purge status;
- safe error code, creator, correlation ID, and timestamps.

Status is one of `awaiting_upload`, `uploaded`, `profiling`, `awaiting_contract`,
`awaiting_approval`, `validating`, `projecting`, `analyzing`, `succeeded`,
`partially_succeeded`, `failed`, `superseded`, or `purged`.

`integration_report_sheet_manifests` stores bounded metadata only: stable sheet ID, original and
normalized name, position, row/cell counts, header candidates, schema fingerprint, artifact path,
artifact digest, formula/external-link flags, classification, required/optional state, and safe
validation counts. `integration_report_validation_results` stores typed package/sheet/control
results, never raw cells.

`organization_channel_intelligence_settings` stores owner/admin-controlled retention months, model
content access mode, benchmark contribution consent, and versioned effective dates. Raw workbooks
default to 13 months. The allowed retention range and legal-hold behavior are platform policy, not
free-form settings.

### 7.3 Parser boundary

The parser port has versioned adapters for XLSX, CSV, and machine-generated PDF.

- ExcelJS is pinned exactly and used in streaming mode in the worker runtime.
- CSV reuses the existing BOM-aware parser and gains the same package envelope and hard limits.
- **PDF is admitted only where the numbers already exist as text.** The adapter extracts a
  positioned text layer and reconstructs a cell grid from it, then hands that grid to exactly the
  same contract, validation, and projection path a spreadsheet takes. A PDF with no text layer, or
  one whose text layer yields no reconstructable grid, is a typed failure. No OCR, no image
  interpretation, and no model reads a value. See ADR 0028.
- **Legacy binary `.xls` (BIFF, pre-2007) is refused with an actionable message** naming the format
  and asking for an `.xlsx` export. ExcelJS cannot read it, and admitting a second spreadsheet
  engine to serve one provider that can already export `.xlsx` is not worth the parser surface.
- A PDF that restates a figure a spreadsheet already carries is a **control document, not a
  source**. Where both exist for one period, the spreadsheet is projected and the PDF's stated
  totals are reconciled against it under 8.3's control-total rules. A mismatch fails the import
  loudly rather than picking a winner.
- Every cell is normalized first into a typed, bounded string representation with its coordinate,
  source type, and flags. Numeric interpretation happens only through an approved contract.
- Formula text is never persisted. Formula cells and cached results are inspected transiently under
  the approved policy; rejected formulas, merged cells, macros, and external links produce typed
  validation failures without retaining workbook content.
- Shared strings, dates, large identifiers, Arabic text, duplicate headers, repeated descriptive
  rows, merged cells, blank sentinels, percentages, and dash sentinels remain distinguishable.
- The original object and gzip-compressed per-sheet NDJSON artifacts live in private Storage.
- No raw order, customer, review, or item row is stored in Postgres or application logs.
- Customer-level columns are classified and minimized before any optional model access.

Storage paths are tenant-prefixed and immutable:

`organizationId/channelId/packageId/revision/{original|sheets/...}`.

Finalization verifies bucket, exact path, object ownership, expected size, MIME, and digest before a
worker can claim the package.

## 8. Schema fingerprints and report contracts

### 8.1 Fingerprint

A schema fingerprint is a versioned digest over declared context plus deterministic workbook
structure:

- report family, channel template hint, currency, and outlet grain;
- ordered normalized sheet names and positions;
- per-sheet ordered normalized header candidates and their row positions;
- repeated-header, merged-cell, formula, and structural flags;
- parser and fingerprint algorithm versions.

Cell values, customer PII, financial totals, and filenames do not enter the fingerprint. The same
schema with different dates or amounts therefore reuses its approved contract.

### 8.2 Contract records

`report_contracts` is a stable organization/channel/report-family identity.

`report_contract_versions` is append-only and contains:

- contract and version IDs;
- exact schema fingerprint and parser/fingerprint versions;
- declarative mapping document and its canonical digest;
- required and optional sheet rules;
- currency and financial-sign semantics;
- control-total definitions and tolerances;
- unmapped fields with reviewed dispositions;
- proposal source: human or model;
- model route, model identifier, prompt-template version, output digest, and evaluation status;
- creator and timestamps.

`report_contract_decisions` is append-only and binds one owner/admin decision to the exact contract
version, fingerprint, mapping digest, control totals, currency/sign semantics, unmapped fields,
actor, reason, and timestamp. Editing any bound field creates a new version and needs a new decision.
The effective lifecycle state (`proposed`, `approved`, `rejected`, `retired`, or `superseded`) is
derived from the latest valid decision/binding event; the immutable version row is never edited to
rewrite its history.

`report_contract_bindings` maps an approved exact version to one organization, channel, report
family, fingerprint, currency, and outlet-grain context. At most one active binding exists for that
tuple. Automatic reuse occurs only when every bound field matches and deterministic validation and
reconciliation pass.

### 8.3 Declarative transform language

The mapping document is validated by Zod and may contain only versioned predefined operations:

- select a sheet by exact normalized identity and structural constraints;
- select header and data row ranges;
- bind a source coordinate or header to a registered canonical field;
- parse integer, decimal, money, local date, timestamp, duration, percentage, text, or enum;
- pair a ratio numerator and denominator;
- apply an explicitly approved financial sign;
- convert money using an approved rate observation with source and timestamp;
- map bounded enum values;
- filter on bounded declarative predicates;
- group by registered keys;
- aggregate using a metric definition's declared semantics;
- declare control totals, tolerances, required coverage, and unmapped-field disposition.

The language cannot contain JavaScript, Python, SQL, regular expressions supplied by a model,
network calls, file paths, dynamic imports, tool calls, or arbitrary expressions. Unknown operation
types fail validation.

### 8.4 Model proposal boundary

Unknown and drifted fingerprints enter `awaiting_contract`. An isolated model worker may propose one
contract version.

- It has no database-write, credential, web, provider, shell, code-execution, or external tool
  access.
- It receives only the package content permitted by the organization's setting and the selected
  model-route policy.
- Workbook content is enclosed and labelled as untrusted evidence. Instructions found inside it are
  ignored.
- Output must satisfy the mapping schema, metric registry, industry-pack registry, financial-sign
  rules, field allowlist, and resource bounds before it is stored as a proposal.
- Invalid output is retained only as a safe failure code and digest; raw model prose is not logged.
- Model outage leaves the package awaiting a human-authored contract; it never guesses or projects.

Full-workbook model access is the platform default only when the selected route has an approved
contract covering residency, retention, no-training use, access controls, and deletion. An
organization may opt out. If those conditions are not current, the system uses a minimized sample
that removes classified fields or fails closed when a useful proposal is impossible.

## 9. Durable workflow

Trigger.dev orchestrates organization-scoped, idempotent stages:

1. `report.profile`
2. `report.resolve-contract`
3. `report.propose-contract` when needed
4. `report.validate`
5. `report.project`
6. `report.reconcile`
7. `report.analyze`
8. `report.narrate`
9. `report.apply-retention`

Each task is a thin Trigger wrapper over an inner testable function. Payloads carry only validated
organization, package, run, contract-version, correlation, and idempotency identifiers plus bounded
configuration versions. Tasks fetch authoritative state from Postgres at execution time.

Every stage has a database-owned operation row with status, attempt, lease owner, lease expiry,
claim token, input digest, version tuple, timestamps, and safe failure code. A worker mutation uses a
security-definer RPC that validates organization binding, expected stage, claim token, current
contract version, package state, cancellation, and idempotency inside the transaction.

Retries replay safely. A cancelled or superseded package cannot project. Unknown terminal outcomes
reconcile before retry. Stage completion never depends only on Trigger run state.

## 10. Deterministic projections and lineage

### 10.1 Period-grain metrics

Daily, weekly, and monthly canonical observations use the existing metric registry and
`normalized_metrics` revision model. New writes require `channel_id`; the historical channel label
is retained as a source snapshot. Ratios always store numerator and denominator. Gaps stay absent.

### 10.2 Exact-range metric ledger

`exact_range_metric_observations` stores Noon-style arbitrary-period totals that cannot honestly be
converted into daily series:

- organization, branch, channel, metric definition, subject, and registered dimensions;
- exact inclusive local start/end dates and timezone;
- value kind, numerator, denominator, currency, quality tier;
- revision, supersession pointer, source package/run, contract version, and timestamps.

Exact-range observations are comparable only when their start and end dates, timezone, branch,
channel, subject, dimensions, currency, and metric definition match. They are never prorated, summed
across overlapping windows, mixed with period-grain observations, or used to fabricate a trend.

#### First governed projection slice

The first shipped projection path is intentionally limited to an approved
`exact_range` declaration bound to one approved report-contract version. An
owner/admin maps a required canonical `money` or `integer` field to one active
registered `money` or `count` metric definition and the only permitted
aggregation is `sum`. The package's declared inclusive local period and branch
context are retained exactly. Daily/weekly/monthly observations, ratios,
filters, dimensions, overlap precedence, corrections, and Channel Economics
remain later slices; none is inferred from a workbook row.

### 10.3 Economics

Projection extends Channel Economics additively:

- add tenant-safe `channel_id` and `channel_label_snapshot`;
- add append-only revisions and supersession for correcting entries;
- bind source package, sheet, contract, and metric revisions;
- preserve reported and derived values separately and raise every non-zero disagreement;
- retain integer minor units and explicit currency;
- prevent overlapping evidence from double-counting in a read window.

Existing legacy rows and readers remain during rollout. New governed projection RPCs refuse a null
channel ID. The campaign Instagram/Facebook action vocabulary and its constraints are unchanged.

### 10.4 Lineage

`report_projection_lineage` links every projected normalized metric, exact-range metric, economics
entry, economics component, finding input, and recommendation input to:

- organization and package revision;
- sheet manifest and source column/header identity;
- bounded row or cell-range reference;
- contract version, field binding, transform steps, and calculation version;
- reconciliation and quality state.

It stores coordinates, digests, and bounded metadata, not raw cell values. Every read-model number
and chart mark resolves through this lineage. A read that cannot resolve required lineage is marked
untrusted rather than silently displayed as verified.

### 10.5 Required, optional, duplicate, and overlap behavior

- Required-sheet, required-field, currency, period, outlet, or control-total failure blocks all
  projection from the package.
- An optional-sheet failure allows only independent projections and marks the package and analyses
  visibly partial.
- Byte-identical content for the same declared context is an idempotent replay.
- A correction creates a new package and metric/economics revisions; prior evidence remains readable.
- Overlapping packages are stored but cannot both contribute to the same current rollup. An approved
  supersession or deterministic precedence decision selects current evidence.
- Ambiguous overlap remains a reconciliation failure requiring owner/admin resolution.

## 11. Detector and analysis catalogue

### 11.1 Registry contract

Detectors are versioned TypeScript definitions registered by core or an Industry Pack. Every
detector declares:

- stable key and calculation version;
- industry-pack owner or core ownership;
- compatible metric/economics grains and exact-range constraints;
- required and optional metrics;
- minimum quality and reconciliation states;
- deterministic calculation and evidence contract;
- finding severity and priority rules;
- whether monetary impact is computable and the exact method;
- limitations and `needs_data` conditions.

No detector runs when its declared evidence contract is unsatisfied. A detector may return an
authoritative observation, a quantified finding, or `needs_data`; it never fills missing inputs.

### 11.2 Restaurant Pack Release-1 catalogue

The Restaurant Pack registers detectors for:

- gross sales, payout, estimated earnings, contribution margin, effective commission, and total
  marketplace take;
- merchant-funded and platform-funded discounts; delivery, packaging, payment, marketing, and
  operational fees; taxes, cash collection, and balances;
- expected contract terms versus actual charges, payout reconciliation, unexplained differences,
  duplicate charges, and reported-versus-derived disagreement;
- cross-channel revenue, margin, take rate, orders, average order value, growth, operational loss,
  and data completeness;
- exposure/impressions to visit/menu-open, cart, checkout, and order funnels with valid numerator
  and denominator pairing;
- new versus returning customer mix, ratings, complaint/review themes, and response coverage;
- availability and closures, cancellations/rejections, preparation time, marked-ready rate,
  waiting-time fees, delivery/pickup mix, and avoidable sales loss;
- item exposure, conversion, units, revenue, order attachment, basket association, and stockout
  signals;
- promotion funding, subsidy, cost per order, discounted-sales share, and margin dilution;
- missing reports, unmapped fields, schema drift, duplicate or overlapping evidence, ambiguous
  period/currency/outlet, ratio defects, reconciliation failure, and stale sources.

Item profit is `needs_data` without trusted item COGS. Promotion incremental ROI is `needs_data`
without a registered baseline or experiment. Monetary impact is omitted when a detector cannot
derive it from accepted evidence.

### 11.3 Analysis records

`channel_analysis_runs` binds one organization/channel/branch/window to exact metric, economics,
contract, detector, and model version tuples.

`channel_findings` stores deterministic outputs, priority, quality, typed evidence references,
calculation digest, limitations, and status. The authoritative observation and numeric values are
never model-authored.

`channel_recommendations` stores a cited model explanation over selected findings with exactly one
label: `observation`, `recommendation`, or `needs_data`. It includes evidence references, supported
actions, limitations, model metadata, and prompt/output digests. It contains no executable tool or
provider payload.

`channel_recommendation_decisions` is append-only and stores `acknowledged`, `dismissed`, or
`planned`, actor, required dismissal reason, timestamp, and the recommendation version. A later
analysis may supersede a recommendation but may not erase the human's prior decision.

### 11.4 Narrative constraints

AI may translate a deterministic finding into plain language, group related findings, and suggest
bounded human actions already supported by the detector catalogue. Every sentence that states a
fact or value must cite stored evidence.

AI may not invent causes, savings, confidence, benchmarks, values, attribution, contract terms, or
action outcomes. It may not convert `needs_data` into a recommendation. Unsupported or uncited
claims fail validation and no narrative is published; the deterministic finding remains visible.

This section narrowly extends `specs/012` and `specs/015`: models still never compute or alter a
financial/metric value. Narration is permitted only after a deterministic detector has created a
cited finding.

## 12. Public API contracts

All routes are organization-scoped, Zod-validated, permission-checked, correlation-aware, and use
idempotency keys for mutations.

### 12.1 Channels

- `GET /api/organizations/:organizationId/channels`
- `POST /api/organizations/:organizationId/channels`
- `PATCH /api/organizations/:organizationId/channels/:channelId`
- `PUT /api/organizations/:organizationId/channels/:channelId/branches`
- `POST /api/organizations/:organizationId/channels/:channelId/aliases`

`PATCH` supports rename, category, archive, and restore. There is no delete endpoint.

### 12.2 Report packages and contracts

- `POST /api/organizations/:organizationId/report-packages/upload-intents`
- `POST /api/organizations/:organizationId/report-packages/:packageId/complete`
- `GET /api/organizations/:organizationId/report-packages/:packageId`
- `GET /api/organizations/:organizationId/report-packages/:packageId/preview`
- `POST /api/organizations/:organizationId/report-packages/:packageId/retry`
- `POST /api/organizations/:organizationId/report-packages/:packageId/supersede`
- `GET /api/organizations/:organizationId/report-contract-proposals`
- `GET /api/organizations/:organizationId/report-contract-proposals/:versionId`
- `POST /api/organizations/:organizationId/report-contract-proposals/:versionId/decisions`
- `POST /api/organizations/:organizationId/report-packages/:packageId/download-intent`

Download-intent returns a short-lived signed URL only after `report.download_sensitive`; it never
proxies bytes through the application.

### 12.3 Economics, evidence, and recommendations

- `GET /api/organizations/:organizationId/channel-economics`
- `GET /api/organizations/:organizationId/channels/:channelId/economics`
- `GET /api/organizations/:organizationId/channel-evidence/:evidenceId`
- `POST /api/organizations/:organizationId/channel-recommendations/:recommendationId/decisions`

Read models use discriminated unions for trusted, partial, indicative, insufficient, stale,
ambiguous-overlap, and currency-mismatch states. An unavailable value is absent, not zero.

### 12.4 Release-2 benchmarks

- `POST /api/organizations/:organizationId/benchmark-research`
- `GET /api/organizations/:organizationId/benchmark-candidates`
- `POST /api/organizations/:organizationId/benchmark-candidates/:candidateId/decisions`
- `PUT /api/organizations/:organizationId/benchmark-contribution-consent`

## 13. Events and audit

Required stable events:

- `channel.created`
- `channel.updated`
- `channel.archived`
- `channel.restored`
- `channel.branches_mapped`
- `channel.alias_confirmed`
- `report_package.uploaded`
- `report_package.profiled`
- `report_contract.proposed`
- `report_contract.approved`
- `report_contract.rejected`
- `report_package.validated`
- `report_package.projected`
- `report_package.partially_projected`
- `report_package.failed`
- `report_package.superseded`
- `channel_analysis.completed`
- `channel_recommendation.triaged`
- `report_package.purged`
- `benchmark_candidate.approved`
- `benchmark_contribution.changed`

Sensitive mutations append immutable audit events with organization, actor or worker identity,
correlation and causation IDs, version/digest references, safe before/after state, and no raw cells,
provider payloads, credentials, or customer PII.

## 14. Security, privacy, and AI threat model

- Enable and force RLS on every tenant table. Add `(organization_id, id)` uniqueness and composite
  tenant foreign keys for every cross-table tenant reference.
- Authenticated users receive only explicit table/RPC privileges required by the permission matrix;
  new tables are never assumed to be exposed through the Data API and `anon` receives none.
  Worker-owned projection, contract proposal, analysis, and retention writes have no authenticated
  table write grant.
- User-facing routes never use service role to bypass RLS. Privileged workers mutate only through
  validation-heavy security-definer functions in a non-exposed schema with `search_path = ''`,
  execution revoked from `PUBLIC`, `anon`, and `authenticated`, and exact worker-role grants. A
  function intentionally exposed through the Data API is placed in `public` only when necessary,
  revokes default execution first, grants the minimum named role, and validates `(select auth.uid())`
  plus the organization permission inside its body.
- Validate the actor, effective permission, organization, channel, branch, package, storage path,
  contract version, idempotency fingerprint, and correlation ID again inside mutation RPCs.
- Treat file names, sheet names, headers, descriptions, formulas, URLs, reviews, and cell text as
  attacker-controlled. They never determine tool calls or prompt instructions.
- The contract-proposal model has no tools and no retrieval outside the bounded package context.
- Redact or remove customer names, phone numbers, email addresses, delivery addresses, free-text
  order notes, and unrestricted review text unless a declared detector needs minimized content and
  policy permits it.
- Do not log raw rows, prompts containing workbook content, model outputs, signed URLs, object paths
  exposed beyond safe identifiers, or model-provider request bodies.
- Model routes and versions are allowlisted, contractually reviewed, and fail closed on expired
  privacy terms.
- Original files and sheet artifacts are encrypted at rest by Storage and accessed through private,
  short-lived paths. Retention purge is auditable, retryable, and leaves non-sensitive lineage
  metadata plus the content digest.
- Every external or peer benchmark is visually distinguished from client-measured evidence and can
  never override it.

OWASP documents indirect prompt injection through attacker-controlled files, and NIST reports agent
hijacking from external data as a practical security risk. This architecture reduces impact through
least privilege, a no-tool model worker, typed output, deterministic projection, and exact human
approval rather than claiming prompt injection can be eliminated.

## 15. Observability and operations

Structured logs include safe identifiers when available: `organizationId`, `channelId`, `packageId`,
`ingestionRunId`, `analysisRunId`, `workerId`, `correlationId`, stage, contract/detector/parser
version, duration, attempt, and safe error code.

Track:

- package count and bytes by stage, format, report family, and safe failure code;
- profiling duration, row/cell volume, expansion ratio, and limit rejection;
- known, unknown, and drifted fingerprint rates;
- contract proposal, approval, rejection, and reuse rates;
- validation, control-total, reconciliation, duplicate, overlap, and partial-result rates;
- projection throughput, revision/restatement rate, and lineage coverage;
- detector eligibility, `needs_data`, finding, narrative rejection, and model-outage rates;
- time from upload to trusted result and approval wait time;
- retention backlog, purge failures, and legal holds;
- recommendation triage state without free-text reasons as metric dimensions.

Alerts cover repeated parser crashes, decompression-bomb rejection spikes, orphaned uploads,
expired leases, failed retention, model-route policy expiry, cross-tenant refusal anomalies, and
lineage below 100% for displayed trusted results.

## 16. Failure and recovery states

- **Upload abandoned:** package expires from `awaiting_upload`; no processing starts. A later upload
  receives a new package and path.
- **Object mismatch:** finalization refuses the object; no worker is enqueued.
- **Workbook limit exceeded:** whole package fails with the exact safe limit code; no truncation.
- **Unknown or drifted fingerprint:** package waits for a contract proposal and approval.
- **Model unavailable or invalid:** package remains awaiting a human contract; no projection.
- **Contract rejected:** proposal remains auditable; a new version may be authored.
- **Required sheet/control failure:** no projection from the package.
- **Optional sheet failure:** independent results continue as visibly partial.
- **Duplicate:** exact replay returns the existing result and records no duplicate metric/economics
  evidence.
- **Correction:** creates a superseding package and append-only revisions.
- **Ambiguous overlap:** both packages remain stored; current rollups exclude the disputed tuple.
- **Currency ambiguity or mismatch:** projection/comparison fails; no inferred conversion.
- **Parser or worker crash:** lease expires and retry resumes idempotently from the authoritative
  stage.
- **Narrative failure:** deterministic findings remain available without AI copy.
- **Retention failure:** original remains private, purge is retried, and operators are alerted.
- **Source purged:** UI retains digest, lineage, calculations, approval, and limitation metadata but
  reports the original file as expired.

## 17. Client experience

### 17.1 Channel management

Add `/organizations/[organizationId]/channels` with:

- channel list, category, status, branch coverage, report freshness, and template hint;
- owner/admin create, rename, categorize, archive, restore, alias, and branch mapping flows;
- explicit copy that creating a channel does not connect a provider or grant execution authority;
- archived channels retained in historical filters and evidence.

### 17.2 Channel Economics portfolio

The landing route remains `/organizations/[organizationId]/economics` and becomes a comparison-led
portfolio workspace with:

- global period, branch, and currency filters;
- KPI strip with quality state;
- sortable channel matrix;
- revenue-versus-margin plot;
- trend small multiples when compatible period-grain data exists;
- marketplace-take comparison;
- prioritized findings and recommendations;
- data-trust and report-freshness status.

Exact-range evidence never fabricates a trend. Currency filters never imply conversion unless an
approved rate exists.

### 17.3 Channel detail

`/organizations/[organizationId]/economics/channels/[channelId]` uses sticky navigation:

- Summary
- Money
- Funnel
- Operations
- Items
- Promotions
- Customer Voice
- Recommendations
- Reports & Trust

Every applicable analysis appears in the main workspace. Priority controls ordering and emphasis,
not visibility. Missing sections explain the exact report or field needed.

Every number, chart mark, finding, and recommendation opens an evidence surface containing the
calculation, metric definition, source package/sheet/column, period, quality, reconciliation state,
contract and calculation versions, and limitations.

Recommendations may be acknowledged, dismissed with a required reason, or marked planned. There is
no execute button.

## 18. Superdesign approval gate

Before production TSX:

1. Refresh `.superdesign/init` because the current index predates the economics route.
2. Reproduce the existing `/economics` screen as the visual baseline.
3. Branch exactly two neutral/emerald variants:
   - comparison-led analytical canvas with a modular full-analysis grid and sticky evidence rail;
   - marketplace audit report with section-indexed analytical chapters.
4. Present both variants for explicit user selection.
5. After selection, use the confirmed direction to generate Channels management and channel-detail
   flow pages, then obtain explicit flow approval.
6. Only then implement production TSX with shadcn/ui compositions and the approved read contracts.

## 19. Release-2 benchmarks

### 19.1 External research

The provider-neutral adapter returns bounded candidate evidence. Exa Search and Contents is the
first adapter because it separates search from content retrieval and exposes per-source crawl
failures. It is limited to public content and respects robots controls; the platform does not bypass
authentication, paywalls, CAPTCHAs, forms, or access restrictions.

`benchmark_candidates` stores definition, source URL, publisher, geography, segment, unit/currency,
period, sample/method, bounded excerpt, content digest, capture date, expiry, adapter/version, and
provenance. Candidate source content remains untrusted.

`benchmark_decisions` is append-only. A benchmark becomes visible only after owner/admin approval,
expiry validation, and deterministic checks for metric definition, grain, geography, segment,
currency/unit, period, methodology, and sample compatibility.

Gemini Grounding with Google Search is prohibited for persistent benchmark collection. Its terms
prohibit using grounded links to build an index or drive crawling, and grounded requests have
mandatory storage that cannot be disabled.

### 19.2 Peer benchmarks

Peer contribution is owner/admin opt-in and revocable prospectively. Publication requires:

- at least ten eligible organizations after all filters;
- no raw rows, identifiers, labels, or organization-level points;
- suppression of sparse cohorts and small tails;
- one organization contribution capped so it cannot dominate a statistic;
- distributions, counts, quantiles, and methodology only;
- minimum quality, compatible definition, grain, currency/unit, period, and industry-pack version;
- immutable cohort/query version and audit trail.

The UI labels evidence as `Client measured`, `Internal comparison`, `Approved external`, or
`Anonymized peer`. A benchmark supports a recommendation only while approved, unexpired, and
comparable.

## 20. Test plan

### 20.1 Fixtures

Use redacted real exports for every Client 1 report family and at least one changed-period or schema
variant. Talabat vocabulary documentation alone does not make a report family supported. Provider
support remains `provisional` until its real fixture, mapping approval, projection, reconciliation,
and detector expectations pass.

### 20.2 Unit and property tests

- Unicode and Arabic sheet/header normalization, repeated/descriptive headers, merged cells, large
  identifiers, supported date formats, percentages, blanks and dash sentinels.
- Formula, macro, external-link, decompression-ratio, row, cell, sheet, and size rejection.
- Fingerprint stability across values and change across structural drift.
- Every declarative transform and rejection of unknown/generated operations.
- Money signs, integer minor units, currency conversion lineage, ratio pairing, aggregation, exact
  ranges, duplicates, overlaps, corrections, and revisions.
- Detector eligibility, calculations, quality thresholds, quantified-impact gates, and `needs_data`.
- Narrative citation coverage and rejection of invented values, causes, confidence, or benchmarks.
- Benchmark comparability, expiry, influence cap, minimum-ten suppression, and consent.

### 20.3 Hosted-staging pgTAP

- RLS and explicit privileges for every table and RPC across two accounts and organizations.
- Composite tenant-safe foreign keys for channels, branches, packages, contracts, lineage,
  recommendations, and benchmarks.
- Permission matrix, including direct API and direct-RPC misuse.
- Worker-only writes, lease and claim fencing, cancellation, idempotent replay, and terminal-state
  preservation.
- Approval binding to exact version/fingerprint/digest/currency/sign/control semantics.
- Archive-with-history behavior and no hard-delete path.
- Metric/economics/package revisions, supersession, duplicate and overlap behavior.
- Original workbook download limited to owner/admin permission.
- Peer consent, minimum cohort, suppression, and no cross-tenant row visibility.

### 20.4 Integration and worker tests

- Signed TUS upload above 4.5 MiB without Vercel body proxying.
- Known, unknown, and drifted fingerprints.
- Valid, invalid, and malicious model contract proposals plus model outage.
- Required and optional sheet failures.
- Idempotent retry after each stage and cleanup after pre-finalization failure.
- Reconciliation, retention, purge retry, legal hold, correction, and supersession.
- No raw cells, workbook prompts, customer PII, or signed URLs in logs and events.

### 20.5 End-to-end acceptance

Prove on desktop and mobile:

1. Owner creates a custom channel and maps a branch.
2. Operator uploads a real redacted workbook directly to private Storage.
3. First schema produces a proposal; owner/admin approves the exact contract.
4. The package projects trusted economics/findings with complete evidence.
5. A repeated matching schema imports automatically after validations pass.
6. A drifted schema stops for new approval.
7. Operator cannot approve a contract; viewer cannot upload or mutate.
8. Another account and organization can see neither metadata nor Storage objects.
9. Recommendation triage survives a superseding analysis.
10. No external execution action exists.

### 20.6 Required verification

Use Node 22 and pnpm. Run focused tests during each slice, then format check, typecheck, lint, full
Vitest, build, Trigger contract tests, hosted migration list/dry-run/push, hosted pgTAP, database
advisors, and browser acceptance. Never start a local Supabase stack. Call every new PL/pgSQL
function against staging at least once after migration.

## 21. Rollout and rollback

Implementation is additive and feature-flagged:

1. Channel registry, aliases, permissions, and legacy ID backfill.
2. Report package/upload/parser path with no projection.
3. Contract proposal and exact approval.
4. One real Client 1 report family end-to-end through deterministic projection and lineage.
5. Remaining Client 1 report families as separately proven contracts.
6. Detector, narrative, and recommendation triage.
7. Approved portfolio and detail UI.
8. Release-2 external benchmarks, then peer benchmarks under a separate enablement flag.

Flags independently disable upload completion, contract proposal, projection, narration, new read
models, and benchmarks. Disabling a flag stops new work and falls back to legacy readers without
deleting packages, revisions, approvals, or audit evidence.

Migrations are forward-only. Once shared staging receives a migration, repair it with an additive
migration. Storage purge is never part of application rollback.

### 21.1 Release decision: defer Noon dashboard-export qualification (2026-08-21)

The first Governed Channel Intelligence release will proceed with a separately proven Client 1
marketplace report family whose export carries the required report-family, exact-period, and
contextual evidence. Noon is deliberately deferred from that enabled report-family set.

- Noon currently exposes one Partner Dashboard Export rather than provider-defined report types.
  Its observed workbook structure contains sales and customer aggregate sheets, but does not
  establish the exact reporting period, branch, timezone, or currency from the source itself.
- The platform must not infer that missing context from a filename, workbook labels, or model
  output. It must not invent Noon report subtypes to make the package fit the contract model.
- This is a release-sequencing decision, not a claim that Noon is unsupported forever. No Noon
  contract, binding, auto-approval, or projection is enabled by this release decision.
- Noon may resume only as its own approved slice after a redacted real export and an explicit,
  reviewable source-context or operator-attestation design prove the branch, inclusive period,
  timezone, currency, contract, validation, projection, and reconciliation path. Existing
  append-only evidence and raw-workbook data restrictions remain in force.
- Each non-Noon marketplace report family remains independently provisional until its own real
  redacted fixture, owner/admin-approved exact contract, deterministic validation, projection,
  reconciliation, tenant/RLS tests, and hosted-staging checks pass. Supporting one family does
  not enable an entire provider.

### 21.2 Talabat Performance Report qualification guardrail (2026-08-21)

The supplied Talabat Performance Report is a valid XLSX and is the next report family under
qualification. This slice does not enable automatic projection, economics, or an organization-wide
Talabat contract.

- The profiler records only a version-2 structural fingerprint and SHA-256 digests of one
  candidate header row. It records no workbook text, cells, rows, customer data, formulas, or
  values that happen to repeat in data rows.
- Existing legacy header-candidate evidence is one-way redacted before the new path is enabled.
  It remains readable as package history, but cannot be used to propose another contract; new
  contract proposals require a new version-2 package profile and owner/admin approval.
- The exact period, branch, timezone, currency, report type, approved mapping, validation,
  projection, revision, and reconciliation rules remain independently governed. This
  qualification does not infer daily grain, prorate, or release a rollup.
- The first Talabat contract remains a human-reviewed, organization-scoped decision. A positive
  money-field mapping may be proposed only after the owner/admin checks the provider semantics.

## 22. Acceptance criteria

- Organizations can create arbitrary channels without a code deploy, and channel creation grants no
  provider or campaign capability.
- Historical labels survive rename and archive, and a channel with history cannot be deleted.
- All new governed metric, economics, rate, package, finding, and recommendation writes carry a
  tenant-safe channel ID.
- A workbook larger than 4.5 MiB reaches private Storage without passing through a Vercel function
  body.
- Hard limits reject complete packages without truncation and raw rows never enter Postgres/logs.
- Known exact fingerprints auto-import only through an approved exact contract and passing controls.
- Unknown or drifted schemas cannot project before owner/admin approval.
- Model output contains no executable code/SQL and cannot create a financial value or write directly.
- Exact-range observations are never prorated, overlap-summed, or rendered as fabricated trends.
- Corrections create append-only revisions and duplicate replays do not double-count.
- Every trusted visible result has calculation and source lineage; missing lineage downgrades trust.
- Every deterministic detector obeys its registered evidence/quality/grain contract.
- AI narratives cite deterministic findings and reject unsupported values, causes, savings,
  confidence, and benchmarks.
- Portfolio and channel detail expose every applicable analysis with accessible evidence.
- Human recommendation decisions remain visible across superseding analysis runs.
- Viewer, operator, and owner/admin behavior matches section 5 through UI, API, RLS, and direct RPC.
- Two-tenant tests prove metadata, rows, signed downloads, and Storage objects cannot cross tenants.
- Release 1 creates no automatic Decision Engine opportunity, Business Memory promotion, campaign,
  provider write, budget, price, or discount action.
- Release-2 benchmarks are labelled by evidence class, approved, comparable, unexpired, and peer
  cohorts meet the minimum-ten privacy rule.

## 23. Open implementation dependencies

These inputs are required before their corresponding production slices can be accepted:

- Redacted real XLSX/CSV files for every targeted Noon, Talabat, Keeta, and Smile report family,
  including at least one schema/period variant.
- The organization's expected marketplace contracts or confirmed fee semantics where reconciliation
  compares expected versus actual charges.
- A model route whose retention, residency, no-training, and deletion terms pass review before
  full-workbook access is enabled.
- Approved Superdesign direction and subsequent Channels/detail flow pages.
- Release-2 Exa commercial/security review and organization benchmark-consent copy.

## 24. Documentation changes required with implementation

- `README.md`
- `context/03-architecture.md`
- `context/04-domain-model.md`
- `context/05-module-map.md`
- `context/12-integrations.md`
- `context/13-ui-ux-context.md`
- `context/15-ai-coding-standards.md`
- `context/19-glossary.md`
- `context/20-roadmap.md`
- `specs/002-guided-onboarding.md`
- `specs/003-integration-hub.md`
- `specs/012-channel-economics-ledger.md`
- `specs/015-metric-registry-and-normalized-metrics.md`
- Restaurant Industry Pack metric, cost, detector, and report-family catalogues
- the permission catalogue migration and TypeScript mirror

## 25. References

- ADR 0026: governed declarative report contracts and stable organization channel identity
- [Vercel Functions limits](https://vercel.com/docs/functions/limitations)
- [Supabase resumable uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads)
- [OWASP prompt injection](https://genai.owasp.org/llmrisk2023-24/llm01-24-prompt-injection/)
- [NIST agent-hijacking research](https://www.nist.gov/blogs/caisi-research-blog/insights-ai-agent-security-large-scale-red-teaming-competition)
- [Exa Search](https://exa.ai/docs/reference/search)
- [Exa contents retrieval](https://exa.ai/docs/reference/contents-retrieval)
- [Exa crawler policy](https://crawler.exa.ai/)
- [Gemini API terms](https://ai.google.dev/gemini-api/terms)
- [Gemini zero-data-retention guidance](https://ai.google.dev/gemini-api/docs/zdr)
- [Talabat Partner API](https://developer.talabat.com/api-specifications)
