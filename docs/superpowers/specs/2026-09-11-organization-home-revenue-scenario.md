# Organization home: revenue scenario (Approved for building 2026-09-16 — ADR 0060)

> 2026-09-18 design successor: the user approved an actual-versus-fixed-original-projection Overview chart. Spec 027 (`specs/027-overview-growth-progress.md`), proposed ADR 0064 and the 2026-09-18 Overview growth handoff define its execution proposal. This document still describes the existing candidate/scenario implementation; do not interpret its current-course forecast as recorded actual revenue. No successor implementation or migration was performed in the planning turn. Historical contradictory “deferred” paragraphs below are retained as proposal history; the accepted nightly-snapshot addendum remains the current implementation until the successor ships.

Status: Approved. The calculation contract below is authorized for
implementation under the GROWTH execution plan (approved 2026-09-16); the
implementation lives in `src/domain/organizations/revenue-scenario.ts` and the
home revenue slice, recorded in ADR 0060. The method proposal history (and its
companion ADR draft,
`docs/superpowers/plans/2026-09-11-organization-home-revenue-adr-draft.md`)
is retained below for the record.

Parent investigation (binding): `docs/superpowers/specs/2026-09-11-organization-home-growth-feasibility.md`.
Design reference for the lower home sections: `docs/superpowers/specs/2026-09-11-organization-home-design.md`.
Deliberate non-changes for the first home slice: `docs/superpowers/plans/2026-09-11-organization-home-data-contract.md`
§§7–8.

## 1. What this section answers

One new first content section below the organization masthead, above campaigns.
It answers: "If we stay on the current course, what revenue do we expect over a
named near future — and what extra revenue could the recommended actions plausibly
add on top of that?"

Three figures, always together:

- Latest reported revenue and its comparable-period change (measured history).
- Revenue on the current course for a named future period (baseline scenario).
- Potential revenue with the included actions: baseline plus modeled combined
  extra revenue, with the uplift shown relative to that same baseline.

The user has accepted revenue as the headline outcome, with profit shown
separately only where supported. Profit is never summed into the revenue headline.

## 2. Outcome definition

- Revenue means one named provider sales/revenue metric, reconciled before it is
  ever labelled simply "revenue". The exact metric (e.g. which gross-sales field
  from which provider report) must be named in the section's source note.
- Gross, not net: it is the reported sales figure before subtracting rejection
  loss. The earned/lost/potential split in `src/domain/analysis/money-split.ts:51-68`
  (`describeChannelMoney`) is historical accounting-style presentation — reported
  gross (`potential`) minus the provider's recorded rejection loss (`lost`).
  Never map its `potential` or `earned` fields to a future figure.
- Currency-scoped: one currency per scenario. Mixed-currency channel sets refuse
  a combined total, reusing the rule in
  `src/modules/analysis/application/channels-overview.ts:645-654` (`sumMoney`)
  and `src/modules/analysis/application/channels-overview.ts:1118-1119`
  (`MIXED_CURRENCY_REASON`). No cross-currency totals, no silent conversion.
- Zero prior period: no percentage change is manufactured from a zero earlier
  value, reusing the rule in `src/modules/analysis/application/channels-overview.ts:674-678`.

## 3. Scope and horizon

- Default horizon: the next 1 month, rolling from the scenario date (16 Sep
  sketches to 16 Oct). The viewer may extend the sketch to 3, 6, or 12 months;
  every horizon accumulates the same flat monthly level, so a percentage is
  never compounded into a rate it was never measured as.
- The horizon must be reconciled with source reporting grain and freshness before
  approval: a 30-day scenario is only honest when the underlying reports arrive
  at a grain and cadence that can support it (e.g. daily/weekly provider exports
  with a known lag). If sources only support period totals, the section shows
  period points or bars and never fabricates daily observations or a smooth
  future curve.
- Scope (channels, locations) is stated in the section, exactly as the
  performance card states coverage in `src/modules/analysis/application/channels-overview.ts:1016-1022`
  (footer) and `src/modules/analysis/application/channels-overview.ts:1037-1051`
  (sources modal). Partial channel coverage must never look like whole-business
  revenue. Comparisons across periods use channels present in both periods;
  the headline total may cover a larger set — preserve and explain that
  distinction, as the feasibility doc requires.

## 4. Source cutoff and freshness rules

- Fix a source cutoff before any arithmetic: which reports, through which date,
  feed the baseline and the estimators.
- Show the cutoff and freshness explicitly in the section. A last observation
  that precedes today is shown as a gap, not hidden.
- Staleness rules (thresholds to be set at implementation planning, after the
  data-feasibility pass): stale or sparse history downgrades the baseline to the
  hold-current-level fallback (§5) or to a refusal with a reason — never to a
  quietly confident number. Rows set aside as incomparable take no part in any
  sum, following the detector precedent in
  `src/domain/analysis/detectors/orders-cancellation-loss.ts:117-128`.

## 5. Current-course baseline method

