# Feature Specification: Shared Business Memory for organizational intelligence

## Status

**Draft — architecture and implementation approval pending.** Automatic capture with distinct trust levels is the confirmed product direction. This document defines the proposed implementation, not authority to execute it.

This is a Tier 3 extension to Spec 004. It connects existing modules and adds durable storage and worker boundaries, so a separate spec and ADR are warranted. [ADR 0054](../adrs/0054-business-memory-shared-context-and-governed-capture.md) is Proposed. [Research and repository evidence](../docs/research/2026-09-10-business-memory-shared-intelligence.md), [execution plan](../docs/superpowers/plans/2026-09-10-business-memory-shared-intelligence.md), and [handoff](../docs/superpowers/prompts/2026-09-10-business-memory-shared-intelligence-handoff.md) travel with this specification.

Baseline inspected: HEAD `e8c1d6d`, hosted staging 2026-09-10. Existing specs and accepted ADRs continue governing until this proposal is approved. Section 17 identifies exactly which clauses the approved extension must amend.

## 1. Business outcome

Every connected AI feature receives relevant current organizational context and contributes durable, source-linked observations about what was generated, decided and measured. The business does not need to repeat its plans across disconnected features. Operators can inspect where context came from and why later advice changed.

Success is fewer redundant or conflicting recommendations, correct handling of changed circumstances, and auditable context use. More stored text is not success. No claim of incremental profit is made without the existing measurement contract.

## 2. User stories

- An operator plans an action in Channel Audit; Growth Intelligence can recognize that intent and explain how a new recommendation relates to it.
- A Campaign has an upcoming approved version; Channel Audit can consider its branch and timing while retaining current findings as evidence.
- Market research uses relevant business context to interpret sources and frame unanswered questions within the operator-approved scope.
- A report correction, changed plan or withdrawn source changes the next context pack without erasing historical provenance.
- An operator sees which context was supplied to an AI run, which references its answer cites, and whether any required context was unavailable.
- A reviewed Campaign lesson can enter reusable memory through a separate decision, while an unreviewed local proposal remains local.

## 3. Scope and release increments

### Included

- A versioned `OrganizationContextPort` over current authoritative state and existing memory.
- Automatic deterministic capture from committed Channel, Growth and Campaign source records.
- Explicit statement kind, source revision, scope, validity, sensitivity, rights and evidence ancestry.
- Transactional capture intent, leased projection, retries, bounded reconciliation and operational health.
- Purpose-specific context packs, source validation, context manifests and output reference validation.
- Channel Audit, Growth research, Growth synthesis, Campaign generation/revision and the existing subject-drafting reader.
- Separate submission/review of reusable Campaign lessons using the existing memory review surface and governed write machinery.
- Visible source coverage, recent capture status and per-result context provenance in existing UI surfaces.

### Excluded

- Copying the entire Digital Twin, raw metrics, reports, conversations, prompts or provider responses into memory.
- Memory becoming the authority for goals, policies, budgets, measurement, ranking, eligibility or execution.
- Cross-organization retrieval, shared raw client lessons, model training or automatic artifact optimization.
- Graph databases, an external memory vendor, a general event-bus rewrite, Redis implementation, or automatic model-authored organization summaries.
- Full feedback-learning optimization: personal likes, dislikes and pins do not become organization policy or global suppression.
- Automatic investigation runs on every memory write, automatic action completion, and retroactive changes to approved Campaign versions.
- Reusing Google Search grounded answer bodies without a qualified agreement permitting that use.

### Delivery order

1. **Channel loop:** current context → recommendation → committed capture → operator decision → next context, with health and usage evidence.
2. **Growth loop:** memory-informed internal research brief and synthesis, completed claims/items and organization decisions captured.
3. **Campaign loop:** current lifecycle/outcomes shared, generation context pinned, lessons submitted and reviewed separately.
4. **Existing reader migration and rollout:** subject drafting uses the common contract; qualified legacy memory admitted; complete cross-feature acceptance.

Schema/worker checkpoints are not independent product completion. Each released increment includes its source adapter, reader, UI provenance, tests and staging evidence.

## 4. Authority and meaning

Two dimensions are mandatory: `knowledgeKind` describes the statement; existing origin, verification and trust rank describe its support. A reliable record of an action is not proof that the action worked.

| Knowledge kind | Stored memory type | Origin / verification on capture | Meaning and permissible use |
|---|---|---|---|
| `observation` from deterministic finding | `episode` | `system_generated` / `unverified` | Source-backed observation with original period and limitations |
| `observation` from an eligible model-extracted market claim or AI insight | `episode` | `ai_proposed` / `unverified` | Accepted source-linked interpretation; never human-verified by implication |
| `recommendation` | `episode` | `ai_proposed` / `unverified` | Earlier advice; useful context, not independent evidence |
| `operator_decision` | `decision` | `system_generated` / `unverified` | System records the authenticated decision, actor, object and time; does not verify its rationale |
| `campaign_state` | `episode` | `system_generated` / `unverified` | Exact lifecycle/version/schedule metadata, not proof of exposure or success |
| `measured_outcome` | `outcome` | `system_generated` / `unverified` | Deterministic settled verdict with original evidence contract; `inconclusive` remains inconclusive |
| `lesson` | `lesson` | `outcome_learned` / `proposed` | A submitted reusable lesson awaiting review; confirmed only through the governed review path |
| `legacy` | Existing type | Unchanged | Pre-existing memory; no invented source or rights metadata |

Current `business_facts`, profiles, goals and constraints are read through, not captured as a second writable truth. Policy and spending checks continue reading their authoritative modules at execution time. Context is never a substitute for those checks.

