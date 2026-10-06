# Independent Creative Studio: current implementation audit

2026-09-20. Source audit only; no provider calls, live database inspection, migrations or production edits. New architecture below is proposed, not implemented. Supabase skill consulted for RLS/grant separation; repository hosted-staging rules override its local workflow advice.

## Main finding

Current Studio is a campaign finishing room. Its route, reads, manifests, renders, edits and deliverables require campaign identity. Removing a required picker does not remove those dependencies: like removing a booking field while every room key still requires a booking.

Introduce organization-owned Studio documents, immutable versions, bounded runs and private model continuations. Attach a selected finished version through an explicit Campaign import contract. Preserve current campaign constraints and approvals; do not create placeholder campaigns to make Generate work.

## Reuse map

| Existing file/function | Reuse and limit |
| --- | --- |
| `src/app/(platform)/organizations/[organizationId]/campaigns/[campaignId]/studio/page.tsx` and matching API `studio/route.ts` | Authorization/read conventions. New organization Studio routes required for campaign-independent work. |
| `src/modules/campaigns/infrastructure/studio-reader.ts`, `readStudioView`; `application/studio-view.ts`, `toStudioView` | Read model and private previews. Requires campaign/bundle/approval data; cannot provide independent history. |
| `application/poster-studio-view.ts`, `toPosterStudioView`; `infrastructure/poster-studio-reader.ts` | Template availability and refusal explanations. Resolves manifest directions/copy/placement, so needs new standalone context adapter. |
| `src/components/campaigns/studio/annotation-canvas.tsx`, `AnnotationCanvas` | Image-space interaction and decoded-size awareness. Existing rectangular regions need adaptation to requested marker UX and keyboard controls. |
| `src/domain/campaigns/plate-edit.ts`, `admitPlateEdit`; `infrastructure/plate-compositor.ts`, `compositeMaskedEdit` | Region limits, union admission, inward feather, unchanged decoded pixels outside union. Reuse pure math; independent version/operation lineage is new. This guarantees pixels, not identical compressed file bytes. |
| `infrastructure/poster-compositor.ts`, `compositePoster`, `pixelDigest`; domain poster-template/slots/render-digest | Pinned fonts, shaping, glyph/fit refusals, deterministic composition. Campaign slot resolver cannot accept independent arbitrary copy without a new copy/provenance contract. |
| `src/workflows/campaigns/render-poster.ts`, `renderCampaignPoster` | Context→verification→composition→upload→durable-record pattern. Wrapper remains campaign-bound through manifest, bundle, plate, render and deliverable stores. |
| `src/workflows/campaigns/edit-plate.ts`, `editCampaignPlate` | Admission before paid call, actual-byte measurement, mask composition, immutable child. Current writer creates a successor campaign bundle, unsuitable unchanged for standalone edits. |
| `src/ai/campaign-generation-provider.ts`, `FinalImageReference`, `finalImageReferenceSchema` | Correct narrow reference boundary excluding rejected files. New provider contract needs Studio identity, style, pinned evidence and continuation. |
| `infrastructure/gemini-campaign-generation-provider.ts`, `createGeminiCampaignGenerationProvider`; `plate-edit-planner.ts`, `createGeminiPlateEditPlanner` | Routing, timeouts, safe provider failures and image extraction. Both call one-shot `generateText` with a single user message; return bytes/model/usage and discard conversation continuation. No image streaming or original-context replay exists. |
| `application/deliverable-service.ts`, `createDeliverableService`; `infrastructure/deliverable-repository.ts` | Exact version/hash human review and distinct worker recording authority. New source/import contract needed. |
| `src/trigger/campaigns.ts` | Durable queue/task/dependency pattern. Existing payloads and admission are campaign-bound; create separate Studio task orchestration. |

Paths abbreviated above under `application/` and `infrastructure/` are relative to `src/modules/campaigns/`. `PosterStudio` explicitly says its edit surface does not poll; do not claim existing live streaming from a completed task.

## Minimal persistence proposal

- `studio_documents`: organization, creator, title, current version, archive state; optional campaign context. Campaign selection supplies context, never publication authority.
- `studio_versions`: immutable parent, settings, original/enhanced prompt, operator copy, style, aspect and explicit dimensions, reference/product/brand version IDs and hashes, private output/plate/mask object identities, content hash, verification and provenance. Typed source/operation discriminators prevent raw plates, previews and finished artifacts being confused.
- `studio_runs`: request digest/idempotency, actor, pinned parent, bounded preparation authorization, state, lease/attempt, safe failure, provider/model, usage and committed output version. Preserve refused/cancelled/failed attempts; complete only after object verification and durable commit. Unknown provider outcomes need explicit reconciliation rather than blind retries.
- `studio_model_turns`: private continuation scoped to run/version, provider/model and serialization version. Keep only documented replay parts, original references and opaque continuation fields needed for edits; do not create a hidden-reasoning or general memory store. Large binary parts may be private hashed objects referenced from a run instead of a public table.
- `studio_campaign_imports`: organization, selected Studio version/hash, campaign/target bundle, resulting deliverable/version, actor, idempotency. This represents actual attachment, unlike a draft campaign picker.
- Reuse durable audit/events where possible. Add bounded ordered run events only if reconnect/replay needs them. UI transport is never the source of truth.

