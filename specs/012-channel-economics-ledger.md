# Feature Specification: Channel Economics Ledger

## Status

Draft, except section 6.3 and section 7.5, which are approved for the
evidence-readiness slice of the Governed Dynamic Channels and Marketplace
Intelligence program. Those two sections describe a read-only classification
over governed report evidence. Everything else in this document remains a draft
and no part of it is authority to compute, store, or display a margin.

## 1. Business outcome

Show an organization what it actually earns per transaction, per channel, after every variable cost — the number most small businesses cannot produce for themselves.

This is the platform's diagnostic wedge. It requires no model, and it establishes the denominator that every later opportunity, impact estimate, and margin guardrail is expressed in. A recommendation denominated in a number the client already trusts inherits that trust.

## 2. Industry neutrality

The core owns the *structure* of unit economics: revenue, an extensible set of variable cost components, and the contribution margin derived from them, dimensioned by channel and period.

The core does not own the *vocabulary*. "Order", "commission", "packaging", and "preparation" are restaurant concepts and live in the Restaurant Industry Pack, which registers them as cost component definitions. A core table must never gain a `commission_amount` column. Per ADR 0006, the second vertical is the test of whether this boundary is real; a distributor's cost components would be freight and returns, registered the same way.

The core term for the unit is **transaction**. The pack maps its own entity onto it.

## 3. Scope

### 3.1 Included

- A cost component registry, seeded by industry packs and extensible per organization.
- Transaction-grain economics where transaction-level data exists.
- Period-grain economics where only aggregates exist, which is the common case early.
- Channel dimension, including marketplace, direct, dine-in, and any pack-registered channel.
- A completeness and quality grade on every computed margin.
- The operator view that presents contribution margin by channel, and by item where the pack supplies item mapping.
- Recomputation when cost inputs change.

### 3.2 Explicitly excluded

- Fixed and overhead cost allocation. Contribution margin only. Allocating rent across orders invites arguments the platform cannot win and does not need for decisions.
- Full accounting reconciliation. This is a decision instrument, not a general ledger, and it never claims to agree with the client's books to the fils.
- Tax computation beyond recording tax treatment as a component.
- Customer lifetime value. Separate, later, and dependent on consented first-party identity.
- Forecasting.

## 4. Domain rules

### 4.1 The identity

For a transaction or a period aggregate:

```
contribution_margin = gross_revenue
                    - sum(variable_cost_components)
```

All money is stored in integer minor units with an ISO currency code. Every component is signed and stored at the same grain as the revenue it offsets. A component that cannot be attributed to a grain is recorded at the coarser grain rather than apportioned silently.

### 4.2 Cost component definitions

A component definition carries a stable key, a display label, an owning scope (core, pack, or organization), an applicability rule by channel, a computation kind, and a default quality tier.

**A definition is vocabulary; a rate is tenant data, and they are separate records.** "Commission" is the same concept for every marketplace restaurant, but this organization's Talabat commission is 28% from March and 30% from June. Folding both into one row would force a new definition on every rate change, and would make the shared catalog organization-scoped for no reason. Definitions therefore follow the registry pattern in `specs/015-metric-registry-and-normalized-metrics.md` section 5 — a null organization means core or pack vocabulary, a non-null one means a custom key — and effective dating in 4.5 lives on the rate, which is where a commission tier change actually belongs.

Computation kinds:

- `fixed_amount` — a flat amount per transaction.
- `rate_of_revenue` — a percentage of gross revenue, which is how most marketplace commissions behave.
- `per_unit` — an amount per unit of quantity.
- `sourced` — supplied directly by an integration or import, not computed.

**A `sourced` component names the metric that supplies it.** Its amount is a measured cost per period per channel, which is exactly what a normalized metric observation is; modelling it as a rate would mean calling a period total a rate, and the rate table deliberately has no column for one. The binding is `source_metric_key` on the definition, so the pack that registers the component also registers the metric that feeds it, and only a `sourced` component may carry one. A period with no observation leaves the component `missing`, which is the honest answer rather than a zero.

Because the definition is shared vocabulary, the binding is the same for every tenant on the pack. An organization whose data arrives under a different key registers a custom metric with that key — the same override path economics roles use, so there is one mechanism rather than two.

### 4.3 Quality tiers

Every component value on every row carries a tier, in descending trust:

1. `measured` — supplied by a system of record or a provider report.
2. `derived` — computed deterministically from measured inputs.
3. `estimated` — computed from a documented assumption the client accepted.
4. `assumed` — a platform default the client has not reviewed.
5. `missing` — no value available.

