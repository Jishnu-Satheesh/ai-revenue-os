# Campaign Feedback Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the campaign loop. An approved envelope produces many creative variants, publishes to a real client-owned Meta account, returns results into the metric warehouse at variant grain, contains waste within two days without human intervention, and settles into a verdict that is either proven under a preregistered method or honestly reported as unproven.

**Supersedes:** Tasks 14–20 of `docs/superpowers/plans/2026-08-11-unified-campaign-bundle-release-train-implementation.md`. Tasks 1–13 of that plan are complete and are prerequisites here. Telegram operator review (its Task 14) is removed from this train and deferred; ADR 0018 remains valid and unimplemented.

**Architecture:** Unchanged in its load-bearing parts. Postgres stays authoritative; Trigger.dev stays execution-only; the deterministic Tool Gateway stays the only route to a public or money-moving provider call. Three things are added. Approval binds a bounded creative family rather than a single creative point (ADR 0020). A deterministic pause-only allocation loop runs on a fast cadence, walled off from the evidence loop that owns verdicts (ADR 0021). Provider results return into `normalized_metrics` at campaign, action, and variant grain, which is the feedback arrow the platform has never had.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, pnpm 11 on Node 22, Supabase/Postgres with forced RLS and private Storage, Zod 4, Trigger.dev 4.5.10, Vercel AI SDK 5, TanStack Query/Form, shadcn/ui, Vitest, Testing Library, MSW, pgTAP, Playwright.

## Global Constraints

Every constraint in the superseded plan still applies. These are the additions and the changes.

- **The Tool Gateway is not modified.** One variant becomes one `campaign_action_run`, so claim, reservation, idempotency, receipt, and unknown-outcome handling are reused exactly as built. A task that finds itself needing to change `src/modules/tool-gateway/**` has misunderstood the design and must stop and discuss.
- **Approval semantics do not weaken.** The generation policy lives inside the manifest and therefore inside the digest. Approval still binds one exact version and one exact digest. Any policy change is material.
- **A variant may vary only imagery, hook, caption, hashtags, and call to action.** Everything else is locked by the approved policy and enforced by a derivation check plus database constraint, never by prompt instruction.
- **The agent may pause. The agent may not resume.** Resume requires an approving role and is recorded with actor and time. No task may add an autonomous resume, budget increase, ceiling change, or creative creation outside an approved policy.
- **The wall between loops is a hard boundary.** The allocation loop may not write to `campaign_exposures`, `campaign_metric_observations`, or `campaign_outcomes`. The evidence loop may not be shortened or pre-empted by anything the allocation loop observed. Cross-task test coverage must prove both directions.
- **No cross-campaign inference anywhere in this train.** The allocation loop runs on a per-organization cadence and decides per campaign. Comparing campaigns is learning, and learning stays campaign-scoped until separately promoted.
- **A model never chooses a pause, a verdict, an attribution method, a stopping rule, or an economic calculation.** It may generate variant creative inside a policy, and it may draft wording from an already-computed result behind a no-overclaim validator.
- **The Meta account is client-owned and organization-bound.** Revocation can occur at any time, including mid-campaign after approval. A dispatch that loses its capability produces `blocked`, never `failed` — blocked is recoverable when the client reconnects, and failed would misreport what happened.
- **`schemaVersion: 1` gets no reader.** Pre-production V1 data is deleted and regenerated through the V2 path. This is only legal while `campaign_action_runs` and `provider_receipts` are empty; Task 14 re-verifies that precondition before deleting anything.
- Migration prefixes begin at `20260817000000`; the applied tail is `20260816130000_campaign_version_channel_readiness.sql`. Regenerate prefixes if the tail advances. Never edit an applied migration.
- Use `PATH=/home/spy/.local/node/bin:$PATH` for pnpm commands. Stage only the files listed by the current task.
- There is no local database. `pnpm db:migrations:*` and `pnpm db:test` target hosted staging and are live for everyone immediately. Read the existing schema before writing DDL; there is no rehearsal.
- Any new `plpgsql` function that reads a table it did not create must be called once against staging before the task is considered done.
- `pnpm db:types` cannot run. Every new table is typed by hand in `src/lib/supabase/database.types.ts` or listed in `UNTYPED_TABLES` in its test.
- Every frontend task is verified in a real Chrome session through Chrome DevTools at desktop and mobile widths, covering rendered route, interactions, console, failed requests, focus behavior, and visible error states.
- `git push` is the user's step. Commit locally; never attempt to push.

## Activation Gates

