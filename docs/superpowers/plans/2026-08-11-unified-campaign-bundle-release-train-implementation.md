# Unified Campaign Bundle Release Train Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the approved first production Campaign Bundle experience: Decision Engine and manual entry, governed image-and-copy generation, Studio and Telegram review, exact-version approval, bounded Meta organic and paid execution, and evidence-qualified business proof.

**Architecture:** Postgres is the authoritative campaign, approval, policy, budget, provider-state, and evidence control plane. The Decision Engine proposes one campaign action; immutable Campaign Bundle versions hold the complete proposal; Trigger.dev `schemaTask` workflows run qualification, generation, scheduling, execution, reconciliation, and measurement; Vercel AI SDK providers generate only validated structured artifacts; and every public or money-moving provider call passes through a deterministic Tool Gateway. Integration Hub owns credentials, provider characters, capabilities, and restrictions. Studio and Telegram Mini App are two authenticated views over the same service and version chain.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript strict mode, pnpm 11 on Node 22, Supabase/Postgres with forced RLS and private Storage, Zod 4, Trigger.dev 4.5.10, Vercel AI SDK 5, TanStack Query/Form, shadcn/ui, Vitest, Testing Library, MSW, pgTAP, and Playwright.

## Global Constraints

- Execute this as one release train with the activation gates below. A later task may depend on an earlier task, but no task may silently weaken an earlier safety contract.
- Use `PATH=/home/spy/.local/node/bin:$PATH` for pnpm commands. Preserve the user's unrelated dirty-worktree changes and stage only files listed by the current task.
- If the migration tail has advanced by execution time, regenerate the numeric prefixes while preserving the migration order in this plan. Never edit an already-applied migration.
- Keep platform core industry-neutral. A reference Restaurant Industry Pack playbook may supply vocabulary and evidence requirements, but no restaurant field belongs in campaign, approval, execution, or measurement tables.
- User-facing routes use the authenticated Supabase session and RLS. Service-role clients may be constructed only inside Trigger.dev workers after strict task-payload validation.
- All tenant-owned foreign keys are composite on `(organization_id, id)`. Enable and force RLS, revoke `anon`, grant only the minimum authenticated operations, and test two-tenant isolation plus direct-RPC misuse.
- Trigger.dev is execution-only. A Trigger run ID never substitutes for a campaign version, approval, execution claim, budget reservation, provider receipt, webhook receipt, exposure, or outcome row.
- A model may propose strategy, structured copy, hashtags, typed revisions, and visual assets. It may not select credentials, grant capabilities, approve a version, reserve spend, choose an unapproved placement, publish, retry an unknown provider outcome, change a budget, or declare causal impact.
- Trigger.dev `schemaTask` plus the Vercel AI SDK is the primary runtime. Do not introduce `chat.agent` as the campaign orchestrator; a future conversational Studio shell may call proposal-only campaign services but may not receive provider or Tool Gateway side-effect tools.
- Validate every model, HTTP, task, provider, webhook, Telegram, and database-RPC boundary with Zod or SQL constraints. Unknown fields fail at external write boundaries.
- Never log prompts, generated assets, provider bodies, OAuth codes, access tokens, Telegram signed initialization data, customer PII, or secret references. Structured logs carry safe identifiers and normalized outcome codes only.
- The production feature flag `CAMPAIGNS_V1_ORGANIZATION_IDS` remains fail-closed until Gate 6. Dry-run UI must say `Dry run` and must not expose an enabled Publish or Start ads control.
- An unavailable or restricted placement remains visible with the exact capability reason. `best_effort` may execute only ready approved actions; `all_channels_required` executes none while one action is blocked.
- A material edit always creates a new immutable bundle version and invalidates approval. Generation-profile changes, prompt patches, assets, copy, hashtags, CTA, channel, audience, schedule, measurement, execution mode, or spend are material.
- Telegram is operator control only. Do not add WhatsApp, Telegram customer messaging, recipient lists, message templates, direct messages, comments, or community management to this plan.
- The first measurement implementation must not use switchback analysis for static brand creative. A provider-supported randomized Meta experiment may be used only when the checked-in provider contract proves eligibility; otherwise report the pre-registered observational result with its limitations and allow `inconclusive`.
- Commit each task only after focused verification. Stop for review at every activation gate; do not combine tasks across a failed gate.
- If implementation evidence conflicts with the approved design, provider reality, or a load-bearing plan assumption, stop and discuss the discrepancy with the user before changing direction.
- Before any Campaign Studio UI code or UI test is written, use the `superdesign:superdesign` skill to design the complete Campaign flow, generate alternatives, and select one coherent direction. The user delegated that selection on 2026-08-12; share the live canvas and use the selected direction consistently across Campaign modules without a separate selection pause.
- Every frontend task must be verified in a real Chrome session through Chrome DevTools at desktop and mobile widths. Inspect the rendered route, interactions, responsive layout, console, failed network requests, keyboard/focus behavior, and user-visible error states; component tests alone are insufficient.
- For each additive migration, run `pnpm db:migrations:list`, `pnpm db:migrations:dry-run`, `pnpm db:migrations:push`, and the post-push list/pgTAP checks against the remote database. If a migration becomes destructive, first make and verify a local data dump, then apply the migration and the preserved data in explicit sequence.
- The completed `feat/business-memory` branch was rebased into this worktree at `6f0810b`. It supplied the economics/metric prerequisites and Trigger SDK/build `4.5.10`, but not the generic Decision Engine or opportunity ledger; Tasks 4–6 therefore remain owned by this release train. Align the remaining `trigger.dev` CLI package to `4.5.10` before authoring the first Trigger task.

## Activation Gates

| Gate              | Required evidence                                                                                                          | Production state                                            |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 1 — Control plane | Campaign/Decision schemas, RLS, immutability, digest, approval invalidation, audit                                         | Data model available; no generation or execution            |
| 2 — Creative      | Three directions, profiles, hashtags, prompt revisions, provenance, Studio tests                                           | Studio dry-run available to allowlisted organizations       |
| 3 — Review        | Telegram link, signed Mini App identity, live role check, attestation, exact-version approval                              | Dual-entry review available; provider actions still dry-run |
| 4 — Organic       | Security-reviewed credential store, verified Meta contract, controlled-account post/story, webhook/reconciliation evidence | Meta organic capability may be enabled per organization     |
| 5 — Paid          | Atomic reservation, stopping conditions, provider-spend reconciliation, capped controlled-account experiment               | Meta Ads capability may be enabled per organization         |
| 6 — Proof         | Exposure joins, settlement window, evidence-qualified verdict, learning proposal, complete E2E and runbook                 | First production organization may be enabled                |

---

## File Structure