### Narrow automatic-capture exception

Spec 004 currently excludes unconfirmed internal model writes. This proposal adds a narrow exception for **validated source projections**: a service-only projection RPC may create internal `ai_proposed/unverified` observations and recommendations from committed, supported source records. It accepts a capture-event identity and claim token, not arbitrary model text. Existing generic `create_proposed_memory_item` semantics remain unchanged.

Captured episodes cannot be verified into facts through the ordinary item edit route. Read-only source projections can be corrected only at their source. The sole captured type eligible for a memory verification decision is a submitted `lesson`, with the additional evidence checks below. Tier derivation stays deterministic; no automatic capture writes `verified`.

### Operator decisions

- `acknowledged`: saw the cited item; does not imply agreement.
- `planned`: intent to act; does not imply execution, scheduling in the Execution Plane, or success.
- `snoozed`: deferred until the saved time; does not imply rejection.
- `dismissed`: decision about this item, preserving its reason as untrusted operator text; not a permanent ban on a topic.
- `resolved`: source workflow says resolved; never relabel as a measured business outcome.
- Personal pins and helpfulness votes stay actor-scoped. They can be shown to that actor in the source UI, but V1 context packs do not expose one actor's personal preferences to all organization workers.
- A later source decision replaces current intent for the same source item. History retains both with timestamps. Two decisions on unrelated items do not supersede one another because their wording is similar.

### Lessons

Only `submitted_for_promotion` Campaign proposals may create proposed shared lessons. `proposed`, `campaign_only` and `dismissed` local proposals do not enter ordinary shared retrieval. Capture Campaign lifecycle and measured outcomes independently so other features still know what happened.

Submission produces one pending memory lesson linked to the exact outcome, version and proposal. Review requires `memory.verify`, an unchanged proposed-item revision, valid same-organization evidence and explicit applicability scope/review date. A valid human review verifies the scoped observation; it does not create causal evidence or broaden an observational result into a universal rule. `inconclusive`/`execution_only` lessons may describe limitations or next tests, never a winning tactic. Promotion changes neither brand rules nor playbook/policy data. Duplicate submit/review is idempotent through existing operation-ledger conventions.

## 5. Sources and automatic capture

The following names are proposed adapter keys. Their backing tables already exist; the capture infrastructure does not.

| Adapter key | Owning source | Capture point | Projection |
|---|---|---|---|
| `channel_finding` | `channel_findings` + analysis run/evidence | Completed eligible analysis; later invalidation/currentness change | Bounded finding description, original scope/window, root evidence references |
| `channel_recommendation` | `channel_recommendations` + citations | Fenced successful recommendation completion, including gap-fill additions | New non-grounded eligible advice; historical grounded text excluded |
| `channel_decision` | `channel_recommendation_decisions` | Accepted append in triage RPC | Deterministic actor action, target and time |
| `market_claim` | `market_evidence_claims` + sources/claim events | Successful research completion; withdrawal/expiry/correction | Permitted paraphrase and original source lineage, not excerpt duplication |
| `growth_item` | `growth_intelligence_items` + evidence joins | Completed synthesis, including no-new-item replay | Insight/recommendation; data gaps kept as labeled missing-data observations |
| `growth_decision` | `growth_intelligence_item_decisions` | Accepted organization triage decision | Actor action on the exact item fingerprint |
| `campaign_state` | `campaigns` + bundle versions and lifecycle records | Creation or meaningful version/status/schedule transition | Campaign/version identity, branch/channel scope, schedule/status, safe intent |
| `campaign_outcome` | `campaign_outcomes` + registered measurement context | Settled outcome or authoritative correction | Verdict, metric key, window, method, baseline reference, limitations |
| `campaign_lesson` | `campaign_learning_proposals` | `submitted_for_promotion` transition | Proposed lesson only; separate human review |

Do not capture partially written candidate rows. Triggers enqueue at the owning completion/transition boundary, or completion RPCs invoke one private capture helper before commit. Use the latter where a run owns multiple child rows; one helper invocation enumerates only that completed run's bounded outputs. Mutations and retries that do not change semantic source state create no additional capture.

### Committed capture and replay

1. The source transaction derives an allowlisted source revision from persisted state, computes its digest, captures required root references and inserts `memory_capture_events` while holding the source lock. No network/model call occurs in the transaction.
2. Source row and capture intent either both commit or both roll back. Capture is bypassed only for an organization whose capture setting is disabled.
3. Trigger.dev polls due identifiers and invokes the projection runner. The database claims rows using `FOR UPDATE SKIP LOCKED`, a random lease token and expiry.
4. The runner reloads the committed source and revision, validates source eligibility, and calls a fenced projection RPC. It never accepts a free-text memory payload from a task.
5. One transaction inserts the memory item, source/dependency links, supersedes the preceding projection when appropriate, and marks capture completed. Unique event/projection keys make repeated delivery harmless.
6. If a later source revision already exists, an old delivery is recorded as obsolete; it cannot become the current projection. A receipt lost after commit is recovered as replay without generating another item.

Projection is deterministic in V1. No model chooses what to remember, summarizes raw provider responses, or rewrites history. Adapter-specific bounded source fields are sufficient because existing sources already contain summaries and structured verdicts.

### Scheduling and repair

