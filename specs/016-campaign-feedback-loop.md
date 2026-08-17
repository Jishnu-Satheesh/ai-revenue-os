# Feature Specification: Campaign Feedback Loop

## Status

Draft. Supersedes the scope of release-train tasks 14–20 in `docs/superpowers/plans/2026-08-11-unified-campaign-bundle-release-train-implementation.md`.

Depends on ADRs 0015, 0016, 0017, 0019, 0020, and 0021, and on `specs/012-channel-economics-ledger.md` and `specs/015-metric-registry-and-normalized-metrics.md`.

## Business outcome

Close the campaign loop: an approved campaign publishes to a real provider, its results return into the metric warehouse at a grain the platform can reason about, waste is contained within two days, and value is either proven under a preregistered method or honestly reported as unproven.

Today the platform can propose, generate, govern, and approve a campaign. It cannot act, observe, or learn. Every claim about incremental gross profit is currently unbacked by construction, because no result has ever returned. This feature is what makes the platform's central promise measurable rather than aspirational.

Two outcomes are separable and both count:

- **Contained waste**, provable by arithmetic within days.
- **Validated incremental contribution**, provable only under the registered method and window, and legitimately often `inconclusive` at pilot scale.

## User stories

- As an agency operator, I approve one campaign envelope and the platform tests many creative variants inside it, so I get testing volume without approving every image.
- As an agency operator, I see which variants the platform paused, why, and on what evidence, so an autonomous action is never a surprise.
- As an agency operator, I resume a paused variant myself when I disagree, because the platform may stop spend but may not restart it.
- As an agency operator, I read a campaign result that states its method, window, evidence quality, and limitations, so I can repeat the honest claim to my client.
- As a client owner, I connect my own Meta account to my organization and can revoke it, so my advertising authority is mine and is visibly bounded.
- As an agency operator, I see a settled campaign propose a lesson that stays attached to that campaign until I separately decide it is reusable.

## Scope

### In scope

- `schemaVersion: 2` bundle manifest with a `generationPolicy`, and forward repair of pre-production V1 data.
- Creative Variants: generation under an approved policy, derivation validation, immutable persistence, and lineage.
- Shared Meta provider substrate: client credential binding, account mapping, bounded HTTP client, webhook intake, reconciliation before retry.
- Meta organic publishing adapter (feed image, image story) as an independently gated capability.
- Meta Ads bounded-experiment adapter and a pause adapter as independently gated capabilities.
- A dispatch worker and sweeper that execute due, approved action runs through the Tool Gateway.
- Metrics-read ingestion from Meta into `normalized_metrics` at campaign, action, and variant grain.
- The allocation loop: deterministic, pause-only, margin-aware, per-organization cadence.
- The evidence loop: exposures, observations, settlement, deterministic verdicts, rendered proof.
- Campaign-scoped learning proposals and their separately governed promotion path.
- Entropy sources as governed data sources feeding Business Memory with sub-verified trust rank.

### Out of scope

- Telegram operator review. It is a review surface, not a loop component, and is deferred to its own train.
- Autonomous resume, budget increase, ceiling change, audience change, or creative creation outside an approved policy.
- Video, Reels, comments, DMs, and customer messaging.
- Non-Meta paid media.
- Automatic promotion of a learning proposal into Business Memory, brand guidance, or a playbook.
- Cross-campaign or cross-tenant inference of any kind.
- Public deletion of a published post as a rollback mechanism.

## UX flow

1. **Approve an envelope.** The Studio approval screen shows the policy in plain terms: how many variants per direction, until when, within which offer, claims, audience, placement, and ceiling. The operator attests and approves one exact version and digest, as today.
2. **Watch the fleet.** A variant grid shows each variant's creative, state (`draft`, `scheduled`, `published`, `paused_by_agent`, `paused_by_operator`, `failed`, `provider_outcome_unknown`), realized spend, and diagnostics.
3. **Read a pause.** A paused variant shows the rule that fired, the observed value, the threshold, the resolved contribution margin where used, and the time. Resume is a visible operator action, disabled for viewers.
4. **Read the result.** The outcome panel shows hypothesis, planned versus realized exposure, baseline, window, estimate and range, spend, guardrails, evidence tier and method, missing data, limitations, and why the verdict carries its label.
5. **Decide on a lesson.** A settled campaign may propose a lesson. The operator dismisses it, keeps it campaign-only, or submits it as a separate reusable-recipe proposal.