| Area                     | Planned files                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable decisions        | `adrs/0015-*.md` through the next available ADR numbers; updates to `context/03-architecture.md`, `context/04-domain-model.md`, `context/05-module-map.md`, `context/17-observability-cost-governance.md`, and relevant specs |
| Integration capabilities | `src/domain/integrations/{types,schemas,capabilities,provider-registry}.ts`, `src/modules/integrations/**`, `src/app/api/organizations/[organizationId]/integrations/**`, and additive Integration Hub migrations/tests       |
| Decision and opportunity | `src/domain/decisions/**`, `src/modules/decisions/**`, `src/workflows/decisions/**`, `src/trigger/decisions.ts`, opportunity APIs/UI, decision migration/pgTAP                                                                |
| Campaign domain          | `src/domain/campaigns/**` for Zod contracts, normalization, digest, state, permissions, content validation, and diffs                                                                                                         |
| Campaign application     | `src/modules/campaigns/{application,infrastructure}/**`, `src/workflows/campaigns/**`, `src/trigger/campaigns.ts`                                                                                                             |
| Provider adapters        | `src/modules/integrations/providers/meta/**`, `src/modules/integrations/providers/telegram-operator-review/**`, checked-in provider contracts and MSW fixtures                                                                |
| APIs and UI              | `src/app/api/organizations/[organizationId]/campaigns/**`, `src/app/api/integrations/{meta,telegram}/**`, `src/app/(platform)/organizations/[organizationId]/campaigns/**`, `src/components/campaigns/**`                     |
| Control-plane data       | Additive migrations for decision records, governed brand assets/source snapshots, campaign bundles, approval/tool execution, measurement/learning; private `brand-assets` and `campaign-assets` buckets; pgTAP suites         |
| Verification             | Colocated unit/integration tests, `e2e/campaign-studio.spec.ts`, `e2e/campaign-telegram-review.spec.ts`, `e2e/campaign-execution.spec.ts`, and provider sandbox evidence under `docs/verification/campaigns/`                 |

## Stable Interfaces

These contracts are shared across tasks. Change them only with an approved spec/ADR update in the same commit.

```ts
export type IntegrationCharacter =
  | "data_source"
  | "publishing_destination"
  | "advertising_account"
  | "operator_review";

export type ProviderCapabilityDefinition = {
  key: string;
  character: IntegrationCharacter;
  direction: "inbound" | "outbound";
  effect: "read" | "public_write" | "money_moving" | "operator_control";
  maturity: ConnectionMaturity;
  requiredScopes: readonly string[];
  restrictionCodes: readonly string[];
  adapterKind: "read" | "publish" | "advertise" | "webhook" | "operator_review";
};

export type CampaignGenerationProfile = "brand_restricted" | "brand_guided" | "full_visual_freedom";
export type CreativeDirectionKind = "control" | "evidence_led" | "experimental";
export type CampaignChannel = "instagram" | "facebook";
export type CampaignPlacement = "feed_image" | "image_story";

export type CampaignBundleManifest = {
  schemaVersion: 1;
  campaignId: string;
  version: number;
  source: { kind: "manual_brief" | "decision_opportunity"; sourceId: string };
  objective: string;
  rationale: string;
  generationProfile: CampaignGenerationProfile;
  directions: readonly CampaignCreativeDirection[];
  actions: readonly CampaignChannelAction[];
  measurementPlan: CampaignMeasurementPlan;
  executionMode: "best_effort" | "all_channels_required";
  totalSpendCeiling: { amountMinor: number; currency: string } | null;
};

export type CampaignApprovalEnvelope = {
  campaignId: string;
  bundleVersionId: string;
  bundleDigest: string;
  actionIds: readonly string[];
  capabilityGrantVersions: Readonly<Record<string, string>>;
  policyVersionIds: readonly string[];
  expiresAt: string;
  totalSpendCeiling: { amountMinor: number; currency: string } | null;
};

export type CampaignGenerationProvider = {
  generatePlan(input: CampaignGenerationInput): Promise<unknown>;
  generateImage(input: CampaignImageGenerationInput): Promise<GeneratedImage>;
  generatePatch(input: CampaignPatchInput): Promise<unknown>;
};

export type ToolGatewayClaim =
  | { outcome: "claimed"; claimToken: string; action: ExecutableCampaignAction }
  | { outcome: "already_completed"; receiptId: string }
  | { outcome: "blocked"; reasonCodes: readonly string[] }
  | { outcome: "provider_outcome_unknown"; reconciliationRequired: true };
```

The canonical bundle digest is SHA-256 over RFC 8785-style canonical JSON of the immutable manifest plus ordered asset content hashes. Database IDs used only for storage location, timestamps, UI labels, provider responses, and review-session IDs are excluded. Approval stores both the digest and exact bundle-version ID.

---

### Task 1: Freeze architectural decisions and live provider contracts

**Files:**

- Create: `adrs/0015-campaign-bundle-system-of-record.md`
- Create: `adrs/0016-integration-action-capabilities.md`
- Create: `adrs/0017-campaign-runtime-and-approval.md`
- Create: `adrs/0018-telegram-operator-review.md`
- Create: `adrs/0019-campaign-measurement-and-learning.md`
- Create: `docs/provider-contracts/meta-campaign-v1.md`
- Create: `docs/provider-contracts/telegram-operator-review-v1.md`
- Create: `src/modules/integrations/providers/meta/contract.ts`
- Create: `src/modules/integrations/providers/meta/contract.test.ts`
- Create: `src/modules/integrations/providers/telegram-operator-review/contract.ts`
- Create: `src/modules/integrations/providers/telegram-operator-review/contract.test.ts`
- Modify: `context/03-architecture.md`, `context/04-domain-model.md`, `context/05-module-map.md`

- [ ] **Step 1: Write failing contract tests.** Define a strict Zod `VerifiedProviderContract` with provider/API version, verification date, official source URLs, account prerequisites, exact scopes, supported placement/action keys, size/copy/hashtag limits, idempotency behavior, webhook events/signature/replay rules, retryable statuses, unknown-outcome reconciliation lookup, and known restrictions. Tests reject an expired verification date, unverified action, missing scope, undocumented webhook, or write action without a reconciliation strategy.
- [ ] **Step 2: Run RED.** Run `PATH=/home/spy/.local/node/bin:$PATH pnpm vitest run src/modules/integrations/providers/meta/contract.test.ts src/modules/integrations/providers/telegram-operator-review/contract.test.ts`; expect missing contract modules.
- [ ] **Step 3: Verify current official Meta and Telegram documentation.** Record only actions actually available to the controlled accounts. Do not infer permission from an onboarding channel declaration. Pin the Meta API version in the checked-in contract, record its review/expiry date, and mark every unavailable placement with a stable restriction code.
- [ ] **Step 4: Write the ADRs.** Record the approved system-of-record, task-plus-AI-SDK runtime, capability/restriction model, exact-version approval, Telegram identity boundary, Tool Gateway, campaign-scoped learning, and evidence-qualified success contract. ADR 0010 remains valid for the fixture-only Google path; explicitly supersede only its blanket write/webhook exclusion for capability-gated campaign providers.
- [ ] **Step 5: Run GREEN and documentation checks.** Run the two contract tests, `pnpm typecheck`, `pnpm lint`, and `git diff --check`.
- [ ] **Step 6: Commit.** `git commit -m "docs(campaigns): freeze runtime and provider contracts"`.