- Poll every minute; select at most 100 due event IDs per pass, process at most 25 per claimed batch, and limit worker concurrency to 2 organizations initially.
- Dispatch organizations by oldest due work with a persisted last-dispatched cursor/timestamp to break ties and rotate fairly; one large tenant must not monopolize every batch. Limits are global per pass, not multiplied silently by every organization.
- Lease: 120 seconds; renew only while doing bounded work, with claim-token checks on completion/failure. No network work is necessary for projection itself.
- Five attempts with delays of 30 seconds, 2 minutes, 10 minutes, 30 minutes and then terminal `failed`. Claim expiry is reclaimable; every actual attempt is counted in Postgres.
- Transient database failure retries; invalid source shape, tenant mismatch, rights denial and missing mandatory provenance are quarantined with safe codes rather than repeatedly retried.
- Embedding is secondary: newly projected eligible items are immediately searchable lexically. Dispatch existing embedding workers from a durable due scan over pending eligible rows; do not depend on an in-process callback.
- Reconcile every 15 minutes, at most 100 source identities per organization per pass, with a persisted cursor. This repairs missed integrations after forward fixes and drives expiry/withdrawal cleanup. Source liveness is still checked on reads; correctness does not wait for reconciliation.
- Retry from the operations UI requires owner/admin, scoped RPC authorization and an audit event. Replaying a job never bypasses its source validation.

## 6. Scope, revisions and dependencies

### Scope

- Every record has an organization. Branch and channel IDs must be same-organization references.
- A branch request reads organization-wide items plus that exact branch. It never silently sees another branch's experience as its own.
- A channel request reads organization-wide/channel-neutral items plus that exact channel within the selected branch scope.
- A default organization request reads organization-wide items only. An explicit cross-branch overview purpose may return labeled branch summaries using an approved bounded adapter; it is not included in the initial purpose registry.
- Campaign scope follows its stored source/bundle scope. Never infer a branch from its name or turn a single-branch result into an organization rule.
- If a Campaign has multiple explicit branches, its initial capture remains a labeled campaign-scoped summary. A branch consumer may receive it only when the source adapter proves that branch is included; an unknown/ambiguous branch set is excluded from branch context with `SCOPE_UNRESOLVED`, never stored as a branch-neutral global fact to bypass the check.

### Time and currentness

Persist event `occurred_at` separately from capture `created_at`, source effective interval and reporting period. Use UTC storage and organization timezone only for presentation and existing period calculations.

- Different reporting windows are distinct historical observations, not automatic supersession.
- A corrected version of the same source identity supersedes its previous projection.
- Mutable lifecycle state receives an ordered revision under the source lock; arrival time and lexicographic UUID ordering do not decide which state is current.
- Defaults: observation review due after 30 days; recommendation review due after 14 days; reviewed lesson review due after 90 days; every value is capped by a stricter source expiry/retain-until. These are proposed review policies, not evidence-derived freshness guarantees.
- Plans older than 30 days are displayed as “Planned; progress needs checking,” not erased or marked completed. Source state remains authoritative.
- Non-stale current context excludes expired, rejected, withdrawn, superseded and unsupported roots. Historical sections may include old reporting windows with their original dates, but never withdrawn text or a claim whose retention rights expired.
- Removing/invalidating a root stops its dependent entry from supporting current claims, regardless of the age or human review of a child lesson.

### Evidence ancestry and loop prevention

Capture dependencies retain roots from the owning source's typed citations. Recommendations derived from the same finding or market claim count as one evidence family, not independent corroboration. An operator acknowledgement or another model repeating the statement adds no evidential strength.

Use `memory_links` for visible item relations and `memory_capture_dependencies` for event ancestry. Reject self-edges and cycles; bound traversal to 32 hops and 100 unique roots, and exclude with `LINEAGE_LIMIT_EXCEEDED` if the bound is exceeded. A memory created by a run cannot appear in the manifest already pinned for that run. A capture operation emits operational status only; it does not enqueue fresh research or analysis.

## 7. Context retrieval contract

New public application export: `OrganizationContextPort.build(request): Promise<OrganizationContextPack>`. It is server-only. Pure contracts live in `src/domain/memory/context.ts`; composition in `src/modules/memory/application/context-service.ts`; runtime factory in `src/modules/memory/infrastructure/context-wiring.ts`.

### Request

- `organizationId`, optional exact `branchId`, optional exact `channelId`, optional `campaignId`.
- `purpose`: `channel_advice`, `growth_research`, `growth_synthesis`, `campaign_generation`, `campaign_revision`, or `subject_drafting`.
- `consumer`: discriminated identity for an existing analysis run, Growth request, Campaign generation run, or authenticated subject-draft operation; `correlationId`.
- `query`: bounded task description, maximum 500 characters, created from allowlisted fields; never logged as raw text by the new API.
- `asOf`: server clock bound when the manifest is created; not caller-controlled historical visibility.

The server binds organization/scope/purpose to the authenticated operation or claimed worker run. A model cannot supply the purpose or raise the ceiling. All initial consumers have maximum `internal` sensitivity. The effective ceiling also intersects current actor access, source permissions and provider disclosure qualification. Sensitive historical material is excluded rather than relabeled internal by truncation.

Do not reuse `createMemoryWorkspaceApi` as a privileged worker factory. Its ceiling is based on the human's role; workers require purpose-bound scope/lease validation and service-only RPCs. Existing public `MemoryRetrievalPort` remains backward-compatible for workspace search.

### Pack

- `schemaVersion: 1`, `manifestId`, `contextDigest`, `policyVersion`, `serverTime`.
- `status`: `ready`, `empty`, `partial`, `unavailable` or `disabled`.
- `sections`: `currentState`, `activeIntent`, `observations`, `lessons`.
- Each entry: stable `contextRef`, typed source identity and revision/digest, statement kind, title and bounded safe summary, organization/branch/channel scope, original effective/reporting dates, verification/trust/freshness, current source state, evidence-root references and permitted-use classification.
- `exclusions`: counts by safe code; `degradedReasons`; selected entry and byte counts; measured retrieval latency.

