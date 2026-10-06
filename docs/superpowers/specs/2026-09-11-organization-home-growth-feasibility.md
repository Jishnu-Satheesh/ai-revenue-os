# Organization home: revenue outlook feasibility

## Status and confirmed direction

Investigation and design proposal, 2026-09-11. This is not an approved algorithm or an
execution plan. It revises the earlier campaign-first home handoff.

- The user requests one new first content section below organization identity: readable
  business metrics and a current/potential growth comparison on the left, with the actions
  behind potential growth and their contribution percentages on the right.
- Campaigns, creative library, attention, goals, destinations and activity continue below,
  preserving their previously planned behavior. Campaigns no longer lead the page.
- The user accepted revenue as the headline outcome, with profit separately where supported.
- The previous prototype, screenshots and ZIP do not contain this addition. Their existing
  browser verification covers only the earlier design. Do not execute that package unchanged.

## What the inspected code already supports

- `src/modules/analysis/application/channels-overview.ts`, `buildBusinessPerformanceCard`:
  reported sales, previous comparable-period growth, historical trend buckets, reporting
  scope and missing-data reasons. Comparisons use channels present in both periods;
  the headline total may cover a larger set. Preserve and explain that distinction.
- The same source refuses combined money totals across currencies and does not manufacture
  percentage growth from a zero prior value. Reuse these rules, not a copied calculation.
- `src/domain/analysis/money-split.ts`: `potential` means reported gross revenue; `earned`
  subtracts the provider's recorded rejection loss. This is historical accounting-style
  presentation, not the future potential requested here. Never map this field to a forecast.
- `src/domain/analysis/detectors/orders-cancellation-loss.ts`: a monetary finding can be
  observed cancellation loss. `revenue-period-movement.ts`: the same impact field can be
  a signed historical period change. Neither is automatically future recoverable revenue.
- `src/domain/decisions/value.ts`: confidence-weighted impact midpoint minus execution cost
  is a ranking quantity. It is not a revenue forecasting method and must not be summed into
  the new revenue headline. Revenue and profit/cost quantities must remain distinct.
- `src/domain/decisions/campaign-draft-impact.ts`: validates an existing authored range,
  assumptions and source revisions. It does not originate an intervention estimate.
- `src/modules/decisions/infrastructure/campaign-evidence-repository.ts`: the Campaign
  source still supplies `impactEvidence: null`; test fixtures are not real estimates.
- `src/modules/growth-intelligence/application/synthesis-service.ts`: checks declarations
  about overlapping evidence windows and mixed measures. This does not compute joint action
  effects, remove duplicate upside, or generate a future baseline.
- `src/domain/campaigns/measurement.ts`: evaluates evidence after execution against a
  registered plan. Its before/after results are not an organization-wide forecast.

Conclusion: reuse the historical measurement foundation. A separate, deterministic revenue
scenario capability is needed for the requested future paths and action contribution shares.
No ready organization-wide implementation of that capability was found in the inspected
domain/module sources. This conclusion concerns code capability, not live tenant readiness.
No database/customer records or authenticated application states were inspected in this pass.

## Recommended first-section design

- Full-width section below the organization masthead. Approximately two thirds for metrics
  and chart, one third for action explanations. On mobile, metrics/chart precede actions.
- Three concise figures: latest reported revenue and comparable-period change; revenue on
  the current course for a named future period; potential revenue with the included actions,
  showing additional revenue and uplift relative to that same future baseline.
- Historical revenue is solid. A clearly marked last-observation boundary separates it from
  two future paths: current course and with actions. Use a scenario range, labelled as such,
  when assumptions support a range. Do not call an uncalibrated range a confidence interval.
- When sources support only period totals, show period points or bars. Do not fabricate daily
  observations or a smooth future curve to make the chart attractive. Last observation can
  precede today; show that gap and freshness explicitly.
- Right-hand list: action name, estimated additional revenue/range, share of included estimated
  upside, and a link to its existing owning workspace. Show action status without implying
  Planned means executed. Group actions whose joint effect cannot be separated honestly.
- Percentages refer to the extra revenue over the future current-course baseline, not total
  sales, historical growth, confidence, completion, or the organization's saved target.
- Keep evidence coverage and the main assumptions readable within this section. Detail opens
  sources/method information. Partial channel coverage must not look like whole-business revenue.
- The section stays summary-sized. Campaigns and the rest of the home follow below it.

