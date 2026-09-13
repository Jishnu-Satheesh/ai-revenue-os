# Feature Specification: Campaign experience and marketing loop

## Status

**Proposed — 2026-09-12.** Tier 3. Not accepted. The user approved the implementation plan
`docs/superpowers/plans/2026-09-12-campaign-experience-implementation.md`; they have not signed this
specification. Until they do, every currently accepted ADR and spec remains authoritative, and the
dated amendments this specification introduced into them take effect only when it and ADR 0057 are
accepted.

- Product authority: `docs/superpowers/specs/2026-09-12-campaign-experience-design.md`. Its
  section 3 decisions **D05, D06 and D07 are confirmed by the user** and are carried here verbatim in
  meaning. They are not re-opened by this specification, by review, or by implementation.
- Evidence base: `docs/verification/campaigns/2026-09-12-workflow-audit.md` (findings F01–F18).
- Contracts: `docs/superpowers/plans/2026-09-12-campaign-experience-contracts.md` (C01–C09), adopted
  as this specification's data and API contracts.
- Reconciliation and delivery status:
  `docs/verification/campaigns/2026-09-12-implementation-reconciliation.md`.
- New governing decision: [ADR 0057](../adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md),
  Proposed, which establishes the two-gate approval model this specification depends on.
- Baseline: branch `feat/governed-channel-intelligence`, HEAD `c48a37b`
  ("chore: baseline WIP commit of in-flight work before Campaign experience rework"). That commit is
  preserved, not reverted.

### Delivery status is tracked in four separate fields

No item in this specification is "done" as a single fact. Every deliverable carries four independent
statuses, and a later one may never be inferred from an earlier one:

- **source** — the code, schema file or document exists on this branch and its focused checks pass.
- **staging-applied** — the migration is applied to the hosted staging database and its pgTAP suite
  ran there.
- **worker-deployed** — the Trigger.dev task is deployed to the cloud project and registered.
- **live-verified** — a real controlled-account result proves the behavior end to end.

A deployed worker and a completed empty sweep satisfy neither the staging-applied nor the
live-verified field.

### Standing constraint on migrations during this run

- No migration will be applied to hosted staging during this implementation run without a separate,
  explicit user decision. `pnpm db:migrations:push` is all-or-nothing, and pushing a new Campaign
  migration would carry every pending migration with it.
- **Corrected 2026-09-13: there are FIVE pending `20260912*` migrations, not three** —
  `20260912030945_business_memory_channel_contexts`,
  `20260912090000_growth_intelligence_item_contexts`,
  `20260912120000_business_memory_growth_capture`, `20260912130000_business_memory_campaign_capture`
  and `20260912140000_business_memory_campaign_context_usage`. The earlier count of three understated
  the blast radius. The application state of the `20260911*` Business Memory set is **also
  unverified**: the 12 September audit reported only that `20260909124757` is present and that the
  local `20260912*` Memory migrations are absent, and never reported the `20260911*` set as applied.
  Only a `pnpm db:migrations:list` against staging can settle the true pending set.
- Therefore every task that adds schema may reach **source** status only, until that decision is
  taken. Nothing in this specification authorizes a push.

### Deferred from this specification

- The visual prototype `.superdesign/campaign-experience/prototype.html` is **deferred to a separate
  dispatch (Task 0b)**, to be produced immediately before the first production UI task. It is a
  design artifact and is not production acceptance. This specification's UX flow section states the
  intended behavior without it.

## Business outcome

Campaign becomes the business's marketing agent: it recognizes a real business shortcoming, researches
an appropriate response, explains a proposal, obtains approval, prepares relevant creative, supports
revision, launches only what a human reviewed, monitors it, and carries evidence into the next cycle.

The experience makes six questions easy to answer: why this campaign, what will it do, what needs my
decision, what is live, how is it doing, and what should we try next?

Success is measured operationally and commercially, and the two are never merged:

- Operational: time from proposal to decision, failed or orphaned work, first-pass creative
  acceptance, uploaded-to-usable conversion, agreement between the reviewed artifact and the
  published artifact, metric freshness, verified pause latency, lesson provenance coverage.
- Commercial: any incremental gross profit claim requires the existing registered measurement method,
  baseline, window and limitations. A forward-looking estimate may be shown with its inputs and
  assumptions on the same surface, labelled an estimate. No realized-result claim is made without its
  registered proof.

## User stories

- As an owner, I open Growth Intelligence and find a campaign proposal built from my own business
  evidence, with the audience, offer, channels, budget and success measures already worked out, so I
  can decide rather than write the strategy myself.
- As an owner, I approve a proposal and understand that I have authorized *preparation only* — the
  platform may spend the approved generation allowance and make creative, and may not publish
  anything or spend media money until I review the finished work.