### Selection algorithm

1. Authorize the consumer and scope. Read the organization integration setting.
2. Read relevant current profile/facts/goals/constraints directly from their owners using registered fields. Apply organization-plus-exact-branch semantics; a more specific valid fact with the same key takes precedence over its organization default. Equally authoritative conflicting facts are labeled, not merged by a model.
3. Load current scoped operator intentions and Campaign lifecycle metadata through bounded source adapters. These direct reads keep a just-saved plan visible while projection is pending.
4. Retrieve at most 50 eligible candidates per memory section, combining lexical matching and existing optional vector search. Filter source currentness, rights and sensitivity before emitting content. Never truncate an unscoped cross-tenant result set in the application.
5. Allocate maximum slots: current state 6, active intent 6, observations 8, lessons 4. Within each section retain existing trust-first ordering, then scope/relevance, original observed time and stable ID. Maximum 3 unverified AI-generated entries in the observations section. Empty slots may transfer to current state or source-backed observations; they must not raise the AI-entry cap. Section quotas keep reviewed facts from crowding out all active intentions.
6. Deduplicate identical roots and exact source revisions. Keep opposing evidence explicitly labeled. Skip no-longer-supported entries; never manufacture a replacement.
7. Cap each summary at 600 characters, the pack at 24 entries and 16,384 UTF-8 bytes. Deterministically drop the lowest-priority optional entries to meet the byte budget; do not truncate away limitations or meaning. If mandatory current context cannot fit, return partial with a safe reason. Report actual tokenizer usage if available; character estimates are not claimed as measured tokens.
8. Persist a manifest and ordered entries before the model call; serialize safe data with tag escaping. A same-attempt retry uses the pinned manifest. A fresh run may use a new manifest.

A projected structured fact's null `itemId` is not sufficient identity: include its typed `businessFactId` and revision digest. Blank-query “top memories” cannot replace current-state assembly; the old fact reader is lexical and its branch filter omits organization defaults when a branch is supplied.

### Freshness between selection and completion

Immediately before each model call and fenced output completion, revalidate the selected source revisions, permissions and rights. If an included root changed or was revoked, the output cannot be marked current with that manifest. Fail the attempt with `CONTEXT_CHANGED`; one new bounded attempt may rebuild context through the owning workflow. Never mutate the pinned manifest silently. Unrelated new memories do not invalidate an attempt. A newly changed source-owned intent for the same target is relevant even if the older state occupied an empty direct-state slot; include scoped state revision markers in the manifest.

### Failure handling

Embedding outage means lexical retrieval, with its existing reason. Optional memory read failure means the AI feature can proceed with its existing mandatory evidence and `contextStatus: unavailable`; its output and UI must disclose that limit. A current authority/policy read required by the source workflow still fails closed. A failed manifest write means no memory content is sent; proceed without optional memory only if the owning output can persist that unavailable status. Never claim tracked context use when its manifest did not persist.

## 8. Consumer integration rules

### Channel Audit

- Add `context` as an explicit dependency to `runChannelRecommendations`; bind to the exact analysis run/claim. Add a separate context block to `buildNarrationPrompt`.
- Keep at least one current same-run finding citation per item, eight-item cap, coverage and gap-fill rules. Memory cannot turn `needs_data` into an observed finding or qualify unsupported money/causal claims.
- Add `contextRefs` as a separately validated optional source field in a versioned narration contract; new memory-enabled outputs must emit the field, possibly empty. It is not a replacement for `citations`.
- To refer to a plan, outcome or reviewed lesson, the answer names its context reference. Resolve it against the same manifest and permitted statement kind before completion. Existential citation validity is not proof of semantic faithfulness; preserve judge/human evaluation.
- With `channel_context_enabled`, use a non-grounded provider call for private-context narration. Useful finding-supported advice remains available. Reusable provider guidance can arrive only through qualified research sources; absent guidance produces qualified suggestions to check a portal, not invented exact portal instructions.
- Keep the legacy path when the new feature is disabled. It receives no newly shared private context. Its grounded bodies remain excluded from reusable capture. Changing the enabled path's grounding behavior is an explicit part of approval, not a hidden implementation choice.
- Bump narration and judge versions together where their contract changes. Store context manifest/digest and context-use mode with completion; preserve analysis result/cache identity. Do not rerun deterministic analysis merely because memory changes. A new narration attempt identity must bind analysis ID, narration version and context digest while retaining existing gap-fill duplicate fences.

### Growth research and synthesis

- Pin an internal brief before research. Include relevant current plans, prior unanswered questions and valid business context, explicitly separate from external evidence.
- Preserve every approved topic and competitor coverage slot. In the first release, external query text remains a deterministic function of approved public profile fields. Internal memory may order execution of slots, but cannot remove one, add an unapproved competitor/geography, or reduce the required coverage. The saved manifest records the order and reasons by reference.
- The internal brief guides extraction relevance and later synthesis, not whether a source supports a claim. The independent support-review pass receives source/candidate context only; old memory cannot count as source support.
- Thread the brief/manifest identity to research completion and its atomic synthesis child. Synthesis builds its own current pack and retains the parent brief reference for traceability; an expired parent entry is not blindly reused.
- Extend strict compact input, output context references, Zod schemas, SQL allowlists and run fingerprint together. Preserve branch/profile/claim/run lineage, source qualification, coverage accounting and budget reservation.
- Keep `findings`/`claims` evidence joins separate from `contextRefs`. Never place a memory ID in a finding/market-claim field or admit old advice as a current market fact.
- Capture claims only after successful admitted research and items after completed synthesis. Zero accepted findings is a legitimate empty outcome, not an invitation to fill memory with fabricated knowledge. Capture an operational completion receipt, not a lesson that nothing exists in the market.