The tiers deliberately mirror the source hierarchy in `context/09-business-memory.md`. A cost assumption is a fact about the business and follows the same trust rules; a platform default must never present as a client-verified number.

### 4.4 Completeness grade

A computed margin carries a grade derived from the tiers of its components and the share of gross revenue each covers:

- `complete` — every applicable component is `measured` or `derived`.
- `partial` — at least one component is `estimated` or `assumed`, and no applicable component is `missing`.
- `indicative` — at least one applicable component is `missing`.

**A margin graded `indicative` is never presented as a contribution margin figure.** It is presented as a bounded range with the missing components named. This is the rule that keeps the ledger honest against the reality that most small businesses do not know their true cost of goods, and it is enforced at the API boundary rather than in UI copy.

The bound is one-sided and computable: a missing cost can only reduce margin, so revenue less the known components is an upper limit and there is no lower one. An `indicative` entry therefore reports **at most X**, never a point and never a symmetric range that would imply a precision nobody has.

Nothing downstream may consume an `indicative` margin as a decision input. The Decision Engine treats it as `needs_data`.

### 4.4.1 A margin reported rather than derived

An operator's own export often states contribution margin outright while saying nothing about what makes it up. That number is measured; it is simply not decomposed, and 4.4 has no grade for it because every grade there describes a decomposition.

An entry therefore records how its margin was arrived at:

- `derived` — computed from components by the identity in 4.1, graded by 4.4.
- `reported` — supplied whole by a system of record, carrying its own quality tier and no components.

A reported margin is a usable decision input, because the figure is measured. What it cannot answer is the second question in section 7, "what is eating the margin", so the waterfall is offered only for derived entries and the operator view says plainly which kind it is looking at.

Where an entry has both — components that derive a margin and a reported figure for the same period — the ledger keeps the derived value and raises the disagreement. A silent reconciliation would hide either a wrong rate or a wrong export, and both matter.

**Raised means visible to the operator, not logged.** The entry keeps the figure the source reported alongside the derived one, and the operator view states the gap above the channel table — before the margin column can be read as settled — and marks each affected row with what the export says. The difference is never stored, only derived from the two figures on the row, so the stored copies cannot drift apart.

Every non-zero gap is surfaced; there is no threshold below which a contradiction stops being one. A gap of exactly zero is agreement rather than a very small disagreement, and shows nothing. Only periods carrying both figures are compared, so a window where the export was silent for half its days does not read as disagreeing by the value of the missing half.

The platform does not adjudicate. It names both possibilities — a rate that is wrong, or an export that is — and leaves the judgement with the operator, because picking a side would be the silent reconciliation this section exists to forbid.

Where the derivation is `indicative` and a reported figure exists, the entry records the **reported** margin. There is no derived value to keep in that case, and grading the period `indicative` would discard a measured number the operator already has and block it from decisions — leaving them worse informed than their own spreadsheet does. This is the common case at the start of an engagement rather than an edge: no rate has been captured yet, so nothing derives, while the marketplace export states a margin on every line. The reported figure answers "how much" and still declines to answer "what is eating it", which is exactly what section 7 needs it to do.

The rule in one line: **the derived margin wins wherever it can be stated; a reported figure is the fallback, and where both stand the disagreement is raised.**

### 4.5 Effective dating

Component definitions and their values are effective-dated. A marketplace commission tier change does not retroactively rewrite last month's margins; it creates a new effective period. Historical rows retain the rates in force when they occurred.

Effective dates are **calendar days in the branch timezone**, not instants. An operator saying a tier rose on 1 June means their own 1 June, and a Dubai day begins at 20:00 UTC the evening before; comparing that date against a period's UTC instant applies every rate change a day late. A period is therefore priced against the rates in force on the local day it began. Where no rate covers a component on that day, resolution returns nothing rather than the nearest rate in time — falling back would price a period with a number that was never in force, which is the precise thing effective dating exists to prevent.

## 5. Data model

Core tables, industry-neutral:

- `cost_component_definitions` — shared vocabulary seeded from a pack catalog, with the fields in 4.2. A null organization is core or pack vocabulary; a non-null one is a custom key, exactly as `metric_definitions` works.
- `cost_component_rates` — organization-scoped and effective-dated, holding what this organization actually pays for a component on a channel, with its quality tier. This is where a commission tier change lands.
- `channel_economics_entries` — grain (`transaction` or `period`), channel, branch, period bounds, gross revenue, quantity, contribution margin, margin source per 4.4.1, completeness grade, currency, source references.
- `channel_economics_components` — per-entry component values with amount, quality tier, and the definition reference.
- `channel_economics_snapshots` — materialized rollups by organization, branch, channel, and day, for the operator view and for firewall evaluation.

