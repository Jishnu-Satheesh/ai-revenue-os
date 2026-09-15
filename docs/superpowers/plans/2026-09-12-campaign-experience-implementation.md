# Campaign experience implementation plan — review draft

- **Status — updated 2026-09-13.** The user gave explicit full approval to implement this plan on 2026-09-12: *"Let's rework on the Campaign module end to end as planned and drafted. I'm giving you the full approval for the implementation."* Feature code for Tasks 1–17 is therefore authorized, subject to each task's own review checkpoint. **Two activation gates remain CLOSED and are not covered by that approval: (1) applying any migration to hosted staging, which needs a separate explicit user decision because `pnpm db:migrations:push` is all-or-nothing over at least five pending `20260912*` migrations; and (2) provider activation — no organic or paid dispatch, no live canary, no extension of the Meta contract's `expiresAt = 2026-09-10`.** Approval to implement is not approval to push migrations or to publish. The superseded original status line read: *"proposed implementation sequence; no feature code, migration application or provider activation is authorized."* Product confirmations, including D06 automatic/scheduled/manual research and D07 supported proposals with evidence gaps, are in the design. This is a handoff for one coding agent working sequentially, using `executing-plans`.
- **Goal:** complete the business-aware campaign proposal → human approval → reviewed creative → governed launch → observation → clinical learning journey, with a coherent redesign of Campaigns, detail, Creative Studio and Asset Library.
- **Architecture:** retain immutable Campaign bundles, source-owned intelligence, shared Business Memory, private creative history, deterministic Tool Gateway and hosted Postgres authority. Add explicit proposal approval and exact finished-output launch binding; close the disconnected runtime boundaries before enabling external actions.
- **Stack:** existing Next.js/TypeScript, shadcn/Tailwind, TanStack Query/Form, Supabase/Postgres/RLS/Storage, Trigger.dev and installed AI/provider adapters. No framework replacement, freeform design engine or new memory vendor.
- **Read first:** [design](../specs/2026-09-12-campaign-experience-design.md), [audit](../../verification/campaigns/2026-09-12-workflow-audit.md), [contracts](2026-09-12-campaign-experience-contracts.md), [visual contract](2026-09-12-campaign-experience-visual-contract.md).

## Global execution rules

- Follow repository mandatory context order, relevant specs/ADRs and collaboration board; preserve all unrelated dirty files. Read actual current files, not just this dated baseline.
- Each task below produces a bounded testable deliverable. Start with the named failing behavior, implement its contract, run focused checks, inspect diff, record evidence and obtain the normal review checkpoint. Do not combine unrelated tasks because they share a directory.
- Plans are bullets by repository convention. Inline test scenarios below are acceptance specifications; write real tests against domain/RPC/route/composition boundaries, not snapshots mirroring markup.
- New domain and API contracts are strict Zod. Update matching SQL validators, types, readers, writers, digest rules and compatibility fixtures in the same task.
- Every new migration is forward-only. Discover the installed CLI command, create it with a descriptive suffix, inspect staging schema, dry-run and review exactly the pending set before any separately authorized staging application. Never push all the unrelated pending Memory migrations as part of a Campaign task.
- `pnpm db:test` uses shared hosted staging. New PL/pgSQL functions reading existing tables must execute there at least once with realistic allowed and denied cases. No local Supabase/Docker; no `pnpm db:types`; maintain `database.types.ts` narrowly.
- No source/service-role shortcut in browser or user request paths. Verify actor, organization, permission, object ownership and version at every mutation; repeat authoritative execution checks in workers.
- Every finished post/ad, including each later variation, must have exact human review before publication. Generation caps do not authorize unseen outputs. Nothing in this plan permits automatic resume, budget increase, offer change or deletion.
- Gate paid activation on provider-confirmed pause/reconciliation and measurable spend. A local `paused_by_agent` row is not evidence of stopped spend.
- Full quality gates apply before rollout; fixture, mocked-provider, hosted database, authenticated-browser and real-provider evidence are reported separately. Skipped tests remain unverified.
- Never run broad formatting, stash, reset peer files, stage everything or git push. Keep commits narrow if the user authorizes/requests committing the implementation.

## Task 0 — Reconcile decisions, baseline and governing documents