### Campaigns

- Capture safe current lifecycle, exact version, timing and scope. Approval is not publication; publication is not exposure; exposure is not measured success.
- Add the common pack to generation/revision preparation, pin it to the existing generation run, and include the digest in generation context provenance. A material newly generated revision remains a new immutable bundle version requiring normal approval.
- Memory does not change factual assertions, spend, legal claims, brand truth, selected credentials, asset truth class or policy. Existing validators and Tool Gateway remain mandatory. Include text-only relevant context in the planning/copy stage; do not send raw historical/rejected design bytes through memory to final image generation.
- Capture settled outcomes with their exact measurement context. Default shared summaries omit confidential money amounts; a wider future consumer purpose requires separate qualification, not an internal-label workaround.
- Reuse `decide_campaign_learning_proposal` submission as the bridge into proposed memory lessons. Extend memory review to verify/reject these under the constraints of section 4; do not implement automatic promotion to playbooks or brand guidance.
- Migrate subject drafting to the common `subject_drafting` purpose after these paths are verified, preserving human confirmation and the current named-subject-only behavior.

## 9. Proposed data model

All names below are **new or changed contracts**, not claims that these objects already exist. Use additive imperative migrations generated by `pnpm exec supabase migration new <name>`; never edit already-applied migrations.

### `memory_integration_settings` — new

One row per organization: `organization_id` primary/composite tenant reference, `capture_enabled`, per-consumer booleans (`channel_context_enabled`, `growth_context_enabled`, `campaign_context_enabled`, `subject_context_enabled`), `legacy_corpus_qualified`, `context_policy_version`, `updated_by`, `updated_at`, and bounded per-adapter reconciliation cursors. Defaults are disabled, corpus unqualified and policy `shared-context-v1`.

Owner/admin changes require a narrow audited RPC. Add permission keys `memory.manage_integrations` and `memory.retry_capture` to the permission catalogue, granted to owner/admin only and mirrored in the browser permission map. No browser table writes. Source capture helpers read this table inside the source transaction; worker flags are not the only gate. Workers and routes recheck flags. Cursor updates are worker-only and must not alter configuration.

### `memory_capture_events` — new durable capture queue

- `id`, `organization_id`, `source_kind`, exactly one primary typed source FK, `source_revision bigint`, `source_digest`, `event_kind` (`recorded`, `changed`, `withdrawn`, `submitted`), `occurred_at`, `created_at`, `correlation_id`.
- Typed FK slots: `channel_finding_id`, `channel_recommendation_id`, `channel_decision_id`, `market_claim_id`, `growth_item_id`, `growth_decision_id`, `campaign_id`, `campaign_outcome_id`, `campaign_learning_proposal_id`. Each references its table through `(organization_id, id)`; add missing referenced uniqueness narrowly. A check maps each `source_kind` to exactly its primary slot and requires all others null.
- `branch_id`, `channel_id`, source effective/reporting intervals, `sensitivity`, `reuse_class` (`internal_reusable`, `qualified_reusable`, `metadata_only`, `denied`), nullable qualification/version reference and `retain_until`.
- `projection_document jsonb`: adapter-specific strict schema, at most 8 KiB; allowlisted safe fields and source revision only. No raw prompts, report rows, provider responses, secrets or source excerpts. Its content is immutable except audited rights-driven payload erasure. Text cannot be user/model-supplied directly to capture RPCs.
- `status` (`pending`, `claimed`, `completed`, `obsolete`, `quarantined`, `failed`), `attempt_count`, `next_attempt_at`, `claim_token`, `lease_expires_at`, `completed_at`, `safe_failure_code`, nullable `projected_item_id`.
- Unique `(organization_id, source_kind, primary_source_id_expression, source_revision)` implemented with per-kind partial unique indexes; unique completed `projected_item_id` within organization. Derive revision under a per-source transaction lock, not from wall-clock milliseconds. Skip semantically unchanged source digest; a changed-away-and-back state is a new ordered revision.
- Index `(status, next_attempt_at, organization_id)` for due work, all composite FKs, per-source revision, and organization/time for health.

### `memory_capture_dependencies` — new

`organization_id`, `capture_event_id`, `parent_capture_event_id`, `relation` (`derived_from`, `supports`, `contradicts`), primary key over the tuple, composite FKs and reverse-parent index. Root identities come from typed owning-module citations. A private helper registers root capture identities before child edges in the same transaction. Cycles and traversal limits are rejected deterministically. Do not use unchecked polymorphic evidence UUIDs.

### `memory_items` — additive changes

- `knowledge_kind` with the vocabulary in section 4, default `legacy` for existing rows.
- `capture_event_id` nullable, unique with organization and composite FK.
- Source-linked captured body/identity immutable; lifecycle changes use governed supersession/rejection/retention paths. A check and privileged transition guard enforce allowed kind/type/origin/verification combinations.
- Existing source columns are not repurposed: `source_run_id` may refer to ingestion runs and must not receive a Channel/Growth/Campaign run ID. Keep original source provenance in the typed capture record.
- No bulk reclassification or trust upgrade of existing rows. Existing workspace remains usable. New AI consumers exclude unqualified legacy corpus until operator/admin qualification is recorded.
- Existing `memory_links` relates projected items once available; event ancestry remains valid even before all items project.

