# ADR 0060 — Transparent action scenario for the home revenue section

Status: Accepted 2026-09-16. Approves the proposal in
`docs/superpowers/plans/2026-09-11-organization-home-revenue-adr-draft.md` and the
contract in `docs/superpowers/specs/2026-09-11-organization-home-revenue-scenario.md`
(§§2–9, §14 selections, §16 amendment rev 2, commit `c3c1e03`).

## Decision

The home revenue section answers "current course vs with the recommended actions"
with a deterministic calculation — a named hold-current-level baseline plus
per-action estimators plus stated combination rules — whose inputs, method, and
assumptions are readable on the same surface as the figures.

AI-assisted rough-estimate mode (§16): where fixed per-action estimators are not
yet evidenced, a model may propose response fractions ONLY as explicit low/high
assumption ranges bound to cited inputs, under strict output-schema validation;
deterministic arithmetic still produces every displayed figure, and model failure
degrades to the hold-current-level scenario with an explicit note. The model
originates no final figure, no calibrated confidence, and no share.

One-line record: the score is a deterministic function over listed inputs
(channel history, observed losses, the approved action set) for a next-month
conditional chart — same inputs, same chart.

## Why

- The product question is "what could these actions plausibly add?", which a
  saved target cannot answer: a goal must never be labelled projected revenue.
- The repository measures history well (performance card, detectors, money-split
  accounting) but had no organization-wide future-scenario capability — the
  feasibility investigation found none. The gap is specific, so the fix is specific.
- Deterministic arithmetic over cited inputs keeps every figure explainable,
  attributable, and auditable, which the product rules require of every AI action.

## Alternatives rejected

- Goal-as-forecast: a goal does not answer what actions can plausibly deliver.
- General forecasting platform alone: needs more data and validation, and alone
  does not establish action effects. Revisit only after the scenario ships with
  backtesting.

## Consequences

- New deterministic capability: `src/domain/organizations/revenue-scenario.ts`
  (pure calculator), input mapping in
  `src/modules/organizations/infrastructure/revenue-inputs.ts`, shared reads in
  `revenue-source.ts`, section composition in `home-service.ts`/`home-loader.ts`,
  presentation in `src/components/organizations/home/home-revenue.tsx`, and the
  stateless proposal route at
  `src/app/api/organizations/[organizationId]/revenue/proposals/` with its
  provider in `revenue-proposal-provider.ts`.
- Needs backtesting of baseline and estimators against held-out history (still
  open), full source lineage on every figure (shipped), and tenant/role
  isolation on every read (shipped: session client throughout, no service role).
- Estimates are labelled estimates with cited inputs and assumptions on the
  same surface; realized/attributed claims additionally need baseline +
  attribution + window (ADRs 0039/0040).
- Scenario persistence/versioning (§10 of the spec) is deferred: no table, no
  migration, no worker in this slice. Proposed ranges are applied in memory and
  never stored.

## Addendum 2026-09-16 — nightly snapshots and selectable horizons

Approved together with the extension plan: the `revenue-snapshots` worker
rebuilds the union input every local midnight (hourly dispatcher fans out only
orgs inside their midnight hour; per-org builds are idempotent per org-day and
leave the last good row on failure) into `public.organization_revenue_snapshots`
(migration `20260916130000`, member-read-only RLS, no client writes, trimmed
past thirteen months). The home section reads the latest validating row with
per-viewer permission narrowing at render, falling back to live reads. Horizons
1/3/6/12 months derive deterministically from the stored monthly figures by
flat accumulation (`projectRevenueHorizon`) — no compounding, no seasonal
curve until backtesting exists. Chart: gray current-course line with a
pulsating tip (static under reduced motion) against the green with-actions
band, horizon end dates named on figures and axes.