- As an owner, I see every finished post and ad at full size with its real caption, call to action,
  destination, schedule and paid/organic identity, and I approve exactly those before anything goes
  out — including a variation produced later.
- As an operator, I upload a past design from my phone or laptop, see it appear with a real preview,
  mark it approved or rejected as a future design reference with a reason, and later inspect whether
  and why a campaign selected it.
- As an operator, I correct a headline or a marked area of an image in Creative Studio, watch the
  preview update, save, and return to review the exact deliverable that will later be sent.
- As an owner, I see what is live, what it actually spent, what it actually produced, and which
  numbers are still missing or delayed, without the page implying a result it cannot prove.
- As an owner, I see an underperforming ad paused within limits I approved, and I see the platform
  say "paused" only after it read the state back from the provider.
- As an owner, I read a clinical comparison of my creatives — what was observed, what is comparable,
  what might explain it, what argues against that, what cannot be known, and what to test next — and
  I decide whether that lesson is reusable.
- As a viewer, I can read a campaign's history, spend and decisions after its approval expired,
  without being offered controls I may not use.
- As an owner, I configure how often the platform researches campaigns and how much it may spend
  doing so, and I see when it last looked, what it skipped and why.

## Scope

### In scope

- Campaign proposal research, the complete proposal document, and the first approval gate
  (preparation approval) in Growth Intelligence.
- Campaign portfolio and Campaign detail redesign around real work, real artwork and the current
  stage with a concrete next action.
- Creative Studio as one focused editor: campaign text, images, layouts, live preview, local AI
  edits, save-and-render, and return to review.
- Asset Library with three purposes: Creative History, Products & Subjects, Brand Kit; a usable
  browser upload journey; real private previews; reference approval separate from publication
  approval.
- Finished deliverable identity, per-output human review, and the second gate: exact-output launch
  approval bound to content hashes.
- Governed dispatch of exactly the reviewed bytes through the existing Tool Gateway; truthful
  per-action state; reconciliation of unknown outcomes.
- Observation at action and variant grain; provider-confirmed pause and human-only resume.
- Clinical investigation, source-linked observations and governed lesson submission; a next-test
  proposal that returns to the full proposal gate.
- Organization-configured research cadence, cost allowance, cooldown and pending-proposal limits.
- Growth Intelligence campaign proposal and campaign preparation surfaces
  (`src/modules/growth-intelligence/`, `src/components/growth-intelligence/`) are in scope for this
  session under `AGENTS.md` section 10.
- Business Memory as context and attributed lessons for the above, through Spec 023's contracts.

### Out of scope

- Channels and its Channel Audit page redesign. Growth Intelligence changes are limited to campaign
  proposal and preparation surfaces and their owning read contracts. Overview needs only compatible
  existing campaign and asset preview readers and destinations.
- Video, Reels, additional ad networks, direct messages, and a full freeform design canvas. The
  initial execution contract is Instagram/Facebook static feed and story creative plus Meta paid ads.
- Any framework replacement, a second Tool Gateway, a new memory vendor, or a parallel campaign
  document.
- Automatic conversion of legacy creative-family approvals into the new exact-output model. Legacy
  records stay readable exactly as they are.
- Deletion of any historical data. No task in this specification deletes past campaigns, bundles,
  manifests, renders, approvals, receipts or outcomes.
- Numeric operating limits of any kind. Cadence, cooldown, pending-proposal caps, research
  allowances, media budgets, exposure floors, margin thresholds and stop thresholds are organization
  configuration and must be explicitly configured. This specification defines no default and permits
  no source-code guess. Absent configuration produces a visible "needs setup" state and no spending
  authority.

## UX flow

The journey is one campaign identity crossing purpose-specific workspaces. Stage names below are
proposed display vocabulary derived from independently persisted state; they are not values to insert
into an existing SQL enum.

- **Proposal (Growth Intelligence).** A separately named "Campaign-ready opportunities" section sits
  after ordinary recommendations, with "Campaign preparation" in Your actions. A proposal leads with
  an action title and the business problem, and states the exact evidence period and scope. It shows
  audience, offer, organic versus paid channels and placements, timing, deliverable count, media
  budget, generation cost limit, success measures and stop conditions. Media spend and platform
  generation cost are separate amounts with separate currencies; unknown is never rendered as zero.
  Estimated impact appears only with its inputs, assumptions, range, method and horizon; when
  unestimated, the gap is explained and the supported advice is still shown. Provenance from Business
  Memory and Creative History is labelled as provenance, not as market citation or authority over
  facts. Primary action **Approve & prepare creatives**; secondary **Request changes**; overflow
  **Snooze** and **Dismiss**, each with a saved reason. A viewer sees the evidence and no mutation
  controls.
- **Creating.** The same card shows preparation state and links to the real campaign. Your actions
  shows the saved decision, the last update and a recovery path where one is permitted. There is no
  duplicate approval state in Growth Intelligence.