| Gate               | Required evidence                                                                                                                      | Production state                                |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| A — Bounded family | V2 manifest, policy inside digest, caps enforced in database, derivation validator, envelope visible in Studio, V1 repaired forward    | Variant fleets generate; nothing executes       |
| B — Substrate      | Client-owned Meta binding, account mapping, bounded client, signed webhook intake, reconciliation-before-retry                         | Credentials bindable; no capability enabled     |
| C — Organic        | Verified contract, dispatch worker and sweeper, controlled-account post and story, receipt-to-exposure handoff                         | Meta organic enabled per organization           |
| D — Paid           | Provider object graph with per-step persistence, double spend enforcement, capped controlled-account experiment, pause tool proven     | Meta Ads enabled per organization               |
| E — Feedback       | Variant-grain metrics in `normalized_metrics`, allocation loop pausing on deterministic rules, operator-only resume, allocation ledger | Autonomous containment enabled per organization |
| F — Proof          | Exposure reconstructed from allocation history, settled verdict with method and limitations, learning proposal, full E2E and runbook   | First production organization may be enabled    |

---

## External Dependencies

### Meta App Review is the critical path

This is the only item in this plan that engineering cannot unblock, and it is the most likely cause of a stalled release train.

- **What is needed.** Meta Business verification and App Review for `ads_management`, plus the publishing scopes named in the checked-in contract. Anything beyond a controlled test account requires it.
- **Who owns it.** The client owns the Meta account and binds it to their organization, so the client — not the agency operator and not engineering — must complete Business verification. That handoff is a real coordination cost and should be started as a conversation, not a ticket.
- **When it bites.** Tasks 14 through 17 have no dependency on it. Task 18 (Meta Ads) cannot reach Gate D without it, regardless of how complete the code is.
- **Therefore.** Start the review submission in parallel with Task 14, on the day this plan begins. Do not sequence it after the code is ready; review turnaround is measured in weeks and is outside anyone here's control.
- **If it stalls.** Gates C and D are deliberately independent. Ship organic to production and hold paid at Gate D rather than blocking the whole train. The allocation loop in Task 20 still functions on organic diagnostics, with the honest limitation that organic signal on a cold account is thin.
- **Contract expiry interacts with this.** ADR 0016 makes provider contracts expire fail-closed. A long review delay can outlive the checked-in contract's verification date, which would require reverification against official sources before Task 18 proceeds. Track the expiry date alongside the review submission.

### There is no Meta account, and the integration is built anyway

Recorded 2026-08-18. This is a standing condition, not a temporary blocker to wait out.

- **What exists.** Nothing. No Meta account, app, Page, Instagram account, or ad account is available to this project, and none may be for some time. No line of the Meta integration can be confirmed by running it.
- **What is built regardless.** All of it. Provider contracts, the bounded client, webhook intake, reconciliation, and both adapters are written blind, complete, and assuming an account connects at some future point. Waiting would idle the whole execution train for work that is fully writable now.
- **How blind work stays honest.** Documentation is the only evidence available, so it is read properly for every endpoint rather than guessed at. An unread detail is an unknown, never a default. Nothing invents a scope, field, permission, placement, webhook event, retry class, or error code the documentation does not state — the contract's empty `retryableStatuses` is the model for that: unproven means empty, not assumed.
- **Building is not granting.** Everything stays fail-closed under ADR 0016. No capability becomes available and no adapter is registered as connectable until controlled-account evidence exists. Code that cannot run is not a capability.
- **Transport.** Direct Graph calls at the contract's pinned version, not the Business SDK. See ADR 0022 for the evidence, including the SDK's hard-coded `v24.0` against the contract's verified `v26.0`.

---

## File Structure

| Area                 | Planned files                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Durable decisions    | `adrs/0020-bounded-creative-family-approval.md`, `adrs/0021-two-speed-campaign-optimization.md`, `specs/016-campaign-feedback-loop.md` (all written and approved)  |
| Campaign domain      | `src/domain/campaigns/{schemas,normalization,digest,diff,variants,derivation,allocation,measurement}.ts` and tests                                                 |
| Campaign application | `src/modules/campaigns/application/{variant-service,allocation-service,measurement-service,learning-service}.ts` and tests                                         |
| Campaign infra       | `src/modules/campaigns/infrastructure/{variant-repository,allocation-repository,measurement-repository,metric-ingest}.ts` and tests                                |
| Workflows            | `src/workflows/campaigns/{generate-variants,dispatch-due-actions,collect-metrics,allocation-cycle,settle-outcome,propose-learning}.ts`, `src/trigger/campaigns.ts` |
| Provider adapters    | `src/modules/integrations/providers/meta/{client,organic-adapter,ads-adapter,pause-adapter,insights-reader,webhooks}.ts`, MSW fixtures                             |
| APIs                 | `src/app/api/organizations/[organizationId]/campaigns/[campaignId]/{variants,allocation,outcome,learning}/**`, `src/app/api/integrations/meta/{oauth,webhooks}/**` |
| UI                   | `src/components/campaigns/{approval-envelope,variant-grid,allocation-ledger,outcome-proof,learning-review}.tsx`                                                    |
| Migrations           | `supabase/migrations/20260817*.sql` and matching suites in `supabase/tests/database/`                                                                              |
| Verification         | `e2e/campaign-feedback-loop.spec.ts`, sandbox evidence under `docs/verification/campaigns/`                                                                        |

