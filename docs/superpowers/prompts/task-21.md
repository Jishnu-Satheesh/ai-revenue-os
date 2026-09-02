# Implement Task 21: settle evidence-qualified outcomes

**Objective.** Build the slow evidence loop: one deterministic, preregistered verdict per campaign — `validated_outcome`, `inconclusive`, `guardrail_breach`, or `execution_only` — computed only after the registered outcome window and settlement delay, with planned and realized exposure stored separately, and a proof an operator can interrogate. Nothing in the allocation loop may shorten, pre-empt, or contaminate it.

**Source of truth.** `docs/superpowers/plans/2026-08-17-campaign-feedback-loop-implementation.md` (Task 21, lines ~291–308), the "Stable Interfaces" block (`CampaignVerdict`), `adrs/0019-campaign-measurement-and-learning.md` (preregistered metric, baseline, attribution method, outcome window, settlement delay, evidence tier; correlation is never relabelled as impact), `adrs/0021-two-speed-campaign-optimization.md` (the wall: allocation events are inputs to measurement, never conclusions within it), and `specs/016-campaign-feedback-loop.md` (Evidence loop + Data model).

**Files to create (all listed in the plan):**

- `src/domain/campaigns/measurement.ts` + test
- `src/modules/campaigns/application/measurement-service.ts` + test
- `src/workflows/campaigns/settle-outcome.ts` + test
- `supabase/migrations/20260819130000_campaign_outcomes.sql` (regenerate the numeric prefix if the applied tail has advanced past `20260819120000` — run `pnpm db:migrations:list` first; never edit an applied migration)
- `supabase/tests/database/campaign_outcomes_test.sql`
- `src/app/api/organizations/[organizationId]/campaigns/[campaignId]/outcome/route.ts` + test
- `src/components/campaigns/outcome-proof.tsx` + test

**Test-first steps (mirror the plan's Step 1).**

RED tests must cover:

- **Immutable preregistration** — the measurement plan is locked before first exposure and cannot be changed by any path; `campaign_measurement_plans` is one plan per version (`unique (organization_id, bundle_version_id)`), and a verdict computed against a plan that was not on file at first exposure fails.
- **Realized exposure is reconstructed, never assumed** — realized exposure is summed from `campaign_exposures` (per action run, only rows the gateway confirmed/reconciled) and truncated by `campaign_allocation_events` pauses; it never equals planned exposure by default, and never falls back to the plan when receipts are missing.
- **Truncation attributed to its cause** — a pause truncates a variant's exposure and the cause (agent pause with its rule, operator pause, guardrail) is recorded on the outcome; a `partially_completed` campaign is not caused by an agent pause.
- **Settlement delay honored** — before `first_exposure + outcome_window_days + settlement_delay_days`, the loop refuses to settle; a restatement after settlement triggers a safe recompute, never a silent overwrite.
- **Guardrail breach** — a breach of a registered guardrail metric yields `guardrail_breach` regardless of the primary metric.
- **Attribution-method eligibility** — `validated_outcome` is unreachable unless the predeclared method's evidence threshold is met under the registered attribution method; engagement diagnostics (`delivery.impressions`/`clicks`) can never produce `validated_outcome` on their own.
- **No causal wording** — every `inconclusive` rendering is asserted (including a source-level check) to contain no causal or impact language.
- **The wall, both directions** — an evidence-loop code path that reads an allocation diagnostic as evidence for a verdict fails; and (cross-task) the allocation loop still cannot write to `campaign_exposures`, `campaign_metric_observations`, or `campaign_outcomes` (the Task 20 wall test keeps guarding this).

**Outcome table (Step 2).** Append-only `campaign_outcomes`: one settled verdict per campaign (`unique (organization_id, campaign_id)` on current rows, supersession for restatements), carrying method, window, planned exposure and realized exposure **as separate columns that are never reconciled into one number**, estimate and range in integer minor units with an ISO currency, evidence tier, guardrail state, truncation causes, limitations, and the preregistered plan's digest it was computed under. Forced RLS (member read), worker-only write RPC, tenant composite FKs.

**Verdicts (Step 3).** Deterministic, in code, exactly four values. `validated_outcome` requires the predeclared method's evidence threshold under the registered attribution method; engagement alone can never reach it. `inconclusive` is the honest default. `guardrail_breach` for guardrail violations. `execution_only` when nothing met the evidence bar but execution happened. No model chooses the verdict, method, stopping rule, or calculation.

**Workflow (Step 4).** `campaign.settle-outcome` — waits `outcome_window_days + settlement_delay_days` from first exposure, recomputes safely across append-only metric revisions and allocation truncations, writes the outcome, marks any already-rendered result a restatement changed, and emits `campaign.outcome_settled` (identifier-only payload). Built + tested with injected deps (mirror `collect-metrics.ts` / `allocation-cycle.ts`), not yet registered as a Trigger task.

**Proof (Step 5).** The outcome route + `outcome-proof.tsx` show hypothesis, planned versus realized exposure, baseline and window, estimate and range, spend, guardrails, evidence tier and method, missing data, limitations, and why the verdict carries its label. `inconclusive` renders without causal wording. A model may draft wording from the already-computed result and **must pass a no-overclaim validator** — build the validator in the measurement domain if none exists, and test it.

**Verify (Step 6).** Focused Vitest, pgTAP two-tenant isolation on `campaign_outcomes`, typecheck, lint. Apply the migration with `pnpm db:migrations:list` → `:dry-run` → `:push` → post-push list/pgTAP, and call every new plpgsql function once against staging (the standing rule — most will read tables they did not create). Chrome DevTools at 390px and 1440px — reuse `scripts/cdp-driver.mjs` + the `scripts/verify-frontend-*.mjs` tooling from Task 20 to render the outcome route, check console and horizontal overflow, and extract DOM text. Commit `feat(campaigns): settle evidence-qualified outcomes`.

**Hard boundaries (violating any of these is a blocker):**

- The evidence loop is the sole author of verdicts and the sole trigger for a learning proposal (Task 22). The allocation loop cannot shorten, pre-empt, or influence it (ADR 0021 wall, both directions).
- `validated_outcome` requires the preregistered method's evidence threshold under the preregistered attribution method — engagement alone never reaches it, and no method or stopping rule is invented at settlement time.
- Planned and realized exposure are stored separately and never reconciled into a single optimistic number; realized exposure is reconstructed from receipts + allocation history, never assumed from the plan.
- The settlement delay is honored exactly; a restatement after rendering marks the rendered result as changed rather than overwriting it.
- No model chooses a verdict, attribution method, stopping rule, or economic calculation. Drafted wording passes a no-overclaim validator, and `inconclusive` never reads as causal.
- Verdicts are per-campaign: baseline, window, and evidence come from the campaign's own preregistered plan and its own exposures — no cross-campaign or cross-tenant comparison anywhere.
- `src/modules/tool-gateway/**` and the allocation loop are not modified by this task.

**After Task 21 (next prompts, same plan):** Task 22 (campaign-scoped learning), Task 23 (governed entropy sources), Task 24 (cross-surface E2E + production gate). Each is its own commit; stop for review at Gates E and F — Task 21 supplies Gate F's "exposure reconstructed from allocation history" and "settled verdict with method and limitations" evidence.
