# Feature Specification: Governed Dynamic Channels and Marketplace Intelligence

## Status

Approved. The user approved ADR 0026, the comparison-led landing direction, and the chapter-indexed channel-workspace direction on 2026-08-20. Intake, deterministic Talabat projection, detector findings, and the recommendation control plane are implemented on the feature branch. Release 1 remains in progress: production analysis is now proven against the recovered Talabat projection, while the longer narration deadline still needs promotion and a successful chained retry, and the refined channel workspace still needs authenticated desktop and mobile browser acceptance.

Section 4.1.8 adds a repeat-intake and in-place audit slice, approved on 2026-09-02 after a live
four-month load exposed that the reuse promised in section 8.2 was never built. ADR 0046 records
that decision and sections 8.1 and 8.2 are corrected accordingly.

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
- The immutable ledger retains current evidence, superseded history, duplicate replay, and every
  overlap row. The Integration Hub does not turn that audit trail into a client task list: it shows
  only unresolved ambiguous overlaps, grouped by projected field, and names the approved source
  field, earlier upload, affected dates, and consequence of each owner/admin choice. Non-overlap,
  duplicate, resolved, and technical evidence identifiers remain off this action surface.
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
  deliberately limited to `money` and `count` sums. See ADR 0029. Four date encodings are carried by
  the client's own exports — a spreadsheet date cell, the compact integer `20260228`, the text
  `1 Jan 2026`, and EatEasily's `01/Jan`, which states no year and takes one from the period the
  package declares.
- Provider-declared absence markers on a contract field. Keeta writes `-` where Talabat leaves the
  cell empty, and both mean absent rather than zero.
- A declared totals row on a contract sheet, set aside during validation and projection rather than
  summed. EatEasily and Smile — one platform under two names — render one in every sales export.
- A report set: one channel and period owning several report types, each with its own contract.
- A machine-generated PDF adapter per 7.3 and ADR 0028.
- Checked-in report-family contracts keyed by schema fingerprint for the recognised providers.

#### What this slice still does not do

No contribution margin, no detectors, no recommendations, no benchmarks, no Business Memory writes,
no AI narration, no provider or campaign actions, no OCR, and no model-read values.

### 4.1.6 Delivered first detector slice (2026-08-23)

- Four core-owned detectors ship — `evidence.period_coverage`, `evidence.reconciliation_blocked`, `revenue.period_movement`, and `revenue.channel_share` — chosen because each runs on evidence a governed report package already produces. Everything else in section 11.2 is deferred by name, because it needs economics inputs or metric vocabulary no governed report currently writes. See ADR 0031.
- Postgres owns the analysis lease, the version tuples a run binds, the rule that a finding may only cite current evidence, supersession by a later run, and the immutable audit event. Trigger.dev carries identifiers only, and the worker is never the authority on what may be recorded.
- All three outcomes are stored. `needs_data` is a visible record, not a silence: an operator who cannot see that a detector had nothing to work with reads its absence as an all-clear.
- Severity and priority exist only on a quantified finding. Three of the four detectors report authoritative observations without either, because no agreed threshold turns a movement, a share, or a share of missing periods into a problem of a given size.
- Two currencies, two grains, two recorded timezones, two branches, or two channels are refused rather than reconciled, and a period-over-period comparison never reaches across a gap. An absent period stays absent everywhere in this slice.
- The workspace at `/organizations/[organizationId]/economics/channels/[channelId]` ships from the approved Superdesign draft, with all nine chapters and one route that starts a run. Recommendation triage, narration, and benchmarks remain out.

### 4.1.7 Talabat vertical slice (2026-08-23)

- One approved contract binds 23 columns of the Talabat performance family, including ragged-row
  realignment: 11 of the 59 rows carry a second unavailability reason that shifts later cells right
  from column 22, and the contract declares the injection point rather than hardcoding the shift.
  See ADR 0036.
- New metric definitions are seeded for the vocabulary these detectors read, and provider reason
  codes land as dimension values on numeric `normalized_metrics` rows under a declared allowed
  vocabulary that refuses an unknown label. See ADR 0034.
- Registry version 2 registers four more core-owned detectors — `funnel.stage_conversion`,
  `orders.cancellation_loss`, `operations.closed_share`, and `customer.new_share`; see section 11.2.
  `orders.cancellation_loss` is the second detector with a declared computable monetary impact,
  alongside `revenue.period_movement`. See ADR 0035.
- Registry version 3 adds `revenue.window_gross` to channel-scoped runs. It stores the selected
  channel's reported gross revenue, every contributing citation, and observed-versus-expected period
  coverage without substituting the organization-scoped `revenue.channel_share` detector. The
  VerdictBand may use that stored amount as Potential beside the provider-reported cancellation loss.
- Recommendation generation and triage ship behind
  `GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS`. The model reads the run's findings and writes a
  schema-validated explanation citing the findings it used; operators Acknowledge, Mark planned, or
  Dismiss with a required reason; and a helpful/not-helpful review hook travels separately from the
  triage decision.
- Presentation follows the refined Data-Ink Maximal Narrative draft approved 2026-08-23: verdict
  band first, numbered narrative chapters ordered by ADR 0035, and evidence in a Sheet from an
  explicit Inspect evidence control. See section 17.3.
- Money, Items, Promotions, and Customer Voice stay awaiting-other-reports, collapsed into one muted
  row naming the report each needs, because the Talabat performance export holds no commission or
  payout columns, no per-item rows, no promotion funding detail, and no ratings.
  **Superseded for Money on 2026-09-01.** Kept as the record of what this dated slice shipped. Keeta
  exports later supplied the commission and fee columns Talabat's export lacks, so the Money chapter
  now reports rather than waits; see registry 7 below. Items, Promotions and Customer Voice are
  unchanged and still wait.

#### Staging proof and recommendation completion (2026-08-26)

- The approved contract-v2 projection was recovered through forward-only claim, revision, and
  decimal-quantity repairs. Its successful retry wrote 653 governed observations and recorded 468
  absent source rows. Twenty observations overlap prior governed evidence and remain
  `blocked_overlap`; 633 are current, so the package truthfully finishes
  `reconciliation_required` rather than pretending the overlap is resolved.