### `memory_context_manifests` — new

- `id`, `organization_id`, `purpose`, `schema_version`, `policy_version`, `context_digest`, `as_of`, branch/channel/campaign scope, actor identity where relevant, `correlation_id`, context `status`, safe degradation/exclusion counts, selected count/bytes and measured latency.
- Typed consumer binding: one of `analysis_run_id`, `growth_request_id`, `campaign_generation_run_id`, or `subject_operation_id`. First three use same-organization FKs. For subject drafting, extend `memory_write_operations` with nullable `actor_id` and `operation_kind` (legacy rows remain null), add `(organization_id, id)` uniqueness, and create a `subject_context` operation in the authenticated preparation transaction. Require actor binding and request fingerprint, using the idempotency key `subject-context:<actor UUID>:<correlation UUID>`; mismatched replay refuses. Preallocate manifest ID and write its bounded response in the same transaction. Only these operations may satisfy the subject FK; another memory operation ID is refused. No free caller UUID establishes authority.
- `attempt_key` from the owning run's attempt/lease identity, not the model; unique `(organization_id, purpose, typed consumer, attempt_key)`. A manifest cannot be reused by another run or tenant.
- State `prepared`, `consumed`, `abandoned`; model-call time, completion time and actual provider/model identifiers. Output associations are persisted by each owning module through typed manifest FKs, not arbitrary JSON output IDs.
- Retain identifier/digest audit history; never store whole system/user prompts or model hidden reasoning.

### `memory_context_entries` — new

- `(organization_id, manifest_id, ordinal)` primary key, unique context reference per manifest, typed source FK and revision/digest, statement kind, scope, trust/freshness, original dates, root references and current-use restrictions.
- Typed source slots include `memory_item_id`, `capture_event_id`, `business_fact_id`, `business_profile_id`, `goal_id`, `constraint_id`, `campaign_version_id`. Use real same-organization composite FKs matching current schema, with exactly-one-primary-source checks. Scope/current-state revision markers may reference the parent manifest's typed consumer; they contain only digests/counts.
- `safe_snapshot jsonb` contains the same bounded allowlisted summary/data supplied to the model, never the full prompt. It permits exact inspection of the provided context without relying on an edited source row. Enforce pack count/size and privacy through the finalization RPC, not just Zod.
- Preparation resolves each source and safe representation inside the controlled boundary; a valid source identity paired with caller-invented text is refused. Snapshot content/revision must match the registered source projection.
- Snapshot visibility intersects the source's current visibility. A downgraded role, withdrawn source, denied reuse or expired retention hides/redacts content even though the historical manifest exists. Safe IDs/digests may survive only where source retention allows them.

### Existing consumer records

Add nullable manifest/digest/status fields and versioned `context_refs` through typed joins or bounded arrays checked against that manifest to Channel narration completion records, Growth research/synthesis records, and Campaign generation runs. For the Channel gap-fill case, preserve one manifest per narration attempt: use a new `channel_recommendation_contexts` association keyed by recommendation ID rather than overwriting an analysis-wide manifest. Each row links `(organization_id, recommendation_id)` to a manifest and validated context refs. A completed run can therefore contain old and new recommendations with honest separate provenance.

Use equivalent per-item `growth_intelligence_item_contexts` where a run produces multiple items; Campaign generation uses its existing single run/version lineage. These two association tables are part of the migration scope. Metadata-only historical records keep null manifests and display “Context use was not recorded.”

## 10. RPCs, events and public exports

Proposed service-only operations:

- `claim_memory_capture_events(organization_id, claim_token, limit, lease_seconds)` returns only bounded claimed identifiers.
- `load_memory_capture_event(organization_id, event_id, claim_token)` validates lease/source scope and returns its typed projection document.
- `complete_memory_capture_event(organization_id, event_id, claim_token)` reloads validated source state and atomically projects/completes; model text is not an argument.
- `fail_memory_capture_event(organization_id, event_id, claim_token, safe_code)` updates retry/quarantine state according to the fixed classifier.
- `prepare_memory_context(...)` and `consume_memory_context(...)` use strict documents plus typed consumer binding, current source checks and size limits. User and worker entry points are separate to prevent a user from forging worker authority.
- `reconcile_memory_capture(organization_id, adapter, cursor, limit)` reads registered sources only; no caller-selected table names or SQL.

Authenticated operations: read context details/health under `memory.read`, update integration settings under `memory.manage_integrations`, retry failed captures under `memory.retry_capture`, and submit/review the permitted lesson through existing memory permissions. Routes use the session client and the established organization-context pattern.

New routes:

- `GET /api/organizations/:organizationId/memory/health` — bounded adapter health/counts, no confidential snippets.
- `GET /api/organizations/:organizationId/memory/contexts/:manifestId` — safe currently visible manifest/entries.
- `PATCH /api/organizations/:organizationId/memory/integrations` — explicit booleans/policy version, audited owner/admin RPC.
- `POST /api/organizations/:organizationId/memory/captures/:captureId/retry` — identifier-only retry, audited owner/admin RPC.

Keep existing workspace routes. No public unrestricted “write AI memory” endpoint is introduced.

Events: `memory.source_captured`, `memory.capture_completed`, `memory.capture_failed`, `memory.context_consumed`, `memory.source_withdrawn`, `memory.integration_changed`, `memory.lesson_submitted`. Payloads contain identifiers, version numbers, counts and safe codes only. Durable business/audit records own delivery evidence; the existing logger-only publisher may mirror observability but is never the capture transport.