- **Review.** Large finished previews with the actual caption, CTA, destination, schedule,
  paid/organic identity and language. A textless plate and a finished poster carry visibly different
  labels. Per-output feedback, reasons, replacement, and batch review with an explicit selection
  summary. Selection alone approves nothing. "Approve as a future design reference" is a separate
  library decision, never implied by publication approval.
- **Studio.** Opened with the exact campaign version, deliverable, direction and language, preserving
  the review context and the return destination. An editing rail, a large live preview, and a
  collapsible context inspector. Typed changes update an unsaved preview and authorize nothing.
  Saving creates the required immutable revision; the final server render is the authoritative
  artifact. Any content change invalidates the affected launch approval.
- **Scheduled / Live.** One confirmation surface may carry both the creative review and the launch
  terms, and must show exactly what it permits: selected final thumbnails, copy, channel and account,
  placement, timezone-resolved schedule, budget ceiling, expiry, measurement and pause terms.
  Per-action queued, scheduled, submitting, live, blocked, failed and confirmation-pending states are
  visible. A live link appears only when a provider receipt confirms the object. Manual export is
  labelled exported and never claimed as external publication.
- **Results & learning.** Delivery coverage, actual spend, reach or impressions, clicks and tracked
  conversions only where available, each with its definition, provider delay and observation window.
  Observed performance and causal business impact stay separate. A comparable creative table plus two
  to four previews side by side, with comparability and confounders stated before any explanation.
  Clinical investigation reads as what happened, comparison group, plausible explanations, evidence
  for and against, what cannot be known, next test, human feedback, and whether the lesson is
  campaign-only or approved for reuse.
- **Needs attention** is an independent marker across all stages with a concrete next action, not a
  stage of its own. A campaign may have an active approved launch while a new proposal version is
  being drafted; editing never erases historical live objects or implies they stopped.
- **Presentation rule (F18).** Client-oriented tasks, strong real artwork, the current stage and next
  action, plain budget and results, compact evidence inspection, and technical diagnostics — version
  ids, digests, attestations — behind disclosure. Exact identities stay in the data model.
- Every surface works at desktop and phone widths, by keyboard, and for supported scripts including
  right-to-left, under no-data, partial-failure, stale-data, expired-approval, viewer and
  cross-tenant-denial conditions.

## Domain rules

### The two gates (ADR 0057)

- **Gate 1 — preparation approval.** Approving a proposal binds the exact proposal version and digest
  and authorizes *preparation only*: bounded creative generation within the approved generation cost
  ceiling. It reserves no media spend, publishes nothing, confirms no creative, and authorizes no
  later variation.
- **Gate 2 — exact-output publication approval.** Publication requires review of each finished output
  as it will actually appear, bound to that output's immutable version and content hash. Approval
  does not transfer to any other output, and a new version never inherits the review of its parent.
- **D05, confirmed.** Every finished variation is reviewed before publication. A generation cap
  authorizes preparation and never authorizes unseen publication. There is no unseen-variation
  publication mode anywhere in this path.
- Material change to a reviewed output — bytes, copy, free line, template, font, brand mark, script,
  destination, schedule, budget or placement — invalidates the affected launch authority. Already
  running provider objects retain their own approved historical identity and are not deleted to hide
  a version difference.
- **Gate 2 has no legacy exemption.** Once ADR 0057 is accepted, no output may be published without a
  Gate 2 review of its exact finished version and content hash, regardless of the rules under which
  its approval was recorded. Legacy V2 records, envelopes, generation policies, variant caps and
  creative families are preserved for reading and historical identity, never as standing publication
  authority. A legacy record reaching dispatch passes Gate 2 or fails closed, and no compatibility
  path, adapter or migration may be used to route around it.
- Reference-library approval and publication approval are different decisions in both directions. A
  brand-approved design may perform badly; a profitable ad may be unsuitable as a brand reference.

### Proposal admission (D07, confirmed)

- A campaign proposal may be presented, and may be approved for preparation, when its internal
  business rationale is supported by current source-owned evidence, even if there is no numeric
  profit estimate, no available external market research, or an unavailable market-monitoring
  profile. Those gaps are shown explicitly as gaps.
- This changes **Campaign proposal admission only**. Generic Decision Engine execution qualification
  is unchanged. `checkDraftEligibility` keeps its existing meaning for the existing governed-draft
  Decision path. A regression test must prove generic execution eligibility did not broaden.
- D07 does not make anything else eligible. Unsupported factual claims, invalid source ownership,
  missing declared subject, and absent spending authority remain refusals. Missing external research
  can never support an external claim: internal observations, test hypotheses and unavailable market
  evidence stay visibly distinct.
- In every case, absent preparation allowance still blocks preparation and absent launch authority
  still blocks launch.