- Impacted files: `docs/collaboration/asset-library-and-studio-board.md`; this design/contracts/visual/implementation package; relevant status/sections of Specs 005, 010, 016, 019, 020, 022, 023 and ADRs 0015, 0017, 0020, 0021, 0049, 0054.
- New governing feature spec: select the next free `specs/` number using `000-spec-template.md` and name it Campaign experience and marketing loop. Add a proposed ADR for proposal preparation approval versus exact-output publication approval. Do not mark either accepted until the user approves it.
- [ ] Read current git status, source hashes and staging migration history. Record which existing CP1 Creative History and Spec 023 tasks are implemented, applied and proved, separately. **Partially done 2026-09-12: git status, source hashes, CP1 and Spec 023 task-by-task records are complete (reconciliation §1, §4, §5). The staging half is BLOCKED — the Supabase MCP server returned CONNECT_TIMEOUT and `pnpm db:migrations:list` was not run, so no migration's applied state was verified. See reconciliation §2.**
- [x] Carry all confirmed conversation decisions, including D06 and D07, into the formal spec/ADR. Do not re-ask them. Reconcile first/second approval semantics and Campaign proposal admission with current source and SQL invariants; generic execution qualification remains unchanged.
- [x] Explicitly supersede unseen-variant publication for the new path; preserve legacy readable history without auto-converting old approvals.
- [x] Reconcile immutable proposal → bundle linkage and V2/V3 compatibility. Reject any plan that deletes past data or broadens generic Decision Engine admission as a shortcut.
- [ ] Have the concrete spec and amended execution plan reviewed before Tier 2/3 code. No numeric allocation or research policy default may be invented by the implementer.
- [ ] **DEFERRED to Task 0b (2026-09-12):** before production UI work, prepare `.superdesign/campaign-experience/prototype.html` covering portfolio, detail, Studio, Library and Growth proposal review with visibly fictional data, the named empty/error/role states and no real uploads/provider calls. Capture desktop/mobile views, exercise keyboard/navigation/review/edit/upload simulation, and obtain visual review. Treat this as a design artifact, not production acceptance.
- Proof: acceptance checklist maps every audit finding F01–F18 to the tasks below; source-only, staging-applied, worker-deployed and live-verified status have separate fields.
- Risk/rollback: documentation changes alter intended behavior; unapproved sections remain Proposed, current accepted contracts remain authoritative until explicit amendment.

**Status 2026-09-12 — Task 0 complete as governing documents; no feature code written.** Delivered:
`specs/025-campaign-experience-and-marketing-loop.md` (Proposed),
`adrs/0057-campaign-preparation-approval-vs-exact-output-publication.md` (Proposed),
`docs/verification/campaigns/2026-09-12-implementation-reconciliation.md`, dated amendments to
ADRs 0015/0017/0020/0021/0049/0054 and Specs 005/010/016/019/020/022/023, and a board entry.
Remaining Task 0 box: the `.superdesign` prototype, deferred to **Task 0b** immediately before the
first production UI task.

**Standing constraint for Tasks 1–17:** no migration is pushed to hosted staging during this run
without a separate explicit user decision — `pnpm db:migrations:push` is all-or-nothing.

**Corrected 2026-09-13: there are FIVE pending `20260912*` migrations, not three.** They are
`20260912030945_business_memory_channel_contexts`,
`20260912090000_growth_intelligence_item_contexts`, `20260912120000_business_memory_growth_capture`,
`20260912130000_business_memory_campaign_capture` and
`20260912140000_business_memory_campaign_context_usage`. The earlier count of three was wrong. The
application state of the `20260911*` Business Memory set is **also unverified** — the 12 September
audit reported only that `20260909124757` is present and that the local `20260912*` Memory migrations
are absent; it never reported the `20260911*` set as applied. The blast radius of the user's eventual
migration decision is therefore at least five migrations and possibly more, and only a
`pnpm db:migrations:list` against staging can settle it. Schema tasks may reach **source** status only
until that decision is taken.

## Task 1 — Make generation readiness and failure recovery truthful

- Impacted files: `src/trigger/campaigns.ts`, `src/workflows/campaigns/generate-bundle.ts`, `src/workflows/campaigns/revise-bundle.ts`, `src/modules/campaigns/application/verified-limits.ts`, new `src/domain/campaigns/readiness.ts`, `src/modules/campaigns/infrastructure/run-repository.ts`, `src/modules/campaigns/application/studio-view.ts`, generation/retry routes and controls, Meta contract reader.
- Tests: new `src/trigger/campaigns-wiring.test.ts`; existing workflow/run-repository/studio-view/verified contract tests; new hosted generation-bootstrap-recovery pgTAP suite if RPC lifecycle changes.
- Contracts: C01/C03; new migration suffix `campaign_generation_bootstrap_recovery` if required. Do not change external contract expiry as a substitute for handling it.
- [ ] Reproduce expiry during task dependency construction before workflow entry. Assert no AI/provider call and a stored recoverable outcome, not a forever-queued domain run.
- [ ] Separate bounded internal-draft validation from current execution-provider validation. Include missing/blocked placements, expired contract and unknown content limits.
- [ ] Implement authoritative preclaim/bootstrap failure and stale-queued reconciliation without creating a claim another worker owns. Validate tenant/run identity and concurrent completion.
- [ ] Map safe failure/readiness codes to actionable client copy, next action and real retry state. Retry refuses unchanged deterministic blockers; a changed prerequisite permits a new recorded attempt.
- [ ] Preserve the named failed run as historical evidence. After authorized repair, retry through the real application path and verify new run/result persistence rather than editing the old row to success.
- Checks: focused Vitest; cold typecheck; lint touched paths; hosted denial/concurrency tests for changed RPCs; run the repaired staging path once before claiming recovery.
- Blast radius: generate/revise/manual edits using provider limits, portfolio/no-version detail, retry behavior and worker initialization. Rollback keeps truthful failure handling and launch refusal; never reenable stale contracts.

## Task 2 — Complete Creative History persistence and upload API