- The Integration Hub now presents those twenty held observations as one gross-revenue decision at
  the top of the package card. It identifies the approved `gross_sales` source field, the earlier
  Performance upload, and the affected range from 2026-01-01 through 2026-02-15. The 633
  non-overlapping rows and all technical evidence identifiers stay in the audit ledger rather than
  filling the user-facing page. One owner/admin choice resolves all twenty dates atomically.
- A replay is successful only when it repeats the same field-level decision. A contrary choice
  returns a conflict and the UI asks the operator to refresh, so an immutable first decision is
  never misrepresented as a later successful change.
- The recommendation storage, same-run citation fence, append-only human decision log,
  helpful/not-helpful vote, second narration worker, and advisory forty-eight-hour judge are
  implemented. Production worker environment contains both recommendation model keys.
- The staging figures prove 18,294 impressions, 949 menu views, 59 add-to-cart events, 24 placed
  orders, AED 553.00 gross revenue over 20 of 59 days, AED 357.00 provider-reported rejection loss,
  25 new and one returning order, ten avoidable cancellations, and 34,217 of 70,799 scheduled
  minutes closed (about 48.3%). Closure reasons are `CHECK_IN_REQUIRED` on 39 days and
  `UNREACHABLE` on 20 days. Five cited days are genuine zero-trading days — 2026-01-11,
  2026-01-22, 2026-01-23, 2026-01-29, and 2026-02-03 — and remain distinct from the 468 absent
  source rows.
- The approved contract does **not** bind a cancellation-reason field. Therefore neither the
  detector, narration, nor UI may claim `ITEM_UNAVAILABLE`, even though the approved visual draft
  used that label. A later contract version and explicit human approval are required before that
  root cause can become governed evidence.
- Production Trigger version `20260826.5` promoted the bounded lineage reads. Analysis run
  `27b2ecd6-7594-4eea-b0ef-68aca82555d8` completed over the projected Talabat window with one
  finding, eleven observations, no `needs_data` outcomes, and citation rows for every result. The
  database had required one further forward-only repair: exact provider-measured availability
  minutes made the ratio denominator fractional, so migration `20260826190000` now admits a
  bounded decimal denominator for ratios while preserving integer-only money.
- The automatically chained narrator reached its exact 90-second provider deadline and failed
  safely with `MODEL_PROVIDER_UNAVAILABLE`; it wrote no uncited prose. Its bounded deadline is now
  180 seconds inside the existing 300-second task cap. Promotion has been delayed by Trigger's
  remote build network, so successful narration remains a release gate independent of the now
  proven deterministic Analysis result.

### 4.1.8 Delivered repeat-intake and in-place audit slice (2026-09-02 to 2026-09-04)

Approved on 2026-09-02 after an operator loaded four months of Talabat's performance report for a
paying client. The design is
`docs/superpowers/specs/2026-09-02-governed-report-reuse-and-channel-intake-design.md`; the durable
decision is ADR 0046. Implemented across 13 planned tasks on `feat/governed-channel-intelligence`,
three inserted mid-flight, and closed out by this section. The full task-by-task record, including
every ruling, defect, and incident named below, is
`.superpowers/sdd/2026-09-02-governed-report-reuse-phase-1/progress.md`.

What the live attempt exposed:

- Every month asked the same four governance questions again, for files differing only in their
  figures. Three independent causes: validation requires a contract version proposed against that
  exact package, so no approval can ever admit a later file; the schema fingerprint hashes the
  worksheet name, which Talabat rewrites per export; and the report type is free text inside the
  reuse key.
- The CSV export of a report drafted from its XLSX export was refused with `INVALID_LOCAL_DATE`.
  The contract declares one date encoding, and the provider writes dates two ways.
- `CATEGORICAL_VALUE_NOT_DECLARED` refused a file over the cancellation reason `CLOSED` without
  naming the label, the days it appeared on, or any way out short of editing the provider library.
  The failure detail is plumbed but empty: `ReportProjectionError` carries only a code whose message
  is that same code, so the recorded detail repeats itself.
- Governed refusals returned `{ outcome: "failed" }` and Trigger.dev recorded `COMPLETED`.
- Projection completing wrote governed evidence and stopped; the audit ran only from a button on
  another route.
- The channel detail page accepts no window and displays the newest completed run, so a chosen
  month changed nothing on screen.

Phase 1, ingestion — delivered:

- `structure_fingerprint` on packages, per section 8.1.
- `report_structure_admissions` and the second admissible path in both claim functions, per
  section 8.2 and ADR 0046.
- One approval screen replacing the four-step flow on an organization's first sight of a
  structure; report type derived from the recognised family.
- A backfill script (`scripts/backfill-report-structure-admissions.mjs`) granting admissions from
  mappings already approved, reporting what it grants before it grants it.
- A strict `YYYY-MM-DD` string accepted whatever encoding a contract declares. Ambiguous forms
  still require a declaration; `03/04/2026` is not made guessable. A declared `valueSeparator`
  (Task 3B, not in the original plan — see "How the plan grew" below) lets one cell carry two
  labels, which is what Talabat's own cancellation-reason column does.
- A `ReportCategoricalValueNotDeclared` subclass carrying the label, output key and dates, on the
  `ReportControlTotalMismatch` precedent of ADR 0029, so the existing failure detail says something.
  A one-click declaration proposes an amended projection version for approval. Scoped to the
  declaring organization.
- Governed refusals raised as non-retryable Trigger errors, so a refusal reads as `FAILED` without
  burning retries.

Phase 2, the surfaces — two of three items delivered, as code that a person also had to hand off
mid-plan and that this task's review round then had to repair (see "How the plan grew"):

- **Delivered, reviewed, browser-unverified:** a clean projection dispatches `channel-analysis.run`
  for its declared window, keyed on the projection run. A `reconciliation_required` or
  `partially_projected` result does not, because an audit of disputed figures would state a
  conclusion the platform cannot support.
