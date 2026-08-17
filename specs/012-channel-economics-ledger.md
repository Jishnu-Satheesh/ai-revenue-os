# Feature Specification: Channel Economics Ledger

## Status

Draft.

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

## 13. Test plan

- Unit: the margin identity across computation kinds, tier and grade derivation, effective-date resolution at boundaries.
- Database: RLS, effective-dated uniqueness, snapshot consistency with source entries.
- Integration: a seeded organization with deliberately incomplete cost data, asserting `indicative` grading propagates and blocks decision use.
- Component: the operator view under complete, partial, and empty data.

## 14. Migration and rollback

New tables only; no changes to existing schemas. The pack catalog seed is idempotent and versioned. Rollback is a table drop, since no other module reads the ledger until the Margin Firewall ships.

## 15. Documentation updates

- `context/04-domain-model.md` — cost component and channel economics entities in the core.
- `industry-packs/restaurant/domain-model.md` — the mapping from `Order` and `MenuItem` onto core grains.
- `context/19-glossary.md` — contribution margin, cost component, completeness grade.

## 16. References

- `specs/013-margin-firewall.md`, the first consumer
- `specs/003-integration-hub.md`
- `specs/001-organization-digital-twin.md`
- `adrs/0006-use-industry-packs.md`
- `context/09-business-memory.md`
- `industry-packs/restaurant/domain-model.md`