- Impacted files: existing `src/domain/campaigns/creative-history.ts` and selector; new `src/modules/campaigns/application/creative-history-service.ts`, `infrastructure/creative-history-repository.ts`, `application/creative-history-route-handlers.ts`, `infrastructure/creative-history-route-wiring.ts`; planned `/api/organizations/[organizationId]/assets/creative-history` routes from approved CP1 plan.
- Read `2026-09-09-creative-history-asset-library-correction.md` Tasks 3–6 and staging core migration first; avoid recreating `creative_items`/folders/version/review tables.
- **Scope note added 2026-09-13.** CP1 Tasks 1–3 are delivered; **CP1 Tasks 4–9 were never started.** What exists is four domain files, `20260909124757_creative_history_core.sql` and `creative_history_core_test.sql`. This task therefore builds the entire application layer, repository and every route from nothing — it does not "complete missing files" beside working ones. The selection-receipt migration (CP1 Task 6) also does not exist. Size and sequence accordingly. Evidence: `docs/verification/campaigns/2026-09-12-implementation-reconciliation.md` §4 and §10.
- Tests: service/repository/route tests beside those files; `supabase/tests/database/creative_history_core_test.sql` and new targeted intake/review/receipt pgTAP suites. Contracts: C06.
- [ ] Prove create folder, prevent descendant cycles, reserve version, upload/finalize, latest review, archived exclusion, confirmed metadata and rights constraints through actual service contracts.
- [ ] Complete missing forward RPC/storage/receipt bindings, with separate caller permissions for manage and review. Validate source render → history linkage and same-tenant composite references.
- [ ] Expose a file intake DTO containing current allowed types/size and signed upload instructions without leaking worker credentials.
- [ ] Make finalize idempotent after a lost response; changed bytes under the same reservation fail; partial failure never rolls back another file's completed version.
- [ ] Execute hosted owner/operator/viewer/cross-tenant paths and real file transfer/finalize with sanitized test imagery, recording private-storage denial tests.
- Blast radius: only corrected history/intake contracts and existing shared asset services where reused. Rollback disables new intake selection while preserving saved items/versions; no destructive rollback migration.

## Task 3 — Ship the usable Asset Library upload and review workspace

- Impacted files: `src/components/assets/asset-workspace.tsx`, `asset-upload.tsx`, `asset-library-grid.tsx`, `asset-review-form.tsx`, `subject-list.tsx`, assets page; new `creative-history-grid.tsx`, `creative-history-inspector.tsx`, `creative-folder-tree.tsx`, `asset-query-options.ts` and tests.
- Contracts: C06/C09 and visual contract section 7. Existing brand-asset API remains for Products & Subjects/Brand Kit; finished history uses Task 2 API.
- **Scope note added 2026-09-13.** CP1 Task 5 was never started, so this task builds the three-purpose Asset Library surface from the current References / Campaign output / Dishes tabs, against an API that does not exist until Task 2 lands. `AssetUpload` exists but is mounted nowhere, and `assets/page.tsx:83` sets every `previewUrl` to `null` — both the upload journey and real previews are new work, not repairs. Evidence: reconciliation §4 and §10.
- [ ] Build the three purpose tabs with shareable filters, actual image previews and selected exact-version inspector. Use server permissions and stable organization query keys.
- [ ] Mount Upload assets in the page header and appropriate empty states. Support file picker/drop, per-file purpose/rights/metadata, duplicate filenames, progress, cancel and retry only failed members.
- [ ] Validate upload bytes transferred versus final usable result. Test 200+refused, lost response, retry, expired upload URL and processing failure without false success toast.
- [ ] Add approve/reject-as-reference with required reasons/history; folder verdict must never be inferred. New file versions start unreviewed; archive preserves prior receipts.
- [ ] Complete source-photo/description creation and confirmation entry points; display industry-neutral labels and supported language direction.
- [ ] Test keyboard and mobile upload/review/inspector, no-data/no-preview/partial source states and viewer read-only access. Verify the component is mounted in the real route, not only unit rendered.
- Checks: component/service/route tests plus authenticated browser upload → finalized preview → reviewed history. No end-to-end claim from `AssetUpload.test.tsx` alone.
- Rollback: switch presentation while keeping all saved content readable. Do not fall back to the rejected-image runtime path from Task 4.

## Task 4 — Complete positive/negative reference separation at the actual provider

- Impacted files: `src/ai/campaign-generation-provider.ts`, `src/workflows/campaigns/generate-bundle.ts`, `src/modules/campaigns/infrastructure/generation-readers.ts`, `blueprint-planner.ts`, `campaign-planner.ts`, `reference-prompt.ts`, `gemini-campaign-generation-provider.ts`, related factories and selector/receipt storage from CP1.
- Contracts: C06 and ADR 0049; use the existing `FinalImageReference` and `BlueprintEvidenceReference` definitions. Finish the approved forward cutover rather than inventing an alternate selector.
- [ ] Add an adapter-boundary regression with approved, rejected, unreviewed, archived and other-tenant files. Capture actual Blueprint and final-image input construction and assert rejected bytes/IDs/paths never reach the final adapter.
- [ ] Pin deterministic selection and its current metadata/review/rights revisions before model spend. Prove caps 3/5/12 and weak-match exclusions with exact scenario tests and stable tie-breaking.
- [ ] Migrate production planner/provider signatures and payload validation to separate evidence types. Remove the shared array/avoid-role runtime path; preserve old receipts as historical read-only data.
- [ ] Test manual override within eligibility; stale/revoked reference rights; missing object; rejection after selection; replay with changed candidate pool; tenant-mismatched receipt.
- [ ] Run one authorized staged generation using sanitized reviewed reference fixtures and inspect its saved selection/Blueprint/final receipt, not raw private payloads.
- Rollback: new generation may be disabled; the structural rejected-byte fence stays. Do not reactivate the superseded legacy final-generation avoid path.

