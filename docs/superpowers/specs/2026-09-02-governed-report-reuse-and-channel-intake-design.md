# Governed report reuse, and intake where the work happens

**Date:** 2026-09-02
**Status:** Approved by the user on 2026-09-02, section by section.
**Extends:** `specs/018-governed-channel-intelligence.md` sections 7, 8 and 10.
**Introduces:** ADR 0046, standing admissions.

## Why

An operator loaded four months of one marketplace's report for a paying client and
described the experience as wanting to scream. Every month asked the same four
questions it had already been answered for. One month's file was refused outright.
A second was refused for a reason it would not name. Trigger.dev reported all of it
as `Completed`.

None of that was a single bug. It was five defects that happened to meet in one
workflow, and one promise the specification made and the implementation never kept.

## What was actually wrong

### The CSV was refused because the recipe said Fahrenheit

`talabat-performance.ts` declares `dateEncoding: "excel_serial"` — the date arrives
as the raw spreadsheet number `46023`. That is true of the XLSX export, where the
reader deliberately ignores cell styles and nothing in the bytes says the number is
a date. It is not true of the CSV export of the same report, which writes
`2026-01-01` as text. `parsePeriodKey` reaches its `excel_serial` branch, computes
`Number("2026-01-01")`, gets `NaN`, and raises `INVALID_LOCAL_DATE`.

A provider that exports one report in two formats writes its dates two ways. The
contract can only declare one.

### The remapping had three independent causes

Any one of them alone would have forced a fresh mapping every month.

**There is no reuse path.** `claim_governed_report_package_validation` requires a
contract version whose `report_package_id` is the package being validated. A
mapping approved last month is structurally incapable of admitting this month's
file. The `report_contract_bindings` table exists and is consulted, but only to
confirm the per-package version is bound — never as an alternative to it.

**The fingerprint hashes the worksheet name.** Talabat names the tab after the
export range. The drafting export is `Talabat-Jan-Feb-2026-Performanc`; the March
export is `Mar-2026`. Same columns, same recipe, different fingerprint, no match.
The CSV path is accidentally immune because every CSV profiles as a sheet named
`csv`.

**The report type is a free-text box.** The reuse key is
`(organization_id, channel_id, report_type, schema_fingerprint, declared_currency, outlet_grain)`.
Typing `Performance report` one month and `Performance Report` the next files them
as unrelated report types.

### The March file was refused without saying what offended

`Mar-2026.xlsx` carries the cancellation reason `CLOSED`. The approved figures
permit only `ITEM_UNAVAILABLE`, so the projection raises
`CATEGORICAL_VALUE_NOT_DECLARED`. Refusing an undeclared label is correct — folding
it into an "other" bucket would make an incomplete count read as complete. But the
failure names neither the label nor the days it appears on, and the only exit is an
engineer editing a file in the provider library.

The detail is plumbed and empty rather than missing. `failureDetail` composes the
error name, code and message, and `ReportProjectionError` carries only a code whose
message is that same code — so the recorded detail reads
`ReportProjectionError: CATEGORICAL_VALUE_NOT_DECLARED`, which is what the operator
saw. The pattern for fixing it already exists one class down: per ADR 0029,
`ReportControlTotalMismatch` extends the same error to carry the arithmetic,
"because the difference is the useful part".

### The audit does not follow the figures

`requestChannelAnalysis` is called from exactly one place: the button on the
channel workspace. Projection completing writes governed evidence and then stops.

### The channel page cannot answer for a window

`channels/[channelId]/page.tsx` accepts no `searchParams`, so a window chosen on
the channels list cannot reach it. It then renders
`runs.find((run) => run.status === "completed")` — the newest completed run,
whatever window that run covered. The picker on the page drives only what a future
run would cover, never what is displayed. Choosing a month therefore changes
nothing on screen, which is exactly what the operator reported.

### A refusal is reported as a success

Both the validation and projection tasks return `{ outcome: "failed" }` rather
than throwing. That is deliberate and half right: a date that will never parse
should not be retried three times. But Trigger.dev sees a clean return and records
`COMPLETED`, so the run list says the opposite of what happened.

## What the specification already promised

Spec 018 §8.2: *"Automatic reuse occurs only when every bound field matches and
deterministic validation and reconciliation pass."* The reuse was specified. It was
never built.

Spec 018 §8.1 lists "ordered normalized sheet names and positions" among the
fingerprint inputs and concludes *"The same schema with different dates or amounts
therefore reuses its approved contract."* Those two sentences cannot both hold for a
provider that names its worksheet after the export range. The conclusion is the part
worth keeping.

Both are corrected in this change, per AGENTS.md §9.

## Decisions taken