The Restaurant Pack maps `Order` and `OrderLine` onto transaction-grain entries and registers commission, packaging, food cost, promotion funding share, delivery cost, and payment fees as component definitions. That mapping lives in the pack, not the core.

## 6. Inputs

- Normalized metrics and ingestion runs from the Integration Hub.
- Verified facts from the Digital Twin for rates the client confirmed, such as a commission percentage from a contract.
- Manual and CSV import where no API exists, which is expected to be the primary path initially. Rates are captured in the **Cost structure** onboarding section (`specs/002-guided-onboarding.md`), which renders one row per registered component so the vocabulary stays the pack's. On completion the section promotes what was typed into `cost_component_rates` through a governed RPC, and the ledger reprices.
- Pack-supplied item cost data where available.

Where a rate exists both as a provider-reported value and a client-stated fact, the provider value wins for `measured` tier and the divergence raises a `fact_proposal` through Business Memory rather than overwriting anything.

**Which metric supplies which input is declared on the registry, not named in code.** The ledger reads the `economics_role` binding in `specs/015-metric-registry-and-normalized-metrics.md` section 5.1 — `gross_revenue`, `transaction_count`, `unit_count`, `reported_margin` — so the core never learns that a restaurant calls its reported margin `margin.contribution`. Only `gross_revenue` is required; an unbound role leaves its input absent, which grades the affected components honestly rather than failing the run.

### 6.1 Recomputation

Recomputation runs as its own background task, not inside the import that triggered it. An import that succeeded has succeeded: a margin that failed to recompute is a retryable problem of its own, and failing the import for it would put a good ingestion into the error list for a reason the operator cannot act on. The task is also the landing point for the other trigger — an operator correcting a rate — which has nothing to do with imports.

The window is read from the observations the ingestion run wrote, together with the grain, branch and timezone they carry. That is exact, needs no plumbing through the ingestion workflow, and is correct for a partial import where some rows rejected. A run that wrote nothing is skipped rather than failed. A run that wrote more than one grain, timezone or branch is refused, because those do not describe a single window.

Recomputes are serialized per organization. Two imports finishing together would otherwise interleave upserts over the same periods.

Capturing rates triggers the same task with a whole-organization window instead of a run window: a corrected commission reprices every period it was in force for, and which periods those are is not knowable from any one ingestion run. Both trigger sites are fire and forget. The rates and the records are already saved and are the durable answer; a recompute that could not be queued means margins are stale for a while, not that the operator's work was lost.

### 6.2 What the operator is asked for

- **One row per registered component**, driven by `cost_component_definitions` rather than a list held in code. A `sourced` component is shown but not typeable, with the reason, so an empty box never reads as the operator's omission.
- **A confidence per row**, in the operator's words rather than the ledger's. This is the input to 4.3, so a guess must be recordable as a guess; an unstated confidence is treated as `assumed`.
- **Zero is an answer.** Dine-in commission genuinely is zero, and recording it is what turns an `indicative` margin into a real one. A blank is the opposite: it leaves the component `missing` and is named as such.
- **One effective date for the capture.** An operator states their current cost structure at a point in time; a later tier change opens a new effective period from the operator surface rather than editing this one.
- **Completion needs one priced cost and a date, not every component.** Most operators cannot state their cost of goods on the first day, and blocking the section would stall onboarding over exactly the gap this ledger exists to report honestly.

### 6.3 Evidence readiness, before any margin is computed

The ledger cannot be trusted before the evidence behind it is. This section
defines a **read-only** classification that answers one question — *is the
governed report evidence this organization already holds sufficient to begin
Channel Economics work?* — and deliberately answers no other. It computes no
margin, writes no entry, captures no rate, and reveals no rate.

The evidence it reads is the governed exact-range ledger built by
`specs/018-governed-channel-intelligence.md` section 10.2 under ADR 0026 and
ADR 0027. Readiness is derived at read time from that evidence and from the
coverage function in 7.3. Nothing is stored, so nothing can drift.

#### 6.3.1 The readiness tuple

Readiness is classified per **organization, channel, branch, and exact local
period** — the same grain the exact-range ledger records, which is the only
grain that exists here. The tuple key is channel, branch, inclusive local start
date, inclusive local end date, and period timezone.