Exports: pure `OrganizationContextRequest`, `OrganizationContextPack`, `ContextEntry`, `ContextPurpose`, `MemoryKnowledgeKind` and strict schemas; application `OrganizationContextPort`, `MemoryCaptureRepository`, `MemoryContextRepository`; source adapters export through their owning module's explicit public boundary. No feature imports another feature's internal repository directly.

## 11. AI and disclosure boundaries

- Memory is untrusted data even when human-verified. Serialize and escape it, keep it out of system instructions, and validate all emitted context references.
- Models do not control source trust, evidence quality, timestamps, expiry, scope, rights, ranking policy, suppression, budgets, currentness or promotion.
- Context may influence the reasoning and wording of advice. It cannot fill missing deterministic inputs or establish a new factual/economic claim without the existing source admission route.
- Internal packs reach only an organization-approved model-processing boundary. Search engines receive the approved public scope only; they never receive operator notes, private campaign plans, customer data or internal metrics copied from memory.
- Embeddings are also external disclosure. Embed only content whose classification and provider qualification permit embedding; retain lexical retrieval when unavailable. Never assume a configured API key implies approved processing rights.
- Historical Google-grounded narratives are `metadata_only` until qualified; never summarize them through a different model to evade this boundary. First-party underlying findings and safe operator status can still be captured independently.
- Descendants inherit restrictive rights and source liveness from roots. Erasing a research source must also redact stored context snapshots, capture documents, memory text and vectors derived from it. Read-time joins block use immediately; bounded cleanup follows and is audited.

## 12. Security and tenancy

Enable and force RLS on every new public table. Grant no anonymous access or browser writes to capture/manifest infrastructure. User reads apply both organization permission and source sensitivity; owner/admin-only operational details must not leak through aggregate endpoints. Do not expose raw actor emails or private feedback via context history.

Use composite tenant FKs everywhere, including association tables and dependencies. Add indexes for every FK and RLS predicate. Privileged RPCs use empty `search_path`, fully qualified objects, explicit grants/revocations and typed strict payload validation. Trigger helpers are private and non-callable by ordinary authenticated users. Worker credentials alone do not authorize arbitrary organizations: validate the bound run/lease, flags and purpose on every relevant operation.

Prove isolation using two organizations in different accounts and sibling organizations in the same account. Agency membership never grants cross-organization context merging. Test revoked membership, operator/viewer versus sensitive sources, forged parent IDs, other-branch IDs and stale claim tokens. Do not infer authorization from navigation visibility or a remembered role.

## 13. UX

Keep the existing Search, Timeline, Lessons and Review organization. Add source and statement-kind filters, a compact connection-health panel and source-linked badges rather than another unrelated workspace.

- Timeline: “Channel Audit recorded an observation”; “Operator planned an action”; “Campaign outcome: inconclusive.”
- Each item: source feature, branch/channel, reporting period or event time, status, review/expiry and “Open source.” Captured source projections explain that corrections happen at the source.
- Recommendation details: “Business context used” drawer with safe entries, source links and capture dates. Separate “Provided to AI” from “Cited in this answer”; citation use is model-declared and validated, not proof of causal influence.
- Degraded state: “Business Memory was unavailable for this analysis. These recommendations use the current report evidence.” An empty pack says no relevant context was found, not that the business has no history.
- Health: per-source last capture, pending/failed counts, projection lag, embedding status and last context use. Show backlog as pending, not silent success. No synthetic counts.
- Review: submitted lessons show evidence, original verdict, limitations, applicability and review date. Confirmation never says a tactic worked unless the underlying outcome contract permits that wording.
- Personal pins/likes stay in their current UI and do not appear as organization instructions.

Use installed shadcn/ui components and organization-scoped TanStack Query keys. Mutations show success only after the explicit domain outcome confirms it.

## 14. Observability and retention

Capture: committed/eligible/projected/obsolete/quarantined/failed counts by adapter; oldest due age; attempt count; projection latency. Context: selection/exclusion counts, status, per-purpose latency, bytes and provider usage where measured. Quality: citation validity, inappropriate corroboration, stale context, repeated advice after plans and false completion claims. Logs contain no source bodies, queries, prompts or credentials.

Proposed operational targets: normal-load capture p95 below 2 minutes, bounded context assembly p95 below 2.5 seconds including the existing 1.5-second embedding timeout. These are canary targets, not promises or measured results. Alert at oldest pending age above 5 minutes or any quarantined/terminal-failed capture. Preserve partial usage/cost from failed external embedding/model attempts; never report invented zero cost.

Safe snapshots and projection documents default to 90-day retention, capped by stricter source rights and organizational retention. Current read-through sources remain in their own stores. After content expiry retain only permitted IDs/digests/decision metadata and mark content unavailable; do not revive from vectors, Redis, backups or a child summary. Proposed audit-metadata retention is 365 days, again capped by applicable source/organization policy. Before rollout, approve these defaults and exercise the rights-driven erasure path.

## 15. Acceptance criteria and tests

