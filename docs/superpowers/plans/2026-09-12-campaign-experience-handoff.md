# Campaign redesign and marketing workflow — start here

- **Status:** audit completed to the stated evidence boundary; discovery decisions confirmed; product/design/implementation proposal prepared for review. Feature implementation and live-provider activation are not authorized. D06/D07 are settled product choices, not open questions; formal spec/ADR and full design/plan review still precede implementation.
- **Intended executor:** one coding agent with no previous conversation context. Work sequentially through the implementation tasks; read the actual source and check staging/deployment state before relying on this dated snapshot.
- **Request:** redesign Campaign portfolio, Campaign detail, Creative Studio and Asset Library as one coherent marketing-agent experience; audit the full lifecycle and repair its shortcomings against the user's vision, with Growth Intelligence as the campaign proposal approval surface.

## Read this package in order

- [1. Evidence and full workflow audit](../../verification/campaigns/2026-09-12-workflow-audit.md): 18 findings, exact failing Trigger run, hosted state and limits of verification.
- [2. Product design and confirmed decisions](../specs/2026-09-12-campaign-experience-design.md): journey, alternatives, authority and settled discovery decisions.
- [3. Page-by-page visual contract](2026-09-12-campaign-experience-visual-contract.md): layout, control behavior, failure states, accessibility and researched references.
- [4. Proposed data/workflow contracts](2026-09-12-campaign-experience-contracts.md): source of truth, new versus existing types/tables/APIs, version/approval/tenancy boundaries.
- [5. Sequential implementation plan](2026-09-12-campaign-experience-implementation.md): Tasks 0–17, exact file responsibilities, regression cases, migrations, integration gates, blast radius and rollback.
- Repository `AGENTS.md` and mandatory context/spec/ADR reading precede implementation. This handoff does not override them.

## Decisions the user has already made

- Campaign is the core marketing agent, spanning idea research, approval, generation, editing, publishing, performance and learning.
- Growth Intelligence must present the full proposal: audience, offer, channels, budget and success measures. Approval occurs before creative generation.
- The missing intended section is visible in `.superdesign/growth-intelligence/prototype.html`: Campaign-ready opportunities after advice, and Campaign preparation in Your actions.
- Every finished post/ad requires human review before publication, including all later variations. Current unseen-variant family publication semantics must be amended; do not ask the user to choose that again.
- The agent can pause underperforming paid ads within approved limits. Preserve the objects and evidence; a human decides restart/removal. A local status change is not a confirmed provider pause.
- Creative Studio is focused editing with a live preview and AI edits, not a full freeform canvas.
- Research starts automatically from meaningful new business evidence and a configured schedule, with a manual Request a campaign action as well. Frequency, cost limits and duplicate-proposal controls are visible settings; their numeric values are organization configuration.
- Source-backed proposals remain visible when profit estimates or external research are unavailable, with clear evidence gaps. This does not qualify unsupported external claims or bypass publication/spending checks.
- Established Asset Library product model remains Creative History / Products & Subjects / Brand Kit, with approved and rejected history influencing different evidence paths.

## Findings that must change implementation order

- The failed run is `run_06g9cko3ehp1gemp1f1v6k6h01`, task `campaign.generate-bundle`, worker `20260910.4`, two failed attempts. The Meta contract expired on 10 September 2026; it throws while dependencies are constructed before the generation workflow starts.
- Hosted Campaign run `d2682f4c-2be1-4a2a-823f-e58d5da1731f` remains queued/attempt 0 while Trigger says FAILED. Fix lifecycle recording and recoverability, not just the exception text or contract date.
- `AssetUpload` has no production caller/file picker. Asset page sets every reference preview URL to null. Existing API/intake infrastructure should be connected, not replaced wholesale.
- Creative History core/schema/selector exists; its app/UI/receipt/provider cutover is incomplete. The corrected final-image type exists but real generation still uses the legacy avoid-capable type. Test actual final adapter inputs.
- A newer Growth campaign-draft source exists without a found production caller; the older Campaign Decision source has `impactEvidence: null`. Do not mistake generic strict execution qualification for the only possible advice/proposal path.
- Current dispatch selects the first campaign asset instead of a reviewed Studio render, supplies no adapters, and collection uses an unavailable reader. Fix exact output/destination binding before external activation.
- Current allocation marks the local variant paused without stopping Meta delivery or inspecting the RPC result. Real paid launch is blocked until stop/reconciliation is proven.
- Variant/stop history is hidden when current approval is no longer live. Historical read permission must be separate from mutation eligibility.
- Current learning is a short campaign-level lesson after settlement, not clinical comparison of creative variants. The new investigation must receive actual comparable evidence and keep hypotheses separate from established results.
- Business Memory work is already dirty in this checkout. New 12 September migrations were not applied in the inspected staging history. A manifest digest/provenance label alone is not proof that selected memory contents reach the Campaign model.