**Review checkpoint — external truth:** Stop if official provider documentation or controlled-account eligibility cannot prove an approved action. Keep that action blocked; do not substitute a guessed endpoint or permission.

### Task 2: Extend Integration Hub with typed action capabilities and restrictions

**Files:**

- Modify: `src/domain/integrations/types.ts`, `schemas.ts`, `capabilities.ts`, `provider-registry.ts`
- Modify: their existing tests and `src/domain/integrations/permissions.ts`
- Modify: `src/modules/integrations/application/{ports,read-model,service,api-schemas}.ts`
- Modify: `src/modules/integrations/infrastructure/repository.ts`
- Modify: `src/components/integrations/{catalog-tab,capability-list,connection-detail}.tsx`
- Create: `supabase/migrations/20260812100000_integration_action_capabilities.sql`
- Create: `supabase/tests/database/integration_action_capabilities_test.sql`

- [ ] **Step 1: Write RED tests.** Cover read, publish, advertise, webhook, and operator-review definitions; unavailable adapters; missing scopes; account ineligibility; organization policy denial; unmapped resources; credential expiry; provider-contract expiry; revoked connection; restriction-code preservation; and prohibition on deriving a higher maturity than the definition allows.
- [ ] **Step 2: Replace boolean provider traits with typed definitions.** `ProviderDefinition` owns `characters` and `capabilities`; the registry accepts separate adapter maps by `adapterKind` and rejects a capability whose matching adapter is absent. Remove only the blanket `supportsWrites`/`supportsWebhooks` rejection, not capability validation.
- [ ] **Step 3: Generalize deterministic derivation.** Extend `CapabilityDerivationInput.platformPolicy` with permitted effects and spend/public-write modes. Persist `restriction_codes`, `derived_from_contract_version`, and a monotonic `grant_version`; disabled/revoked grants remain unusable regardless of cached UI state.
- [ ] **Step 4: Add the migration and pgTAP.** Alter existing grant rows additively, backfill read capabilities, constrain new columns, and test two-tenant read/write, role permissions, inactive-connection disablement, and composite connection ownership.
- [ ] **Step 5: Update the Hub UI.** Show each connection character, effect, maturity, availability, exact scopes, restrictions, and recovery action. Never label a Meta/Telegram definition `available` until an organization connection has a usable grant.
- [ ] **Step 6: Verify.** Run `pnpm vitest run src/domain/integrations src/modules/integrations src/components/integrations`, `pnpm db:test`, `pnpm typecheck`, and `pnpm lint`.
- [ ] **Step 7: Commit.** `git commit -m "feat(integrations): model governed action capabilities"`.

### Task 3: Add the production credential and OAuth connection substrate

**Files:**

- Create: `src/modules/integrations/infrastructure/vault-credential-store.ts` and tests
- Create: `src/modules/integrations/application/oauth-service.ts` and tests
- Create: `src/app/api/organizations/[organizationId]/integrations/oauth/[providerKey]/route.ts`
- Create: `src/app/api/integrations/oauth/[providerKey]/callback/route.ts`
- Create: `supabase/migrations/20260812110000_integration_oauth_sessions.sql`
- Modify: `src/lib/env.ts`, `.env.example`, Integration Hub route/UI files
- Modify: `adrs/0010-fixture-first-integration-credential-boundary.md`

- [ ] **Step 1: Write failing security tests.** Assert state is random, stored only as a digest, single-use, expires, is bound to organization/user/provider, rejects callback mismatch before token exchange, and never returns/logs OAuth codes, access/refresh tokens, app secret, credential handle, or decrypted Vault output.
- [ ] **Step 2: Implement the server-only credential adapter.** The only public value is `CredentialHandle`; decrypted values expose `toJSON(): never`. Restrict Vault RPC execution to worker/server functions documented by the security review. Rotation and revoke are idempotent and preserve safe audit metadata.
- [ ] **Step 3: Implement generic OAuth sessions.** Add server-only `META_APP_ID` and `META_APP_SECRET`; compute the callback from `NEXT_PUBLIC_APP_URL`. The organization route creates a persisted one-time session and provider authorization URL from the verified contract. The callback atomically consumes state, exchanges the code server-side, stores the credential, writes the connection/scopes/expiry, recomputes grants, and redirects with a safe opaque result code.
- [ ] **Step 4: Add Meta as the first production connection definition.** Account discovery and mapping remain server-side. Register Instagram publishing, Facebook publishing, Meta Ads, metrics read, and webhook intake as distinct grants; one missing grant must not disable unrelated grants.
- [ ] **Step 5: Verify migrations and route behavior.** Include two-tenant pgTAP, replayed callback, expired state, revoked user, token exchange failure, credential-store failure, and safe error cases.
- [ ] **Step 6: Run security review checkpoint.** Document least privilege, encryption/key ownership, rotation, revocation, backup/restore, incident response, and provider-app secret handling under `docs/verification/campaigns/credential-security-review.md`. Gate 4 cannot pass without sign-off.
- [ ] **Step 7: Commit.** `git commit -m "feat(integrations): add governed OAuth credential boundary"`.

### Task 4: Implement the Decision Engine and opportunity ledger prerequisite

**Files:**

- Create: `src/domain/decisions/{schemas,types,ranking,screening,digest,errors}.ts` and tests
- Create: `src/modules/decisions/application/{ports,service,authorization}.ts` and tests
- Create: `src/modules/decisions/infrastructure/repository.ts` and integration tests
- Create: `supabase/migrations/20260812120000_decision_engine_and_opportunities.sql`
- Create: `supabase/tests/database/decision_engine_test.sql`
- Modify: `src/domain/events/types.ts`

- [ ] **Step 1: Encode the exact `specs/005` invariants as failing tests.** One decision selects one action; candidate fingerprint is stable; screening is set-based; confidence is deterministic; ranking is evidence tier then expected contribution then time; `needs_data` creates no opportunity; `no_action` is recorded; tier 4 and margin/budget gates remove candidates; suppressions/resurfacing and expiry are deterministic.
- [ ] **Step 2: Add the nine tenant-owned tables.** Create `playbook_definitions`, `playbook_versions`, `artifact_versions`, `decision_cycles`, `decision_records`, `decision_candidates`, `decision_feedback`, `candidate_suppressions`, and `opportunities`. Add append-only/immutability triggers, active-version uniqueness, composite tenant FKs, retention metadata, RLS, explicit grants, audit, and indexes.
- [ ] **Step 3: Implement repository ports.** User-facing callers may read opportunities and append authorized feedback only. Only validated workers may write decision cycles/records/candidates/opportunities through security-definer RPCs with `search_path = ''`, input organization checks, and no `authenticated` grant for worker-only RPCs.
- [ ] **Step 4: Add stable events.** Add safe identifier-only payloads for `decision.cycle_started`, `decision.recorded`, `decision.needs_data_identified`, `opportunity.proposed`, `opportunity.approved`, `opportunity.rejected`, `opportunity.snoozed`, `opportunity.expired`, and `decision.feedback_captured`.
- [ ] **Step 5: Verify.** Run decision unit tests, migration contract tests, remote pgTAP, typecheck, lint, and `git diff --check`.
- [ ] **Step 6: Commit.** `git commit -m "feat(decisions): persist deterministic opportunities"`.