## Task 5 — Persist complete proposals and preparation approval

- Impacted files: new `src/domain/campaigns/proposal.ts`, `application/proposal-service.ts`, `infrastructure/proposal-repository.ts`, proposal route handlers/wiring, organization-scoped campaign-proposals routes; existing Campaign creation/source/snapshot/digest/types where C02 requires linkage.
- New schemas: C02 tables, strict proposal document, versioned decisions, Campaign source link amendment and durable post-approval generation intent. Migration suffix `campaign_proposal_preparation_approval`.
- Tests: proposal domain/service/route tests; new `supabase/tests/database/campaign_proposal_approval_test.sql`; compatibility tests for old manual/Decision campaigns.
- [ ] Write acceptance fixtures with audience, no-offer/real-offer, organic/paid channels, separate media and generation budget, exact success measures, sourced/unknown impact and readiness.
- [ ] Prove D07 at the real proposal admission/read boundary: internal evidence with no profit estimate, no external research, and both absent remains reviewable with explicit gaps. Missing/foreign source evidence cannot support a factual proposal; unsupported market claims are refused. In every case, absent preparation allowance or launch authority still blocks its respective action. Run a regression proving generic Decision execution eligibility did not broaden.
- [ ] Implement immutable version/digest and source/actor integrity. Owner/admin approval of the displayed revision is distinct from an operator drafting it; use capability policy, not broad role comparisons.
- [ ] Make approval → campaign link → generation intent atomic and idempotent. Concurrent clicks and retries create one link/intent; stale revisions, changed terms and cross-tenant source IDs fail.
- [ ] Add changes requested, snooze/until and dismiss with saved reasons and truthful current state. Changing audience/offer/budget/success terms requires a new proposal revision.
- [ ] Prove preparation approval cannot reserve media spend, publish, confirm a creative or authorize a later variation.
- [ ] Execute new hosted RPCs with valid source rows and deny direct mutation/cross-tenant/viewer/forged-actor paths; verify schema/type agreement and backwards readers.
- Blast radius: creation, source snapshots, Growth handoff, future bundles and Memory event capture. Rollback gates new proposals while existing linked campaigns and history remain readable.

## Task 6 — Connect evidence, Business Memory and real campaign research

- Impacted files: new `src/modules/campaigns/application/research-service.ts`, `application/research-policy-service.ts`, `infrastructure/research-policy-repository.ts`, `infrastructure/research-context-reader.ts`, `infrastructure/research-planner.ts`, `src/domain/campaigns/research-policy.ts`, `src/workflows/campaigns/research-proposal.ts`; `src/trigger/campaigns.ts`; new `src/modules/growth-intelligence/application/campaign-evidence-reader.ts` composing the existing Growth evidence repository behind a typed read port; existing Memory context repository/renderer and generation readers. Paths without a root in this bullet are relative to `src/modules/campaigns/`.
- New schemas: C03 research run lifecycle and `campaign_research_policies`/current-policy binding; typed alternative/proposal model output; source manifests; research request/cost records. Migration suffix `campaign_research_proposals`. Create policy/allowance enforcement here before any research can spend; Task 16 adds automatic scheduling and the client settings surface.
- [ ] Validate explicit organization policy, record its immutable version/trigger kind on the research run, and enforce allowance reservation, cooldown and pending limits for manual/staged requests. Deny absent policy, stale policy, cross-tenant policy access and concurrent overspend. Never defer cost enforcement until automatic research is enabled.
- [ ] Reconcile and finish the relevant Spec 023 prepare/consume/pin work already in progress before adding another context layer. Test actual selected entry contents in the planning prompt; a digest-only fixture must fail this acceptance.
- [ ] Gather current source-owned business data, goals, capacity/constraints, prior actions and scoped reviewed context. Resolve whether marketing addresses the observed problem; operational blockers produce useful advice rather than mandatory ads.
- [ ] Connect qualified external evidence through existing research contracts. Test unavailable/expired/conflicted evidence, private-query exclusion and missing reuse rights. No direct arbitrary provider SDK/web call from a model.
- [ ] Draft bounded alternatives and a supported proposal, validate facts/offers/claims and proposed amounts, then save a new proposal version. No creative generation before Task 5 approval.
- [ ] Preserve measured cost/latency for failed external work and model repairs. Add cancellation, lease loss, duplicate event, stale snapshot, unavailable memory and malicious source-text tests.
- [ ] Exercise the source-backed staged request with bounded approved research spend; confirm the resulting proposal is readable and exact provenance is stored.
- Rollback: disable new research admissions; retain existing proposals/context receipts. Proposed policy/cadence values remain explicit configuration, not source-code guesses.

## Task 7 — Restore the Growth Intelligence campaign proposal handoff