- **Not attempted in this plan:** the channel detail page accepting `?window=` and selecting the
  run matching that window through the URL. The page's run selection is unchanged from before this
  slice. This remains open, exactly as originally scoped for a later pass.
- **Delivered, reviewed, browser-unverified:** a Reports tab on the channel page carrying the whole
  intake with the channel fixed from route context. The Integrations governed-reports view is
  unchanged.

#### What was actually verified against staging

- **The structure fingerprint collapses real uploads to one identity.** Computed from the client's
  five real packages' own stored header-candidate digests: the January, February, March and April
  2026 XLSX uploads — four different worksheet names (`jan_2026`, `feb_2026`, `mar_2026`,
  `apr_2026`) — all fingerprint to `606b75133c29…`. The January CSV of the same report fingerprints
  to a different identity, `1951b8d9a2cd…`, because its header names genuinely differ from the
  XLSX's — the honest outcome the design predicted (CSV and XLSX are two structures, each admitted
  once), not a defect.
- **`fixtures/raw/Talabat/Jan-2026.csv` projects end to end**: CHECK_IN_REQUIRED 28, UNREACHABLE 3,
  ITEM_UNAVAILABLE 7, gross 43800 minor units, 20 orders, 31 rows spanning 2026-01-01..31.
- **A real package was claimed on staging through the admission path**: outcome `acquired`, the
  admission's contract version returned, `admitted_under_admission_id` written, status advanced to
  `validating`.
- **Both service-role advance functions were called against staging**, each on a success path and a
  refusal path: `advance_governed_report_package_on_admission` (awaiting_contract →
  awaiting_validation) and `advance_admitted_report_package_to_projection` (validated →
  awaiting_projection).
- **The backfill granted the client's two admissions** (the CSV and the four-month XLSX structure)
  and a second `--apply` run was a no-op (7 skipped, 0 new grants).

#### What was not verified — stated plainly

- **The live end-to-end upload was never performed.** Uploading a fresh file (for example
  `fixtures/raw/Talabat/Mar-2026.xlsx`) and watching it reach `projected` with no approval screen —
  the single most convincing proof this slice works — is outstanding. Do not read any statement in
  this section as end-to-end verification; every item above was verified individually, not as one
  live chain.
- **Browser verification covered only the governed-report intake**, not the admission approval
  screen or the channel Reports tab. An operator-role session (role `OPERATOR` on a real
  organization) was exercised at 1440×900 and an emulated 390×844 mobile viewport: the intake
  correctly shows no Approve control for an operator, the two-person approval note renders, there is
  zero horizontal overflow at 390px, and the console carries zero errors and zero warnings at both
  widths. The admission approval screen and the channel Reports tab were not reached, because the
  verified account's organization has zero channels and zero report packages, and the organization
  that does have real data is reachable only with the user's own credentials, which were not
  requested.

#### A compatibility shim is live on staging and must be removed

`supabase/migrations/20260903125000_restore_profiling_completion_overload.sql` restores the
six-argument `complete_governed_report_package_profiling`. An earlier migration in this same slice
added a seventh argument and dropped the six-argument overload in the same migration; the Trigger.dev
worker already deployed to the cloud still calls six arguments, so every profiling run in the
deployed environment failed function-not-found and recorded a generic `PROFILE_FAILED` until this
shim was pushed. The overload is a thin wrapper passing a null structure fingerprint — the honest
value, since the deployed worker cannot compute one — so a package it profiles simply matches no
admission until re-profiled, which is correct rather than degraded.

**This overload must be dropped in a later migration once the Trigger worker is deployed with this
branch's code.** Until then it is load-bearing for every new upload on staging. The lesson for future
migrations that change a function signature the deployed worker calls: expand and contract as two
migrations — add the new overload, deploy the worker, then drop the old one — never both in one
migration. Every test passed throughout this defect's life, because tests exercise the code in the
branch, not the code already running in the deployed worker.

#### Residue on shared staging that cannot be removed

Governed report packages and admissions cannot be hard-deleted by design. Verification across this
slice (Tasks 2, 6, 7, 9C, and 12) left several synthetic packages and fixture organizations on
staging — all clearly labelled, isolated, and carrying no real client data. One admission, in the
`Task 7 admission-path claim verification` organization, could not even be revoked: that organization
has zero memberships, so no session can satisfy the revoke RPC's requirement of a real owner or
admin acting on themselves. This is the access-control protection working as designed, not a defect
— the admission is inert, since no session can reach that organization and no real package anywhere
carries its placeholder fingerprint.

#### A caveat on Task 7's isolation proof

Task 7's cross-organization isolation assertion is weaker than it looks. `report_structure_admissions`
has a composite foreign key to `organization_channels(organization_id, id)`, so two organizations can
never share a channel id — meaning that assertion would still pass even with its own organization
filter removed. The isolation itself is real, but it rests on the schema design from Task 6, not on
that pgTAP assertion. A future reader should not mistake the test for the protection.

#### How the plan grew

The plan added three tasks mid-flight and one repair round on work handed to it from outside the
normal task sequence:

- **Task 3B** ("a categorical cell that carries two labels"), inserted after Task 3. Task 3's own
  acceptance test could not pass on the date fix alone: the January CSV writes two unavailability
  reasons joined by a semicolon in one cell, and admitting that shape needed a new declared
  `valueSeparator` field plus a forward migration replacing the database's own strict key allowlist
  on the projection document — bigger than a clause inside Task 3, so it became its own task.
- **Task 9B** ("let an admitted upload advance without asking again"), inserted after Task 9's wiring
  was reviewed clean. Investigation found the automatic chain Task 9 wired had no way to actually
  run: two required state transitions (`awaiting_contract` → `awaiting_validation` and `validated` →
  `awaiting_projection`) had no non-human path in the database, so an admitted package's dispatch
  would always return `not_ready`. Task 9B added the two service-role RPCs that supply them.
- **Task 9C** ("restore the profiling signature the deployed worker calls"), inserted after Task 10's
  implementer found fresh profiling failing generically on staging. This is the compatibility-shim
  migration described above — a regression this plan itself caused by dropping a signature the
  deployed worker still needed.