### Task 5: Run a campaign playbook through the deterministic Decision Engine

**Files:**

- Create: `src/modules/decisions/sources/campaign-opportunity-source.ts` and tests
- Create: `src/modules/decisions/playbooks/meta-campaign-v1.ts` and tests
- Create: `src/workflows/decisions/{contracts,run-cycle}.ts` and worker tests
- Create: `src/trigger/decisions.ts` and tests
- Modify: `src/lib/supabase/service.ts`, `trigger.config.ts`

- [ ] **Step 1: Write the campaign source tests.** Required evidence includes a current organization profile, verified brand constraints/claims, usable brand assets or an explicit synthetic-asset allowance, configured economics/currency, an active goal/metric, Meta account mapping, action capabilities, spend policy, tracking readiness, and data freshness. Missing required evidence yields named `needs_data`; it never invents a candidate.
- [ ] **Step 2: Define one industry-neutral action.** Register `campaign.meta_bundle_v1` as one action whose parameters describe the downstream bundle objective, eligible Meta channels, placements, spend ceiling, measurement method, and constraints. The three creative directions are downstream alternatives inside this selected action, not extra Decision Engine candidates.
- [ ] **Step 3: Implement pure screening/scoring/ranking.** Use the economics ledger and metric registry; never let a model emit confidence, value, risk, capability, or approval path. Pin every artifact/input version into the decision record and opportunity assertions.
- [ ] **Step 4: Implement the Trigger `schemaTask`.** Parse UUIDs and trigger type, create the decision-worker client only after parsing, atomically claim a cycle, persist all outcomes, and publish safe events. Retries reuse the business idempotency key.
- [ ] **Step 5: Test cancellation, duplicate dispatch, stale lease, needs-data, no-action, selected-action, and cross-tenant payloads.** Run focused workflow/Trigger tests and the decision pgTAP suite.
- [ ] **Step 6: Commit.** `git commit -m "feat(decisions): qualify campaign opportunities"`.

### Task 6: Expose the opportunity feed and campaign qualification boundary

**Files:**

- Create: `src/app/(platform)/opportunities/page.tsx`
- Create: `src/components/opportunities/{opportunity-feed,opportunity-card,query-options}.tsx` and tests
- Create: `src/app/api/organizations/[organizationId]/opportunities/**/route.ts` and route tests
- Create: `src/modules/campaigns/application/qualification.ts` and tests
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Write feed/qualification RED tests.** Tier grouping/order, range-plus-tier display, no `needs_data`, expired opportunities blocked, role-scoped feedback, edited parameters producing a new plan source, and campaign qualification rechecking source status/assertions.
- [ ] **Step 2: Implement RLS-backed feed routes and Server Component initial read.** The global page resolves the active organization explicitly; query keys include the organization ID. Approve/edit/reject/evidence/snooze writes append-only `decision_feedback`.
- [ ] **Step 3: Implement `qualifyCampaignSource`.** Manual briefs return a typed source without a Decision record. Opportunity sources require a current `proposed` opportunity whose playbook action is `campaign.meta_bundle_v1`; qualification snapshots its exact assertions and source ID rather than changing the opportunity.
- [ ] **Step 4: Enable the Opportunities navigation destination.** Keep Campaigns marked Soon until Task 12 provides its real page.
- [ ] **Step 5: Verify focused UI, API, authorization, and type tests; commit.** Use `git commit -m "feat(opportunities): expose campaign-ready decisions"`.

### Task 7: Define the immutable Campaign Bundle domain

**Files:**

- Create: `src/domain/campaigns/{schemas,types,normalization,digest,diff,state-machine,permissions,content-policy,errors}.ts`
- Create corresponding tests

- [ ] **Step 1: Write RED tests for the full manifest.** Require exactly one control, evidence-led, and experimental direction; at least one eligible action; per-channel hook/caption/hashtags/CTA/timing rationale/schedule; asset provenance/truth class; bundle and per-direction generation profiles; measurement plan; execution mode; and currency-matched spend ceiling.
- [ ] **Step 2: Test content policy and generation modes.** `brand_restricted` cannot leave approved palette/typography/layout rules; `brand_guided` may vary soft composition; `full_visual_freedom` may depart from soft brand rules but never factual, claims, legal, safety, consent, platform, or offer constraints. Experimental output must be meaningfully distinct under the selected mode.
- [ ] **Step 3: Implement hashtag validation.** Normalize case for duplicate detection without rewriting display text, enforce verified provider limits, remove restricted/unsupported tags, separate internal content tags from public hashtags, and require a short rationale for each channel set.
- [ ] **Step 4: Implement canonical normalization/digest/diff.** Sort set-like fields, preserve authored ordering where it changes presentation, include asset hashes, and categorize every changed path as material. Property tests prove semantically equal input has the same digest and every material mutation changes it.
- [ ] **Step 5: Implement the state machine.** Only `draft → ready_for_review → approved → scheduled → executing → measuring → completed` plus explicit `needs_data`, `blocked`, `partially_completed`, `cancelled`, and `failed` transitions. Approval is derived from an approval row, never a mutable boolean.
- [ ] **Step 6: Run `pnpm vitest run src/domain/campaigns`, typecheck, lint; commit.** `git commit -m "feat(campaigns): define immutable bundle contracts"`.

### Task 8: Persist bundle versions, assets, approvals, and attestations

**Files:**

- Create: `supabase/migrations/20260812130000_campaign_bundle_control_plane.sql`
- Create: `supabase/tests/database/campaign_bundle_test.sql`
- Create: `src/modules/campaigns/application/ports.ts`
- Create: `src/modules/campaigns/infrastructure/repository.ts` and integration tests
- Modify: `package.json`, `pnpm-lock.yaml`
- Update generated database types through the repository's established staging workflow