- Impacted files: `src/components/growth-intelligence/growth-intelligence-workspace.tsx`, `priority-actions.tsx`, `campaign-draft-action.tsx`, `campaign-preparation-card.tsx`, `your-actions-tab.tsx`; new `campaign-proposal-card.tsx`, `campaign-proposal-review.tsx`; Growth read-model/service; `new-campaign-brief.tsx` and its route/callers.
- Contracts: C02/C09; visual sections 3/4; preserve ordinary recommendation triage and their source IDs. Do not rename Planned to Approved.
- [x] Restore the separately named campaign section after ordinary recommendations, with real proposal rows and honest no-proposal/research/needs-input/failure states.
- [x] Render full proposal review and exact preparation-approval terms; Request changes, Snooze and Dismiss retain input/outcome. Viewer sees evidence but no mutation controls.
- [ ] Link a saved approval to real Campaign preparation in Your actions; preserve route/tab context, error/retry, latest update and the actual ready creative-review link.
- [ ] Change manual request to the same proposal-first journey. Keep typed caller/response compatibility deliberate; do not show “Generation queued” before the new approval transaction exists.
- [ ] Reconcile the dormant `createGrowthIntelligenceOpportunitySource` with actual SQL/worker admission. Reuse its useful semantics, but do not remove legacy execution gates or generate fictitious numeric impact to populate a list.
- [ ] Browser proof: request/research → full proposal → approval → one Campaign → creative preparation, with reload/back, double submit, stale approval and cross-tenant denial.
- Rollback: stop new proposal actions and retain readable saved preparation; ordinary Growth recommendations and Channel Audit stay intact.
- Status 2026-09-16: the two read boxes above are done and the decision path is wired to the existing decisions route. The seam is documented at `docs/collaboration/campaign-and-growth-intelligence-seam.md`. Needed no migration — the proposal tables already carry member `select` policies from `20260913120000`. Deliberately still open: Your actions still shows the older `draftRequest` preparation rather than proposal-linked preparation; the manual request is still opportunity-first; `createGrowthIntelligenceOpportunitySource` stays dormant; and the browser proof of the populated states is blocked because staging holds **zero** proposals and both `campaign_proposal_versions` and `campaign_proposal_decisions` carry immutability triggers, so a hand-made fixture row could never be removed. That proof arrives with the first real research run, which needs the research policy switched on.

## Task 8 — Produce tracked finished deliverables from the approved proposal

- Impacted files: new `src/domain/campaigns/deliverable.ts`, `application/deliverable-service.ts`, `infrastructure/deliverable-repository.ts`; current generation/planner, poster render completion and variant generation paths; bundle schemas/digests/SQL validators/types.
- New schemas: C04 deliverable identities/versions/reviews and proposed manifest V3 with backwards-readable V2. Migration suffix `campaign_finished_deliverables`.
- [ ] Generate only approved proposal terms and planned output counts/formats/languages. Record each requested member including failures; partial completion never silently shrinks the deliverable plan.
- [ ] Persist exact final render or explicit final-image identity/hash, copy fields, source proposal/bundle/direction/variant and verification. Raw plate creation alone cannot satisfy a finished deliverable.
- [ ] Bind every changed render input, including free line, font/template/logo version and script. Identical retry reuses; changed bytes/text produce a new immutable version with no inherited human review.
- [ ] Preserve failed generation cost and successful sibling output; retries do not regenerate everything by default or exceed approved generation caps.
- [ ] Test no-offer image, composed poster, multi-language/placement, wrong source/tenant/render and partially completed set. Verify old V2 records/digests remain readable and unmodified.
- [ ] Link completed renders into Creative History exactly once as Unreviewed via Task 2, with no automatic approved-reference verdict.
- Rollback: disable new generation path while keeping deliverables/renders/history. Existing provider actions retain old exact authority; no data deletion.

## Task 9 — Build the focused Creative Studio

- Impacted files: `src/components/campaigns/studio/poster-studio.tsx`, `annotation-canvas.tsx`, `verification-panel.tsx`; new `studio/text-controls.tsx`, `layout-controls.tsx`, `studio-preview.tsx`, `reference-inspector.tsx`; `revise-workspace.tsx`; Studio page/reader/view and existing edit/render APIs.
- Contracts: C05; visual section 6. Keep current compositor/fonts, version checks and masking guarantees.
- [ ] Compose editing rail, large preview and collapsible context inspector. Expose exact source-bound text slots and supported layout/script controls; show original/current values and unsaved state.
- [ ] Implement local live preview/undo/redo and Save & render against the selected base digest. Price/offer changes request business revision; cosmetic copy still passes source/claim validation.
- [ ] Connect Library selection and region editing to exact parent/deliverable; offer keyboard region controls and before/after. No permanent edit outside saved mask; never overwrite parent bytes.
- [ ] Verify stale-save conflicts, cancellation, rejected render, text overflow, unsupported glyph/script, expired preview, failed save and changed free line.
- [ ] Add a current-version returned-render watcher/poll with bounded lifetime; elapsed work shows named states, no invented percentage. Return to review preserves exact deliverable/version.
- Checks: compositor golden/font/shaping regression tests, masked-byte invariance tests, focused UI/route tests and authenticated desktop/mobile edit → render → review proof.
- Rollback: old Studio remains available as a reader if needed; new saved versions stay readable. No approval survives changed finished output.