- **One repair round on handed-off work.** After Task 10 completed, four additional commits landed
  on this branch implementing the declare-a-label flow (Task 11), the auto-analysis dispatch, and the
  channel Reports tab, without going through this plan's per-task review loop. A final review of
  those four commits found 0 Critical, 5 Important, and 8 Minor issues; one repair round addressed
  all 5 Important findings, verified independently rather than taken on the implementer's report.
  That same review found another agent's Growth Intelligence changes committed inside two of those
  four commits (`src/lib/logger.ts` and `database.types.ts` hunks unrelated to reports) — a violation
  of this plan's path-limited `git add` rule. The commits are not rewritten: rebasing or splitting
  commits on a branch another agent is actively committing to risks destroying their work to fix an
  attribution error, a worse trade than a mis-attributed line in four commits on a shared branch. One
  of those same commits' own board entry states "Growth Intelligence files are not touched," which is
  not true as committed; that claim is corrected in the board entry accompanying this section rather
  than left standing.

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

### 7.4 Sheets whose records are their columns

Every provider export the client sends is one row per period and one column per figure. An
accounting profit and loss is the transpose: one row per account, one column per month. All the
information is there, rotated ninety degrees, and a reader that only knows the first shape cannot
follow it.

- A contract sheet declares **`recordOrientation`** — `rows` (the default, and what every contract
  approved before 2026-09-01 keeps) or `period_columns`. Nothing is sniffed. A file is read the way
  its approved contract says it is laid out, and no other way.
- A `period_columns` sheet also declares **`periodHeaderRow`**, the row of the file that carries the
  period names. A statement names its months in a column heading rather than in a cell of its own,
  so after rotation those names are values with nothing above them. The reader supplies the reserved
  header `report_period`, and the contract binds it like any other field.
- The rotation happens once, on the way in. After it, `headerRow` and `dataStartRow` mean exactly
  what they always meant, counted down the rotated grid, and validation, the parsers, the projection
  language, the control totals and the lineage all work unchanged. Nothing downstream asks which way
  round the file was.
- A rotated sheet may not declare a **totals row** or **ragged rows**, and no **row or cell count
  control** may name one. The first two describe a shape the sheet has before rotation and do not
  survive it with their meaning intact; the third would compare a count taken after rotation against
  a profile taken before it, and fail every time while nothing was wrong.
- **A label the statement uses twice is refused, not resolved.** A profit and loss repeats a label
  freely, with different figures under each. Binding one and silently getting the other is the
  failure mode this whole path exists to prevent, so a bound duplicate is a typed
  `AMBIGUOUS_ROW_LABEL` failure. Recognition applies the same rule earlier: a repeated label is left
  out of the profiled candidate, so a contract binding one is refused at approval rather than on the
  first real file.
- **Recognition reads the first column.** A rotated sheet has no header row to digest, so the
  profiler additionally digests the label column and files it at row position `0` — outside the
  range a contract may name, so nothing reaches it by accident. `assert_report_contract_matches_package`
  sends a `period_columns` sheet there by its declared orientation rather than by its row number.
- **`numberFormat`** belongs to the same family as `dateEncoding` and exists for the same reason: a
  spreadsheet hands over a number, while a PDF hands over what was printed, and an accounting
  statement prints `1,234.56`. A numeric field declares `plain` (default) or `grouped`. Declared
  rather than sniffed, because `1,234` is one number on a statement and could be two badly split
  columns in a CSV, and an undeclared grouped column keeps failing.
- **`month_year`** is a period-key encoding for a column headed `May 2026`. It resolves to the first
  of that month, which is where a monthly period starts.

See ADR 0045.

Storage paths are tenant-prefixed and immutable:

`organizationId/channelId/packageId/revision/{original|sheets/...}`.

Finalization verifies bucket, exact path, object ownership, expected size, MIME, and digest before a
worker can claim the package.

## 8. Schema fingerprints and report contracts

### 8.1 Fingerprints

A package carries two versioned digests. Both are computed during profiling, and neither contains
cell values, customer PII, financial totals, or filenames.

**Schema fingerprint** identifies an exact profiled shape, worksheet names included:

- report family, channel template hint, currency, and outlet grain;
- ordered normalized sheet names and positions;
- per-sheet ordered normalized header candidates and their row positions;
- repeated-header, merged-cell, formula, and structural flags;
- parser and fingerprint algorithm versions.

It is recorded on append-only contract, decision and binding rows and is never redefined.

**Structure fingerprint** identifies the same report across the months a provider issues it, and is
what reuse is keyed on:

- outlet grain and parser version;
- per sheet, ordered by position: the position and the repeated-header, merged-cell and formula
  flags;
- per header candidate row: its row position, field count, and the digests of its normalized
  column names;
- the structure algorithm version.

It excludes the worksheet name, the report type, the declared currency, and the declared period.

The exclusion of worksheet names is the point. Talabat names its tab after the export range —
`Talabat-Jan-Feb-2026-Performanc`, then `Mar-2026` — so a digest containing that name changes every
month for a file whose columns never move. A name a provider rewrites per export is a label on the
folder, not the identity of what is inside it. Currency and report type are matched explicitly at
admission rather than folded into the digest, so a mismatch is refused by name instead of
disappearing as a non-match.

Two files with the same columns therefore carry one structure identity whatever their dates,
amounts, worksheet name, or file format. See ADR 0046.

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
family, schema fingerprint, currency, and outlet-grain context. At most one active binding exists
for that tuple.

Reuse across uploads is carried by `report_structure_admissions` rather than by the binding. An
admission states that, for one organization and channel, a file of one structure fingerprint and
currency is read using one approved contract version and one approved projection version, granted
by a named person until revoked. `claim_governed_report_package_validation` and the projection
claim admit a package on either a contract version proposed against that exact package or a
matching active admission; every other invariant they enforce is unchanged. Each package records
`admitted_under_admission_id`, so an import always names the authorisation that let it in, and
revoking an admission returns that structure to per-upload approval without rewriting a figure.

