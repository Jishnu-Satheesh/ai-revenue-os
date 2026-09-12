# Campaign workflow audit — 12 September 2026

Status: read-only investigation completed to the evidence boundary below; discovery decisions confirmed; redesign and implementation proposal prepared for review.
Baseline HEAD: `e122d374cadb7eee78970393d09dee22ec627dae`; the working tree also contains existing uncommitted Campaign, Memory, Home, configuration and documentation work. Findings describe inspected working files unless a deployed run or hosted query is explicitly named. Do not reset those changes or deploy them as a batch.

## Acceptance criteria for this planning task

- Reconcile the user's marketing-agent workflow with current routes, services, workers, schemas, approved specifications and delivery records.
- Explain both reported failures with evidence; distinguish symptoms, root causes and adjacent blockers.
- Plan Campaign portfolio, Campaign detail, Creative Studio, Asset Library and the Growth Intelligence handoff as one journey.
- Carry forward confirmed product decisions and label unresolved decisions explicitly.
- Deliver exact file boundaries, proposed contracts, implementation order, tests, staging/provider gates, risks and rollback for a successor with no conversation context.
- Planning authorization does not authorize feature implementation, migration application, generation spend, public posting or ad changes.

## Confirmed conversation decisions

- Campaign is the product's central marketing capability: business-aware research, proposed action, approved creation, approved launch, observation, investigation and improvement.
- First approval in Growth Intelligence covers audience, offer, channels, budget and success measures, not just the idea.
- The intended campaign section is the separate **Campaign-ready opportunities** section in `.superdesign/growth-intelligence/prototype.html`, under Recommendations. **Campaign preparation** belongs in Your actions.
- Underperforming paid ads may be paused within previously approved limits; preserve the ad, evidence and history. A human decides on restart or removal.
- Creative Studio is a focused campaign editor with live preview and local AI edits.
- Every finished output, including later variants, must be reviewed before publication. Unseen creative-family publication is not the desired product behavior.
- Research runs automatically on meaningful business evidence changes and a configured schedule, plus a manual Request a campaign action. Frequency, cost and duplicate-proposal controls must be visible.
- Show campaign proposals supported by business evidence even when profit estimates or external market research are unavailable, with those gaps explicit. Publication and spending still require approval and normal checks.

## Exact failed-run evidence

Read using the installed Trigger.dev SDK's `runs.retrieve`, without retriggering:

| Field | Verified value |
| --- | --- |
| Trigger run | `run_06g9cko3ehp1gemp1f1v6k6h01` |
| Task | `campaign.generate-bundle` |
| Status / attempts | `FAILED` / `2` |
| Worker version | `20260910.4` |
| Created | `2026-09-12T15:53:38.115Z` |
| Started / finished | `2026-09-12T15:53:38.362Z` / `2026-09-12T15:53:50.169Z` |
| Organization | `2dda45b8-82db-4f5f-b17d-611b9bbb7846` |
| Campaign | `d7365075-810c-4e35-8432-a7ff6f04a0a8` |
| Domain generation run | `d2682f4c-2be1-4a2a-823f-e58d5da1731f` |
| Failure | `Provider contract verification is expired: meta_campaign` |

Stack: `parseVerifiedProviderContract` → `getMetaCampaignProviderContract` → `verifiedChannelLimits` → Trigger task dependency construction. Deployed stack points to `contract.ts:473`, `verified-limits.ts:21`, `campaigns.ts:226`; the working file has shifted lines.

The checked-in contract at `src/modules/integrations/providers/meta/contract.ts` has `verifiedAt = 2026-08-11T00:00:00.000Z`, `expiresAt = 2026-09-10T00:00:00.000Z`. Its parser deliberately throws on expiry. `verifiedChannelLimits()` is evaluated before `generateCampaignBundle()` is invoked, so the workflow has not claimed the database run and its failure handler cannot record the exception.

Hosted staging SELECTs, in a read-only transaction, confirmed:

- The domain run still has `status = queued`, `attempt = 0`, no lease, no failure code, no result version and unknown/null cost.
- The campaign is `draft`, `source_kind = manual_brief`, with zero bundle versions.
- These timestamps remain at creation; the failed Trigger attempts did not update the domain run.
- This organization has zero `creative_items`, `creative_folders`, `organization_brand_assets`, `campaign_action_runs` and `campaign_learning_proposals`.
- Its only inspected connection is `google_business_profile`, `active`, `fixture`, without a credential reference. No Meta connection exists in this organization's inspected rows.
- Creative History core migration `20260909124757` is present in staging. The local `20260912*` Memory migrations are absent from the inspected migration history.