## Task 10 — Review every output and bind exact launch approval

- Impacted files: Campaign creative/review UI; `campaign-actions.ts`; existing approve/attest/schedule routes; new deliverable review/launch-approval routes; `application/service.ts`, launch service/repository, manifest digest and Tool Gateway approval checks.
- New schemas: exact output review and C04 launch approval binding; migration suffix `campaign_exact_output_launch_approval`. Amend ADR 0020/Spec 016 wording in this task's approved spec change.
- [ ] Review finished output, caption/hashtags/CTA, destination, account, placement, script, time and budget in one coherent confirmation. Batch approval explicitly lists the selected set.
- [ ] Enforce each selected deliverable's current reviewed hash and required verification. Unreviewed later variant must fail even under a previously approved generation family.
- [ ] Test stale version, mismatched digest, changed free line/render/text, rejected member, expired approval, permission revoked, mixed tenant and selection changed between review/launch.
- [ ] Atomically save exact launch authority and scheduling intent; replay returns the saved result. Changing launch terms creates new authority, not in-place editing.
- [ ] Keep reference-library approval separate; approving a post to publish cannot make it Approved in Creative History automatically.
- Checks: domain/route/component tests and hosted actor/version/row-lock/concurrency tests. No actual provider call is required to prove review authority.
- Rollback: refuse new launch admission while retaining reviews, receipts and still-live historical delivery records.

## Task 11 — Redesign Campaign portfolio and detail around real work

- Impacted files: `campaign-portfolio.tsx`, `campaign-studio.tsx`, `variant-grid.tsx`, `allocation-ledger.tsx`, `outcome-proof.tsx`, `learning-review.tsx`, `execution-timeline.tsx`, campaign list/detail pages; new `campaign-detail-workspace.tsx`, `campaign-phase-strip.tsx`, `campaign-publishing.tsx`, `campaign-results.tsx` and source-owned readers/DTOs.
- Contracts: C09; visual sections 4/5. Split the large current detail component by concrete tab responsibilities, preserving reusable readers and controls.
- [ ] Implement art-led gallery/list, real attention counts/previews and phase-aware facts/next actions. Search/filters do not change the organization or mislabel global totals.
- [ ] Implement Overview/Creative/Publishing/Results/Activity over saved records; no-version campaigns get useful detail/status/recovery.
- [ ] Remove the live-approval gate from historical fleet/allocation reads; keep mutation authorization separately checked.
- [ ] Preserve older running launch versus newer draft identity; explicit version picker and source links cannot show newer artwork for older approved work.
- [ ] Show data freshness/missingness, named error recovery and readable source detail. Move diagnostics/digests to disclosure without losing auditability.
- [ ] Verify compatibility of Overview home preview readers/destinations and Growth Your actions links; update only those adapters/tests affected by the new DTO, not Home layout.
- Checks: all phase/read-model tests, component state matrix and authenticated desktop/mobile routes; no broad app restyle or new Campaign archive lifecycle.
- Rollback: feature-gate composition; preserve all domain changes/history and usable recovery routes.

## Task 12 — Qualify and wire organization-owned provider connections

- Impacted files: `src/modules/integrations/providers/meta/contract.ts`, current Meta provider substrate/credential/OAuth/account-mapping/capability registry, Integration Hub connection controls, Campaign readiness reader and provider verification records.
- Read current provider files and official docs before editing. Meta docs returned errors in this audit; no contract renewal evidence was obtained.
- [ ] Obtain current official documentation and controlled-account evidence for each desired organic/paid/pause/read capability, exact pinned API/SDK version, account eligibility, scopes, formats/limits, billing constraints and reconciliation support.
- [ ] Implement/activate the existing client-owned connection path only for qualified capabilities. Verify multi-account mapping ambiguity, token expiry/revocation and exact credential tenant binding.
- [ ] Update checked-in contract dates/evidence only with that proof. Expiry alerts/readiness are operational controls, not a bypass.
- [ ] Prove unauthenticated/other-tenant/viewer cannot select credentials or grant paid authority. Readiness accurately distinguishes connected from publish-enabled.
- External dependency: real controlled client/test Meta accounts and applicable review/permissions. Keep unsupported capability blocked with the exact missing evidence; do not advertise activation based on code tests.
- Rollback: revoke feature/grants for new admissions, retain connection/history evidence, and keep containment possible for existing live ads.

## Task 13 — Dispatch exact outputs once and collect actual results