Blocked, unknown, and inconclusive states are always rendered with their stable reason code, a plain-language explanation, and a recovery action. Nothing blocked is ever styled as ready.

## Domain rules

### Generation policy

- The policy lives inside the manifest and therefore inside the digest and the approval binding.
- It declares: `maxVariantsPerDirection`, `maxVariantsTotal`, `policyExpiresAt`, the locked offer reference, the locked assertion keys, and the locked audience, channel, placement, schedule window, and total spend ceiling.
- `policyExpiresAt` may not exceed the approval expiry, and no variant may be generated or dispatched after it.
- Any policy field change is material under ADR 0017.

### Creative variants

- A variant belongs to exactly one approved bundle version and one creative direction.
- A variant may set only: asset, hook, caption, hashtags, call to action.
- A variant must pass `evaluateGeneratedBundle`'s existing checks plus a derivation check asserting that no locked policy field is altered and that every claim traces to the campaign's pinned source snapshot.
- Variant caps are enforced by database constraint. A generation request exceeding a cap is refused with a stable code, never truncated silently.
- One variant produces one `campaign_action_run`. Budget reservation splits within the parent action's ceiling and can never exceed it.

### Allocation loop

- Runs on a per-organization schedule, evaluates each live campaign independently, and performs no cross-campaign comparison.
- Evaluates only after a variant has met a minimum exposure floor, so a stop is never made on noise.
- Rules are deterministic, versioned, and recorded on every decision. Two rule families exist: diagnostic thresholds, and contribution-margin floors resolved through the Channel Economics Ledger where the margin grade is sufficient.
- The only action is pause, routed through the Tool Gateway as its own action run.
- Every cycle appends a ledger row per evaluated variant, including "no action" with its reason.
- Resume requires an approving role and is recorded as an operator action.
- Pausing does not change campaign state.

### Evidence loop

- The measurement plan is preregistered before first exposure and is immutable thereafter.
- Realized exposure is reconstructed from provider receipts and allocation history, and is stored separately from planned exposure.
- Verdicts are exactly `validated_outcome`, `inconclusive`, `guardrail_breach`, `execution_only`, and are computed deterministically.
- Engagement diagnostics may never produce `validated_outcome` unless the registered plan gave them a separately valid role.
- No model chooses a verdict, method, stopping rule, or economic calculation. A model may draft wording from the computed result and must pass a no-overclaim validator.

### Learning

- A proposal references exact bundle version, policy version, variants, exposures, and outcome.
- An `inconclusive` outcome may not produce a winning rule.
- Promotion is a separate governed decision under ADR 0013 and never mutates the source campaign.

## Data model

New tenant-owned tables, all with forced RLS, composite tenant foreign keys, append-only triggers where stated, explicit grants, audit, and indexes.

- `campaign_creative_variants` — immutable. Version, direction, asset, hook, caption, hashtags, CTA, content hash, derivation check result, provenance, policy version, state, created-by.
- `campaign_allocation_events` — append-only. Cycle id, variant, rule key and version, observed value, threshold, resolved margin and grade, action, reason code, actor (`agent` or user id).
- `campaign_exposures` — planned and realized exposure per variant, provider timestamps, receipt linkage, truncation cause.
- `campaign_metric_observations` — links a variant or action to `normalized_metrics` revisions, preserving missingness and restatement.
- `campaign_outcomes` — one settled verdict per campaign, with method, window, estimate and range, evidence tier, guardrail state, limitations.
- `campaign_learning_proposals` — append-only. Observation, limitation, suggested next test, evidence links, target artifact type, status.

Changed:

- `campaign_bundle_versions.manifest` — `schemaVersion: 2`, adds `generationPolicy`. New generated columns and constraints for policy caps and expiry.
- `subject_kinds` — adds `campaign`, `campaign_action`, `creative_variant` so provider performance can land at a grain the agent can reason about.