These counts are specific to this organization and this inspection, not a statement about every tenant. No source snapshots, prompts, workbook contents, customer data, credentials or signed image URLs were copied into this document.

## Findings and required remedies

### F01 — Contract expiry crashes internal generation before its lifecycle starts

- Evidence: exact deployed stack above; `src/trigger/campaigns.ts`, `src/modules/campaigns/application/verified-limits.ts`, `src/modules/integrations/providers/meta/contract.ts`.
- Impact: a designer cannot start work because the publishing department's checklist is overdue.
- Required design: distinguish internal proposal/draft validation from current provider execution verification. Unverified launch limits cannot silently become verified limits; block the affected launch action explicitly. Internal drafts need their own bounded content contract and visible readiness state.
- Repair the execution contract through actual source/account reverification. Do not extend a timestamp, inject today's date into a fixture or return guessed platform limits just to clear this exception.
- Verification: expired and missing contracts, blocked placements, a usable internal draft, refused provider launch, contract freshness before/after expiry, and no repeated automatic retry for a deterministic prerequisite failure.

### F02 — Trigger failure and Campaign status disagree

- Evidence: Trigger FAILED versus hosted `campaign_generation_runs.queued`, attempt zero.
- Required design: persist a typed terminal or recoverable blocked outcome even for dependency/bootstrap failure before claim. Reconcile orphaned queued work using authoritative attempt/dispatch evidence. Use controlled RPCs and tenant/run identity; never let a request path arbitrarily mark a worker successful.
- Do not patch the one row directly as the systemic fix. Preserve the failed historical attempt and create an explicit recoverable retry only after prerequisites change.
- Tests must inject a failure while constructing dependencies, before `generateCampaignBundle`; mocking only errors inside the workflow misses this defect.

### F03 — No usable frontend upload journey

- Evidence: `AssetUpload` is referenced only by its own component tests; `asset-workspace.tsx` never mounts it. Its request contains label and ownership, no File. There is no file input in it. Existing reserve/upload/finalize routes and `brand-asset-service.ts` are useful infrastructure.
- Impact: the warehouse exists, but its customer entrance does not.
- Required: visible upload entry; file selection/drop; preview; correct purpose; metadata/rights; per-file reserve, transfer, finalize and authoritative success; retry failed files; cancellation; no false success on HTTP 200 carrying a refused domain outcome.
- Do not implement finished Creative History as generic Brand Kit assets merely because that upload API exists.

### F04 — Library does not show actual visual work

- Evidence: `assets/page.tsx` maps every reference to `previewUrl: null`; Campaign output cards in `asset-workspace.tsx` show truth class/alt text and review form without an image element.
- Required: session-authorized private previews, exact version identity, bounded signing, expiry refresh, failed-preview recovery, image contain sizing and a useful inspector. A failed source must not become an empty library.

### F05 — Approved Creative History correction is only partially connected

- Evidence: approved Spec 019, ADR 0049 and `2026-09-09-creative-history-asset-library-correction.md`; existing domain selector, strict types, core SQL migration and pgTAP file. No Creative History application/API/UI files were found in the prescribed paths. Current tabs remain References / Campaign output / Dishes.
- Required: resume the approved correction, reconcile actual completion task by task, retain three purposes: Creative History / Products & Subjects / Brand Kit. Folder defaults and human-confirmed metadata are distinct from model suggestions; verdict belongs to a version, not a folder.
- Use existing migration/schema. Do not recreate tables or reapply old superseded rejected-image migrations.

### F06 — Final image path still accepts rejected-image bytes

- Evidence: `CampaignImageGenerationInput.references` still uses `CampaignImageReference[]`, whose union includes `avoid`. `generate-bundle.ts` loads one reference set; `campaign-planner.ts` passes `imageGuidance.references` to `generateImage`; Gemini provider supports the avoid role. Narrow corrected types exist but are not the runtime port.
- Required: complete ADR 0049 cutover through real call sites. Approved bytes may reach Blueprint and final generation; rejected bytes only Blueprint; cited validated avoid rules may reach final text. The final provider port must have no rejected/avoid bytes path.
- Regression: inspect the actual final adapter payload with a rejected reference fixture, not just whether a new type rejects it in isolation.

### F07 — Growth Intelligence prototype section drifted

