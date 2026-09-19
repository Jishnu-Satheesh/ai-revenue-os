# ADR 0064 — Fixed original projection versus reported progress

Status: Implemented 2026-09-19 (Tasks 0–8) behind `OVERVIEW_GROWTH_PROGRESS_ORGANIZATION_IDS`; user-approved product decision unchanged (fixed original; blue actuals vs green projections). Migration unapplied, worker undeployed, staged runs and live acceptance still gated — see `docs/verification/overview-growth/final-report.md`.

## Context

ADR0060's home section compares a hold-current-level future scenario with an action scenario. Daily candidate inputs are mutable and viewer-narrowed. The newly approved design compares observed progress against an earlier fixed outlook. Merely recolouring the existing current-course series would misrepresent a forecast as measured performance.

## Decision

- Introduce one immutable, explicitly scoped projection per organization/fixed period/horizon. Save numeric low/central/high points, method version, issue time, source cutoff, source identities and source-permission requirements.
- Publish prospectively through a service-only deterministic database boundary; duplicates return the original record. Later candidates never update it.
- Read actuals from the reconciled metric ledger, independently of completed analyses or forecast refreshes.
- Match accumulation start, date, metric, currency, branch/channel coverage and timezone before calculating a difference.
- Keep a labelled even-pace scenario as the initial intra-period projection method; it is an assumption, not learned daily forecasting. Actual data is never disaggregated this way.
- Classify against the frozen range; show midpoint differences separately.
- Use existing recommendation/finding readers for the advice rail, without storing a second lifecycle or inventing causal explanations.
- Hide inaccessible projections rather than recalculating their monetary values for different viewers.

## Alternatives rejected

- Latest snapshot as original: it is UPSERTed and can move.
- Reconstructing an earlier forecast from today's evidence: hindsight, not an original forecast.
- Current-course forecast labelled Current: not observed revenue.
- One fixed point estimate without stored range: loses the approved rough-estimate uncertainty.
- Updating the projection when actuals overtake it: erases the comparison the user explicitly requested.
- Reusing a channel-aggregated series without row/branch/dimension provenance: cannot prove equal coverage or no overlap.

## Consequences

- Spec027 and its data contract introduce immutable storage, prospective start rules, coverage-aware readers and explicit honest unavailable states.
- The old scenario engine remains a candidate estimator; it does not become the actual-progress reader.
- No guarantee of a populated live chart at launch: the inspected canary has only historical data and no original forecast snapshots.
- Technical implementation choices require review with the execution plan. User approval of the visual direction does not claim database schema, migration application or deployment approval.
- Supersedes only the enabled Overview display semantics of ADR0060. Existing worker snapshots, candidate estimation rules and unmodified callers remain governed by that ADR.