## Proposed calculation approach, pending design decisions

- Fix the outcome definition, currency, scope, future horizon and source cutoff before arithmetic.
  The exact provider sales/revenue metric must be reconciled before labelling it simply revenue.
- Establish a current-course baseline from comparable history. Evaluate simple recent-level
  and seasonal benchmarks against held-out history; select by a documented rule once actual
  history availability is inspected. Do not compound the latest percentage change indefinitely.
  With insufficient history, a labelled hold-current-level scenario may be useful; it must not
  claim to be a learned forecast. Exact admission thresholds remain to be specified.
- Build intervention-specific estimators from cited quantities and explicit response assumptions.
  Example: projected eligible cancellation loss times a supported recovery fraction, adjusted
  for start date and capacity. Past loss is an input/cap, not a promise of full recovery.
- Other actions need their own response basis: experiments, comparable measured interventions,
  or explicit supported scenario assumptions. An LLM may explain evidence; it cannot invent
  response rates, amounts, confidence, or contribution percentages.
- Apply the same horizon and baseline to every included intervention. Already operating effects
  embedded in history cannot be added again. Account for timing, dependencies, shared customers,
  channel substitution, capacity, budget constraints and diminishing returns where applicable.
- Begin with independently estimable actions and explicit joint groups. Do not simply add
  standalone recommendations. If an interaction cannot be estimated, show a joint group or
  disclose that it is outside the quantified scenario; do not silently count it twice.
- Scenario revenue equals future baseline revenue plus the modeled combined incremental
  revenue. Each displayed contribution must reconcile to that combined increment. Shares use
  that increment as denominator; zero/negative totals require a separate explanatory state.
  Negative effects remain visible. Do not normalize benefits to 100% while hiding penalties.
- Action groups may carry joint shares until a defensible allocation rule is approved. A future
  allocation such as Shapley values cannot make unsupported underlying effect estimates valid.
- Useful actions without an amount remain visible as not yet quantified. Do not mislabel missing
  estimates as zero or label a partial quantified scenario as the maximum possible business growth.
- Persist/version scenario inputs and method only under an approved architecture. Retain the
  scenario the user saw so subsequent revisions and eventual outcomes can be compared fairly.

## Alternatives considered

- Historical revenue plus a saved target: simplest, but a goal does not answer what actions can
  plausibly deliver and must not be labelled projected revenue.
- A transparent action scenario: recommended. Reuses measurements and adds specific estimators,
  a common baseline and rules for combined effects. Meets the requested product question.
- A broad statistical/causal forecasting platform: potentially valuable later, but more data and
  validation are needed. A general forecasting model alone does not establish action effects.

## Research supporting the distinction

- [Forecasting: Principles and Practice, scenario forecasting](https://www.otexts.com/fpp3/forecasting-regression.html):
  future assumptions define scenarios; conditional prediction intervals do not automatically
  include uncertainty about those assumptions. Adapt the distinction, not an unvalidated model.
- [Google Meridian, incremental outcomes and response curves](https://developers.google.com/meridian/docs/post-modeling/roi-mroi-response-curves):
  incremental outcomes compare alternatives under a model. Its media-specific framework is
  methodological context, not an existing repository capability or a proposed dependency.
- ADRs 0039 and 0040 permit forward estimates with cited inputs and stated assumptions while
  keeping model-originated financial values out. Recommendations need not wait for proven results.

## Remaining co-decisions and execution boundary

- Recommended scenario membership: show the recommended feasible action set, with each action's
  actual status. Alternative: only actions marked Planned. User has not yet selected this.
- Proposed horizon: next 30 days. Must be reconciled with source reporting grain and freshness;
  the final horizon, baseline method and sparse-history fallback are not yet approved.
- Source availability, response evidence and overlap handling need a focused data feasibility
  pass before promising numerical coverage for real organizations.
- This is potentially Tier 3 because it adds a new calculation capability and durable scenario
  contract. Write the appropriate spec/ADR and execution plan after the product co-decisions;
  retain the existing lower-home scope as a separate component of the revised handoff.
- Verification gates for the eventual plan: comparable scopes/currencies/windows; zero baseline;
  stale/sparse data; duplicate and interacting actions; negative effects; scenario reconciliation;
  backtesting and explicit assumption ranges; source lineage; tenant/role isolation; responsive
  readable graph and action states; no execution or financial mutation from scenario controls.
- No production implementation, migration, background job, or new dependency was created here.