An organization's first upload of an unadmitted structure asks once — one screen naming the report
and the figures it will read, one approval, which writes the contract version, its decision, the
projection version, its decision, and the admission, all attributed to the operator. Later uploads
of that structure are admitted silently. A library-drafted family is recognised in every
organization; a hand-built mapping is reused only within its own organization until it is
deliberately promoted into the library. See ADR 0046.

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

A sheet rule may also declare ragged-row realignment, and a projection output may bind a decimal
parser to a count metric or count occurrences of declared categorical labels into dimension values;
see ADR 0036 and ADR 0034.

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

**Shipped.** An approved `period_grain` declaration is written by
`complete_governed_report_package_period_grain_projection`, a fenced RPC the worker calls under its
claim token and lease. One observation per period; no observation at all for a period the provider
left blank, and the count of those blanks is recorded on the projection run as `absent_row_count`
rather than turned into a zero nobody can tell apart from a day that genuinely sold nothing.

Period boundaries are computed in the **branch's** timezone, per `specs/015` section 4.4, not in the
organization default the package copies at intake, and the zone in force is recorded on the row.
`period_start` is local midnight of the first day; `period_end` is local midnight of the day after
the last. The grain comes from the approved declaration and is re-derived by the database rather than
accepted from the worker. A row dated outside the package's declared window is
`PERIOD_OUT_OF_DECLARED_RANGE`; a row whose date cannot be read is `INVALID_LOCAL_DATE`. See
ADR 0030.

Categorical outputs write provider labels as dimension values on those same numeric rows, and
continuous quantities reach count metrics through decimal-parser columns accumulated in exact
fixed-point addition, never floating point. See ADR 0034 and ADR 0036.

Where a provider writes those labels as prose rather than as codes, the approved declaration carries
a `categorical.labelMap` naming which literal text stands for which approved value — Keeta's
`Cancelled by merchant` for `MERCHANT`. The map is approved with the rest of the document rather
than inferred at import, must reach every value the output allows, and does not loosen the refusal:
text it does not carry stops the import instead of becoming an undefined "other". See the
2026-09-01 amendment to ADR 0034.

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

It stores coordinates, digests, and bounded metadata, not raw cell values. A lineage row names
exactly one of the two ledgers. A series row records the sheet, the column, and how many rows fed
each period; it records no first and last data row, because the projector computes none per period
and a sheet-wide range would claim evidence nobody checked. Per-period row ranges are a follow-up. Every read-model number
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
- Overlap is searched across **both** projection targets. A daily series and an exact-range total
  covering the same days collide, and each side is compared in its own recorded zone's local dates so
  a branch zone differing from the package's cannot hide a collision. Only rows a governed projection
  wrote are candidates. Every colliding prior is recorded as a decision of its own, so accepting a
  correction sets aside all of them rather than the first.
- An accepted correction supersedes priors in its own ledger and marks priors in the other one
  `excluded`, because a supersession pointer cannot cross tables. Held evidence carries
  `reconciliation_state = 'blocked_overlap'` in whichever ledger it landed in and is excluded from
  every current read. See ADR 0030.
- The operator resolves one package/run/output group, not one ledger row at a time. Postgres locks
  the complete group and applies the choice in one transaction; either every affected observation
  changes state and receives an immutable resolution record, or none does. The tenant-scoped read
  model lists only unresolved `ambiguous_overlap` groups from the thirty recent packages and caps
  the action list at fifty groups.

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

#### First shipped detector slice

The first shipped slice is deliberately limited to detectors that run on evidence a governed report
package already produces, and to core ownership. It registers four:

- `evidence.period_coverage` — which periods in a window carry current governed evidence and which
  are absent, from the metrics ledger and the projection run's recorded gap count. An absent period
  is reported as absent; it is never inferred, interpolated, or read as zero.
- `evidence.reconciliation_blocked` — evidence held for an owner or admin decision in either ledger,
  named by its reconciliation record so the operator can act on it.
- `revenue.period_movement` — period-over-period movement in `revenue.gross` for one channel over a
  window, from the period-grain series only. `needs_data` with fewer than two comparable periods, or
  where grain, currency, branch, or channel differ. This is the only detector in the slice that
  computes a monetary impact, and it computes it as the movement itself in integer minor units.
- `revenue.channel_share` — each channel's share of gross revenue in a window. Two currencies are
  refused, never converted.

Deferred at that slice, and named rather than implied: every margin, take-rate, fee, funnel, item,
promotion, review, and operational detector in section 11.2, each of which needs economics inputs or
metric
vocabulary that no governed report currently populates. A detector registered against vocabulary
nothing writes returns `needs_data` forever and teaches an operator nothing.

`channel_recommendations` and `channel_recommendation_decisions` are also deferred. They exist to
hold a cited model explanation over selected findings under section 11.4; shipping the tables before
the narration path would be dead schema, and shipping narration alongside an unproven detector layer
would put an AI boundary on top of numbers nobody has checked in production yet. Findings are
visible without narration, which section 11.4 already requires as the fallback.

**Shipped.** All four are registered in `src/domain/analysis/`, run by the
`channel-analysis.run` worker, and written through the fenced RPCs in section 11.3, together with
the registry-version-2 additions below. Three details
of the shipped slice are decisions in their own right and are recorded in ADR 0031:

- A run names one channel or none. `revenue.channel_share` compares channels and has no single
  channel to bind to, so each detector declares a scope and the registry binds only the detectors
  whose scope matches the run.
- Severity is omitted rather than invented. It exists only on a quantified finding, and three of the
  four detectors emit authoritative observations without one, because no agreed threshold turns a
  movement or a share into a problem of a given size. The single shipped severity rule is a case
  distinction on the evidence — held evidence is high when it blocks a period nothing else covers,
  medium when it does not — and is versioned with its detector.
- A finding may cite only current evidence from either ledger. It may still cite a reconciliation
  record, which is what `evidence.reconciliation_blocked` does: an outstanding decision is a fact
  about the evidence, while the held figure behind it is not yet a fact about the business, and that
  detector never reports its value.

**Exercised over real evidence.** The slice was first run against a governed Talabat package
declaring 1 January to 28 February 2026 at day grain, with 20 of 59 days carrying evidence. Every
figure resolved to the ledger rows it cited. Two refusals were wrong in the same way and were
repaired, each as a new detector calculation version (ADR 0032):