Currency is an attribute of the tuple, never part of its key. Two current money
observations inside one tuple carrying different currencies is precisely the
condition 6.3.3 calls `not_comparable`; folding currency into the key would hide
that contradiction by splitting it into two tidy tuples.

Only **current** observations are read — `reconciliation_state = 'current'`,
not superseded, excluded, or held. A history view is the only exception and
must say so explicitly. Values are never read: readiness needs the shape of the
evidence, not the numbers in it, and reading a number here would put workbook
content on a surface that has no business holding it.

Nothing is inferred. A daily, weekly, or monthly figure is never derived from an
exact range; ranges are never prorated, summed across an overlap, currency
converted, or joined across differing periods.

#### 6.3.2 Which roles must be supplied

Roles are read from the registry binding in
`specs/015-metric-registry-and-normalized-metrics.md` section 5.1, exactly as
section 6 already requires, so the core never learns a provider's vocabulary. An
observation supplies a role when its metric definition is active, visible to the
organization, and carries that `economics_role`; an organization's own
definition outranks shared vocabulary for the same role.

- `gross_revenue` is **required**. Without it there is no period to price.
- `transaction_count` is **required** for readiness, though not for the ledger
  itself. This ledger's promise is what a business earns *per transaction*; a
  revenue total with no denominator cannot begin that work.
- `unit_count` and `reported_margin` are optional and are reported as present or
  absent without affecting the classification.

Cost inputs are read only as coverage, per 6.3.4.

#### 6.3.3 The five states, and the order they are decided in

A tuple is classified by the **first** matching rule. Worst wins, so a tuple is
never described more favourably than its weakest fact allows.

1. **`blocked`** — evidence exists but may not be used. Any of: an observation
   for this tuple is held as `blocked_overlap`; an ambiguous-overlap
   reconciliation for this tuple is unresolved; every observation for the tuple
   is `superseded` or `excluded` with no current replacement; or the source
   package sits in `reconciliation_required`, `validation_failed`,
   `projection_failed`, or `failed`.
2. **`not_comparable`** — the inputs exist but cannot honestly be combined. Any
   of: two current observations in the tuple bind the same role through
   different metric definitions; money observations in the tuple carry different
   currencies; a required role is absent from the tuple but is supplied for the
   same channel and branch by a current observation whose exact range intersects
   this one without matching it, or matches it under a different timezone; or a
   required role is absent from the tuple but is supplied for the identical
   period and timezone under a different branch or channel.
3. **`needs_data`** — a required input is simply absent. Any of: no current
   observation supplies `gross_revenue`; none supplies `transaction_count`; or
   cost coverage is `unchecked` or reports no covered component at all.
4. **`partial_evidence`** — the required evidence is present and comparable but
   incomplete. Any of: a supplying observation carries `quality_state` or
   `completeness_state` of `partial`; or some, but not all, applicable cost
   components are covered.
5. **`ready_for_economics`** — current, non-overlapping, complete, comparable
   observations supply every required role, and every applicable cost component
   is covered.

`ready_for_economics` means *work may begin*, not *the margin is correct*. It is
a statement about evidence and never about a figure, because this slice computes
no figure.

Warnings are carried on every tuple regardless of its state, as typed codes with
plain-language copy. A warning that stopped being visible once the headline read
`partial_evidence` would defeat the point of grading at all.

#### 6.3.4 Cost coverage is availability, never an amount

Cost readiness is read through the governed coverage function named in 7.3 and
through nothing else. That function returns, for each registered component,
**whether** it is covered and **at what quality tier**. It returns no amount, no
percentage, no effective date, no contract, and no supplier.

An operator may therefore be told "commission has a measured source" or "food
cost is missing". They may not be told what the commission is. This holds for
every role, including owner and admin, on this surface: the readiness panel is
not the rate surface and gains nothing by becoming one.

An empty or failed coverage read is `unchecked`. It is never an all-clear, and
per 6.3.3 it classifies the tuple `needs_data` rather than letting silence read
as sufficiency.

A component the operator cannot close stays subject to 7.4: it is named and
explained, and it carries no action.

#### 6.3.5 Determinism

The read model carries a version and is ordered stably by channel key, branch,
start date, end date, and timezone. A digest is computed over the ordered,
value-free classification, so the same evidence always produces the same
response and a change in readiness is attributable to a change in evidence
rather than to query order.

#### 6.3.6 What this section does not do