These are five concepts, not a requirement for five public tables: continuation can live in private storage referenced by runs, and edit metadata can remain on version/run records. Finalize this in implementation planning.

## Campaign attachment requires an explicit source contract

`supabase/migrations/20260913130000_campaign_finished_deliverables.sql` requires campaign, bundle and direction IDs. Its source kind permits only `finished_poster` pointing to `campaign_poster_renders`, or `final_image` pointing to a campaign asset. A Studio path alone cannot satisfy it.

Recommended extension: a narrow `studio_version` source arm with same-tenant immutable FK and exact hash. Update source schema, recording RPC, resolution/download/publication readers and digest inputs together. The alternative is materializing the image through existing campaign bundle/asset creation, retaining an import receipt, but that must not mislabel a composed design with a truth class describing only its background.

Attach atomically, compare target campaign version, and create a fresh unreviewed deliverable. Never transfer Studio history approval or an older campaign approval to imported pixels. Create Campaign means draft creation with genuine required business inputs, not invented objective/budget. Independent generation needs its own bounded cost authorization; a selected campaign does not implicitly lend its remaining allowance.

## Specification conflicts and product gaps

- Spec 020 §4/§5.3 forbid model-rendered text: model draws a textless plate, platform writes approved words. Embedded-copy AI posters reverse that boundary. Preserve deterministic text, or explicitly propose a superseding ADR; a new textbox is not architectural approval.
- Spec 020 §7.6 masks plates only, never text, and excludes a new Blueprint stage for edits. Original-context replay can coexist with that exclusion but is new behavior. Marking canvas text must route to text-layer edit or a separately approved new rule.
- Exact design must mean strongest reference adherence, not guaranteed pixel-identical AI output. ADR 0059 expressly treats generated logos as approximate conditioning; exact typography/layout needs deterministic mechanisms.
- ADR 0049 allows approved finished history at final generation, forbids rejected/unreviewed history bytes there. Fresh uploads need explicit current-use rights, role and provenance; uploading cannot silently approve historical evidence.
- ADR 0049 has stale September 12 prose saying the final provider still accepts `avoid`; current `CampaignImageGenerationInput.references` is already `FinalImageReference[]`. Preserve corrected runtime boundary; reconcile document drift during implementation.
- ADR 0057 still says Proposed while current deliverable code implements exact-output review. Check final Spec 025 approval records before changing status. Imports still must not authorize publication.
- Aspect label needs exact pixels: Instagram Feed does not distinguish square/portrait. Existing image adapter returns requested dimensions while downstream intake measures bytes; do not trust requested dimensions as measurement.
- Enhance/New Idea are bounded text suggestions; they must not silently change factual product constraints, current copy or approved commercial terms, or automatically buy an image.
- Legacy generations have no saved original continuation. A new session seeded with an old image is new lineage; label replay unavailable rather than claim to reconstruct original context.

## RLS, storage and migration implications

Use additive forward-only migrations, forced RLS, explicit SELECT grants, permissions, composite tenant FKs and private signed storage. Decide Studio view/edit/generate permissions explicitly; organization viewers must not become paid generators by accident. Security-definer mutation RPCs use empty search_path, revoked public execution and explicit caller grants/checks. Worker completion cannot review or approve.

Database owns parent-version comparisons, idempotency, claim/lease fencing and atomic import. Validate scoped record→object/hash relationships, not just storage prefixes. Specify archive/reference revocation, stalled runs, failed upload cleanup, retry and expired previews. No mutable object behind immutable version; no signed URLs as source identity.

Schema anchors: `20260826090000_campaign_creative_studio.sql` (render/edit), `20260909124757_creative_history_core.sql` (finished-render link), `20260913130000_campaign_finished_deliverables.sql` (output review/source). Read later amendments before editing any function. Maintain database.types.ts by hand; no local Supabase. New table-reading PL/pgSQL must execute against hosted staging during approved implementation.

## Required tests

- Generate without campaign → persisted history → reload → edit child → download. Campaign selection stays optional throughout.
- Tenant A/B, viewer/operator, foreign UUID tests for rows, streams, continuations, references, private previews/download and imports.
- Concurrent admission, idempotent replay, cancellation/finalization race, stale parent, lease expiry, failed upload, disconnect/reconnect and provider unknown outcomes; reconnect cannot duplicate paid work.
- Actual adapter payloads prove approved reference inclusion, rejected exclusion, ordered original continuation replay, provider/model mismatch handling and refusal of browser-injected provider history.
- Mask bounds/union/dimensions tests and outside-union decoded pixel preservation; preserve font/glyph/RTL/compositor golden tests when reusing deterministic text.
- Import exact version/hash, stale target refusal, same-tenant FK, idempotent replay, fresh review requirement, no publishing first raw asset by positional heuristic.
- Browser: 20/80 desktop, narrow-screen settings, keyboard markers, default dimensions, reference failure/rights states, progress/history, reconnect, retry and expired preview recovery. Never simulate unavailable progressive image previews.

Documentation-only task: no tests executed. Source findings do not establish deployed or staging behavior.