### Research admission (D06, confirmed)

- Research starts from an organization-configured cadence and from meaningful new business evidence,
  plus a manual "Request a campaign" action. It never starts from a page view, a refresh, a memory
  write, or a changed last-fetched timestamp.
- Meaningful evidence is a source-owned revision that passes configured qualification and freshness
  rules.
- Every admission checks organization configuration, source fingerprint, cooldown, pending-proposal
  limit and research allowance. A manual request obeys the same limits and authorizes no creative
  generation.
- Cadence, cost allowance, maximum pending proposals and cooldown are explicitly configured with no
  default. Missing settings produce a visible setup requirement and no model spend.
- A due schedule alone does not require a proposal. "No warranted proposal", "skipped duplicate",
  "research paused", "allowance exhausted" and "research failed" are five distinct explained
  outcomes, each persisted.
- Changing or pausing research settings never cancels approved campaigns, their performance
  monitoring, their containment, or their reconciliation.
- Deduplicate by organization, business issue, audience, offer and evidence revision. A declined idea
  returns only on new evidence or its saved revisit condition. A helpfulness vote is not policy.

### Readiness (C01)

- `CampaignReadiness` has four independent results: `proposal`, `creativePreparation`, `launch` and
  `measurement`. Each carries `status: ready | needs_input | blocked | unknown`, typed blockers, a
  checked time and source revision bindings. A blocker carries a stable code, the affected phase or
  action, a safe explanation and a typed repair target that the client turns into a permitted route.
- **The `proposal` result is defined in full from the outset and returns `status: "unknown"` with a
  typed `proposal_stage_not_implemented` blocker until the proposal stage is wired.** All four parts
  of the type are defined from the outset; only the proposal implementation arrives later, with the
  proposal persistence work. The type is never shipped in three parts and widened afterwards.
- Internal draft validation and current provider execution validation are separate. Unverified launch
  limits never silently become verified limits. An expired provider contract blocks the affected
  launch action explicitly and does not crash internal generation.
- Backend callers consume typed outcomes, never raw error strings. No model invents a limit or
  changes readiness authority.

### Truthfulness and authority

- Marketing is not the automatic answer to every revenue decline. Research distinguishes a demand
  problem from supply, fulfillment, pricing and capacity constraints, and recommends the repair —
  saying whether marketing should wait — when the cause is operational.
- Completion means validated artifacts and saved lineage, not a completed Trigger run. Partial
  failure is reported, only the affected bounded work is retried, and good outputs are preserved.
- A pause is claimed only after a provider read-back confirms the effective delivery state.
  Acknowledgement is not a stop. Unknown and refused outcomes stay visible, stay urgent, and trigger
  reconciliation.
- Resume is never autonomous. It requires current authority and limits, a governed invocation and a
  provider confirmation.
- Historical visibility and mutation eligibility are separate. Fleet, spend and decision history stay
  readable under membership and permission after approval expiry, cancellation or a new version.
- Prices, offers and claims are source-bound. Text editing cannot silently change money or approved
  business intent.
- Failed bounded work preserves whatever usage was actually measured. A failed attempt never reports
  zero model cost; unknown stays unknown until measured usage exists.

## Data model

Adopted from C01–C09. All tables are tenant-owned with RLS, composite organization foreign keys,
immutable-history guards and bounded indexes. All changes are additive and forward-only.

- **Proposals (C02).** `campaign_proposals` for identity and current state; `campaign_proposal_versions`
  for immutable strict documents and digests; `campaign_proposal_decisions` as an append-only actor
  decision log. Proposal identity states: `researching`, `needs_input`, `ready_for_review`,
  `changes_requested`, `approved_for_preparation`, `snoozed`, `dismissed`, `superseded`, `cancelled`.
  Source kinds `manual_request`, `business_signal`, `next_test` are proposal kinds, not Campaign enum
  values. Unique `(organization_id, proposal_id, version)`; document and digest immutable.
- **Proposal document (C02).** `schemaVersion: 1`, carrying title, business problem, objective,
  audience, nullable offer reference with an explicit no-offer choice, requested channels with
  organic/paid distinction, deliverables by format/language/count, timing, proposed media budget,
  generation cost ceiling, success plan, pause policy reference, evidence references, Business Memory
  context manifest reference, assumptions, limitations and readiness results. Money is integer minor
  units plus ISO currency; unknown is never 0; proposed-versus-approved labels derive from appended
  decisions, never from a mutable flag.
- **Campaign source linkage (C02).** Add `campaign_proposal` to Campaign source kinds with
  `proposal_id` and a check requiring exactly the appropriate source link. Do not manufacture a
  qualified Decision opportunity and do not misuse `manual_brief` to avoid the schema amendment.
  Existing manual and Decision campaigns stay readable.