- Impacted files: `src/modules/campaigns/infrastructure/dispatch-planner.ts`, `execution-readers.ts`, installed Meta organic/Ads adapters and request loaders, `src/trigger/campaigns.ts`, `src/workflows/campaigns/dispatch-due-actions.ts`, `collect-metrics.ts`, `metric-ingest.ts` and provider Insights reader.
- Contracts: C04/C07/C08. Replace `adapters: []` and `createUnavailableInsightsReader` only behind qualified organization/capability gates.
- [ ] Build provider-specific payloads from exact reviewed deliverables; include all approved public copy fields in request digest. Reject first-mapping/first-asset heuristics and ambiguous destination.
- [ ] Test missing adapter, lost scope, stale approval, revoked source, budget race, timeout before/after send, partial object creation, duplicate dispatch, delayed receipt and partial multi-channel delivery.
- [ ] Persist each provider ID before subsequent paid object-graph writes; reconcile unknown outcomes before retry. No duplicate campaign/ad-set/ad from retry.
- [ ] Ingest observations at actual action/variant grain with metric registry unit/window/currency/revision/deduplication rules; preserve reporting lag, restatements and missingness.
- [ ] Run organic controlled-account canary only after explicit launch approval. Verify posted final bytes/content match the reviewed hash, provider identity/receipt and one real metrics return.
- [ ] Paid live canary remains blocked until Task 14's confirmed pause and current budget/policy proof pass; adapter sandbox/fixture checks can run before then.
- Rollback: halt new dispatch; reconcile already-sent/unknown objects. UI/config disable is not a provider rollback.

## Task 14 — Stop and resume ads through verified provider state

- Impacted files: `allocation-policy.ts`, `allocation-repository.ts`, allocation service/workflow and Trigger composition; existing pause/resume adapters, Gateway request loader, variant state/ledger and UI copy; organization/campaign policy settings.
- New schema: C07 versioned per-organization policy and confirmed pause lifecycle; migration suffix `campaign_confirmed_containment`. Reuse existing pause/action ledgers rather than inventing a parallel external execution log.
- [ ] Require explicitly approved policy values and measurement delays/exposure floors. No global environment threshold silently applies to all currencies/tenants.
- [ ] Reject malformed numeric policy values, including numeric prefixes with trailing text; the old `parseFloat` share helper must not turn `0.5junk` into an accepted 0.5 policy value. Validate actual numeric units/currency and threshold version at the authoritative boundary.
- [ ] Replace local-only pause with persisted intent → Gateway → provider read-back → confirmed variant state. Preserve the decision even if its action is refused.
- [ ] Test local RPC failure/not_pausable/already_paused, provider timeout, acknowledgement without effective stop, repeated reconciliation, missing external ID, account revocation and ongoing spend evidence.
- [ ] Change displayed pause count/state to actual outcome; do not count a requested/ignored action as successfully paused. Confirmation pending stays urgent and visible.
- [ ] Implement operator resume through current approval/policy and provider confirmation; local state cannot restart delivery. Autonomous resume remains forbidden.
- [ ] Controlled paid canary: approve a bounded ad, confirm it live, request pause, read effective provider stop, then ingest delayed metrics. Capture sanitized IDs/timestamps/receipt state and observed cost, not raw provider responses.
- Rollback: disable new paid admissions; keep stop/reconciliation available. This task cannot roll back to a local-only “paused” assertion.

## Task 15 — Deliver clinical creative comparisons and governed learning

- Impacted files: C08 new investigation domain/service/repository/drafter/workflow and Trigger registration; existing measurement/learning services and `campaign-results.tsx`; new `creative-comparison.tsx`, `clinical-review.tsx`; Spec 023 capture adapter/projection and lesson submission boundary.
- New schema: C08 immutable investigation reports/runs/source links; migration suffix `campaign_clinical_investigations`. Existing settled outcomes are unchanged.
- [ ] Build deterministic comparison cohorts with objective/audience/placement/delivery-age/exposure/attribution/currency checks; reject apples-to-oranges comparisons explicitly.
- [ ] Supply exact creative, human review and permitted metrics/source context. Validate structured observations, hypotheses, counterevidence, unknowns and next test; no uncited numeric/causal claim.
- [ ] Keep hypothesis wording in its separately labelled/validated field. Preserve current settled-outcome overclaim validation; do not route the entire clinical report through the old two-sentence lesson validator or remove its factual safeguards merely to allow an explanation. Regression fixtures must distinguish supported observations, tentative explanations and unsupported causal conclusions.
- [ ] Test insufficient exposure, no conversion tracking, delayed results, unequal spend/age, paused variant, conflicting evidence, null metrics, cross-tenant sources and injection in human feedback.
- [ ] Render side-by-side selected creatives with the comparison evidence and an understandable clinical report. Observed relative CTR does not become “caused more profit.”
- [ ] Persist source-linked observations and submit reusable lessons through existing Memory review. A human rejection reason and weak performance remain separate dimensions.
- [ ] Request next-test proposal through Task 5/6 with its evidence lineage; it returns to Growth Intelligence approval and cannot auto-launch.
- Checks: deterministic comparison/calculation tests, structured-output validation/evaluation fixtures, hosted provenance/permission/idempotency tests and one bounded staged report using actual qualified observations.
- Rollback: stop new investigation generation; keep reports/outcomes/source history readable and reusable lessons governed.

## Task 16 — Activate governed cadence and cross-feature continuity