- [ ] **Step 1: Write migration contract and pgTAP tests first.** Cover two tenants, viewer/operator permissions, composite ownership, immutable version/action/asset rows, one version number per campaign, append-only attestations/approvals, approval digest/version match, approval expiry, later-version invalidation, private asset paths, direct RPC misuse, and audit payload redaction.
- [ ] **Step 2: Create tables.** Add `organization_brand_assets`, `organization_brand_asset_versions`, `campaign_briefs`, `campaign_source_snapshots`, `campaigns`, `campaign_bundle_versions`, `campaign_creative_directions`, `campaign_assets`, `campaign_channel_actions`, `campaign_measurement_plans`, `campaign_visual_attestations`, and `campaign_approvals`. A source snapshot pins the exact verified organization facts and brand-asset-version IDs used for generation. Store normalized relational fields for queries plus the canonical manifest JSON/digest; DB constraints keep manifest IDs/version/digest aligned with rows.
- [ ] **Step 3: Create private Storage policies and governed asset intake.** Install and pin `sharp@0.34.3`. Brand source paths use `organizationId/brandAssetId/versionId/filename`; generated paths use `organizationId/campaignId/bundleVersionId/assetId.ext`. Validate path ownership and magic bytes, accept only JPEG/PNG/WebP within contract size/dimensions, decode and re-encode server-side while stripping metadata, and compute the content hash before marking a brand asset version usable. Prohibit anonymous access and return signed URLs only after authenticated authorization.
- [ ] **Step 4: Add atomic RPCs.** `create_campaign_bundle_version` locks the campaign, assigns the next version, inserts all immutable children, and invalidates earlier unconsumed approvals. `approve_campaign_bundle` requires current role, visual attestation, exact digest/version, capability snapshot, policy versions, expiry, action IDs, and spend ceiling.
- [ ] **Step 5: Implement the authenticated repository over the RPC/read tables.** No browser-side multi-table transaction and no service role in request paths.
- [ ] **Step 6: Run migration tests, pgTAP, repository tests, typecheck, lint; commit.** `git commit -m "feat(campaigns): persist immutable bundle approvals"`.

### Task 9: Add dual-entry Campaign application services and APIs

**Files:**

- Create: `src/modules/campaigns/application/{service,authorization,api,api-schemas,read-model,feature-access}.ts` and tests
- Create: `src/app/api/organizations/[organizationId]/campaigns/route.ts`
- Create: `src/app/api/organizations/[organizationId]/campaigns/[campaignId]/route.ts`
- Create: routes for `/generate`, `/revisions`, `/attest`, `/approve`, `/schedule`, and `/cancel`
- Create: routes for `/brand-assets`, `/brand-assets/uploads`, and `/brand-assets/uploads/[uploadId]/complete`
- Create route tests
- Modify: `src/lib/env.ts`, `.env.example`, `src/domain/events/types.ts`

- [ ] **Step 1: Write route/service RED tests.** Manual and opportunity creation converge after qualification; body/route organization mismatch fails; viewer mutations fail; duplicate idempotency replays; source change conflicts; malformed JSON is safe; signed asset URLs are tenant-scoped; feature flag is enforced after membership to avoid tenant enumeration.
- [ ] **Step 2: Implement `createCampaignService`.** Create a campaign shell with one immutable source, build a generation input snapshot from verified organization data, dispatch a persisted generation run, expose the version timeline/diff, and append safe campaign events. Do not generate inline in the route.
- [ ] **Step 3: Implement exact API shapes.** `POST /campaigns` accepts `{ source, brief, generationProfile, idempotencyKey }` and creates an immutable `campaign_briefs` row for manual entry; `POST /brand-assets/uploads` plus `/complete` follows the repository's private-upload/finalization pattern and never trusts browser MIME metadata; `POST /generate` queues generation; `POST /revisions` accepts a prompt and target scope; attest/approve require the exact `bundleVersionId` and digest; schedule never bypasses approval.
- [ ] **Step 4: Add organization permissions.** Members read; owner/admin/operator create/edit/attest; owner/admin/operator approve Tier-3 public/spend actions as the approved operator workflow; viewers cannot. The DB and service both enforce this mapping.
- [ ] **Step 5: Verify routes/service/events and commit.** `git commit -m "feat(campaigns): expose dual-entry bundle APIs"`.

**Gate 1 checkpoint:** Demonstrate two-tenant isolation, immutable source and bundle version chains, stable digests, append-only attestation/approval, material-edit invalidation, safe audit events, and both qualified source types. No generation or provider execution is required for this gate.

### Task 10: Implement structured planning, image generation, and prompt patches

**Files:**

- Modify: `package.json`, `pnpm-lock.yaml`, `src/ai/{types,provider,telemetry}.ts`, `src/lib/env.ts`, `.env.example`
- Create: `src/ai/campaign-generation-provider.ts` and tests
- Create: `src/modules/campaigns/application/{generation-context,creative-planner,patch-service,evaluation}.ts` and tests
- Create: `src/modules/campaigns/infrastructure/openai-campaign-generation-provider.ts` and tests

- [ ] **Step 1: Write adversarial RED fixtures.** Include malformed objects, extra fields, invented offers/metrics/claims, prompt injection in source text/operator prompt, cross-tenant asset reference, wrong currency, duplicated/unsafe hashtags, brand violations, non-distinct experiment, unsupported placement, excessive asset count, and unbounded repair loops.
- [ ] **Step 2: Extend the provider abstraction.** Keep text/image provider specifics behind `CampaignGenerationProvider`; return `unknown` for structured outputs so the application boundary must parse. Extend telemetry for generation kind, retries, validation outcome, image count, latency, and cost without recording input/output content.
- [ ] **Step 3: Add the first configured adapter.** Install and pin `@ai-sdk/openai@2.0.0`, keeping `ai@5.0.0`. Require `CAMPAIGN_TEXT_MODEL` and `CAMPAIGN_IMAGE_MODEL`; production has no implicit model default. The adapter uses the Vercel AI SDK's currently verified structured-output and image APIs and returns content bytes/hash/metadata through the port.
- [ ] **Step 4: Implement the planner.** Build three directions from pinned evidence and hard constraints, then generate per-placement images and channel copy. Every fact/offer/claim contains a source reference; missing evidence becomes `needs_data`, not creative invention.
- [ ] **Step 5: Implement typed prompt patches.** A prompt produces operations against allowlisted manifest paths. Apply to a copy, revalidate the whole manifest, create a new version, and show a diff. Never mutate an approved version or execute a prompt as a tool command.
- [ ] **Step 6: Add bounded evaluation/repair.** At most one repair pass per failed artifact; then fail with safe validation reason. Record evaluation hooks for truth, hard constraints, novelty, hashtags, accessibility, and platform contract.
- [ ] **Step 7: Run AI/domain tests, typecheck, lint, dependency audit; commit.** `git commit -m "feat(campaigns): generate governed creative bundles"`.

### Task 11: Make generation and revision durable with Trigger.dev

**Files:**

- Create: `src/workflows/campaigns/{contracts,generate-bundle,revise-bundle}.ts` and tests
- Create: `src/trigger/campaigns.ts` and tests
- Modify: `src/lib/supabase/service.ts`, `trigger.config.ts`

- [ ] **Step 1: Write RED workflow tests.** Invalid UUID/version fails before service client construction; duplicate business keys replay; stale version loses its lease; cancellation fences before each model/image call; partial asset generation never publishes a version; cost/attempt ceiling stops work; cross-tenant context is rejected.
- [ ] **Step 2: Add `campaign.generate-bundle` and `campaign.revise-bundle` `schemaTask`s.** Task input contains IDs, expected source/version, correlation ID, and persisted run key—never the prompt, provider secret, or full business context.
- [ ] **Step 3: Add worker-only campaign client/repository.** Use atomic claim/complete/fail RPCs and private temporary assets; publish the immutable version only after all validations and final storage moves succeed.
- [ ] **Step 4: Propagate safe observability.** Carry organization/campaign/version/run/worker/correlation identifiers, normalized failure stage, model cost, and asset count.
- [ ] **Step 5: Run workflow/Trigger tests plus generation tests; commit.** `git commit -m "feat(campaigns): run durable creative workflows"`.

