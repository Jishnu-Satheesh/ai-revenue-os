# ADR draft — transparent action scenario for the organization-home revenue section (NOT in adrs/ — number assigned on approval)

Status: draft. This file is a proposal. It becomes a numbered ADR in `adrs/`
only after the user approves it together with its companion spec
(`docs/superpowers/specs/2026-09-11-organization-home-revenue-scenario.md`).

## Decision (proposed)

Build the home revenue section on a transparent action scenario: a deterministic
calculation (named baseline + per-action estimators + stated combination rules)
whose inputs, method, and assumptions are readable on the same surface as the
figures — rather than on a saved target or on a broad statistical/causal
forecasting platform.

Amendment (proposed 2026-09-15, AI-assisted rough-estimate mode): where fixed
per-action estimators are not yet evidenced, a model may propose response
fractions as explicit low/high assumption ranges bound to cited inputs, under
strict output-schema validation; deterministic arithmetic still produces every
displayed figure, and model failure degrades to the hold-current-level
scenario with an explicit note. The model originates no final figure, no
calibrated confidence, and no share. The score is a deterministic function
over listed inputs (channel history, observed losses, the approved action
set) for a next-month conditional chart — same inputs, same chart.
Companion spec §16 carries the full contract.

Why:

- The requested product question is "what could these actions plausibly add?",
  which a saved target cannot answer: a goal must never be labelled projected
  revenue.
- The repository already measures history well (performance card, detectors,
  money-split accounting) but has no organization-wide future-scenario
  capability — the feasibility investigation found none in the inspected
  domain/module sources. The gap is specific, so the fix is specific.
- Deterministic arithmetic over cited inputs keeps every figure explainable,
  attributable, and auditable, which the product rules require of every AI action.

## Alternatives rejected

- Goal-as-forecast (historical revenue plus a saved target): simplest, but a
  goal does not answer what actions can plausibly deliver and must not be
  labelled projected revenue.
- General forecasting platform alone: potentially valuable later, but needs
  more data and validation — and a general forecasting model alone does not
  establish action effects. Revisit only after the scenario capability ships
  with backtesting.

## Consequences (if approved)

- New deterministic calculation capability plus a durable scenario contract
  (persisted/versioned inputs + method) — hence Tier 3.
- Needs backtesting of baseline and estimators against held-out history, full
  source lineage on every figure, and tenant/role isolation on every read.
- Estimates are labelled estimates with cited inputs and assumptions on the
  same surface; realized/attributed claims additionally need baseline +
  attribution + window (ADRs 0039/0040).

## Verification gates for the eventual implementation plan

- Comparable scopes, currencies, and windows across baseline and actions.
- Zero-baseline behaviour (no manufactured percentages from zero).
- Stale/sparse data handling (fallback or refusal, never quiet confidence).
- Duplicate and interacting actions (joint groups or disclosed exclusions).
- Negative effects (visible, never normalized away).
- Scenario reconciliation (baseline + combined increment; shares reconcile).
- Backtesting plus explicit assumption ranges.
- Source lineage on every figure.
- Tenant and role isolation on every read.
- Responsive, readable graph plus honest action states
  ("not yet quantified", actual status shown).
- No execution or financial mutation reachable from scenario controls.

## Non-goals of this draft

No production types, no `src/` code, no SQL, no migration, no worker, no
dependency, no fixture numbers, no invented rates or shares. Numbers ship only
through the approved implementation plan that follows this ADR. Model-proposed
assumption ranges ship only under the §16 contract above, never as bare figures.