- Impacted files: research policy domain/service/repository introduced in Task 6; new `src/modules/campaigns/infrastructure/research-due-reader.ts`, `src/components/campaigns/campaign-research-settings.tsx` and `src/app/api/organizations/[organizationId]/campaign-research/settings/route.ts`; Campaign research/sweep scheduling in `src/trigger/campaigns.ts`; source-transactional intent and dispatch/reconciliation/observation scheduling; existing Memory/Growth consumers where connected. New paths are proposed targets, not existing exports in the audited baseline.
- New schema: C03 due/evaluated-source receipts with tenant keys/RLS, reusing Task 6 policies/current-policy binding; migration suffix `campaign_research_cadence`. Extend strict domain/SQL validation and hand-maintained database types together; do not create the policy table twice.
- D06 product behavior is confirmed. Activation requires explicit organization configuration and prior stage gates. Capture/Memory writes alone must not trigger unbounded research.
- [ ] Implement meaningful-evidence deduplication, configured cadence, cooldown, pending proposal limits and approved research/generation cost allowances. Page open/refresh is read-only.
- [ ] Persist schedule/due intent in Postgres; workers claim bounded IDs. Retry/lease/cancellation and repeated scheduler delivery do not duplicate research/proposals/posts.
- [ ] Bind admissions to policy version and trigger kind. Reserve the applicable allowance atomically across concurrent runs; settle actual bounded usage and release unused reservation. Manual requests obey the same allowance/cooldown rules. No settings means a visible setup requirement and no model spend.
- [ ] Add permission-checked settings with schedule/timezone, qualifying changes, cooldown, pending limit and separate per-run/window research allowances. Expose last evaluation, last successful research, next evaluation and skipped/paused/exhausted states. Version each saved policy; pausing or revising it must be rechecked before subsequent billable work and must not disable live-ad containment.
- [ ] Schedule metric/reconciliation/containment according to actual active campaign windows and configured provider/reporting policy. Historical campaigns can still receive delayed observations.
- [ ] Test organization A enabled/B disabled and denied cross-tenant policy mutation; no settings; concurrent allowance reservation; exhausted budget; stale evidence; repeated Memory capture of the same root revision; event/schedule races; event storms; missed sweep without catch-up flooding; timezone/daylight-saving boundaries; manual request replay; policy paused mid-run; cancelled campaign; unknown provider outcome; and one next-test proposal per material evidence revision. A due evaluation with no warranted candidate stores that outcome and creates no empty proposal.
- [ ] Verify one business context → proposal → approved creative → observed outcome → investigation → reviewed lesson → next proposal chain using persisted source IDs. Check actual Memory entries consumed and trust labels, not just item counts.
- Rollback: stop future admissions and cadence safely, retaining reconciliation/containment for outstanding provider work. Never disable all workers while spend may be live.

## Task 17 — Verify the complete experience and hand off the release

- Impacted files: new `e2e/campaign-experience.spec.ts`, `e2e/asset-library.spec.ts`, focused additions to `e2e/growth-intelligence.spec.ts`; verification evidence/report under `docs/verification/campaigns/`; relevant final docs/status and this task ledger.
- [ ] Run the full journey from a source-backed proposal, first approval, real upload/reference selection, generation, Studio change, every-output review, exact launch, result collection, verified stop, clinical report and next proposal.
- [ ] Run the named failed-run recovery and no-version detail; expired contract/refused dispatch; lost upload/finalize response; stale approval; variant missing review; provider unknown; expired approval with readable history.
- [ ] Verify operator/reviewer/approver/viewer and tenant A/B application+RLS+private-storage boundaries, including guessed IDs, stale permission, forged actor, mismatched source/render and read-only history.
- [ ] Verify desktop/mobile/keyboard/RTL/font states against the visual contract, actual mounted routes, console and failed requests. Save reference screenshots and compare the meaningful user flows.
- [ ] Run `pnpm typecheck`, focused and full `pnpm test`, `pnpm lint`, `pnpm build`, required hosted pgTAP and relevant authenticated Playwright suites. Avoid generated directories when interpreting unrelated lint noise; record exact exits and separate unrelated baseline failures.
- [ ] Record which changes are in source, applied to staging, deployed to Trigger, connected to a provider and proven by a real controlled-account result. A deployed task and a completed empty sweep cannot satisfy the live gate.
- [ ] Update status/spec/ADR/board with exact activation scope, tests, known limitations and rollback commands for the chosen deployment. The user's git push step remains theirs.
- Release criteria: no known critical/high issue in authority, tenancy, private assets, truthful state, duplicate execution, exact creative selection or containment; no fictional proof, unreviewed output launch or unsupported business-lift claim.

## Coverage and delivery order

- F01/F02 → Task 1; F03/F04/F05 → Tasks 2–3; F06 → Task 4; F07/F08/F09 → Tasks 5–7; F10/F12 → Tasks 8/10/13; F11 → Task 9; F13 → Tasks 12/13/16; F14 → Task 14; F15/F18 → Task 11; F16 → Task 15; F17 → Tasks 6/15/16.
- Deployable internal milestone: Tasks 0–11 provide the full proposal/upload/creative/review experience with honest launch blockers. This is not the completed marketing loop and must not be advertised as publishing/optimization.
- Organic external milestone: qualified Task 12 capability plus Task 13 organic canary and applicable Task 17 checks.
- Paid external milestone: Task 14 containment proof plus reviewed bounded paid canary, metrics and reconciliation; do not enable it solely because organic passed.
- Complete learning milestone: Tasks 15–17 with real outcome evidence, trust-preserving Memory capture and next-cycle source linkage.
- Review each milestone without discarding the ultimate full-workflow objective. External prerequisites may block activation but do not justify omitting internal implementation already approved and independent of them.