- `evidence.period_coverage` is at calculation version 2. A window whose evidence exists but is
  recorded at another grain now reports `EVIDENCE_AT_DIFFERENT_GRAIN` and names that grain, instead
  of `NO_GOVERNED_EVIDENCE_IN_WINDOW`. Describing a ledger full of days as an empty window sends an
  operator to chase a provider for a file the platform already holds.
- `revenue.period_movement` is at calculation version 2. A refusal for want of two comparable
  periods now names the rows it set aside and reports itself as partial, which
  `evidence.period_coverage` already did. Two detectors describing the same evidence differently is
  a defect in whichever one says less.

`evidence.reconciliation_blocked` remains at calculation version 1 and correctly emits an
observation, not a finding, where nothing is held.

#### Registry version 2

Registry version 2 appends four core-owned detectors, each running on vocabulary a governed
projection now writes — reason codes as dimension values (ADR 0034) and continuous quantities
through decimal-parser bindings (ADR 0036):

- `funnel.stage_conversion` — conversion between consecutive reported funnel stages
  (impressions, menu views, add-to-cart, placed order) for one channel over a window.
- `orders.cancellation_loss` — cancelled and rejected orders over a window, with the provider's own
  reported rejection loss summed over the window as its declared monetary impact. See ADR 0035.
- `operations.closed_share` — the share of scheduled operating minutes the provider reports closed,
  with closure reasons carried as dimension values.
- `customer.new_share` — the provider-reported share of orders from first-time customers over a
  window.

#### Registry version 3

Registry version 3 appends one core-owned channel detector:

- `revenue.window_gross` — the selected channel's reported `revenue.gross` over the analysed window,
  summed only from current comparable period-grain rows in one currency. It cites every contributing
  row and carries observed-versus-expected coverage; missing periods remain absent rather than zero.
  It refuses no evidence, mixed currency, or an unnamed currency. It is an observation, not a
  monetary-impact calculation, payout, margin, or realized-profit claim.

The channel VerdictBand reads Potential from this observation and Lost from
`orders.cancellation_loss`'s provider-reported monetary impact. Earned is the explicitly labelled
derived split `Potential − Lost`, shown only when both stored amounts share a currency and potential
is not smaller than lost. This does not depend on a model-written recommendation or on the
organization-scoped `revenue.channel_share` detector.

#### Registry versions 4 to 8

Each appends without changing what came before, and each is admitted in two places — the
`channel_analysis_runs` check constraint and the guard inside `claim_channel_analysis` — because
changing only the first passes every unit test and then raises 22023 at claim time.

- **4** — `revenue.window_gross` may answer from a provider's own span total, so a channel that
  states one figure per export is analysable at all.
- **5** — a span becomes a grain a run can be claimed at. Only the two detectors that can honestly
  answer without periods bind there; the rest are not bound at all rather than bound and refusing.
- **6** — `economics.commission_share`, the first detector that reads a cost. Keeta's order export
  states the commission the marketplace charged, so what a channel costs to sell through comes from
  evidence rather than from a configured rate.
- **7** — `economics.channel_cost_load`. Commission was never the whole bill: reconciling a client's
  own statement of account showed it to be roughly half of what the marketplace actually charged,
  with bank charges and equipment fees making up the rest.
- **8** — `orders.cancellation_attribution`. Keeta names the party that cancelled each order, in
  sentences the projection language could not read until `categorical.labelMap` landed, so the
  workspace answers whose cancellations a channel's are instead of only how many. It states counts
  and the proportions between them; it recognises no party by name, per ADR 0034. Its monetary
  impact is declared not computable — this provider prices no cancellation, and multiplying one by
  an average basket would be a model presented as a measurement.
- **9** — `economics.company_cost_structure`, the first detector that reads the client's own books
  rather than a marketplace's export. No marketplace has ever stated what the food cost, so the money
  chapter has always had to say that what remains after a marketplace's deductions is not profit. It
  reads `cost.food`, `cost.packaging` and the marketplace commission the books recorded against
  `revenue.company_gross`, and reports each line on its own as well as together, because a reader
  deciding what to do needs to know whether the cost sits in the kitchen or in the commission.

  It divides by `revenue.company_gross` and never by `revenue.gross`. A statement that books
  marketplace commission as a cost has, under accrual, already counted those marketplaces' sales as
  income, so dividing a company cost by one channel's revenue would compare a whole against a part.
  Nothing it reports is attributed to a channel: a set of books does not say which marketplace an
  order's ingredients were bought for, and the finding says so in its own limitations. Its monetary
  impact is declared not computable — these are costs already incurred and recorded, not a gain or
  loss the analysis found.

### 11.3 Analysis records

`channel_analysis_runs` binds one organization/channel/branch/window to exact metric, economics,
contract, detector, and model version tuples.

`channel_findings` stores deterministic outputs, priority, quality, typed evidence references,
calculation digest, limitations, and status. The authoritative observation and numeric values are
never model-authored.

**Shipped.** `channel_analysis_runs`, `channel_findings`, and `channel_finding_evidence` exist, and
the worker reaches them only through `claim_channel_analysis`, `complete_channel_analysis`, and
`fail_channel_analysis` — security definer, granted to `service_role` alone, with an idempotency row
and a lease, exactly as the projection path works. Economics, contract, and model version tuples are
absent from the shipped run because this slice binds none of them; the run records the metric and
detector tuples it did bind, and the completion RPC refuses any finding naming a detector version or
a metric the run did not bind.

`channel_findings.kind` is `observation`, `finding`, or `needs_data`. All three are stored: a
`needs_data` outcome an operator cannot see reads as "nothing wrong here", which is the opposite of
what it means. Severity and priority exist only on `finding`. A run is keyed for idempotency on the
run id rather than the window, because re-analysing a window as new evidence arrives is ordinary; a
later run supersedes the earlier findings for the detectors it carried, and those stay readable.
Findings are readable through RLS to `report.read` and writable from no session at all.