- **Research lifecycle (C03).** `campaign_research_runs` with organization, proposal, source and
  candidate revision, trigger kind, policy version, status, attempt and lease, idempotency and
  request digest, context manifest id and digest, qualified research request ids, cost budget and
  actual bounded usage, timestamps, safe outcome and failure code.
  `campaign_research_policies` with an immutable policy version, enabled state, schedule and
  timezone, evidence qualification rule version, configured thresholds, cooldown, maximum pending
  proposals, per-run allowance and per-window allowance with currency, creator and timestamps, plus a
  controlled current-policy pointer. Research allowance is distinct from media spend and from
  creative preparation allowance. Post-approval creative work reuses `campaign_generation_runs` with
  added proposal and context binding; no competing generation queue is created.
- **Deliverables (C04).** `campaign_deliverables`, `campaign_deliverable_versions`,
  `campaign_deliverable_reviews`. Columns cover organization and campaign identity, composite tenant
  links to the exact bundle version, direction, optional creative variant, poster render or explicit
  existing final asset, template version, script, channel and placement, caption, hashtags, CTA,
  destination, content hash, verification record and timestamps. Finished bytes are referenced
  through an owned asset or render link; **no signed URL ever enters a manifest, review or digest**.
  `finished_poster` and `final_image` are distinct; a textless plate is not automatically a
  `final_image`.
- **Launch manifest (C04).** Binds the exact bundle and proposal version, the selected deliverable
  versions and hashes, and every channel action term including caption, hashtags, CTA, destination,
  accounts, placement, script, timezone-resolved schedule, budget and expiry, and pause policy, plus
  offer and claim source assertions and measurement prerequisites.
- **Bundle manifest V3 (authorized 2026-09-12).** Introducing campaign bundle manifest **version 3** is
  authorized for the deliverable-identity work, **conditional on a V2 backward reader shipping with
  it**. Existing V2 records stay readable, unmodified, and resolvable — a V2 record can be read,
  reconciled and displayed without being rewritten. **Readability is not launch authority.** No V2
  record, legacy envelope, generation policy, variant cap or creative family authorizes the dispatch
  of an output that has not itself passed Gate 2 review of its exact finished version and content
  hash. A legacy record reaching dispatch passes Gate 2 or fails closed. The historical "there is no
  V1 reader, repair forward" instruction in ADR 0020 is a record of a past pre-production act and must
  never be repeated as a "delete past data" step.
- **Pause policy (C07).** Versioned organization and campaign pause policy storing permitted
  deterministic rule ids and versions, exposure floor, applicable metric reporting delay, window,
  numeric thresholds and ceilings, currency, approver and effective period. Every numeric value is
  explicitly configured and approved. Existing global environment values are not a durable per-tenant
  policy. Pause action states: `requested`, `submitting`, `confirmation_pending`, `confirmed_paused`,
  `refused`/`failed`; these are action-state semantics, not replacements for existing variant enums.
- **Investigation (C08).** `campaign_investigation_runs` for bounded durable work;
  `campaign_investigations` for immutable structured reports keyed by organization, campaign and
  evidence digest, with a source-owned exact-version link to the proposal generated for a next test.
- **Creative History (C06).** Reuse `creative_folders`, `creative_items`, `creative_item_versions`,
  `creative_item_reviews` and `creative_item_performance_evidence` from migration
  `20260909124757_creative_history_core.sql`. Do not add duplicates under different names and do not
  reapply superseded rejected-image migrations.
- **Types.** Every new table is either typed by hand in `src/lib/supabase/database.types.ts` or
  listed with its reason in `UNTYPED_TABLES` in `database.types.test.ts`. `pnpm db:types` cannot run
  here.

## API and events

- **Proposals:** `GET/POST /campaign-proposals`, `GET /campaign-proposals/:proposalId`,
  `POST /campaign-proposals/:proposalId/decisions`,
  `POST /campaign-proposals/:proposalId/revisions`, under the organization Campaign module.
- **Deliverables and launch:** `GET /campaigns/:campaignId/deliverables`,
  `POST /campaigns/:campaignId/deliverables/:deliverableVersionId/reviews`,
  `POST /campaigns/:campaignId/launch-approvals`. These extend, and do not ambiguously repurpose,
  existing `/approve` behavior; legacy callers keep an explicit compatibility adapter or fail closed.
  The review path names the **version**, not the deliverable: a review is a verdict on one exact
  set of bytes, and addressing it by deliverable would put back in the URL precisely the
  conflation C04 and D05 exist to prevent — a later re-render would inherit an approval nobody
  gave it. `launch-approvals` is plural because authority accumulates: superseding writes a new
  approval and leaves the old one readable, so the path names a collection, as `campaign-proposals`
  above does.
  There is deliberately **no** route for recording a finished deliverable version.
  `record_campaign_deliverable_version` is granted to the render worker alone, so a member-facing
  route could only fail; its absence is what stops a "finished output" being hand-written for a
  render that never happened.