### Task 12: Build Campaign Studio and activate the organization destination

**Files:**

- Create: `src/app/(platform)/organizations/[organizationId]/campaigns/{page,loading,error}.tsx`
- Create: `src/app/(platform)/organizations/[organizationId]/campaigns/[campaignId]/{page,loading,error}.tsx`
- Create: `src/components/campaigns/{campaign-list,campaign-studio,bundle-header,direction-board,asset-card,copy-editor,hashtag-editor,schedule-editor,generation-profile-selector,measurement-card,approval-panel,version-diff,timeline,query-options}.tsx`
- Create focused component tests
- Modify: `src/components/layout/sidebar.tsx`

- [ ] **Step 1: Apply the selected Superdesign system.** Use the user-delegated selected direction and the implemented read models/contracts for desktop and mobile campaign entry, three-direction comparison, focused editing, prompt revision, diff review, capability blockers, measurement, attestation, approval, execution, and proof. Keep the canvas and interaction notes linked from the task report.

**Mandatory UI design checkpoint:** Do not write or dispatch TSX, CSS, component tests, or route-page UI work until the Superdesign alternatives exist and one direction has been selected and recorded. The user's 2026-08-12 instruction delegates that selection to the implementation agent.

- [ ] **Step 2: Write UI RED tests after approval.** Manual/opportunity entry, three direction labels, profile switch warning, editable hooks/captions/hashtags/tags/CTA/timing/schedule, prompt target scope, version diff, blocked-capability reasons, spend/measurement summary, visual attestation, role-disabled approval, stale version refresh, and dry-run labeling.
- [ ] **Step 3: Add Server Component initial reads and organization-scoped Query keys.** Interactive mutations are non-optimistic; invalidate only the campaign/list/version keys touched after the server confirms a new version.
- [ ] **Step 4: Compose installed shadcn primitives.** Add missing primitives through the repository's shadcn workflow. Preserve keyboard navigation, focus return, semantic status copy, reduced motion, 200% zoom, image alt-text editing, and mobile review.
- [ ] **Step 5: Enable Campaigns only in organization navigation.** Remove `Soon` only for `/organizations/:organizationId/campaigns`; do not create a misleading global campaign route.
- [ ] **Step 6: Verify component tests, authenticated browser flow, responsive/accessibility checks, typecheck, lint; commit.** `git commit -m "feat(campaigns): add governed campaign studio"`.

**Gate 2 checkpoint:** Demonstrate both entry paths, all three directions, all generation profiles, hashtags, prompt-to-new-version diff, and mandatory attestation with deterministic providers. No provider side effect is permitted yet.

### Task 13: Implement the deterministic Tool Gateway and execution ledger

**Files:**

- Create: `src/domain/tools/{schemas,types,policy,idempotency}.ts` and tests
- Create: `src/modules/tool-gateway/application/{ports,service}.ts` and tests
- Create: `src/modules/tool-gateway/infrastructure/repository.ts` and tests
- Create: `supabase/migrations/20260812140000_campaign_tool_gateway.sql`
- Create: `supabase/tests/database/campaign_tool_gateway_test.sql`

- [ ] **Step 1: Write RED preflight tests.** Re-evaluate membership/role, exact active approval/version/digest, expiry, visual attestation, schedule window, action inclusion, current policy versions, current capability grant/version/restrictions, credential/account mapping, provider-contract version, privacy/tracking assertions, execution mode, spend currency/ceiling, cancellation, and previous unknown outcome.
- [ ] **Step 2: Add append-only control records.** Create `campaign_action_runs`, `tool_invocations`, `provider_receipts`, `campaign_budget_reservations`, and a private operation ledger. Browser roles read safe projections only; workers mutate through security-definer RPCs.
- [ ] **Step 3: Implement one atomic claim RPC.** Lock campaign/action/approval/grant/policy/budget rows, return stable reason codes for a failed assertion, reserve paid spend before returning `claimed`, replay completed keys, and return `provider_outcome_unknown` until reconciliation clears ambiguity.
- [ ] **Step 4: Implement completion/failure/unknown/reconciliation RPCs.** A stale claim token cannot write. Actual provider spend updates the reservation ledger without erasing approved/reserved values. Provider receipts store bounded normalized fields and a digest, not raw payloads.
- [ ] **Step 5: Implement the application Tool Gateway.** It accepts only a registered tool key and parsed action. Adapter selection occurs after a successful claim; no campaign worker imports provider `fetch` code directly.
- [ ] **Step 6: Test concurrent reservation, idempotent replay, direct RPC misuse, unknown outcome, cancellation fence, cross-tenant attack, and audit redaction; run pgTAP; commit.** `git commit -m "feat(execution): gate campaign side effects atomically"`.

### Task 14: Add Telegram-native operator linking, review, and approval

**Files:**

- Create: `supabase/migrations/20260812150000_telegram_operator_review.sql`
- Create: `supabase/tests/database/telegram_operator_review_test.sql`
- Create: `src/modules/integrations/providers/telegram-operator-review/{definition,adapter,webhook-verifier}.ts` and tests
- Create: `src/modules/campaigns/application/telegram-review-service.ts` and tests
- Create: `src/app/api/organizations/[organizationId]/campaigns/telegram/link/route.ts`
- Create: `src/app/api/integrations/telegram/webhook/route.ts`
- Create: `src/app/api/integrations/telegram/mini-app/session/route.ts`
- Create: `src/app/(telegram)/campaign-review/page.tsx` and review components/tests
- Modify: `src/lib/env.ts`, `.env.example`