`channel_recommendations` stores a cited model explanation over selected findings with exactly one
label: `observation`, `recommendation`, or `needs_data`. It includes evidence references, supported
actions, limitations, model metadata, and prompt/output digests. It contains no executable tool or
provider payload.

`channel_recommendation_decisions` is append-only and stores `acknowledged`, `dismissed`, or
`planned`, actor, required dismissal reason, timestamp, and the recommendation version. A later
analysis may supersede a recommendation but may not erase the human's prior decision.

`channel_recommendation_feedback` stores the helpful / not-helpful review hook: one vote per actor
per recommendation, replaceable, stored apart from triage decisions so a statement about usefulness
is never mistaken for a statement about action.

**Approved, not yet implemented — monthly analysis reuse.** ADR 0043 replaces the proposed
free-range calendar with one server-resolved `YYYY-MM` selection inside the channel's contiguous
declared-package timeline. It will add immutable evidence/cache digests to the analysis run, so an
identical current evidence set can reuse a completed run while any correction, reconciliation,
supersession, projection, or detector/metric-version change creates a new one. Run-id idempotency
remains an operation concern; it is not the cache identity.

Generation is a second fenced worker, not a phase of the detector run (ADR 0037). It claims a
completed analysis run through a security-definer RPC, reads that run's findings alone with no tools
and no retrieval, and files at most six schema-validated recommendations whose citations the
completion RPC re-checks against the findings of the same run. Each recommendation records the
prompt version that produced it. A failed or refused narration leaves the run's findings visible
untouched, which section 11.4 requires as the fallback.

Quality is evaluated by a scheduled judge that reports and never modifies (ADR 0038). Every
forty-eight hours it receives each not-yet-judged recommendation together with the exact findings it
cites, returns a structured verdict on citation faithfulness, label appropriateness, invented values,
and uncertainty honesty, and files it into `channel_recommendation_evaluations` through a
worker-only RPC with digests and judge-model metadata. Verdicts are internal quality evidence for human prompt iteration; they never render on a
client-facing surface and never change a recommendation, a prompt, or a rule by themselves.

**Shipped on the feature branch.** All five recommendation tables force RLS; narration and judge
writes enter only through fenced `service_role` RPCs; member triage and feedback enter only through
authenticated definer functions that explicitly revoke `service_role`. The judge selection is a
database anti-join capped at 200, so its request does not grow with all prior verdicts, and an
invalid judge reply is logged by recommendation id with no provider text or business figure.

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