## Preserve these useful foundations

- Immutable Campaign bundle versions/digests, source snapshots, typed qualification, approval state, Tool Gateway, idempotency, receipts and budget reservations.
- Private image intake, declared-subject grounding, immutable asset versions/review history, Creative History selector/core schema and separate Blueprint/final reference types.
- Deterministic poster compositor, vendored fonts, multilingual shaping/glyph/fit checks, local mask edit invariance and parent/child image lineage.
- Outcome registration/settlement/proof, source-linked learning proposal review and shared Business Memory trust/consumption/capture contracts.
- AppShell, organization navigation and existing Growth/Channel/Home visual language. Current Channels inner Audit and pending Overview revenue-first work are outside this redesign.

## Approval and activation are different gates

- Product decisions above, including D06 research initiation and D07 proposal evidence gaps, are confirmed. The proposed full layout, new schemas, formal spec/ADR amendments and task plan still require review/approval; do not ask the discovery questions again.
- Task 0 creates/reconciles the formal feature spec and durable ADR amendment. Do not implement new proposal/approval/launch schema before their plan/spec approval.
- Approved implementation permits the internal feature work described, subject to current session scope. It does not itself provide Meta account access, publisher scopes, billing/contract evidence or authority to publish a particular post/spend a particular campaign budget.
- Provider capability activation needs current official and controlled-account proof. Every launch still needs exact output approval; paid activation additionally needs confirmed provider pause and reconciliation.
- Never ask again for decisions already recorded above. Ask only for a missing material decision, specific external setup or actual launch approval when required.

## Verification evidence currently available

- Current source inspection across pages/services/workers/adapters and approved plans/ADRs, exact deployed Trigger run retrieval, organization-scoped hosted SELECTs and migration metadata. Audit has the identifiers and observed values.
- 38 baseline tests passed across Meta contract parsing, dispatch planner, upload component, Creative History selector and Growth draft source. These are fixture/component tests and did not establish working end-to-end flow.
- Local Channels and organization-home reference screenshots were visually inspected; Growth prototype HTML and intended section were inspected. Web references are linked in the visual contract.
- No authenticated browser acceptance, new UI prototype, current complete RLS proof, live publish/stop or full current repository quality-gate pass is claimed by this planning task. No model generation/provider action/database mutation was performed.
- The requested Meta documentation opens were unavailable (429/safe-open errors). No external contract was renewed or represented as reverified.

## Successor traps

- Do not set a future `expiresAt` to make generation work; first separate internal preparation from verified provider launch and persist bootstrap failures.
- Do not trust Trigger COMPLETED without its domain outcome and saved artifacts. In `generate-bundle`, published can mean persisted internal bundle, not a published social post.
- Do not treat HTTP success as usable upload, approved action, confirmed pause or successful measurement. Parse committed domain outcomes.
- Do not create another Creative History schema, apply the superseded rejected-avoid migration, or cast the legacy shared image array into the new narrow type.
- Do not reuse the latest/first image, current gallery selection or first account mapping for publishing. Bind exact reviewed identity/hash/destination.
- Do not alter all Decision playbooks to populate Campaign recommendations. Keep draft advice and external execution readiness distinct with explicit approved contract changes.
- Do not turn a generation cap into approval of later unseen posts. No output can inherit review from its parent, folder, template or prior file version.
- Do not hide old campaign fleet/results when approval expires or a new draft exists.
- Do not infer why a creative failed from CTR alone, compare unequal audiences/exposure as a controlled test, sum overlapping reach, average rates or convert absent metrics to zero.
- Do not convert rejected design preference into proof of poor performance, or low performance into a permanent brand prohibition.
- Do not assume local new Memory SQL is deployed; inspect actual prepare/consume payload and pinned entry usage. Preserve all existing uncommitted work.
- Do not use feature disable as the only rollback for live ads. Existing delivery and unknown provider actions still need stop/reconciliation.

## Suggested implementation prompt, only after approval

- Implement the approved Campaign experience plan at `docs/superpowers/plans/2026-09-12-campaign-experience-implementation.md`. Read this handoff, its design/audit/contracts/visual companions and repository instructions first. Reconcile drift and approval status in Task 0; work sequentially through authorized tasks. Preserve existing dirty work and source-owned contracts. Fix the connection failures as well as presentation. Every finished creative, including later variations, requires review, and only the exact reviewed output can launch. Prove upload, source selection, generation lifecycle, actual memory input, version-bound review, provider execution, confirmed pause, metrics and clinical learning at their real boundaries. Report fixture, staging, browser, deployed-worker and provider evidence separately. Keep blocked external capabilities honest while completing independent authorized work. Do not fabricate data, change policy thresholds, auto-publish unseen work, run local Supabase, regenerate database types, broadly format, stash or git push.