- Candidate methods: a simple recent-level benchmark and a seasonal benchmark.
  Select between them by a documented rule tested against held-out history once
  actual history availability is inspected. Exact admission thresholds remain to
  be specified in the implementation plan.
- Never compound the latest percentage change forward indefinitely. A movement
  figure such as `src/domain/analysis/detectors/revenue-period-movement.ts:72-76`
  (latest period minus preceding period, signed, never extrapolated) describes
  what happened; it is not a growth rate to project.
- Fallback: with insufficient history, a labelled hold-current-level scenario
  may be shown. It must be honestly labelled as a scenario, never as a
  "learned forecast".
- The baseline, its method, and its admission threshold outcome are readable
  in-section, with method detail one drilldown away.

## 6. Intervention estimators per action type

- Every quantified action needs its own response basis: a controlled experiment,
  a comparable measured intervention, or an explicit supported scenario
  assumption. An LLM may explain evidence; it never invents response rates,
  amounts, confidence, or contribution shares.
- Worked example — cancellation recovery: projected eligible cancellation loss
  (an input and a cap, where the observed loss in
  `src/domain/analysis/detectors/orders-cancellation-loss.ts:130-163` is past
  loss, never a promise of full recovery) times a supported recovery fraction,
  adjusted for action start date and capacity. Past loss caps the estimate; the
  recovery fraction must come from evidence or a stated assumption, never from
  the loss figure itself.
- What is forbidden as an estimator origin:
  - `src/domain/decisions/value.ts:48-73` (`expectedContributionMinor`):
    confidence-weighted impact midpoint minus execution cost is a ranking
    quantity. It is not a revenue forecasting method and must not be summed
    into the revenue headline. Revenue and profit/cost quantities stay distinct.
  - `src/domain/decisions/campaign-draft-impact.ts:4-12`
    (`qualifyDraftImpact`): validates an existing authored range, assumptions
    and source revisions. It does not originate an intervention estimate.
  - `src/domain/campaigns/measurement.ts:272-327` (`computeVerdict`):
    evaluates evidence after execution against a registered plan. Its
    before/after results are not an organization-wide forecast.
  - The Campaign source still supplies `impactEvidence: null`
    (`src/modules/decisions/infrastructure/campaign-evidence-repository.ts:14-16`);
    test fixtures are not real estimates.
- All actions share one common horizon and one common baseline (§3, §5).

## 7. No double-counting

- Effects already operating and therefore embedded in history cannot be added
  again as new upside.
- Account for timing, dependencies, shared customers, channel substitution,
  capacity, budget constraints, and diminishing returns where applicable.
- Begin with independently estimable actions plus explicit joint groups. Do not
  simply add standalone recommendations.
- If an interaction cannot be estimated, show the actions as a joint group (one
  shared figure until a defensible allocation rule is approved) or disclose the
  interaction as outside the quantified scenario. Never silently count the same
  upside twice.
- Precedent, not method: `src/modules/growth-intelligence/application/synthesis-service.ts:286-346`
  (`checkCitedFindings`) refuses to total mixed measures or overlapping evidence
  windows without a declared limitation. The scenario calculator needs the same
  discipline, but as real arithmetic (joint groups, exclusions), not as a
  limitation label — a flagged overlap the calculator still adds is still
  double-counting.

## 8. Reconciliation

- Scenario revenue = baseline revenue + modeled combined extra revenue.
- Each displayed action share = that action's increment ÷ combined increment.
- Shares refer to extra revenue over the future baseline — never to total sales,
  historical growth, confidence, completion, or the organization's saved target.
- Zero or negative combined totals get a separate explanatory state, not a
  chart that implies growth.
- Negative action effects stay visible beside the benefits. Never normalize
  benefits to 100% while hiding penalties.

## 9. Unquantified and joint actions

- Useful actions without an amount stay visible as "not yet quantified".
  Missing estimates are never labelled zero.
- A partial quantified scenario is never labelled the "maximum possible"
  business growth.
- Joint groups may carry joint shares until a defensible allocation rule is
  approved. A future allocation method (e.g. Shapley values) cannot make
  unsupported underlying effect estimates valid.

## 10. Persistence and versioning (shipped 2026-09-16)

- Every nightly snapshot stores the verified union input plus the worker's
  note in `public.organization_revenue_snapshots`, keyed one row per
  organization per local day and trimmed past thirteen months. Horizons
  derive deterministically at read time, so stored rows stay comparable as
  the selector grows.
- The page reads the latest validating row and falls back to live reads when
  none validates. A row that no longer parses is treated as missing, never
  repaired; per-viewer permission narrowing happens at render, never in
  storage.

## 11. Uncertainty

- Show a scenario range where the assumptions support one. Label it a scenario
  range.
- Never call an uncalibrated range a "confidence interval".
- Assumption ranges behind the figures are explicit and readable in-section.

## 12. Evidence coverage and assumptions on the surface

- Evidence coverage and the main assumptions are readable inside the section;
  detail (sources, method, revisions) opens in a drilldown.