## Stable Interfaces

Change these only with an approved spec or ADR update in the same commit.

```ts
export type CampaignGenerationPolicy = {
  maxVariantsPerDirection: number;
  maxVariantsTotal: number;
  policyExpiresAt: string;
  lockedOfferRef: string | null;
  lockedAssertionKeys: readonly string[];
};

export type CampaignBundleManifest = {
  schemaVersion: 2;
  campaignId: string;
  version: number;
  source: { kind: "manual_brief" | "decision_opportunity"; sourceId: string };
  objective: string;
  rationale: string;
  generationProfile: CampaignGenerationProfile;
  generationPolicy: CampaignGenerationPolicy;
  directions: readonly CampaignCreativeDirection[];
  actions: readonly CampaignChannelAction[];
  assets: readonly CampaignAsset[];
  measurementPlan: CampaignMeasurementPlan;
  executionMode: "best_effort" | "all_channels_required";
  totalSpendCeiling: { amountMinor: number; currency: string } | null;
};

export type CampaignCreativeVariant = {
  id: string;
  bundleVersionId: string;
  directionId: string;
  assetId: string;
  hook: string;
  caption: string;
  hashtags: readonly string[];
  callToAction: string;
  contentHash: string;
  state:
    | "draft"
    | "scheduled"
    | "published"
    | "paused_by_agent"
    | "paused_by_operator"
    | "failed"
    | "provider_outcome_unknown";
};

export type AllocationDecision = {
  variantId: string;
  ruleKey: string;
  ruleVersion: string;
  observedValue: number | null;
  threshold: number | null;
  resolvedMarginGrade: "measured" | "derived" | "estimated" | "assumed" | null;
  action: "pause" | "no_action";
  reasonCode: string;
};

export type CampaignVerdict =
  | "validated_outcome"
  | "inconclusive"
  | "guardrail_breach"
  | "execution_only";
```

New tool keys: `meta.organic.publish_image`, `meta.organic.publish_story`, `meta.ads.run_bounded_experiment`, `meta.ads.pause_ad`.

New events, past tense, identifier-only payloads: `campaign.variant_generated`, `campaign.variant_published`, `campaign.variant_paused`, `campaign.variant_resumed`, `campaign.allocation_cycle_completed`, `campaign.exposure_recorded`, `campaign.outcome_settled`, `campaign.learning_proposed`.

---

### Task 14: Move the manifest to V2 and approve a bounded creative family

**Files:**

- Modify: `src/domain/campaigns/{schemas,normalization,digest,diff}.ts` and tests
- Modify: `src/modules/campaigns/application/{evaluation,api-schemas}.ts` and tests
- Create: `supabase/migrations/20260817090000_campaign_generation_policy.sql`
- Create: `supabase/tests/database/campaign_generation_policy_test.sql`
- Create: `src/components/campaigns/approval-envelope.tsx` and test
- Modify: `src/lib/supabase/database.types.ts`
- Modify: `scripts/` V1 repair script