- Evidence: prototype line 53 defines Campaign-ready opportunities after advice; line 54 Campaign preparation. Current `priority-actions.tsx` leads with Platform opportunities and Operator recommendations; workspace composes this generic group.
- Required: restore a clearly named campaign proposal section and its purposeful empty/loading/failure states, preserving ordinary advice and Your actions. Do not copy illustrative prototype campaigns into production.

### F08 — Proposal admission has two paths; neither is the full requested research loop

- Legacy path: `campaign-opportunity-source.ts` checks Meta authority/execution prerequisites; `campaign-evidence-repository.ts` supplies `impactEvidence: null`. This legacy execution candidate cannot be used as the only campaign-idea source.
- Newer draft path: `growth-intelligence-opportunity-source.ts` correctly delegates to `checkDraftEligibility`, which does not require a Meta connection to create an internal draft. It still requires qualified impact and market evidence/profile prerequisites. Source search found the factory definition and tests, but no production invocation. Verify any SQL-side admission independently before declaring all admission absent.
- Required: source-backed campaign research/proposal orchestration plus a persisted handoff into Growth Intelligence. Do not weaken generic Decision Engine execution admission or confuse these two action keys.
- Confirmed product decision D07: a useful proposal can show missing impact as unknown and external research as unavailable when its internal business rationale is supported; approving creative preparation and approving launch remain different questions. Record the changed Campaign proposal admission semantics in the formal spec/ADR before implementation; do not remove generic execution thresholds.

### F09 — The first full-proposal approval is missing

- Evidence: current manual brief enters `createCampaignService.create`, saves a snapshot and immediately queues bundle generation. `CampaignDraftAction` asks the human for objective/audience and requests a draft; it is intentionally not an approval action.
- Required: a versioned proposal containing research rationale, audience, offer, channels, budget and success measures. First approval freezes it and authorizes preparation. Campaign must generate what was approved or propose a material revision for review.
- Manual requests should enter this same proposal review stage; do not silently treat form submission as approval of an AI-completed budget/offer.

### F10 — Current creative-family approval conflicts with required output review

- Evidence: `campaign-studio.tsx` authorizes up to a policy-defined number of variants; Spec 016/ADR 0020 allow derivative variants under one envelope.
- The user confirmed review of every finished post/ad, including later variants. Amend this durable approval rule before implementation. Separate campaign preparation authority, exact creative approval, publishing authority and approval of a design as a reusable reference.

### F11 — Studio rendering works as a foundation, but editing is split across surfaces

- Evidence: `studio/poster-studio.tsx` selects direction/template/script, displays manifest slot text, exposes a free line and queues renders. `annotation-canvas.tsx` supports bounded local image edits. `revise-workspace.tsx` handles copy/revision separately. Prior renderer/browser proof exists in `creative-studio-live-proof.md`; it was not rerun in this audit.
- Required: one focused editor with a large live preview, editable authorized text slots, layout choices, asset selection, local AI edit, undo/cancel, saved revision status, render verification and return-to-review. Persist through the existing version/patch/render boundaries.
- Prices, offers and claims remain source-bound; textual editing cannot silently change money or approved business intent. Malayalam/Arabic shaping and glyph/overflow checks remain server verified.

### F12 — Dispatch selects the first raw campaign asset, not the chosen finished poster

- Evidence: `dispatch-planner.ts` uses `direction.assetIds[0]`, reads `campaign_assets.storage_path`, and signs that image. It does not select `campaign_poster_renders` or an exact reviewed render.
- Impact: the print shop can send the background photo instead of the flyer the client signed off.
- Required: persist exact deliverable identity, finished render/content hash, copy, placement, language, destination and approved version in the launch manifest. Dispatch must use this identity, never first/newest/last-viewed image heuristics.
- Test changed free line, changed render, stale approval, mismatched direction/script and multiple outputs in one campaign.

### F13 — Real publishing and collection are not activated end to end

- Evidence: Trigger dispatch constructs `adapters: []`; collection uses `createUnavailableInsightsReader()`. Task definitions exist, but no scheduler is declared for these campaign tasks. The inspected organization has no Meta connection/action runs.
- Required: qualified organization-specific credential/account/grant wiring, exact adapter registration, publish-and-reconcile tests, permission revocation and typed readiness. Complete organic and paid gates independently; no claim of working publication from an empty successful sweep.
- `dispatch-planner.ts` also uses one first account mapping and an Instagram-shaped request for the supported channel enum, and builds caption from hook/caption. Verify Facebook request shape, multi-account ambiguity, hashtags/CTA and paid variant mapping before activating it.