- **Research settings:** a permission-checked settings route exposing schedule and timezone,
  qualifying changes, cooldown, pending limit and separate per-run and per-window research
  allowances, plus last evaluation, last successful research, next evaluation and
  skipped/paused/exhausted states.
- Read and list payloads are typed DTOs. A decision body names the exact version and digest, the
  decision, an optional reason or date, and an idempotency key. **Actor and organization authority is
  never accepted from request JSON.**
- Domain outcomes map exactly: 401 unauthenticated; 403 unauthorized; 404 not found or not visible;
  409 version or idempotency conflict; 422 invalid business prerequisite; 503 unavailable dependency.
  A 202 for accepted background intent returns saved domain state and is never proof of completion.
  A 200 carrying a typed refusal is a refusal and must not render success.
- **Services:** `createCampaignProposalService` in a new `application/proposal-service.ts` with
  `request`, `decide`, `requestRevision` and `read`. Proposed RPC names `request_campaign_proposal`,
  `decide_campaign_proposal`, `complete_campaign_proposal_version`; verify no collision at
  implementation time.
- **Workers:** `campaign.research-proposal` composed in `src/workflows/campaigns/research-proposal.ts`
  and registered in `src/trigger/campaigns.ts`, with a payload of organization, proposal, run and
  correlation ids only. PostgreSQL owns claim, lease, retry and completion; Trigger owns execution.
  Trigger runs to the cloud project; never a local worker.
- **Events** are past-tense and identifier-only: `campaign.proposal_requested`,
  `campaign.proposal_prepared`, `campaign.proposal_approved`, `campaign.proposal_changes_requested`,
  `campaign.creative_reviewed`, `campaign.launch_approved`, `campaign.investigation_completed`.
  Schemas and durable capture or outbox intent are registered in the same transaction as the state
  change; a logger-only publisher is insufficient.

## AI behavior

- A model may: interpret business evidence, draft alternatives and a recommended hypothesis, propose
  descriptive metadata, generate imagery and copy inside approved terms, propose a creative
  hypothesis, propose a next-test variation, and explain a recorded decision.
- A model may not: choose a business fact, declare a causal conclusion, set or change policy,
  approve anything, hold a credential, call a side-effect tool, override a deterministic
  comparability verdict with a confidence score, or promote a rule into brand policy or verified
  memory.
- Every model output crosses a Zod schema and deterministic validation before it is persisted or
  displayed. Structured reports keep hypothesis wording in its own labelled, validated field; the
  existing settled-outcome overclaim validation is preserved and is not bypassed to allow an
  explanation.
- Generation order is textless visual plates first, then exact text and brand marks composed
  deterministically. Multiple creative hypotheses must differ in a declared way that is useful for
  later comparison; a random image batch is not an experiment.
- Selection is pinned before model spend: at most 3 approved designs, 5 rejected designs for
  Blueprint only, and 12 supported negative rules, per ADR 0049, with exclusions and reasons stored.
  The final image port accepts `FinalImageReference[]` only; Blueprint accepts
  `BlueprintEvidenceReference[]`; these are separately constructed and validated, never a cast or a
  filtered shared array. **Rejected bytes, ids and paths have no path to the final adapter.**
- Internal private context never enters a public research query. Business Memory context references
  are provenance, distinct from market claim citations, and carry no authority over facts.
- A human rejection reason is preference evidence and a low-performing ad is performance evidence.
  They are never automatically equated.

## Security and tenancy

- Read APIs use session clients under RLS with current permission checks. No service role appears on
  any user-facing request path.
- Private previews use session-authorized source identity and bounded URL expiry, with a safe
  no-preview state on signing failure. Signed URLs never enter manifests, digests, reviews, logs or
  errors.
- Mutations go through scoped controlled RPCs. Privileged worker RPCs revoke PUBLIC, anon and
  authenticated, and validate organization, run and lease. `SECURITY DEFINER` functions set an empty
  search path and check organization and permission explicitly.
- Permissions use existing named capabilities; new capabilities are defined only for genuinely new
  actions and are checked as capability policy, not as broad "not a viewer" comparisons. Manage
  permission is not launch or spend approval permission. Roles are rechecked after session changes
  and again at background execution.
- Approving a proposal rechecks role, exact current version and digest, source freshness, proposal
  eligibility and preparatory cost limits inside the transaction. A duplicate request replays the
  committed result; different content under the same key is refused.
- Cross-tenant source ids, forged actors, guessed ids and stale permissions fail closed everywhere,
  including in background execution.
- A new `plpgsql` function that reads a table it did not create must be called once against staging
  before it is considered done — subject to the standing migration constraint above.