| Question | Decision |
| --- | --- |
| How far does reuse go? | Platform-wide recognition; one confirm the first time an organization sees a structure; silent thereafter. |
| Reusable across organizations? | Shipped library families only. A hand-built mapping reuses within its own organization, and crosses a tenant boundary only after we promote it into the library deliberately. |
| What does the one confirm replace? | All four steps. One screen naming what will be read, one Approve, attributed to the operator. |
| Ambiguous dates | Never guessed. A strict `YYYY-MM-DD` string is not ambiguous and is accepted whatever encoding is declared. |
| Undeclared categorical label | Stop, name the label and its dates, offer a one-click declaration. Organization-scoped. |
| Analysis after projection | Automatic, on a clean projection only. |
| Window with no audit | Say so by name and offer to run it. Never show another window's figures under the chosen dates. |
| Existing approved mappings | Carried forward automatically by backfill. |
| Trigger run status | Refusals surface as `FAILED` without retrying. |

## Design

### 1. A structure identity that survives the calendar

Add `structure_fingerprint` to `integration_report_packages`, computed during
profiling alongside the existing `schema_fingerprint`. The existing fingerprint is
not redefined: it is recorded on append-only rows that outlive this code, and
repartitioning it would make every past import look like a different report.

The structure fingerprint hashes, versioned by `structure_version`:

- `outlet_grain` and `parser_version`;
- per profiled sheet, ordered by sheet position: the position, `has_formula`,
  `has_merged_cells`, `has_repeated_header`;
- per header candidate row: its row position, field count, and the digests of its
  normalized column names.

It excludes the worksheet name, the report type, the declared currency, the
declared period, the filename, and — as everywhere in this pipeline — every value
in the file. Currency and report type are matched explicitly at admission rather
than baked into the digest, so a mismatch produces a named refusal instead of a
silent non-match.

Two consequences are intended and stated here so they are not discovered later.
Talabat's Jan-Feb, March and April exports collapse to one identity. A CSV and an
XLSX of the same report collapse together only if they carry the same columns; if
they do not, they are honestly two structures and each is admitted once.

### 2. Standing admissions

One new table, `report_structure_admissions`. A row states: in this organization,
for this channel, a file with this structure and this currency is read using this
approved mapping and these approved figures, granted by this person, until revoked.

Columns: `organization_id`, `channel_id`, `structure_fingerprint`,
`declared_currency`, `outlet_grain`, `report_type` (derived, inherited by admitted
packages), `report_family_key` (the library family, null for hand-built),
`report_contract_version_id`, `report_projection_version_id`, `active`,
`granted_by`, `granted_at`, `revoked_by`, `revoked_at`, `correlation_id`. At most
one active row per
`(organization_id, channel_id, structure_fingerprint, declared_currency, outlet_grain)`.

`claim_governed_report_package_validation` and the projection claim learn a second
admissible path: either a contract version proposed against this exact package, as
today, or a matching active admission, in which case the admission's contract and
projection versions are used. Every other invariant they enforce is unchanged.

`integration_report_packages` gains `admitted_under_admission_id`, so every import
records which grant let it in, and `report.package_admitted` is emitted as an audit
event.

Revoking an admission returns that structure to the per-upload approval path. No
recorded figure is touched.

**Scope of a grant.** An admission is keyed to one channel, because the mapping says which channel's
figures these are. It is deliberately not keyed to a branch: the columns of a report do not change
by outlet, and keying on branch would reintroduce the repetition this design removes for any
organization trading through more than one. Uploading the same structure into a *different* channel
asks once for that channel.

**Who may grant.** Granting and revoking require `report.contract_approve`, which today means owner
or admin. That is unchanged from the two approvals the grant replaces. An operator holds
`report.upload` and `report.retry` but not approval, so an operator meeting an unadmitted structure
uploads it and is told an owner or admin must admit it once. After that the operator uploads that
report every month with no approval in the loop at all — which is the whole point.

**Audit.** `audit_events` records `report.structure_admitted` on grant, with the actor, channel,
structure fingerprint, family key and the two version ids; `report.structure_admission_revoked` on
revoke; and `report.package_admitted` per import, naming the admission it descended from. The
existing contract and projection decision events are unchanged.

### 3. What an operator experiences

- **Structure already admitted here** — upload, and it projects. No screen, no click.
- **Recognised, not yet admitted here** — one screen naming the report and listing
  exactly which figures will be read, and one Approve. That click writes the
  contract version, its decision, the projection version, its decision, and the
  admission, all attributed to the operator. `proposal_source` stays `human`
  because a human proposed it.
- **Never seen anywhere** — today's guided mapping, ending at the same single
  Approve screen, which also creates the admission.

Report type stops being typed. It is taken from the recognised family, with the
free-text field surviving only for structures nothing recognises.

### 4. Dates, labels, and telling the truth about failure

**ISO text dates.** `parsePeriodKey` accepts a strict `YYYY-MM-DD` string before
dispatching on the declared encoding. This is not sniffing: `YYYY-MM-DD` has one
reading worldwide, which is precisely what `03/04/2026` does not. Ambiguous forms
continue to require a declaration.