No contribution margin, no economics entry or component write, no rate capture
or edit, no recomputation, no cost allocation, no normalized daily metric write,
no detector, recommendation, benchmark, Business Memory write, AI narration, or
provider action. No marketplace-specific rule and no provider-specific table.

## 7. UX flow

The operator view answers three questions in order:

1. **Which channel actually makes money?** Contribution margin by channel for the period, with the completeness grade visible per row, never hidden behind a tooltip.
2. **What is eating the margin?** Component breakdown as a waterfall from gross revenue to contribution margin.
3. **What would I have to fix to trust this number?** The missing and assumed components, each linking to the action that would upgrade its tier.

The third question is the retention mechanism. It converts a data-quality problem into a guided task list, and it is the natural on-ramp to the AI Readiness Score.

Follows `context/13-ui-ux-context.md` and the shadcn/ui requirement.

### 7.1 How a window is combined

The view reports over a window, and combining periods needs rules the sections above do not state:

- **A window is only as trustworthy as its weakest period**, the same weakest-wins rule components already follow. Sixty complete days and ten indicative ones make an indicative window.
- **An indicative window reports a ceiling and carries no scalar to read.** The upper bound is the sum of each period's own bound. The read model's type has no `contributionMarginMinor` field on that branch, which is how §12 is enforced rather than merely documented.
- **Mixed margin sources are labelled, not blended.** A window holding both derived and reported periods says so and offers no waterfall: the components explain only the derived periods and would not add up to the figure on screen.
- **Two currencies in one window are refused**, never converted.

### 7.2 Order, and when it inverts

The three questions run in order, except where no channel has a derived margin. There the task list leads: every row is a ceiling or a reported figure, and opening with a table the operator cannot act on wastes the one screen that could tell them what to do about it. §11 asks for this, and it is the state every client starts in.

### 7.3 What may be read, and by whom

Entries and components are readable by any member. Rates are not — §9 makes cost structure confidential, and the rate table is owner and admin only.

That creates a trap the view has to avoid. Coverage cannot be read from the rate table, or an operator without admin rights sees every priced component reported as unpriced and is sent to re-enter figures that already exist. It cannot be derived from the entries' own components either, because a `reported` margin carries none — which is precisely the state a new client is in, and precisely when the task list matters most. Coverage therefore comes from a governed function returning **whether** each component is priced and at what tier, never what it costs. A percentage is commercially sensitive; "commission is priced, from a contract" is the readiness signal every member needs.

An empty coverage read is reported as unchecked, never as an all-clear.

### 7.4 A gap the operator cannot close is not a task

The task list distinguishes a component the operator can price from one the platform cannot yet use. `packaging` needs a unit-count metric and `promotion_funding` needs a provider line-item path; no rate anyone could type would resolve either. Those rows are named and explained but carry no action, because offering a button nobody can complete is worse than offering none.

### 7.5 The evidence readiness panel

One panel on an existing surface, answering three questions in plain language
and nothing else:

- **What evidence is ready?** Each channel, branch, and exact local period the
  organization actually holds current governed evidence for, with its state from
  6.3.3 and its exact start and end dates, timezone, and currency shown as
  recorded. Never a rolled-up month, never a rate, never a total.
- **What prevents an honest contribution margin?** The named reasons behind the
  state — a missing role, a held overlap, a currency that does not match, a cost
  component with no source — in the operator's words rather than the ledger's.
- **What should the user provide next?** The single next step for each reason,
  subject to 7.4: a gap nobody can close is named and explained and offers no
  action.

The worked example the panel must be able to produce: *"Gross revenue is
available for this exact Talabat period. Contribution margin is not calculated
because commission, delivery cost, and food cost evidence are missing."*

The panel never renders a workbook value, a row, a cell, a formula, a signed
URL, a filename, a prompt, a secret, or model output. It states no figure of any
kind, because it has none. A tuple that is not `ready_for_economics` is never
described as trusted.

## 8. AI behavior

Almost none, deliberately. The ledger is arithmetic.

Models are used only for:

- Extracting rates and fee structures from uploaded contracts and provider statements, as a `fact_proposal` requiring confirmation.
- Mapping provider line-item labels onto registered component definitions, as a suggestion with a confidence score and a human confirmation step.

No model computes, adjusts, or explains a margin figure. A generated narrative over a financial number is an unsupported-claim risk with no upside here.

## 9. Security and tenancy