## Observability

- Structured logs carry `organizationId`, `runId`, `workerId` and `correlationId` where available,
  plus campaign, proposal, bundle version, deliverable version and action identifiers.
- Sensitive changes emit audit events with organization, actor, source identity and version, decision
  kind, correlation and event timestamp.
- Worker telemetry records task and run, stage, elapsed time, actual bounded cost or usage, and a
  safe reason code.
- Prompts, raw provider responses, customer information, storage credentials and signed URLs never
  enter public errors or logs.
- Operational surfaces expose last evaluation, last successful research, next evaluation, skipped,
  paused and exhausted states, metric freshness and missingness, and pending provider confirmations.

## Failure states

Each of these is a named, persisted, explained state — never a silent gap or a false success.

- Source facts unavailable; no declared subject; synthetic path not permitted.
- Proposal not approved; proposal superseded by new evidence; proposal stage not implemented
  (`unknown` readiness).
- Research paused, allowance exhausted, cooldown active, pending limit reached, duplicate skipped, no
  warranted proposal, research failed.
- Generation bootstrap failure before the run is claimed — persisted as a typed terminal or
  recoverable blocked outcome, never left forever `queued`. The original failed attempt is preserved
  as historical evidence and is not edited into success.
- Required creative rejected; render verification pending; content changed after approval; unsupported
  script or missing glyph (a named refusal, never a silent font switch or transliteration).
- Provider contract expired; provider mapping missing or ambiguous; scope revoked; adapter absent;
  credentials expired.
- Publish confirmation pending; provider outcome unknown; partial multi-channel delivery.
- Pause requested, submitting, confirmation pending, refused, or acknowledged without an effective
  stop — the last of which stays urgent because money may still be moving.
- Measurement unavailable, stale, delayed or restated; budget missing; currency conflict.
- Upload: bytes transferred, processing, usable, needs review, refused — five distinct states. A
  failed finalize, including a 200 carrying a typed refusal, never shows Uploaded or Ready.

## Acceptance criteria

- A client reviews a meaningful campaign proposal derived from actual business evidence without
  writing the strategy themselves, and the proposal renders honestly when profit estimate or external
  research is unavailable.
- Approving a proposal provably cannot reserve media spend, publish, confirm a creative, or authorize
  a later variation.
- A generic Decision Engine execution eligibility regression proves admission did not broaden.
- The client uploads a past design, reviews it, and can inspect whether and why a later campaign
  selected it.
- Rejected image bytes cannot reach the final image adapter, proven by inspecting the actual adapter
  payload with a rejected reference fixture.
- The client corrects text or a marked image area, inspects the result, and approves the exact
  deliverable that is later sent; an unreviewed later variant fails launch even under a previously
  approved generation family.
- Dispatch sends the reviewed deliverable version and hash — never `direction.assetIds[0]`, the newest
  render, the current gallery selection, or the first account mapping.
- The named failed run `run_06g9cko3ehp1gemp1f1v6k6h01` becomes an actionable saved outcome with a
  valid recovery path, and its historical failure is preserved.
- An approved output launches once, receives a provider identity, collects delayed results, and can
  be demonstrably paused with provider read-back.
- A clinical comparison produces evidence-linked hypotheses and a next test, with no invented
  attribution and no automatic brand-rule promotion.
- Portfolio, detail, Studio and Library remain usable under no-data, partial failure, stale data,
  expired approval, mobile, keyboard, viewer and cross-tenant denial scenarios.
- V2 bundle records remain readable and unmodified after V3 is introduced.
- A legacy V2 record with a pre-ADR-0057 envelope approval, driven at dispatch, **fails closed** unless
  its exact finished output has passed Gate 2 review. This is tested with a legacy fixture, not
  assumed from the absence of legacy data in one inspected organization.
- Every claim of completion states which of the four status fields it satisfies.

## Test plan

- **Domain:** readiness results and blocker codes; proposal document schema and digest immutability;
  deliverable identity and review binding; deterministic comparability; policy validation including
  rejection of malformed numeric values such as a numeric prefix with trailing text; selection caps
  3/5/12 with stable tie-breaking.
- **Application and route:** typed outcome to HTTP mapping; idempotent replay; stale version and
  digest mismatch; 200-carrying-refusal handling; permission revocation mid-flight.
- **Adapter boundary:** a regression capturing actual Blueprint and final-image input construction
  with approved, rejected, unreviewed, archived and other-tenant files, asserting no rejected byte,
  id or path reaches the final adapter.
- **Worker:** a failure injected while constructing task dependencies, before `generateCampaignBundle`
  is entered — mocking only errors inside the workflow misses F01/F02. Lease loss, cancellation,
  duplicate event, stale snapshot, unavailable memory, malicious source text.