**Undeclared categorical labels.** A `ReportCategoricalValueNotDeclared` subclass
carries the offending label, the output key and the dates it appears on, following
the `ReportControlTotalMismatch` precedent from ADR 0029. `failureDetail` then has
something worth recording, and the screen names the label and its dates instead of
repeating a code twice. It offers to declare the label, which proposes an amended
projection version — the value appended to that output's `allowedValues` — for
one-click approval, then re-runs. Scoped to the organization that declared it.
Nothing is counted until a person names it.

**Trigger run status.** A governed refusal is raised as a non-retryable Trigger
error so the run shows `FAILED` immediately without burning retries. The exact API
is confirmed against the `trigger-authoring-tasks` skill before implementation.

### 5. The audit follows the figures

On a clean projection, the projection worker dispatches `channel-analysis.run` for
the package's declared window, channel and branch, with the grain taken from the
approved projection document. This mirrors the existing chain from the analysis
worker to the recommendations worker. Idempotency is keyed on the projection run,
so a retried projection does not start a second audit.

A projection ending `reconciliation_required` or `partially_projected` does not
auto-run. Those states mean the figures disagree with the provider's own totals, or
that only some landed. Auditing disputed numbers and presenting the result as an
audit would state a conclusion the platform cannot stand behind.

### 6. The window that follows you

`channels/[channelId]/page.tsx` accepts `?window=start..end..grain`, the same shape
the channels list already emits, and every link from the list carries the current
selection. The page selects the run matching that window rather than the newest
completed run. The picker inside the workspace drives the URL rather than local
state, so choosing a month re-reads the page.

A chosen window with no completed run is named on screen — "no audit has been run
for this window yet" — with the run control beside it. A window is never answered
with another window's figures.

### 7. Intake where the work happens

A Reports panel on the channel page: upload, profile, the one Approve screen when
required, projection progress, and the audit starting on its own. The channel is
fixed from route context, so the form is shorter than the Integrations one.

`report-package-upload.tsx` is 1,386 lines and assumes it owns the Integrations
tab. The intake flow is lifted into a component both surfaces mount rather than
duplicated. The Integrations governed-reports view keeps every capability it has.

## Blast radius

- **Schema:** `integration_report_packages` gains two columns; one new table; two
  claim functions altered. No existing column is redefined and no recorded figure
  is rewritten.
- **RLS:** the new table needs organization-scoped select and the same hoisted
  permission checks applied on 2026-08-31.
- **Workers:** the projection task gains a dispatch; both report tasks change how
  they surface refusal.
- **Read paths:** the channel detail page changes which run it displays. Anything
  asserting "newest completed run" changes meaning.
- **Types:** new table and columns are added to `database.types.ts` by hand.
- **Growth Intelligence:** untouched. Nothing in this design reads or writes
  `growth_intelligence_*`, and the `database.types.ts` drift from that agent's
  unapplied migration is not resolved here.

## Test plan

- **pgTAP against staging:** a package admitted under its own organization's grant
  projects; another organization's grant is invisible and does not admit; a revoked
  grant stops admitting; a matching structure with a differing currency is refused
  with a named code; the per-package approval path still admits unchanged.
- **Unit:** the structure fingerprint collapses Talabat's three real exports to one
  identity and separates a genuinely different column set; the ISO branch is
  exercised against every declared encoding; the categorical failure carries its
  labels.
- **Real-export:** `Jan-2026.csv` and `Mar-2026.xlsx` join the existing
  `*.real-export.test.ts` suites and must project.
- **Component:** the one-Approve screen; the channel page answering for a window
  with no run; the channel intake panel.
- **Browser:** authenticated desktop and mobile acceptance via Chrome DevTools
  before any part is called done.

## Risks and rollback

The claim functions decide who may read figures, and a pushed migration is live on
shared staging at once. Each is read end to end before it is changed, and every new
plpgsql function is called once against staging before it is considered done —
plpgsql resolves record fields at execution time, and this repository has been bitten
by that twice.

Auto-analysis spends a model run per clean projection that nobody pressed a button
for.

The carry-forward backfill computes structure identities for already-approved
mappings and grants admissions from them. A mistake there would admit a future
upload under the wrong mapping. It reports what it is about to grant, and every
grant is revocable without touching a figure.

Each phase is a separate migration. The per-upload approval path remains intact
throughout as the fallback.

## Delivery

**Phase 1 — ingestion.** Structure fingerprint, standing admissions, the one-Approve
screen, report type from the recognised family, the carry-forward backfill, ISO
dates, the declare-a-label flow, and honest Trigger status. This is what unblocks
February through April.

**Phase 2 — navigation.** Auto-analysis on clean projection, window persistence and
window-correct run selection, and the channel intake panel.

## Documentation

- `specs/018-governed-channel-intelligence.md`: correct §8.1 (sheet names leave the
  reuse identity), make §8.2's reuse promise true, and add the delivered slice.
- `adrs/0046-*`: standing admissions as the unit of reuse.
- `docs/collaboration/asset-library-and-studio-board.md`: claim the files and record
  what the investigation found.