### F14 — Local pause is not a provider-confirmed pause

- Evidence: allocation worker calls `allocation.pauseVariant`; its RPC `pause_campaign_variant` only updates the local variant state. The workflow discards the RPC outcome. It does not call the provider pause Tool Gateway path.
- Impact: crossing an ad off a spreadsheet does not stop Meta charging for it.
- Required before live ads: pause intent → governed invocation → provider read-back → confirmed state; unknown and refused outcomes remain visible, trigger reconciliation and never claim spend stopped. Reconcile resume the same way.
- Existing allocation thresholds are deployment environment values, while ADR 0021 requires versioned organization-scoped thresholds. Move to governed per-organization/campaign policy without inventing default economic thresholds.

### F15 — Performance history disappears when approval expires

- Evidence: Campaign detail reads variant fleet and allocation events only while `view.approval.status === live`; outcome/lesson readers do not share that gate.
- Required: historic fleet, spend and decisions remain readable under membership/permission even after approval expiry, cancellation or a new version. Mutation eligibility is separate from historical visibility.

### F16 — Clinical investigation is not implemented

- Evidence: `LearningContext` has campaign-level outcome/exposure summaries and variant IDs, not comparable per-variant metrics, creative features, delivery timing, audience/placement, landing behavior or hypotheses. `learning-drafter.ts` writes two or three sentences after settlement; next-test wording is largely deterministic by verdict.
- Required: evidence-backed comparison per creative and comparable cohort, known observations, plausible explanations, disconfirming evidence, unknowns and a proposed next test. A model may hypothesize; it cannot declare a causal winner from CTR alone.
- A rejected design is human preference evidence; a low-performing ad is performance evidence. Never automatically equate them.

### F17 — Business Memory is under active construction, not proven comprehensive Campaign context

- Evidence: existing subject drafting retrieves memory. Dirty Campaign generation/revision code carries manifest ID/digest, while the rendered generation prompt names the digest rather than supplying selected entry contents. The local new SQL loader selects the latest matching manifest; this inspection did not establish end-to-end prepare/consume/pin/usage semantics. The local 12 September Memory migrations were absent in staging at inspection.
- Required: reconcile Spec 023 work; prove bounded actual entries reach the intended planning call, their source refs/usage are saved, source-owned facts remain authoritative and retry cannot silently swap the pack. A provenance badge or hash alone does not prove the model learned the business context.
- Reusable lessons require the governed review path; automatic source capture and unverified observations may be recorded without upgrading them to brand rules or verified outcomes.

### F18 — Page presentation is dominated by implementation concepts

- Evidence: Campaign portfolio explanation starts with “Two entry points, one governed pipeline”; metadata cards precede usable creative; detail mixes version/digest/attestation and economic review into a long surface; library shows ingredient taxonomy and no pictures.
- Required: client-oriented tasks, strong real artwork, current stage and next action, plain budget/results, compact evidence inspection and technical diagnostics behind disclosure. Keep exact identities in the data model while changing presentation.

## Verification limits and next proof

- Read-only evidence includes the exact deployed run and scoped hosted state above; no live campaign was generated, approved, published, paused or retried during this audit.
- Local reference screenshots inspected: `.superdesign/channels/desktop.png`, `.superdesign/organization-home/desktop.png`; Growth Intelligence prototype HTML and source were inspected. Organization-home has a later pending revenue-first design amendment; preserve its current lower artwork-led sections as inspiration, not as permission to overwrite that amendment.
- Authenticated browser workflows, provider controlled-account tests, complete current RLS acceptance and full repository quality gates are not claimed by this audit.
- Meta documentation opens returned 429/safe-open failures. That is not provider reverification. A successor must obtain usable official/current evidence and controlled-account proof before opening those gates.
- Focused baseline: `pnpm exec vitest run src/modules/integrations/providers/meta/contract.test.ts src/modules/campaigns/infrastructure/dispatch-planner.test.ts src/components/assets/asset-upload.test.tsx src/domain/campaigns/creative-history-selector.test.ts src/modules/decisions/sources/growth-intelligence-opportunity-source.test.ts` passed **38 tests in 5 files**. These fixtures pass despite the observed production gaps. Passing component/domain tests cannot prove a component is mounted or an adapter is registered.