Global rollout (2026-09-09, channel recommendations, Amendment B): the Amendment A
treatment — stored channel context plus Google Search grounding (user-consented; the
channel's own docs, forums, and merchant discussions first), no URLs emitted, findings
the only cited evidence, portal how-to steps allowed as grounded advice phrased as
actions the operator performs (never menu-path claims), every action human-supervised —
now applies to every audit section, not just the three pilot detectors
(`orders.cancellation_loss`, `orders.cancellation_attribution`,
`operations.closed_share`, kept as documentation of where the rollout started). The
channel block and grounding rules render whenever stored context survives the loader,
for any detector key. Narration prompt version 7 adds a global plain-English rule: short
common words a busy shop owner with basic English reads fast, one idea per sentence,
most sentences under about 15 words, no idioms or figures of speech, numbers as figures
never spelled out. The plain-English rule renders on every run, including the
loader-failure fallback, which is otherwise the pre-pilot v4 shape (no channel block, no
grounding rules). A grounding failure still falls back the same way and the run still
completes. The judge (version 3) still flags invented values and now also names heavy
jargon, unexplained technical terms, or longwinded prose. The version-5 playbook design
stands as history in ADR 0050, the Amendment A grounding decision in ADR 0051; the
binding rule is section 14 — see ADR 0052.

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
- `POST /api/organizations/:organizationId/channel-recommendations/:recommendationId/feedback`

Read models use discriminated unions for trusted, partial, indicative, insufficient, stale,
ambiguous-overlap, and currency-mismatch states. An unavailable value is absent, not zero.

**Shipped.** `POST /api/organizations/:organizationId/channels/:channelId/analysis`
starts a deterministic analysis over a declared window. It carries `windowStart`, `windowEnd`,
`periodGrain`, and an optional `branchId`; it is gated on `report.retry` and on the governed channel
analysis flag; and it returns `202` with the run id it created. The window is supplied and never
inferred — a window derived from whatever evidence exists cannot report a gap at its own edges. The
route decides nothing: the claim RPC re-resolves the channel, the branch timezone, and the metric
vocabulary, and refuses what it cannot bind. A dispatch that did not happen is reported as a failure
rather than as a success nobody got.

The two recommendation mutation routes above are also implemented. Decisions require
`recommendation.triage`; feedback requires organization membership. Both use the signed-in
session all the way through the database fence, return safe errors, and log identifiers only. A
request-level idempotency key is still a named follow-up: feedback is naturally one upserted vote,
but retrying a triage request can append the same human answer twice until that operation ledger is
added without breaking the currently deployed RPC signature.

Findings themselves have no read route yet. They are read server-side through the caller's own
session, so RLS decides what is visible rather than application code deciding for it.

**Approved, not yet implemented — monthly request contract.** ADR 0043 changes the route to accept
only a canonical `month` (`YYYY-MM`). The server resolves the known declared timeline, local bounds,
timezone, branch scope, grain and exact evidence/cache digest; callers cannot provide dates, grain or
branch to bypass that fence. It returns a safe `cached` disposition and existing run id only when the
authenticated server-side cache key is exact, otherwise `queued` with the new run id; a queued worker
recomputes the key under its lease before reuse or completion.

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
- `channel_analysis.started`
- `channel_analysis.completed`
- `channel_analysis.failed`
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
  The scheduled judge has the same constraint, bounded to one run's findings and their citations.
  The recommendation-narration model grounds with Google Search on every run with findings
  (2026-09-09, user-consented, global rollout under Amendment B; the Amendment A
  pilot-detector gate is retired and its three keys are kept as documentation of where the
  rollout started) — preferring the channel's own
  docs, forums, and merchant discussions first. The model still emits no URLs (the output shape has
  no URL field), findings remain the only cited evidence, every action stays human-supervised, and
  output still passes the same schema-validation and citation re-check fence. Narration prompt
  version 7 states the global plain-English rule (short common words, one idea per sentence,
  no idioms, numbers as figures); the judge (version 3) checks it. This superseded the
  original section 11.4 pilot paragraph's playbook and empty-web-slot sentences, and then the
  Amendment A pilot-only wording — that paragraph now
  describes the global rollout; see ADR 0052. ADRs 0050 and 0051
  stand as history.
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
least privilege, a no-tool model worker (apart from the user-consented narration grounding
exception above), typed output, deterministic projection, and exact human
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
- **Dispatch never ran:** a package stops in a *waiting* state rather than a failed one, because
  nothing claimed it and so nothing marked it wrong. Every stage's recovery path admits its own
  waiting state — `uploaded` and `profiling` for profiling, `awaiting_validation` for validation,
  `awaiting_projection` for projection — so an operator can ask again for work that was queued and
  never picked up. Admitting the waiting state widens nothing: each claim RPC already accepts it,
  and every approval boundary is re-checked at claim time.
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

**Shipped.** All nine chapters render, and since 2026-08-23 the presentation follows the refined
Data-Ink Maximal Narrative draft: the verdict band leads, and the narrative chapters are numbered in
the order ADR 0035 defines — declared monetary impact first, then the deterministic fallbacks — so
the page opens with what each problem cost. Chapters the current exports cannot fill do not render
empty frames: Items, Promotions, and Customer Voice collapse into one muted
awaiting-other-reports row naming the report each needs, because the Talabat performance export
holds no data for them (section 4.1.7). Money was in that row until 2026-09-01 and no longer is:
Keeta's order export writes the commission a marketplace charges and its billing report writes the
bank and equipment fees beside it, so `economics.commission_share` and `economics.channel_cost_load`
both report there from evidence. The page still distinguishes reported, needs data, no
detector yet, and not analysed, because all four look identical as a blank frame and mean entirely
different things.

A figure the platform cannot state renders as an em-dash with the reason beside it, never as a zero.
The window on screen is stated as exact local dates and the zone they were bucketed in, never as a
month name. Evidence opens in a Sheet from an explicit Inspect evidence control beside any figure,
showing the detector key, its calculation version, the window, the quality state, the limitations
the detector itself recorded, every cited row, and the calculation digest. The earlier dark floating
Evidence Node rail is gone; `.superdesign/design-system.md` forbids it by name.

**Approved, not yet implemented.** ADR 0043 replaces the package picker and ADR 0033's proposed
free-range calendar with adjacent Month and Year controls. The selectable pairs cover every month
from the earliest to latest projected package declaration, including empty internal months; edge-year
months outside that horizon are unavailable. The selected `YYYY-MM` maps to the full local calendar
month, while the server derives its actual evidence grain. A blank month stays selectable and the
VerdictBand states that no governed evidence was recorded; it is not rendered as zero or a broken
control. The detail URL chooses the corresponding run, so no month selection can sit above another
month's figures. A cache cue appears only for a completed run whose recomputed evidence digest and
versioned input key match exactly.

The page reads the findings of the one run it displays, so the window in the header and every figure
beneath it come from the same analysis. Reading every open finding for the channel put two runs'
answers on one page, under a header naming only one of their windows.

Recommendations ship with the Talabat vertical slice (section 4.1.7), behind
`GOVERNED_CHANNEL_ANALYSIS_ORGANIZATION_IDS`. Narration is written by a second fenced worker
chained after the detector run (ADR 0037), capped at six per run and citing the findings it used;
triage offers Acknowledge, Mark planned, and Dismiss with a required reason through an append-only
decision log; a helpful/not-helpful hook sits apart from triage; and a scheduled judge reviews each
recommendation against its own citations every forty-eight hours as advisory quality evidence for
human prompt iteration (ADR 0038). Findings remain visible without narration, which section 11.4
already requires as the fallback.

The refined operations chapter now includes a cited day calendar for closed-versus-scheduled
minutes, bars for the provider reason dimensions the detector actually cited, cancellation count
and provider-reported rejection-loss treatments, and compact bars for the Also measured rail. A
dashed calendar cell means that this finding did not cite a closed/scheduled pair for that day; it
never means zero. The cancellation panel explicitly says its root-cause breakdown is unavailable
under the approved contract instead of copying the draft's unsupported `ITEM_UNAVAILABLE` label.
Failed projection cards expose the existing governed request-and-dispatch path as **Retry
projection**, including when the package state lags but its latest projection run is failed.

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
- Canonical month parsing, leap-year bounds, known-timeline expansion including empty internal months,
  edge-month availability, server grain resolution, and URL/run alignment.
- Content-addressed reuse: exact-evidence hit; misses after a metric revision/reconciliation/package
  declaration/detector or registry-version change; and an explicit empty-month cache shape.
- Narrative citation coverage and rejection of invented values, causes, confidence, or benchmarks.
- Benchmark comparability, expiry, influence cap, minimum-ten suppression, and consent.

### 20.3 Hosted-staging pgTAP

- RLS and explicit privileges for every table and RPC across two accounts and organizations.
- Composite tenant-safe foreign keys for channels, branches, packages, contracts, lineage,
  recommendations, and benchmarks.
- Permission matrix, including direct API and direct-RPC misuse.
- Worker-only writes, lease and claim fencing, cancellation, idempotent replay, and terminal-state
  preservation.
- Monthly analysis cache lookup/index/RLS isolation, cache invalidation under a changed governed row,
  and first staging invocation of every new claim/resolver function.
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
- Month-only analysis request validation, `report.retry` permission, no raw window/grain/branch bypass,
  safe cached-versus-queued responses, and deterministic findings when recommendation narration fails.

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
- ADR 0031: the first shipped detector slice
- ADR 0033: superseded free-range windows shaded by evidence density
- ADR 0043: month-and-year evidence windows use content-addressed analysis reuse
- ADR 0034: reason codes are metric-row dimensions
- ADR 0035: findings rank by declared money first
- ADR 0036: ragged rows are a declared contract capability
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