- Every forward-looking figure is labelled an estimate, with its cited inputs
  and stated assumptions on the same surface (ADRs 0039/0040).
- Never state a realized or attributed result ("this earned you X") without an
  explicit baseline, attribution method, and measurement window. A goal is a
  target: never label the organization's saved goal as projected revenue.
- The platform core stays industry-neutral: no restaurant-specific logic in the
  scenario contract. Restaurant behaviour belongs in the Restaurant Industry Pack.

## 13. Profit, kept separate

- Profit appears only where cost evidence supports it, as a figure distinct
  from the revenue headline — never summed into it.
- Where cost context is missing, say so plainly (cf. the performance card's
  "Costs are not yet included" footnote,
  `src/modules/analysis/application/channels-overview.ts:749`).

## 14. Co-decision recommendations (selected 2026-09-15, approved for building 2026-09-16)

- (a) Scenario membership: the recommended feasible action set spanning AI
  recommendations, campaign proposals, and growth insights, with each action's
  actual status shown. Actions without a cited monetary basis stay visible as
  "not yet quantified" (§9) — they are never zeroed and never block the
  quantified rows. Planned-only was rejected: it would hide feasible actions
  the operator has not yet marked.
- (b) Horizon: next month (≈30 days), reconciled with source grain and
  freshness per §3–§4 before any figure ships. Where sources support only
  period totals, the chart shows period points/bars at that grain — daily
  observations and smooth curves are never fabricated to fill the month.

## 16. Amendment (Proposed 2026-09-15): AI-assisted rough-estimate mode

Motivation: the user accepts a rough estimate over no estimate, and fixed
per-action estimators are not yet evidenced. The model paces the field;
deterministic code surveys it.

- What the model may do: propose response fractions ONLY as explicit low/high
  assumption ranges, each bound to a cited input from the §§2–5 evidence. Its
  output is strict schema-validated JSON (Zod at the boundary, low temperature,
  no tools, no side effects, no finance mutation). A range that cites no input
  is rejected like a malformed row.
- What the model may NOT do: emit final revenue figures; invent inputs; state
  calibrated confidence; present a range as a confidence interval; override
  the §8 reconciliation. The §6 forbidden-origin list (value.ts ranking
  quantities, campaign-draft-impact validation, measurement.ts verdicts,
  money-split potential/earned mapping, fixtures) is unchanged — the model
  does not get to launder any of them into estimator origins either.
- This section's §6 sentence "An LLM may explain evidence; it never invents
  response rates, amounts, confidence, or contribution shares" is replaced by:
  "An LLM may propose response fractions as explicit labelled assumption
  ranges bound to cited inputs; it never originates final figures, calibrated
  confidence, or contribution shares — those come from deterministic
  arithmetic over §§5–8."
- Roughness contract: wide bands never precise lines, rounded figures,
  "rough estimate" labelling with cited inputs and stated assumptions on the
  same surface (§12). Unquantified stays unquantified (§9); joint-group rules
  (§7) apply unchanged to AI-proposed fractions.
- Failure mode: model failure or schema-invalid output → the §5
  hold-current-level scenario plus an explicit "AI path unavailable" note.
  Never a fake number, never quiet confidence.
- Scoring mechanism (the solid part): a deterministic function over listed
  inputs — all-channel reported history (performance-card trend buckets),
  observed loss findings (detector amounts, past loss caps recovery), and the
  §14(a) action set. Same inputs always give the same chart; every unit of
  uplift traces to a listed parameter. The chart reads time-by-time at the
  supported grain: solid history → marked last-observation boundary → two
  labelled next-month paths (current course vs acting on the recommendations
  and proposals). Staleness renders as an explicit gap.
- Status: Approved for building 2026-09-16 (ADR 0060) together with the §14
  selections above. Implementation: `src/domain/organizations/revenue-scenario.ts`
  (`buildRevenueScenario` + `applyProposedRanges`), inputs in
  `src/modules/organizations/infrastructure/revenue-inputs.ts`, reads in
  `revenue-source.ts`, section in `home-revenue.tsx`, stateless proposal route
  under `src/app/api/organizations/[organizationId]/revenue/proposals/`.
- Nightly mode (approved 2026-09-16): the `revenue-snapshots` worker rebuilds
  the union input every local midnight, attaches validated ranges where the
  model offers any, and stores the row; the page reads instead of analyzing.
  The explicit-click route remains as the on-demand path with identical
  validation. A failed night leaves the last good row in place — never a hole.

## 15. Non-goals

The contract proposes no worker beyond the nightly snapshot builder, no SQL
beyond the snapshots table and its member-read policies, no new dependency, no fixture numbers, no
invented response rates/amounts/confidence/shares, no mapping of money-split
potential/earned to forecast, no summing of `value.ts` ranking quantities into
the headline, no calling campaign-draft-impact validation an estimator origin,
no labelling a goal as projected revenue. Scenario persistence and versioning
(§10) remain a later slice.