Money is integer minor units with an ISO currency code throughout. Timestamps are UTC and rendered in the organization's timezone.

## API and events

Routes, all organization-scoped and role-checked:

- `POST /campaigns/:campaignId/variants` — generate variants under the approved policy.
- `GET /campaigns/:campaignId/variants` — fleet read.
- `POST /campaigns/:campaignId/variants/:variantId/resume` — operator-only resume.
- `GET /campaigns/:campaignId/allocation` — allocation ledger.
- `GET /campaigns/:campaignId/outcome` — settled result and proof.
- `POST /campaigns/:campaignId/learning/:proposalId/decision` — dismiss, keep local, or submit for promotion.

Workflows: `campaign.generate-variants`, `campaign.dispatch-due-actions`, `campaign.collect-metrics`, `campaign.allocation-cycle`, `campaign.settle-outcome`, `campaign.propose-learning`.

Tool keys: `meta.organic.publish_image`, `meta.organic.publish_story`, `meta.ads.run_bounded_experiment`, `meta.ads.pause_ad`.

Events, past tense, identifier-only payloads: `campaign.variant_generated`, `campaign.variant_published`, `campaign.variant_paused`, `campaign.variant_resumed`, `campaign.allocation_cycle_completed`, `campaign.exposure_recorded`, `campaign.outcome_settled`, `campaign.learning_proposed`.

## AI behavior

- A model generates variant imagery and copy inside an approved policy and receives no credential and no side-effect tool.
- A model may draft outcome wording and a proposed lesson from a computed result.
- A model may not choose a pause, a verdict, an attribution method, a stopping rule, or any economic calculation.
- Every model output crosses the boundary as `unknown` and is parsed with Zod before use. Unknown fields fail.
- One bounded repair pass per failed artifact, then a safe validation failure.

## Security and tenancy

- The Meta account is owned by the client and bound to their organization through the existing OAuth session substrate. Credentials remain behind the server-only `CredentialStore` as Vault references. Revocation is immediate and disables only the affected capability grants.
- Organic publishing, paid advertising, pause, and metrics read are four independent capability grants. Each requires an installed adapter, a non-expired checked-in contract, current credentials with exact scopes, verified account eligibility, organization mapping, current policy, and controlled-account evidence.
- No service role in any user-facing request path. Workers write through security-definer RPCs with `search_path = ''` and explicit organization checks.
- Webhook intake verifies signature before parsing business fields, enforces replay TTL and digest uniqueness, allowlists event types, and maps a provider account to exactly one organization. Unknown account or event is quarantined without tenant disclosure.
- Provider receipts store bounded normalized fields and a digest, never raw payloads. No secret, token, or customer PII is logged.

## Observability

Structured logs and spans carry `organizationId`, `campaignId`, `bundleVersionId`, `variantId`, `runId`, `workerId`, and `correlationId`.

Tracked: dispatch latency and failure stage, provider error class, unknown-outcome count and age, reconciliation results, allocation cycle duration and decisions per outcome, metric ingestion freshness and gap count, settlement lateness, model cost and token use by generation kind.

Alerts: any unknown outcome older than its reconciliation window, a reservation-versus-settled spend divergence beyond tolerance, an allocation cycle that skipped, metric staleness beyond the registered reporting delay, and provider-contract expiry approaching.

## Failure states

- **Capability lost after approval** — dispatch refuses with a stable code; the action run is blocked, not failed.
- **Timeout after send** — `provider_outcome_unknown`; reconciled by verified lookup before any retry.
- **Pause outcome unknown** — treated with the same severity as a publish, because unresolved means spend may still be live; alerted immediately.
- **Metrics missing or late** — recorded as missingness, never imputed; may push the outcome to `inconclusive`.
- **Metrics restated by the provider** — append-only revision, safe recomputation, and a visible note on any already-rendered result.
- **Policy expired mid-flight** — no further variants or dispatches; already-published variants continue to be measured.
- **Margin grade insufficient** — the margin rule does not fire; diagnostic rules still may.
- **Evidence bar unmet** — `inconclusive`, with method and limitations shown. Never presented as success.