- [ ] **Step 1: Write identity/security RED tests.** One-time link nonce, expiry/replay, Telegram webhook secret, signed Mini App init-data validation, auth-date window, linked identity, organization binding, revoked link, current platform membership/role, review-session expiry, campaign/version/digest binding, and safe rejection without leaking membership.
- [ ] **Step 2: Persist operator-review state and configuration.** Add server-only `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, and `TELEGRAM_MINI_APP_URL`. Add `telegram_operator_links`, `telegram_link_sessions`, and `campaign_review_sessions`. Store Telegram user/chat IDs only as required operator identifiers; never store raw signed init data. Revoke links and grants immediately on unlink/membership loss.
- [ ] **Step 3: Implement media-rich notification and Mini App.** Notification contains safe campaign summary and preview media; complete assets, captions, hashtags, hooks, CTA, timing, schedule, spend, blockers, measurement, profile, diff, attestation, prompt revision, and approval live in the Mini App.
- [ ] **Step 4: Reuse the campaign service.** Telegram prompt revision calls the same revision API/service and creates the same immutable version. Approval calls the same attestation/approval RPC after a fresh live authorization check.
- [ ] **Step 5: Register Telegram solely as `operator_review`.** A successful link upserts the organization's Telegram operator-review connection; its grant is available only while the bot contract/configuration is healthy and at least one linked platform user still has a current approving role. It has no campaign audience/channel action, customer recipient, or outbound marketing capability.
- [ ] **Step 6: Verify pgTAP, webhook/identity tests, Studio/Telegram shared-version test, browser Mini App flow; commit.** `git commit -m "feat(campaigns): add Telegram operator review"`.

**Gate 3 checkpoint:** From a connected operator chat, reject invalid/expired/unlinked/revoked sessions, revise into a new shared version, attest, and approve the exact digest. Tool Gateway dry-run must accept only that version.

### Task 15: Implement the Meta organic adapter and inbound reconciliation

**Files:**

- Create: `src/modules/integrations/providers/meta/{definition,client,organic-adapter,webhook-verifier,reconciler}.ts` and tests
- Create: `src/app/api/integrations/meta/webhook/route.ts` and tests
- Create: `supabase/migrations/20260812160000_integration_webhook_receipts.sql`
- Create: `supabase/tests/database/integration_webhook_receipts_test.sql`

- [ ] **Step 1: Write MSW contract tests from Task 1 fixtures.** Cover Instagram/Facebook image posts and supported image Stories, account eligibility, scope loss, media processing, rate limits, permanent errors, timeout before/after send, idempotency semantics, normalized external IDs/permalinks/status, and reconciliation lookup.
- [ ] **Step 2: Implement a bounded client and organic adapter.** All requests use the credential handle resolved inside the adapter, verified account mapping, pinned provider contract, timeouts, bounded response schemas, and safe normalized errors. No raw provider response crosses the adapter boundary.
- [ ] **Step 3: Add generic inbound webhook receipts.** Verify signature before parsing business fields, enforce replay TTL/digest uniqueness, allowlist event types, map provider account to exactly one organization/connection, persist ordering metadata, and dispatch reconciliation. Unknown account/event is quarantined without tenant data disclosure.
- [ ] **Step 4: Implement reconciliation-before-retry.** A timeout after request marks the invocation unknown. Lookup by captured provider/idempotency/reference evidence either completes it, proves absence and releases retry, or keeps it unknown for operator action.
- [ ] **Step 5: Verify controlled-account sandbox evidence.** Publish and reconcile one private/test-account post and each supported Story placement. Store redacted timestamps, external safe IDs, screenshots, capability/scopes, and cleanup result in `docs/verification/campaigns/meta-organic-sandbox.md`.
- [ ] **Step 6: Run tests/pgTAP/typecheck/lint; commit.** `git commit -m "feat(integrations): add governed Meta organic adapter"`.

### Task 16: Schedule and execute approved organic actions

**Files:**

- Create: `src/workflows/campaigns/{schedule-actions,execute-organic,reconcile-action}.ts` and tests
- Modify: `src/trigger/campaigns.ts` and tests
- Create: campaign execution-status API/read-model/UI components and tests

- [ ] **Step 1: Write RED workflow tests.** Schedule in organization timezone/UTC persistence, early/late dispatch window, approval expiry, capability loss, optional blocked action in both execution modes, cancellation, duplicate trigger, unknown provider outcome, partial success, and no public delete rollback without separate approval.
- [ ] **Step 2: Persist schedules before Trigger dispatch.** Trigger runs are recoverable from Postgres; a sweeper finds due unqueued actions. Each worker calls Tool Gateway, then only the returned registered organic tool.
- [ ] **Step 3: Update status from gateway/receipt truth.** Show `blocked`, `scheduled`, `claimed`, `provider_pending`, `provider_outcome_unknown`, `published`, `failed`, or `cancelled` with safe operator recovery; never infer success from task completion.
- [ ] **Step 4: Add provider receipt/exposure handoff.** A confirmed publication creates the initial exposure record with provider timestamps and later metric-fetch eligibility.
- [ ] **Step 5: Verify workflows/UI plus a controlled-account scheduled run; commit.** `git commit -m "feat(campaigns): execute approved organic actions"`.

**Gate 4 checkpoint:** Security review signed, contract current, capability grants usable, controlled-account static post/Story actually published, ambiguous outcomes reconciled, and receipt visible in the same bundle. Enable organic per organization only after this checkpoint.

### Task 17: Add one capped Meta Ads experiment

**Files:**

- Create: `src/modules/integrations/providers/meta/ads-adapter.ts` and tests
- Create: `src/workflows/campaigns/{execute-meta-ad,monitor-meta-ad,stop-meta-ad,reconcile-meta-spend}.ts` and tests
- Modify: `src/trigger/campaigns.ts`, provider definition/contracts, campaign read model/UI

- [ ] **Step 1: Write RED budget/adapter tests.** Currency/account mismatch, minimum/maximum provider budget, approved audience/placement only, creative/version mismatch, partial provider object creation, idempotent resume, provider overspend tolerance, local/provider stop, guardrail breach, account spend cap, scope loss, and no automatic increase.
- [ ] **Step 2: Implement one registered paid tool.** `meta.ads.run_bounded_experiment` creates/resumes the verified provider object graph from one approved action. Persist every provider external ID step before the next call so retry cannot duplicate campaign/ad set/creative/ad objects.
- [ ] **Step 3: Enforce spend twice.** Tool Gateway transactionally reserves the full ceiling; the adapter applies the verified provider ceiling/stopping controls. Monitoring compares approved, reserved, provider-reported, and settled spend in one currency and stops on the earliest configured boundary.
- [ ] **Step 4: Treat stop as deterministic containment.** Guardrail/ceiling stop is pre-authorized inside the approval envelope; expansion or restart requires a new bundle version and approval. Public deletion remains excluded.
- [ ] **Step 5: Verify a controlled-account minimal capped experiment.** Record redacted object IDs, configured ceiling, observed spend, stop result, and reconciliation in `docs/verification/campaigns/meta-ads-sandbox.md`.
- [ ] **Step 6: Run focused tests and commit.** `git commit -m "feat(campaigns): run capped Meta Ads experiments"`.

**Gate 5 checkpoint:** Concurrent claims cannot exceed the envelope, actual spend reconciles against reservations, stop conditions work, and no code path can expand budget/audience/placement without a new approval.

### Task 18: Close the loop with exposures and evidence-qualified outcomes

**Files:**

- Create: `src/domain/outcomes/campaign-outcome.ts` and tests
- Create: `src/modules/campaigns/application/outcome-service.ts` and tests
- Create: `src/workflows/campaigns/{collect-metrics,settle-outcome}.ts` and tests
- Modify: `src/trigger/campaigns.ts`
- Create: `supabase/migrations/20260812170000_campaign_measurement.sql`
- Create: `supabase/tests/database/campaign_measurement_test.sql`
- Create outcome UI components/tests

- [ ] **Step 1: Write RED measurement tests.** Immutable preregistration before first exposure, exact metric definitions/dimensions, baseline/window/timezone, settlement delay, provider receipt-to-exposure join, missing/late/restated metrics, guardrail breach, attribution-method eligibility, observational limitation, and no causal wording for insufficient evidence.
- [ ] **Step 2: Add `campaign_exposures`, `campaign_metric_observations`, and `campaign_outcomes`.** Link normalized metrics by revision IDs and provider metrics by verified receipts; preserve planned versus realized exposure/spend and all missingness.
- [ ] **Step 3: Implement deterministic verdicts.** Only return `validated`, `inconclusive`, `guardrail_breach`, or `execution_only`. `validated` requires the predeclared attribution method's evidence threshold; engagement alone cannot prove incremental gross profit/customer acquisition.
- [ ] **Step 4: Schedule collection/settlement durably.** Fetch permitted Meta metrics through read capabilities, wait the registered window/settlement period, recompute safely after append-only metric revisions, and never let an LLM calculate or choose the verdict.
- [ ] **Step 5: Render business proof.** Show hypothesis, exposure, baseline, measured window, estimate/range, spend, guardrails, evidence tier/method, missing data, limitations, and why the verdict has its label. A model may draft wording only from the computed result and must pass a no-overclaim validator.
- [ ] **Step 6: Run tests/pgTAP/typecheck/lint; commit.** `git commit -m "feat(campaigns): measure evidence-qualified outcomes"`.

### Task 19: Add campaign-scoped learning and separately governed promotion

**Files:**

- Create: `src/modules/campaigns/application/learning-service.ts` and tests
- Create: `src/workflows/campaigns/propose-learning.ts` and tests
- Create: `supabase/migrations/20260812180000_campaign_learning_proposals.sql`
- Create: `supabase/tests/database/campaign_learning_test.sql`
- Create learning proposal API/UI and tests

- [ ] **Step 1: Write RED governance tests.** Learning references exact bundle/version/action/exposure/outcome; is organization/campaign-scoped; distinguishes observed result from hypothesis; cannot modify active brand policy/playbook/recipe; cross-tenant evidence fails; inconclusive result cannot become a winning rule.
- [ ] **Step 2: Add append-only `campaign_learning_proposals`.** Store structured observation, limitation, suggested next test, evidence links, target artifact type, and status. Promotion creates a separate governed artifact proposal under ADR 0013; it never mutates the source campaign.
- [ ] **Step 3: Generate constrained summaries.** The model may draft a proposed lesson only from the settled outcome and evidence; deterministic validation checks verdict consistency and prohibited generalization.
- [ ] **Step 4: Add Studio review.** Operators may dismiss, keep campaign-only, or submit a separate reusable-recipe proposal. Do not add auto-promotion.
- [ ] **Step 5: Verify and commit.** Run learning/campaign/memory integration tests and `git commit -m "feat(campaigns): propose governed campaign learning"`.

### Task 20: Complete cross-surface verification and production rollout

**Files:**

- Create: `e2e/campaign-studio.spec.ts`
- Create: `e2e/campaign-telegram-review.spec.ts`
- Create: `e2e/campaign-execution.spec.ts`
- Create: `docs/runbooks/campaign-operations.md`
- Create: `docs/verification/campaigns/production-readiness.md`
- Modify relevant context/spec status, `README.md`, and `progress-tracker.md`

- [ ] **Step 1: Write the reference E2E story.** Prove both sources converge; three directions and hashtags exist; profile switch plus prompt creates a diff/new digest; invalid Telegram identities fail; attestation/approval bind exact version; later edit invalidates approval; organic publishes/reconciles; paid cannot exceed ceiling; optional blocked action obeys execution mode; receipts/exposures settle; final verdict and learning are truthful.
- [ ] **Step 2: Add adversarial E2E/security cases.** Cross-tenant route/body/storage IDs, stale tabs, revoked membership/credential/capability after approval, replayed webhooks/callbacks, tampered Mini App data, duplicate scheduling, timeout-after-send, concurrent budget claims, prompt injection, and asset URL expiry.
- [ ] **Step 3: Run the full quality gate.** Run:

  ```bash
  PATH=/home/spy/.local/node/bin:$PATH pnpm format:check
  PATH=/home/spy/.local/node/bin:$PATH pnpm lint
  PATH=/home/spy/.local/node/bin:$PATH pnpm typecheck
  PATH=/home/spy/.local/node/bin:$PATH pnpm test
  PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:list
  PATH=/home/spy/.local/node/bin:$PATH pnpm db:migrations:dry-run
  PATH=/home/spy/.local/node/bin:$PATH pnpm db:test
  PATH=/home/spy/.local/node/bin:$PATH pnpm build
  PATH=/home/spy/.local/node/bin:$PATH pnpm test:e2e
  git diff --check
  ```

  Expected: all commands pass against the intended staging/provider test environments; no migration is pending unexpectedly; the E2E suite records real provider evidence only under explicit sandbox credentials.

- [ ] **Step 4: Complete operational readiness.** Document capability enable/disable, credential rotation/revoke, approval expiry, unknown-outcome reconciliation, budget discrepancy containment, campaign cancellation, webhook outage/backfill, provider-contract expiry, observability/alerts, incident response, and a recoverable feature-flag rollback.
- [ ] **Step 5: Run an independent review/fix/re-test loop.** Review tenant isolation, authorization, AI truth, provider duplication, spend containment, audit redaction, and measurement claims. Fix every critical/high finding and rerun the affected focused suite plus the full gate.
- [ ] **Step 6: Obtain Gate 6 approval before allowlisting the first production organization.** Provider capability grants are enabled individually; Telegram remains operator-review only. Capture the approver, time, contract versions, sandbox evidence, and remaining lower-severity risks.

**Gate 6 checkpoint:** The reference campaign passes the complete business-proof loop, all production-readiness evidence is current, and no critical/high tenant, authorization, privacy, provider-duplication, money-movement, or truthfulness issue remains.

- [ ] **Step 7: Commit the verified release train.** `git commit -m "feat(campaigns): complete governed campaign proof loop"`.

## Final Plan Self-Review Checklist

- [ ] Every approved first-slice item maps to at least one task and E2E assertion.
- [ ] Customer messaging, video/Reels, comments/DMs, non-Meta paid media, automatic budget expansion, and automatic learning promotion remain absent.
- [ ] Decision proposal, approval, deterministic execution, provider truth, and outcome evidence are separate records and services.
- [ ] Every material edit and generation-profile change invalidates the old approval.
- [ ] Every provider action has a current verified contract, organization capability, restriction state, idempotency strategy, and ambiguous-outcome reconciliation path.
- [ ] No task uses a service-role client in a user-facing request path or treats Trigger.dev as authoritative state.
- [ ] No placeholder model/provider permission or fabricated field is required for a task to pass.
- [ ] The production flag cannot open before real credential, sandbox, budget, measurement, tenant, and security evidence pass.