| ID | Required scenario | Pass condition |
|---|---|---|
| A01 | Source transaction rolls back | No capture event or memory item exists |
| A02 | Crash after source commit, before dispatch | Due scan later projects exactly one item |
| A03 | Duplicate delivery and lost completion receipt | Same projection identity; no duplicate or extra trust |
| A04 | Out-of-order source revisions | Older arrival cannot replace newer current state |
| A05 | Operator plans then later changes decision | Next pack uses current source state; history retains both |
| A06 | Acknowledgement, planning, likes and pins | No promotion, success claim, cross-user preference leak or policy change |
| A07 | Same organization, different branches | Exact branch plus global context only; scope labels survive |
| A08 | Different organizations, including same account | No cross-tenant rows, counts, joins, manifests or source links |
| A09 | Higher sensitivity or revoked role | No snapshot, cache, embedding or model disclosure |
| A10 | Corrected report / expired or withdrawn research | Dependent context is excluded immediately; cleanup cannot resurrect it |
| A11 | AI suggestion repeated across features | One root family; no independent corroboration or upgraded trust |
| A12 | Malicious note, provider text or context reference | No tool/policy change; invalid refs rejected; safe failure only |
| A13 | Embedding failure / missing config | Lexical results with explicit degrade; no feature outage |
| A14 | Memory DB read or manifest persistence failure | Existing evidence-only mode with honest persisted/UI status |
| A15 | Included source changes during generation | Completion refuses stale manifest; bounded new attempt |
| A16 | Channel coverage and gap-fill | Existing same-run citations and eight-item cap remain; each item keeps its own manifest |
| A17 | Growth approved query coverage | All slots retained; public queries contain no private-memory bytes |
| A18 | Growth claim support | Memory alone cannot pass claim admission or create corroboration |
| A19 | Campaign revision | Context digest pinned; new material version requires new approval |
| A20 | Campaign lesson submission | One proposed lesson; no shared retrieval until review; inconclusive never becomes a winning rule |
| A21 | Context detail | Supplied entries and cited refs distinguishable; no invented original text after erasure |
| A22 | Backfill and live capture overlap | Idempotent, revision ordered, resumable; no seed corpus treated as real outcomes |
| A23 | Flags off / worker restart | Source features operate in prior supported mode; pending work retained and authorized reads disabled |
| A24 | Measured quality | Required context recall >=90% on frozen fixtures; all valid citation references resolved; zero critical trust/tenant/rights failures |

Unit/property tests cover derivation, scope, ranking, bytes, ancestry, temporal updates, digest stability and public disclosure. Repository/RPC tests cover source adapters and runtime refusal paths. Hosted pgTAP covers transaction/lease/idempotency/RLS and actual execution of every new PL/pgSQL function. Workflow tests inspect captured provider inputs and completion payloads, not only mocks of a retrieval method. End-to-end tests traverse source decision → capture → next run → context drawer across the real authenticated application.

Use at least 40 labeled scenarios for the frozen context evaluation, distributed across the target consumers, including corrections, missing information, repeated suggestions and adversarial inputs. Human helpfulness comparison uses the same evidence with memory enabled/disabled, randomized presentation and recorded reviewer judgments. A model judge is advisory; no new rubric auto-promotion is included.

## 16. Migration, rollout and rollback

- Re-read the current schema, migration history, board and exact HEAD before implementation. Task 13 Growth staging history is present in the inspected snapshot; this does not verify all its acceptance or provider readiness. Record current prerequisites afresh.
- Add infrastructure and constraints with defaults disabled; maintain database types manually. Do not run local Supabase/Docker or `pnpm db:types`.
- Add each source adapter and its tests, then enabled reads for that release increment. Source capture may be enabled first in one qualified staging organization while reads remain disabled.
- Backfill starts from live source tables with provenance, not old memory seed content. Default window is 90 days plus all currently active plans/Campaigns and submitted lessons, bounded to 100 source identities per batch. Record cutoff/cursor and report excluded/rights-blocked sources. Insert current snapshots for mutable objects; never invent unavailable past transitions.
- Enable live capture before starting backfill, using the same identities/revision allocator. It must tolerate changes occurring during the backfill. Reconcile counts with eligible source versions, not total historical table rows.
- Run shadow context assembly without sending it to AI, then a small paid canary only after provider/disclosure/cost qualification. Compare against frozen baseline. Enable one consumer at a time.
- A stale or unqualified legacy corpus remains excluded from new AI context even if the Memory workspace can display it. No automatic bulk deletion or seed reset.
- Roll back by disabling consumer flags, then capture if needed. Preserve queue/history and stop dispatch for disabled organizations. Apply a forward repair for schema defects; never drop live tables or edit an applied migration as rollback.
- No deployment, production acceptance, provider permission or user browser acceptance may be claimed from repository fixtures alone.

## 17. Required documentation changes on approval/implementation

- Spec 004 §§3.2, 6, 9–12: distinguish governed source capture from arbitrary AI proposals; add statement kinds, lineage/currentness and context API; preserve fact ownership and cache boundaries.
- Context 09 and module map: define shared context, automatic capture, source-owned truth and contextual versus artifact learning.
- ADR 0011: retain fact read-through; clarify additional read-through context is not a second fact store. ADR 0012 remains deferred infrastructure and is not required by this feature.
- ADRs 0013/0019: reusable lessons still require promotion review; current Campaign episodes/outcomes may be shared as scoped historical context without becoming reusable recipes.
- Spec 018 and ADRs 0051/0052/0053: document the new conditional non-grounded Channel path, dual citation contracts and per-attempt provenance while preserving coverage/gap-fill.
- Spec 022 §§13–15 and ADRs 0044/0047: distinguish automatic recording from promotion; permit current shared context while preserving public query scope, source support and retention.
- Spec 016: wire submitted Campaign learning to the memory review queue without claiming promotion merely from submission.
- Existing memory implementation plan: retain as historical evidence; link the new approved continuation instead of treating stale task boxes as current authority.

No existing accepted restriction is implicitly repealed by this Draft. Approval must cover these scoped amendments, the schema/route surface, Channel provider behavior and retention/rollout defaults.