- [x] **Step 1: Write RED domain tests.** A V2 manifest requires `generationPolicy`; caps must be positive and `maxVariantsTotal` at least the per-direction cap times the direction count; `policyExpiresAt` must be a future UTC instant; a policy change must alter the digest; two semantically equal policies must produce the same digest; `diffManifests` must categorize every policy path as material.
- [x] **Step 2: Implement the V2 schema.** Add `campaignGenerationPolicySchema` and bump `schemaVersion` to the literal `2`. Do not add a V1 branch, a union, or a compatibility reader; ADR 0020 removes V1 deliberately.
- [x] **Step 3: Extend evaluation.** Reject a manifest whose policy expiry exceeds the approval expiry it will be bound under, and whose locked assertion keys are absent from the pinned source snapshot. Reuse the existing failure-code vocabulary; add codes only where an existing one would misdescribe the fault.
- [x] **Step 4: Write the migration RED state and apply forward.** Run `pnpm db:migrations:list` and `pnpm db:migrations:dry-run`, then run the new pgTAP suite before applying to prove the constraints are absent. Add generated columns for the caps and expiry, check constraints matching the Zod rules, and an index supporting the cap-enforcement lookup.
- [x] **Step 5: Verify the repair precondition, then repair V1 forward.** Done. The precondition guard and V1 deletion shipped in the migration; regeneration through the live V2 path produced bundle version `d5946300` on 2026-08-17 — `schemaVersion: 2`, caps 4/12 projected onto the row, and `policyExpiresAt` equal to the last scheduled action, which is the derivation working end to end. Re-assert that `campaign_action_runs` and `provider_receipts` are empty; abort loudly if either is not, because deletion is only legal with no execution history. Then delete the V1 bundle-version chain and its approval, and regenerate through the live V2 generation path rather than backfilling — a backfill would verify nothing about the new path.
- [x] **Step 6: Show the envelope in Studio.** The approval panel states in plain language what the operator is authorizing: how many variants per direction, until when, within which offer, claims, audience, placement, and ceiling. An operator who cannot read the bound from the screen has not meaningfully approved it.
- [x] **Step 7: Verify and commit.** All gates green: focused Vitest, 720 pgTAP assertions, typecheck, lint, format. Browser-verified at 390px and 1440px — the Approval envelope shows "Up to 4 per direction (12 total)", "Until 23 Aug 2026", and the promise copy, with no console errors and no horizontal overflow. Run `pnpm vitest run src/domain/campaigns src/modules/campaigns src/components/campaigns`, `pnpm db:test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, Chrome DevTools at both widths, and `git diff --check`. Commit `feat(campaigns): approve a bounded creative family`.

### Task 15: Generate and validate creative variants under an approved policy

**Files:**

- Create: `src/domain/campaigns/{variants,derivation}.ts` and tests
- Create: `src/modules/campaigns/application/variant-service.ts` and test
- Create: `src/modules/campaigns/infrastructure/variant-repository.ts` and test
- Create: `src/workflows/campaigns/generate-variants.ts` and test
- Create: `supabase/migrations/20260817100000_campaign_creative_variants.sql`
- Create: `supabase/tests/database/campaign_creative_variants_test.sql`
- Create: `src/app/api/organizations/[organizationId]/campaigns/[campaignId]/variants/route.ts` and test
- Create: `src/components/campaigns/variant-grid.tsx` and test

- [x] **Step 1: Write RED derivation tests.** A variant altering offer, assertions, audience, channel, placement, schedule, spend, or generation profile fails with a stable code. A variant varying only imagery, hook, caption, hashtags, and CTA passes. A variant asserting a claim absent from the pinned source snapshot fails. A variant referencing an asset produced for another campaign fails.
- [x] **Step 2: Add the variants table.** Immutable rows with composite tenant foreign keys, forced RLS, content hash, provenance, policy version, direction lineage, state, and an append-only trigger. Enforce both caps as database constraints so a worker cannot exceed them by any path.
- [x] **Step 3: Implement the variant service.** It refuses generation when no live approval covers the current version and digest, when the policy has expired, or when a cap is reached — each with a distinct stable reason, never a silent truncation.
- [x] **Step 4: Implement `campaign.generate-variants`.** Durable, cancellable, bounded in attempts and cost. Task input carries identifiers and a persisted run key only, never the prompt, provider secret, or business context. Every generated variant passes `evaluateGeneratedBundle` plus the derivation check before persistence; a failed variant is recorded as failed, never dropped.
- [x] **Step 5: Build the variant grid.** Show every variant with its creative, state, direction, and lineage. States that will later carry provider truth render as explicit placeholders rather than optimistic success.
- [x] **Step 6: Verify and commit.** Focused Vitest, pgTAP, adversarial fixtures for prompt injection and cross-tenant asset reference, Chrome DevTools at both widths, typecheck, lint. Commit `feat(campaigns): generate variants inside an approved policy`.

### Task 16: Complete the shared Meta provider substrate

**Files:**

- Modify: `src/modules/integrations/providers/meta/{contract,definition}.ts` and tests
- Create: `src/modules/integrations/providers/meta/{client,webhooks}.ts` and tests
- Create: `src/app/api/integrations/meta/oauth/{start,callback}/route.ts` and tests
- Create: `src/app/api/integrations/meta/webhooks/route.ts` and test
- Create: `supabase/migrations/20260817110000_meta_webhook_receipts.sql`
- Create: `supabase/tests/database/meta_webhook_receipts_test.sql`

- [~] **Step 1: Reverify the checked-in Meta contract against current official sources.** Partly done. The version schedule was verified against Meta's own versions page and the contract re-pinned to `v24.0` — the version the SDK actually calls — with that page added to its official sources. What cannot be done here is the rest: ADR 0016 requires controlled-account evidence to move any action from blocked to verified, and there is no Meta account. The contract's own review window (to 2026-09-10) still needs renewing on time regardless.
- [ ] **Step 2: Implement the client-owned account binding.** **Blocked, and the only step here that cannot be built blind.** The generic OAuth substrate already exists from the credential work; what remains is registering Meta as a connectable OAuth application, and doing that without controlled-account evidence would make a provider connectable that ADR 0016 requires to stay fail-closed. It waits for the account.
- [x] **Step 3: Implement the bounded HTTP client.** Credentials resolve inside the adapter boundary, never above it. Timeouts, bounded response schemas, normalized safe errors, and a retry classification taken from the contract rather than invented. No raw provider response crosses the adapter boundary.
- [x] **Step 4: Implement webhook intake.** Verify the signature before parsing any business field. Enforce replay TTL and digest uniqueness, allowlist event types, and map a provider account to exactly one organization and connection. An unknown account or event is quarantined without disclosing whether the tenant exists.
- [x] **Step 5: Implement reconciliation-before-retry.** A timeout after send marks the invocation unknown. The verified lookup either completes it, proves absence and releases retry, or keeps it unknown for operator action. No path retries an ambiguous outcome.
- [ ] **Step 6: Verify and commit.** MSW contract tests for rate limit, permanent error, timeout before and after send, and reconciliation lookup; replayed webhook and unknown account tests; pgTAP; typecheck; lint. Commit `feat(integrations): complete the Meta provider substrate`.

### Task 17: Publish organic through the Tool Gateway with a real dispatch worker

**Files:**

- Create: `src/modules/integrations/providers/meta/organic-adapter.ts` and test
- Create: `src/workflows/campaigns/dispatch-due-actions.ts` and test
- Modify: `src/trigger/campaigns.ts`
- Create: `supabase/migrations/20260817120000_campaign_exposures.sql`
- Create: `supabase/tests/database/campaign_exposures_test.sql`
- Create: `docs/verification/campaigns/meta-organic-sandbox.md`

- [x] **Step 1: Write RED dispatch tests.** Schedule resolved in the organization timezone and persisted in UTC; early and late dispatch windows; approval expired between scheduling and dispatch; capability revoked after approval producing `blocked` not `failed`; optional blocked action under both execution modes; cancellation fence; duplicate trigger; unknown provider outcome; partial success.
- [x] **Step 2: Implement the organic adapter.** Instagram and Facebook feed image plus image story, against the verified contract only. Register it as a Tool Gateway adapter under `meta.organic.publish_image` and `meta.organic.publish_story`. This is the first production caller of `createToolGateway`, which until now has been constructed only in tests.
- [x] **Step 3: Implement dispatch and a sweeper.** Schedules persist in Postgres before any Trigger dispatch, and a sweeper finds due unqueued action runs so a lost Trigger run cannot strand an approved action. Each worker calls the Tool Gateway and then only the registered tool it returns.
- [x] **Step 4: Add the exposure handoff.** A confirmed publication creates the initial `campaign_exposures` row with provider timestamps and later metric-fetch eligibility. Status is read from gateway and receipt truth; task completion never implies success.
- [ ] **Step 5: Capture controlled-account evidence.** **Blocked on the Meta account.** Publish and reconcile one post and one story on the controlled account. Record redacted timestamps, safe external IDs, screenshots, scopes, and cleanup in `docs/verification/campaigns/meta-organic-sandbox.md`. Gate C cannot pass without it.
- [x] **Step 6: Verify and commit.** Focused workflow and adapter tests, typecheck, lint. Browser verification is deferred: nothing has published, so the variant grid has no real provider state to show yet. Commit `feat(campaigns): publish approved organic actions`.

### Task 18: Run capped Meta Ads experiments and register the pause tool

**Files:**

- Create: `src/modules/integrations/providers/meta/{ads-adapter,pause-adapter}.ts` and tests
- Modify: `src/modules/campaigns/infrastructure/run-repository.ts`
- Create: `supabase/migrations/20260817130000_meta_ads_object_graph.sql`
- Create: `supabase/tests/database/meta_ads_object_graph_test.sql`
- Create: `docs/verification/campaigns/meta-ads-sandbox.md`

- [ ] **Step 1: Write RED budget and adapter tests.** Currency or account mismatch; provider minimum and maximum budget; approved audience and placement only; creative-to-version mismatch; partial provider object creation; idempotent resume; provider overspend tolerance; local and provider stop; guardrail breach; account spend cap; scope loss; and no automatic increase under any condition.
- [ ] **Step 2: Implement `meta.ads.run_bounded_experiment`.** Create or resume the verified provider object graph from one approved action. Persist every provider external ID before the next call, so a retry cannot duplicate a campaign, ad set, creative, or ad object. Map variants to ads one to one.
- [ ] **Step 3: Enforce spend twice.** The Tool Gateway transactionally reserves the full ceiling; the adapter applies the verified provider ceiling and stopping controls. Monitoring compares approved, reserved, provider-reported, and settled spend in one currency and stops at the earliest configured boundary.
- [ ] **Step 4: Register `meta.ads.pause_ad` as its own tool.** A pause is a provider write with its own action run, idempotency key, and unknown-outcome path. An unresolved pause is treated with the same severity as an unresolved publish, because unresolved means spend may still be live.
- [ ] **Step 5: Capture controlled-account evidence.** Run one minimal capped experiment and one pause. Record redacted object IDs, configured ceiling, observed spend, stop result, and reconciliation in `docs/verification/campaigns/meta-ads-sandbox.md`. Gate D cannot pass without it.
- [ ] **Step 6: Verify and commit.** Concurrent claim tests, idempotent resume, direct RPC misuse, pgTAP, typecheck, lint. Commit `feat(campaigns): run capped Meta Ads experiments`.

### Task 19: Ingest provider metrics at variant grain

**Files:**

- Create: `src/modules/integrations/providers/meta/insights-reader.ts` and test
- Create: `src/modules/campaigns/infrastructure/metric-ingest.ts` and test
- Create: `src/workflows/campaigns/collect-metrics.ts` and test
- Create: `supabase/migrations/20260817140000_campaign_metric_grain.sql`
- Create: `supabase/tests/database/campaign_metric_grain_test.sql`

- [ ] **Step 1: Write RED ingestion tests.** Exact metric definitions and dimensions; correct period grain and branch timezone; quality tier preserved; missing, late, and restated metrics; append-only revision and supersession; a provider figure never silently overwriting a prior observation.
- [ ] **Step 2: Add the metric grain.** Register `campaign`, `campaign_action`, and `creative_variant` in `subject_kinds`, and add `campaign_metric_observations` linking a variant or action to `normalized_metrics` revisions while preserving missingness. Without this grain the agent has nowhere to reason from.
- [ ] **Step 3: Implement the insights reader.** Fetch only metrics the contract permits under a metrics-read capability grant, bounded and schema-validated. An undocumented field is unavailable, not inferred.
- [ ] **Step 4: Implement `campaign.collect-metrics`.** Durable, idempotent per period and subject, respecting the registered reporting delay. A gap is recorded as a gap and never imputed.
- [ ] **Step 5: Verify and commit.** Focused tests, pgTAP two-tenant isolation on the new table, typecheck, lint, and a live staging call of every new plpgsql function. Commit `feat(campaigns): return provider results to the warehouse`.

### Task 20: Run the deterministic allocation loop

**Files:**

- Create: `src/domain/campaigns/allocation.ts` and test
- Create: `src/modules/campaigns/application/allocation-service.ts` and test
- Create: `src/modules/campaigns/infrastructure/allocation-repository.ts` and test
- Create: `src/workflows/campaigns/allocation-cycle.ts` and test
- Create: `supabase/migrations/20260817150000_campaign_allocation_events.sql`
- Create: `supabase/tests/database/campaign_allocation_events_test.sql`
- Create: `src/app/api/organizations/[organizationId]/campaigns/[campaignId]/{allocation/route.ts,variants/[variantId]/resume/route.ts}` and tests
- Create: `src/components/campaigns/allocation-ledger.tsx` and test

- [ ] **Step 1: Write RED allocation tests.** Boundary values on every threshold; the minimum exposure floor preventing a stop on noise; a margin rule not firing when the economics grade is insufficient; deterministic repeatability given identical inputs; no cross-campaign comparison reachable from any code path; and the wall — an allocation cycle attempting to write an exposure, observation, or outcome row must fail.
- [ ] **Step 2: Add the allocation ledger.** Append-only rows carrying cycle, variant, rule key and version, observed value, threshold, resolved margin and grade, action, reason code, and actor. Every evaluated variant gets a row including `no_action`, because a decision not to act is still a decision that must be explainable.
- [ ] **Step 3: Implement deterministic rules.** Two families only: diagnostic thresholds, and contribution-margin floors resolved through the Channel Economics Ledger where the grade suffices. Rules are versioned and organization-scoped. No model participates in either direction.
- [ ] **Step 4: Implement `campaign.allocation-cycle`.** Per-organization cadence, per-campaign decisions. Pause routes through the Tool Gateway as its own action run. A pause does not change campaign state and does not put a campaign into `partially_completed`.
- [ ] **Step 5: Implement operator resume.** Approving roles only, recorded with actor and time. There is no autonomous resume anywhere in the codebase; a test asserts the absence.
- [ ] **Step 6: Show the reasoning.** The ledger UI shows, for each pause, the rule that fired, the observed value, the threshold, the resolved margin where used, and the time. An autonomous action the operator cannot interrogate is an autonomous action they cannot trust.
- [ ] **Step 7: Verify and commit.** Focused tests, pgTAP, Chrome DevTools at both widths, typecheck, lint. Commit `feat(campaigns): contain waste without human intervention`.

### Task 21: Settle evidence-qualified outcomes

**Files:**

- Create: `src/domain/campaigns/measurement.ts` and test
- Create: `src/modules/campaigns/application/measurement-service.ts` and test
- Create: `src/workflows/campaigns/settle-outcome.ts` and test
- Create: `supabase/migrations/20260817160000_campaign_outcomes.sql`
- Create: `supabase/tests/database/campaign_outcomes_test.sql`
- Create: `src/app/api/organizations/[organizationId]/campaigns/[campaignId]/outcome/route.ts` and test
- Create: `src/components/campaigns/outcome-proof.tsx` and test

- [ ] **Step 1: Write RED measurement tests.** Immutable preregistration before first exposure; realized exposure reconstructed from receipts and allocation history rather than assumed from the plan; truncation attributed to its cause; settlement delay honored; guardrail breach; attribution-method eligibility; and no causal wording anywhere in an `inconclusive` rendering.
- [ ] **Step 2: Add `campaign_outcomes`.** One settled verdict per campaign with method, window, estimate and range, evidence tier, guardrail state, and limitations. Planned and realized exposure are stored separately and never reconciled into a single optimistic number.
- [ ] **Step 3: Implement deterministic verdicts.** Exactly `validated_outcome`, `inconclusive`, `guardrail_breach`, `execution_only`. `validated_outcome` requires the predeclared method's evidence threshold; engagement alone can never reach it. No model chooses the verdict, method, stopping rule, or calculation.
- [ ] **Step 4: Implement `campaign.settle-outcome`.** Wait the registered window and settlement period, recompute safely after append-only metric revisions, and mark any already-rendered result that a restatement has changed.
- [ ] **Step 5: Render proof honestly.** Show hypothesis, planned versus realized exposure, baseline, window, estimate and range, spend, guardrails, evidence tier and method, missing data, limitations, and why the verdict carries its label. A model may draft wording from the computed result and must pass a no-overclaim validator.
- [ ] **Step 6: Verify and commit.** Focused tests, pgTAP, Chrome DevTools at both widths, typecheck, lint. Commit `feat(campaigns): settle evidence-qualified outcomes`.

### Task 22: Propose campaign-scoped learning

**Files:**

- Create: `src/modules/campaigns/application/learning-service.ts` and test
- Create: `src/workflows/campaigns/propose-learning.ts` and test
- Create: `supabase/migrations/20260817170000_campaign_learning_proposals.sql`
- Create: `supabase/tests/database/campaign_learning_proposals_test.sql`
- Create: `src/app/api/organizations/[organizationId]/campaigns/[campaignId]/learning/[proposalId]/decision/route.ts` and test
- Create: `src/components/campaigns/learning-review.tsx` and test

- [ ] **Step 1: Write RED governance tests.** A proposal references exact bundle version, policy version, variants, exposures, and outcome; is organization and campaign scoped; distinguishes observed result from hypothesis; cannot modify active brand policy, playbook, or recipe; cross-tenant evidence fails; and an `inconclusive` outcome cannot become a winning rule.
- [ ] **Step 2: Add the append-only proposals table.** Structured observation, limitation, suggested next test, evidence links, target artifact type, and status.
- [ ] **Step 3: Generate constrained summaries.** A model drafts a proposed lesson only from the settled outcome and its evidence. Deterministic validation checks verdict consistency and prohibited generalization.
- [ ] **Step 4: Add Studio review.** Dismiss, keep campaign-only, or submit as a separate reusable-recipe proposal under ADR 0013. No auto-promotion exists and a test asserts its absence.
- [ ] **Step 5: Verify and commit.** Learning, campaign, and memory integration tests; pgTAP; typecheck; lint. Commit `feat(campaigns): propose governed campaign learning`.

### Task 23: Inject entropy through governed sources

**Files:**

- Create: `src/modules/integrations/sources/{ad-library,transcripts}/**` and tests
- Modify: `src/modules/memory/application/**` for inspiration-class items
- Create: `supabase/migrations/20260817180000_inspiration_sources.sql`
- Create: `supabase/tests/database/inspiration_sources_test.sql`

- [ ] **Step 1: Write RED containment tests.** An ingested competitor claim can inform an angle but can never become an assertion in generated copy, because claims must trace to the pinned source snapshot. An ingested asset can never be classified `authentic_source`. Prompt injection inside ingested content cannot reach a tool, a credential, or a policy decision.
- [ ] **Step 2: Register entropy as Data Sources, not prompt inputs.** They enter through the Integration Hub with the same provenance, health, and ingestion-run treatment as any other source.
- [ ] **Step 3: Land content in Business Memory below verified facts.** Trust rank sorts derived inspiration beneath verified facts lexicographically, so an inference can never outrank a fact regardless of relevance score.
- [ ] **Step 4: Record the legal position.** Ad Library and transcript ingestion have terms-of-service and copyright dimensions. Decide and document retention, attribution, and permitted use before ingesting anything; do not discover this later.
- [ ] **Step 5: Verify and commit.** Containment tests, memory ranking tests, pgTAP, typecheck, lint. Commit `feat(campaigns): inject governed creative entropy`.

### Task 24: Verify across surfaces and open the production gate

**Files:**

- Create: `e2e/campaign-feedback-loop.spec.ts`
- Modify: `context/{05-module-map,10-events-and-workflows,21-learning-system}.md`, `MANIFEST.md`, `progress-tracker.md`
- Create: `docs/verification/campaigns/feedback-loop-runbook.md`

- [ ] **Step 1: Write the reference E2E story.** One campaign from approval through variant fleet, publication, metric ingestion, an autonomous pause, an operator resume, settlement, verdict, and a learning proposal. Assert the verdict language matches the evidence it actually has.
- [ ] **Step 2: Add adversarial cases.** Cross-tenant route, body, and storage identifiers; stale tabs; membership, credential, or capability revoked after approval; replayed webhooks; duplicate scheduling; timeout after send; concurrent budget claims; prompt injection in operator text and ingested entropy; asset URL expiry; and an allocation cycle attempting to cross the wall.
- [ ] **Step 3: Run the full quality gate.** `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm knip`, `pnpm db:test`, `pnpm test:e2e`, remote migration alignment, and Supabase security and performance advisors. Stop on any critical or high finding.
- [ ] **Step 4: Complete operational readiness.** Document capability enable and disable, client credential rotation and revocation mid-campaign, approval and policy expiry, unknown-outcome reconciliation, unresolved pause escalation, budget discrepancy containment, campaign cancellation, webhook outage and backfill, provider-contract expiry, allocation-loop suspension, observability and alerts, incident response, and a recoverable feature-flag rollback.
- [ ] **Step 5: Run an independent review, fix, and re-test loop.** Review tenant isolation, authorization, AI truth, provider duplication, spend containment, audit redaction, the loop wall, and measurement claims. Fix every critical and high finding and rerun the affected focused suite plus the full gate.
- [ ] **Step 6: Update documentation to match reality.** `progress-tracker.md` is stale as of this plan and must describe the shipped system, not the system as of 2026-08-09.
- [ ] **Step 7: Obtain Gate F approval before allowlisting the first production organization.** Capture the approver, time, contract versions, sandbox evidence, and remaining lower-severity risks. Commit `feat(campaigns): close the campaign feedback loop`.

---

## Definition of Done

- [ ] One human approval authorizes a bounded, capped, expiring creative family, and the operator can read that bound from the screen.
- [ ] A variant can change how a campaign is said and can never change what it promises.
- [ ] The Tool Gateway is unchanged, and a variant reaches a provider through the same action-run identity a single action always used.
- [ ] Provider results land in `normalized_metrics` at variant grain with correct quality tier, period grain, and timezone.
- [ ] The platform pauses waste on deterministic rules within its cadence, explains every pause, and cannot resume.
- [ ] Realized exposure is reconstructed from allocation history, never assumed from the plan.
- [ ] Every campaign conclusion states its method, window, evidence tier, and limitations, and `inconclusive` is rendered without causal language.
- [ ] Learning stays attached to its campaign until a separate governed decision promotes it.
- [ ] Tenant isolation holds across every new table, route, storage path, worker RPC, and provider mapping.
- [ ] No service-role client exists in a user-facing request path, and no Trigger run ID substitutes for business state.
- [ ] Telegram, customer messaging, video, non-Meta paid media, autonomous resume, and automatic learning promotion remain absent.