- **Tenancy:** owner, admin, operator, reviewer, approver, viewer and tenant A/B paths at
  application, RLS and private-storage layers, including guessed ids, forged actors and mismatched
  source or render references. pgTAP suites run against hosted staging and are integration checks,
  not an isolated unit layer.
- **Browser:** Chrome DevTools MCP at desktop and phone widths for upload, review, Studio edit,
  proposal review and results; a component is not proven mounted by its own unit test. Frontend work
  is not done until exercised in the browser at both widths.
- **Memory:** the planning prompt must contain actual selected entry contents; a digest-only fixture
  must fail this acceptance.
- **Gates:** `pnpm typecheck`, focused and full `pnpm test`, `pnpm lint`, `pnpm build`, relevant pgTAP
  and authenticated Playwright suites, with exact exits recorded and unrelated baseline failures
  listed separately. Stop the dev server before running the test suite.

## Migration and rollback

- All schema changes are additive and forward-only. Proposed migration suffixes:
  `campaign_generation_bootstrap_recovery`, `campaign_proposal_preparation_approval`,
  `campaign_research_proposals`, `campaign_finished_deliverables`,
  `campaign_exact_output_launch_approval`, `campaign_confirmed_containment`,
  `campaign_clinical_investigations`, `campaign_research_cadence`.
- **No push without a separate explicit user decision**, per the standing constraint above. Until
  then these migrations exist in source only, and no task may claim staging-applied status.
- Backward readers preserve existing campaigns, V2 manifests, renders, approvals, reference receipts
  and outcomes. New paths are feature-gated per organization.
- Rollback stops new admissions and new execution while leaving all history readable. Disabling a
  feature does not stop ads already running at a provider; the containment path stays operational in
  every rollback. There is no rollback to a local-only "paused" assertion.
- Legacy creative-family approvals are never auto-converted. They remain readable as the record of
  what was decided under the rules in force at the time, and no legacy approval silently acquires new
  meaning. **A legacy approval is not standing publication authority**: once ADR 0057 is accepted, any
  output reaching dispatch — legacy or new — passes Gate 2 review of its exact finished version and
  content hash, or fails closed. An object already running at a provider keeps its historical identity
  and its containment, reconciliation and measurement paths; that is continuity of an existing object,
  not authority to publish a new one.

## Activation gates

These are blocked, named gates. Code may be written and merged behind them; activation may not.

- **Meta provider qualification — BLOCKED.** Missing evidence: current official Meta documentation
  and controlled-account proof for each desired organic, paid, pause and read capability; an exact
  pinned API/SDK version; account eligibility; granted scopes; formats and limits; billing
  constraints; reconciliation support. The checked-in contract's `expiresAt = 2026-09-10` **must not
  be extended** without that evidence. Injecting today's date into a fixture, or returning guessed
  platform limits to clear the exception, is prohibited.
- **Organic dispatch canary — BLOCKED.** Missing evidence: a qualified organization-owned Meta
  connection with a credential reference. The audited organization has none. Code, fixtures and
  adapter sandbox checks may proceed; the canary may not run.
- **Confirmed pause canary — BLOCKED.** Missing evidence: a controlled account with a live bounded ad
  to pause and read back, plus approved per-organization pause policy values. Paid live dispatch stays
  blocked until this gate passes; passing the organic gate does not open it.
- **Staging application and worker deployment — BLOCKED pending the user's migration decision**, per
  R2 above.
- Readiness must distinguish "connected" from "publish-enabled" at all times, and a blocked gate is
  reported with its exact missing evidence rather than as a generic unavailability.

## Documentation updates

Amended in place on 2026-09-12, each amendment dated and attributed to ADR 0057 or to this
specification. Historical text is superseded, never deleted.

- **ADR 0020** — the unseen-variant publication allowance is superseded for the new path.
- **Spec 016** — the envelope user story, the "approve an envelope" flow step and the creative-variant
  rules are superseded for the new path.
- **ADR 0015, ADR 0017** — bundle system of record and exact-version approval extended by the two-gate
  model and manifest V3 with a V2 backward reader.
- **ADR 0021** — allocation thresholds move to versioned organization-scoped policy; pause is claimed
  only on provider read-back.
- **ADR 0049** — cutover through the real call sites is restated as outstanding.
- **ADR 0054, Spec 023** — Campaign context consumption must prove actual entry contents reach the
  planning call.
- **Spec 005** — generic Decision Engine execution admission explicitly unchanged by D07.
- **Spec 010** — the two gates are recorded in the approval governance model.
- **Spec 019, Spec 020** — Creative History completion state and Studio boundaries.
- **Spec 022** — section 10.1 eligibility is unchanged for the Decision governed-draft path and does
  not govern the new Campaign proposal admission.
- **`docs/collaboration/asset-library-and-studio-board.md`** — session ownership and touched files.