## Acceptance criteria

- An approved V2 envelope produces N variants per direction, each passing derivation validation, with caps enforced by the database.
- A variant reaching its schedule publishes through the Tool Gateway and produces a provider receipt and an initial exposure record.
- A capped Meta Ads experiment cannot exceed its approved ceiling under concurrent claims.
- Provider metrics land in `normalized_metrics` at variant grain with correct quality tier, period grain, and timezone.
- An allocation cycle pauses a variant that breaches a deterministic threshold, records the full reason, and does not change campaign state.
- The agent cannot resume, and an operator resume is recorded with actor and time.
- A settled campaign returns exactly one deterministic verdict with method, window, evidence tier, and limitations, and `inconclusive` renders without causal wording.
- Realized exposure reflects allocation history rather than the plan.
- A learning proposal references exact evidence, cannot be auto-promoted, and cannot turn an `inconclusive` result into a winning rule.
- Tenant isolation holds across every new table, route, storage path, and worker RPC.

## Test plan

- **Domain unit tests** — policy validation, derivation checks, cap enforcement, deterministic allocation rules across boundary values, verdict computation across every evidence combination, no-overclaim validator.
- **Adversarial generation fixtures** — invented offer, invented metric, unsourced claim, cross-tenant asset, policy field mutation, prompt injection in operator text and in ingested entropy content.
- **Provider contract tests** — MSW against checked-in Meta fixtures for publish, pause, insights, rate limit, permanent error, timeout before and after send, and reconciliation lookup.
- **Concurrency** — simultaneous budget claims across variants, duplicate dispatch, replayed webhook, stale claim token, expired lease.
- **Tenant isolation** — two-organization pgTAP on every new table and RPC; cross-tenant identifiers in route, body, and storage paths rejected; viewer roles refused on resume, approve, and generate.
- **Staging integration** — pgTAP suites against the hosted staging project, understood as integration checks rather than a hermetic layer.
- **Controlled-account evidence** — one organic post, one story, one capped paid experiment, and one pause, each published, observed, and reconciled, recorded redacted under `docs/verification/campaigns/`.
- **Browser verification** — Chrome DevTools MCP at both widths for the variant grid, pause explanation, resume, and outcome panel.
- **End-to-end** — one campaign from approval through variant fleet, publication, ingestion, a pause, settlement, verdict, and a learning proposal.

## Migration and rollback

Forward, in order, each migration applied to staging only after reading current schema:

1. `subject_kinds` additions.
2. Manifest V2: `generationPolicy`, constraints, and generated columns.
3. Variant, allocation, exposure, observation, outcome, and learning tables with RLS and RPCs.

**V1 data repair.** Staging holds one bundle version at `schemaVersion: 1`, one approval, three channel actions, three assets, one measurement plan, and zero action runs and receipts. Because nothing has executed, the V1 chain is deleted and regenerated through the V2 path rather than backfilled. Regeneration exercises the new path end to end; a backfill would verify nothing. This is only defensible while no execution history exists, and the ADR records that condition.

**plpgsql caution.** Every new function that reads a table it did not create is called once against staging before it is considered done, because plpgsql resolves record fields at execution time.

**Rollback.** Each capability is an independent grant and can be disabled without touching the others. Disabling the allocation loop's schedule stops autonomy immediately and leaves published campaigns measurable. New tables are additive; no existing table loses a column. The manifest V2 change is not reversible without discarding V2 versions, which is acceptable pre-production and must not be assumed after the first production organization is allowlisted.

## Documentation updates

- `context/05-module-map.md` — Campaign Bundles gains variants, allocation, and measurement; Capability and Tool Registry gains the pause and metrics-read capabilities.
- `context/10-events-and-workflows.md` — the six new workflows and eight new events.
- `context/21-learning-system.md` — campaign learning proposals and the promotion gate.
- `MANIFEST.md` — this spec and ADRs 0020 and 0021.
- `progress-tracker.md` — current state, which is stale as of this spec.
- `docs/superpowers/plans/` — a new implementation plan replacing tasks 14–20.