- RLS on every table per `context/06-multi-tenancy-and-security.md`.
- Cost structure is commercially sensitive. Default sensitivity is `confidential`; component definitions and rates are never included in cross-organization aggregation without the privacy path in `context/11-playbooks-and-experiments.md`.
- Customer identifiers are not required and are not stored here.

## 10. Observability

- Share of revenue covered by `measured` components, per organization. This is the single best indicator of whether the ledger is trustworthy for a given client.
- Completeness grade distribution over entries.
- Count of entries blocked from decision use by `indicative` grading.
- Recomputation lag after a rate change.
- Divergence events between provider-reported and client-stated rates.

## 11. Failure states

- **No cost data at all.** The view renders gross revenue by channel with every margin `indicative`, and leads with the readiness task list. It does not render zeros or invent defaults. Where the source reported a margin, section 4.4.1 applies instead and the entry is `reported`.
- **A component that cannot yet be priced by any rate.** A `per_unit` component with no unit-count metric imported, or a `sourced` one whose bound metric has no observations, is not a missing rate an operator could supply. The readiness task list names it and explains why, but offers no action: a button nobody can complete is worse than none. Both of the pack's original cases are now closed — `units.count` is registered core vocabulary and `promotion_funding` is bound to a metric per 4.2 — so the state is reachable again only where the data has genuinely not arrived.
- **Partial period coverage.** Entries are marked and excluded from period comparisons rather than extrapolated.
- **Currency mismatch across sources.** Rejected at ingestion; no implicit conversion.
- **Retroactive provider restatement.** Creates a correcting entry with a reference to the original; entries are never silently mutated.

## 12. Acceptance criteria

- No core table contains an industry-specific cost column.
- Every margin figure carries a completeness grade, and `indicative` margins cannot be read through the API as a scalar contribution margin.
- No downstream consumer can treat an `indicative` margin as a decision input.
- Component rates are effective-dated and historical entries are stable across a rate change.
- Money is stored in integer minor units with an explicit currency throughout.
- Provider and client rate divergence produces a proposal, never an overwrite.
- The operator view names missing components explicitly and links each to a resolving action.
- Tenant isolation is tested, including snapshot tables.
- Evidence readiness classifies only current exact-range evidence, never a superseded, excluded, or overlap-held observation, and never a value.
- A readiness response reveals cost availability and quality tier only; no rate amount, percentage, effective date, or supplier reaches any role on that surface.
- An unavailable coverage read reads as `unchecked` and never as sufficiency.
- Readiness is organization-scoped, feature-flagged off by default, and enforced at the API boundary and the page loader rather than in navigation alone.

## 13. Test plan

- Unit: the margin identity across computation kinds, tier and grade derivation, effective-date resolution at boundaries.
- Database: RLS, effective-dated uniqueness, snapshot consistency with source entries.
- Integration: a seeded organization with deliberately incomplete cost data, asserting `indicative` grading propagates and blocks decision use.
- Component: the operator view under complete, partial, and empty data.
- Readiness: each of the five states from a fixture of governed exact-range evidence; superseded, excluded, and overlap-held observations excluded from readiness; missing registered roles; mismatched period, timezone, currency, branch, channel, and metric definition; coverage returning availability and tier only; cross-organization isolation; viewer, operator, and owner boundaries; feature flag enforced at both the API and the page; and a stable ordering and digest across repeated reads.

## 14. Migration and rollback

New tables only; no changes to existing schemas. The pack catalog seed is idempotent and versioned. Rollback is a table drop, since no other module reads the ledger until the Margin Firewall ships.

## 15. Documentation updates

- `context/04-domain-model.md` — cost component and channel economics entities in the core.
- `specs/018-governed-channel-intelligence.md`, which supplies the governed evidence readiness reads
- `adrs/0026-governed-channel-identity-and-report-contracts.md`
- `adrs/0027-governed-report-projection-declarations.md`
- `industry-packs/restaurant/domain-model.md` — the mapping from `Order` and `MenuItem` onto core grains.
- `context/19-glossary.md` — contribution margin, cost component, completeness grade.

## 16. References

- `specs/013-margin-firewall.md`, the first consumer
- `specs/003-integration-hub.md`
- `specs/001-organization-digital-twin.md`
- `adrs/0006-use-industry-packs.md`
- `context/09-business-memory.md`
- `specs/018-governed-channel-intelligence.md`, which supplies the governed evidence readiness reads
- `adrs/0026-governed-channel-identity-and-report-contracts.md`
- `adrs/0027-governed-report-projection-declarations.md`
- `industry-packs/restaurant/domain-model.md`
