# ADR 0077: Environment-aware research spend policy

## Status

Accepted by the user on 2026-10-06 as a Tier 3 product decision. Implements
the approved `Proper staging and development policies` plan: staging and
development workers run research without spend walls, production keeps every
current cap.

## Problem

The USD 5 organization-day research allowance is a single global rule. On the
shared staging project, routine overnight monitoring sweeps consume the full
allowance within hours of reset, so every daytime test and canary that needs
a real research reservation fails closed. Development speed is gated by a
production-shaped spend wall on non-production environments.

## Decision

- The three day-allowance reservation RPCs (`reserve_research_pipeline_budget`,
  `reserve_research_request_budget`, `reserve_monitoring_update_budget`) gain
  an optional `p_skip_allowance` flag defaulting to false. When true, only
  the day-allowance comparison is skipped; request, quote, provider
  qualification, conflict, replay, and ledger-row behavior are unchanged, and
  the reservation row is still written with its allowance day.
- Only `service_role` may pass true. Authenticated callers passing true are
  refused with `research_budget_forbidden`. Per-attempt ceilings and all
  other budget errors are untouched.
- Workers pass the flag only when their own runtime policy variable
  `RESEARCH_BUDGET_POLICY` explicitly resolves to `uncapped`. The resolver is
  default-closed: missing, blank, or unrecognized values resolve to `capped`,
  so production behavior cannot change by accident. The bypass is logged with
  organization and request identifiers for audit.
- The variable lives in the worker runtime environment only (Trigger
  dashboard for deployed workers, process env for local runs). It is
  documented in `.env.example` and validated in `src/lib/env.ts` with a
  `capped` default. It is never read from client input, thread state, or
  dispatch payloads.

## Consequences

- Staging and development research spend is uncapped wherever the variable is
  set. Those environments bill real provider money, so staging billing must
  be watched; the reservation ledger keeps attributing every unit of it.
- Production keeps the USD 5 rule with zero code-path divergence: the same
  RPCs, the same checks, the same refusal. A worker without the variable set
  is a capped worker by construction.
- Future spend walls in non-production get the same treatment (explicit
  policy value, default-closed, logged) rather than ad-hoc fence edits.

## Rollback

Set the variable back to `capped` (or remove it) and redeploy; no migration
is needed to restore capped behavior. The RPC flag defaults keep every
existing caller capped even if worker code lags behind.

## Verification

- pgTAP `growth_intelligence_research_budget_bypass_test.sql` (18 assertions):
  exhausted allowance still refuses default calls; service_role bypass
  reserves, replays, stays attributed, and keeps quote/conflict validation;
  authenticated bypass is forbidden; the cap is unchanged afterwards. The two
  neighboring budget suites (60 + 25) pass with updated signatures.
- Unit tests cover default-closed policy resolution (7 tests).
- Live staging proof is recorded in the release verification notes; the
  bypass audit log line in the worker trace is the flag-flow evidence.
