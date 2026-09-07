# ADR 0046: A standing admission is the unit of report reuse

## Status

Accepted. User-approved on 2026-09-02. Implements the reuse that spec 018 §8.2
promised and never built, and corrects the fingerprint definition in §8.1.

## Context

Spec 018 §8.2 states that automatic reuse occurs when every bound field matches.
`report_contract_bindings` was built for it. It never happened, for three reasons
that each independently defeat it.

`claim_governed_report_package_validation` requires a contract version whose
`report_package_id` is the package being validated. A mapping approved for last
month's file cannot admit this month's, whatever the binding says. The binding is
consulted only to confirm the per-package version is bound.

The schema fingerprint hashes the normalized worksheet name. Talabat names the tab
after the export range — `Talabat-Jan-Feb-2026-Performanc`, then `Mar-2026` — so
identical column structures fingerprint differently every month. §8.1 both requires
sheet names in the digest and concludes that the same schema reuses its contract.
Those cannot both be true.

The report type is free text on the upload form and is part of the reuse key.

The consequence in production: an operator loading four months of one marketplace's
report answered the same four governance questions four times, for files that
differed only in their figures.

The obvious repair — auto-creating a proposal and an approval on each upload — was
considered and rejected. `proposal_source` is constrained to `human` and
`decided_by` references a real user. Writing those rows for someone who dragged a
file records them as having approved a mapping they never saw, produces nothing that
can be revoked, and makes the approval ledger describe events that did not occur.

## Decision

### Reuse is authorised once, durably, and is revocable

An organization grants a **standing admission**: for this channel, a file of this
structure and this currency is read using this approved mapping and these approved
figures, granted by this person, until revoked.

`claim_governed_report_package_validation` and the projection claim accept either a
contract version proposed against the exact package, as today, or a matching active
admission. Every package records `admitted_under_admission_id`, so each import points
at the authorisation that admitted it. Revoking returns the structure to per-upload
approval and rewrites no figure.

The approval ledger stays literally true. One named person authorised a standing
arrangement on a stated date, and every import descends from it.

### Structure identity excludes the worksheet name

A second digest, `structure_fingerprint`, is recorded beside the existing
`schema_fingerprint`, which is not redefined — it sits on append-only rows that
outlive this code.

It covers sheet position, structural flags, and the digests of normalized column
names with their row positions. It excludes the worksheet name, the report type, the
declared currency, the declared period, the filename, and every workbook value.
Currency and report type are matched explicitly at admission so a mismatch is named
rather than silently missed.

A name a provider rewrites each month is a sticky note, not an identity. What makes
a report the same report is its columns.

### One confirm the first time, none after

An organization's first upload of an unadmitted structure asks once: a screen naming
the report and listing exactly which figures will be read, and one Approve. That
click writes the contract version, its decision, the projection version, its
decision, and the admission — all attributed to the operator, all with
`proposal_source` genuinely `human`. Later uploads of that structure are admitted
silently.

### Cross-tenant reuse only through the shipped library

A report family in the platform's provider library is recognised in every
organization, because we drafted and reviewed it. A mapping an operator builds is
reused within their own organization and is never offered to another tenant until it
is deliberately promoted into the library.

Column names are provider vocabulary rather than customer data, so the exposure is
small — but it is one tenant's record shown to another, and that is a decision we
make deliberately rather than a side effect of a matching digest.

### Report type is derived, not typed

The report type comes from the recognised family. Free text survives only for
structures nothing recognises. A reuse key with a hand-typed component is not a key.

## Consequences

Loading a month of an already-admitted report becomes: upload, wait. The four-step
governance flow is paid once per structure per organization, and never again.

Two claim functions now have two admissible paths, which is more surface to get
right; both are proved from the database side in pgTAP, including that one
organization's grant is invisible to another.

An admission is a durable permission and needs a place to be seen and revoked.

Structure identity is versioned. If it is ever redefined, existing admissions must
be recomputed or retired rather than silently reinterpreted.

## Alternatives rejected

**Auto-propose and auto-approve per upload.** No schema change to the guards, and
much less work. Rejected: it records approvals that never happened, and AGENTS.md §6
forbids marking uncertain data as verified for the same reason.

**Shipped library only.** Smallest change and the cleanest trust story, but an
operator mapping a provider we have not drafted keeps repeating the same four steps
forever — which is the defect this ADR exists to remove.

**Redefining the existing schema fingerprint.** One digest instead of two. Rejected:
it repartitions every fingerprint ever recorded, making unchanged historical imports
look like different reports.
