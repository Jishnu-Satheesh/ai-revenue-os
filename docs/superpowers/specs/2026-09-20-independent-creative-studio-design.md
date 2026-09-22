# Independent Creative Studio — proposed design specification

Status: **PROPOSED — design review, not implementation approval.** Started September 20; resumed September 21, 2026. This package changes no production application, database or worker. The referenced wireframe was not visible in this conversation; the design is derived from the written requirements. Do not claim sketch fidelity or freeze a final visual baseline until the sketch is supplied and compared, or the user explicitly accepts the prototype as the replacement reference.

## 1. Outcome and binding decisions

Let an organization create, refine, download and reuse a finished creative without first creating a campaign. The creative retains its own history; campaigns may select an exact finished revision.

The user explicitly confirmed:

- A campaign is optional. Generate without one; save in Studio history; link or create a campaign later.
- The image model generates the complete poster, including the words supplied in the **Text copy** textarea. The new workflow does not substitute deterministic text layers.
- **Visible progressive image previews are mandatory.** Status streaming followed only by a final image does not satisfy this requirement. Qualify another provider if necessary.

Original requirements retained: Campaigns submenu order Overview → Creative Studio → Asset Library; approximately 20% controls and 80% work area; approved-reference/product pickers with uploads and large previews; Exact design / Take Inspiration; Enhance / New Idea; format presets defaulting to Instagram Feed; full-screen initial loader matching Channel Audit; canvas marker edits with original model/context; download; create or select campaign; detailed handoff with per-task code and browser review.

## 2. Artifact map and authority

- Interactive prototype: `.superdesign/creative-studio-independent/prototype.html`.
- Canonical screenshot and companion states: `docs/design/creative-studio-independent/` (see `REFERENCE.md` for dimensions, hashes and approval status).
- Current source audit: `docs/design/creative-studio-independent/current-studio-audit.md`.
- Provider evidence: `docs/design/creative-studio-independent/provider-and-assets-audit.md`.
- Exact proposed contracts: `docs/design/creative-studio-independent/technical-contract.md`.
- Implementation sequence: `docs/superpowers/plans/2026-09-20-independent-creative-studio.md`.
- Handoff entrypoint and review protocol: `docs/design/creative-studio-independent/HANDOFF.md`.

User decisions govern product behavior. This specification governs the new workflow; technical contract governs interfaces; approved prototype and frozen screenshots govern geometry. Existing campaign approval/publication rules remain binding. A contradiction is a recorded blocking finding, never an invitation to invent a compromise. Prototype sample data, timers and SVG artwork are not production implementation instructions.

## 3. Architecture choice

**Recommended: organization-owned Studio with an explicit Campaign attachment boundary.** Studio owns documents, immutable image revisions, generation/edit runs, original-model continuation and history. Asset Library owns approved design evidence, product photography and Brand Guidelines. Campaign owns its brief, output selection, exact-output review and publication authority.

Two rejected alternatives:

- Making `campaignId` nullable throughout the existing Studio couples standalone work to campaign manifests, approval digests and template assumptions. A missing campaign picker alone cannot remove those dependencies.
- Creating hidden campaigns for every image fabricates business work and pollutes campaign history. It contradicts independent creation.

The current campaign Studio remains readable for existing renders. New independent documents and full-poster edits use the new workspace. A legacy creative can be imported as a new Studio branch; if no saved original continuation exists, say **New editing session from this image**, not **Original context restored**. Import must require a human choice when it cannot meet same-model continuity.

Proposed routes (new, not existing): `/organizations/[organizationId]/campaigns/studio` for history/new work and `/organizations/[organizationId]/campaigns/studio/[documentId]` for a saved document. A validated `campaignId` preselection provides context. A requested exact revision is pinned explicitly. The static `studio` segment must coexist with the existing `[campaignId]` route; test route resolution and sidebar active states.

## 4. Clinical layout contract

Canonical desktop viewport: **1728 × 1080**, device scale 1, browser zoom 100%, Manrope loaded, light theme. Preserve the actual application shell: 256px global sidebar and 64px header. The Studio split applies to its content width after the sidebar, outer gutters and inter-panel gap; it does not mean 20% of the full browser including navigation.

- Page gutters: 32px horizontal; two-pane gap 24px. Available pane width is 1384px; left 276.8px, right 1107.2px at the canonical viewport.
- Left controls are one vertical sequence, with 16–20px section spacing, consistent labels, compact 36–40px controls and full-width upload triggers. The primary Generate action stays reachable at the bottom of the controls region while long settings scroll internally.
- Preserve the 1:4 ratio while the control rail is at least 256px. Below that width clamp the rail at 256px rather than crush controls. This responsive deviation is explicit and must be included in visual review.
- At tablet widths use a control drawer or a dedicated Create tab alongside History/Canvas; at mobile use a single work area and a clearly labelled settings opener. Do not compress the desktop rail into an unreadable 20% column.
- The right region is one workspace with mutually exclusive History, initial loading, streaming canvas, completed canvas and recoverable-error presentations. History is not left behind as a third panel once the canvas opens.
- Desktop history is a vertical list of **long horizontal cards**, not a thumbnail grid or horizontal carousel. Each row contains a legible image thumbnail, title and prompt excerpt, campaign/unassigned label, format, date, current revision and status, plus an Open action.
- Filters sit above the rows: search, campaign including No campaign, state, format and date range. Show active filter count, Clear filters, result count, empty results and retained-result refresh error. Dates render in organization timezone.
- Use the existing neutral/emerald chrome, border/radius/typography tokens and Lucide icon language. Artwork supplies color. Avoid a new visual theme.

`REFERENCE.md` records measured positions from the final proposed prototype. The missing sketch cannot be clinically analyzed by guessing: a later comparison must enumerate each discrepancy in sidebar order, left-section order, proportions, history-card arrangement, canvas treatment, picker placement and loading transition.

## 5. Entry states and navigation

- Sidebar entry always opens History with a blank creative setup and **no poster selected on the canvas**. Existing history thumbnails are allowed; no previous poster automatically occupies the canvas.
- Opening a specific saved creative shows its exact image revision, stored settings and ancestry immediately. Opening from a campaign selects the requested creative rather than the first asset in an array.
- New creative clears the selection only after preserving or explicitly discarding unsent edits. It returns to History/new setup; it does not delete saved images.
- Back to history retains current in-session settings and filter state. Reload of a saved document restores persisted settings and active run; it must not submit another generation.
- Viewer can read history and permitted final downloads, but cannot upload, generate, enhance, edit, review or attach. Controls carry explanations instead of disappearing unpredictably.

## 6. Left-side sections, in exact order

### 6.1 Campaign

Searchable selection, default **No campaign — create freely**. Read only same-organization campaigns the actor can access. Selecting a campaign provides attributable context and a requested attachment target, not campaign approval or permission to publish. Successful generation saves Studio first and then attaches the selected revision as a source needing review. Attachment failure must retain the generated image and provide Retry link without rerunning generation.

Existing campaign information cannot silently overwrite typed prompt/copy. If selecting a campaign conflicts with supplied offer text, show the conflict for review. Downloadable image creation is distinct from campaign eligibility.

### 6.2 Reference images

Rectangular **+ Select / upload references** trigger. On desktop, open a popover to its right with upload at the top and Approved designs beneath. On narrow viewports use a full-width Sheet/Dialog with the same content. Reuse the picker shell for product images; pass a typed source filter.

Separate **Preview** from **Select**. A design may be inspected at a useful large size with fit/zoom and filename/format/verdict before selection. Clicking a thumbnail is not silent consent. Selected items appear as removable thumbnails with a visible count; maximum three approved historical references unless a later approved capability change narrows it.

The library list includes only eligible approved finished designs. Rejected, unreviewed, archived, foreign-organization or rights-expired library versions never reach generation. Pin immutable version IDs and hashes; recheck at dispatch.

Fresh upload is a current-use operator reference with explicit use-rights confirmation, validated bytes and provenance. It does not become an Approved design or overwrite Asset Library review history. The new contract must distinguish this path from unreviewed historical-library retrieval.

Upload accepts the intersection of current application intake and qualified provider support. Initial repository intake supports PNG/JPEG/WebP; HEIC/HEIF requires an explicitly implemented conversion path before advertising support. Show effective per-file/request limits from capabilities. Validate actual bytes, dimensions, orientation and decompression bounds; handle progress, cancel, failed transfer, failed finalization, duplicate and expired preview separately.

### 6.3 Image generation style

Two radio buttons on one row: **Exact design** and **Take Inspiration**. Default Take Inspiration. Exact design requires at least one reference; indicate which is the primary layout reference when several are selected.

- Exact design: preserve reference composition, element placement and hierarchy as closely as possible; substitute supplied product images; apply the organization palette and typography guidance. If no product photo is supplied, the model may create a visually appropriate subject, but cannot present it as a photograph of the organization's real product. Do not carry the reference business's words, logo, prices or contact information into the output unless explicitly supplied for this organization.
- Take Inspiration: use the references as a starting point with greater freedom in composition and visual treatment while respecting the same brand rules, product identity and exact supplied copy.

Exact design is a requested adherence level, not a promise of identical pixels or guaranteed font reproduction. Hard brand restrictions still apply to both choices. Brand-source precedence: explicit applicable constraints → current versioned Brand Guidelines → supplied creative instructions → approved design inspiration. A conflict is shown, not silently resolved by the model.

### 6.4 Prompt

Textarea with 4–5 visible rows and internal scrolling. Label row contains **Enhance** and **New Idea** as separate compact buttons. Enhance requires non-empty text; New Idea may start from blank. Both use selected reference/style/product/brand context, produce a reviewable suggestion and do not generate an image automatically.

Show original and suggested text with Apply / Keep original. Applying changes only Prompt; Text copy remains byte-for-byte the user's input. Neither helper may invent offers, contact details, availability, prices, endorsements or campaign promises. Retain the pre-enhancement original in the run's input provenance. One bounded request per click, visible pending/error states, no overlapping replacements or automatic paid loops.

### 6.5 Text copy

Multiline textarea for exact wording to include in the poster. Examples belong in placeholder/help copy, not prefilled business claims. Preserve Unicode, punctuation, line breaks, numerals and language; do not paraphrase or translate implicitly. Blank is allowed for an image without text. Clearly distinguish words to render from design instructions in the provider payload.

Channel names can be resolved into approved channel-logo assets through explicit chips below the field. **Use channel logos** applies only to those selected known channels; show which text phrase is represented by logos before Generate. Preserve the original copy plus this explicit substitution manifest. Unknown channel names, unavailable logo bytes or uncertain availability must be surfaced; never invent a logo or imply a provider connection. Logo inclusion is branding, not publishing permission.

The final poster is one raster image. Human review checks spelling, addresses, phone numbers, claims, logo fidelity and layout at full size. Optional OCR may point out suspected mismatches, but never establishes verified exactness. The output may be downloaded directly once saved; campaign approval is a separate act.

### 6.6 Aspect ratio / size

Default proposed preset: **Instagram Feed · 4:5 · 1080 × 1350**. User approval of this package approves that interpretation of the otherwise ambiguous Feed label. Also expose square feed, stories, landscape advertising and product/flyer formats using the evidence-based capability table in the provider audit.

Each preset identifies destination/use, ratio and final export dimensions. Display native generation dimensions separately only when needed to explain a fit/pad/crop decision. Do not promise a native model ratio it cannot produce. For non-native ratios require a reviewed conversion strategy that preserves the whole poster and its text; automatic destructive cropping or stretching is prohibited. A provider that cannot meet the approved ratio/fidelity contract does not pass qualification.

Meta Ads, Google Ads, Amazon and ecommerce are placement families, not single sizes or proof of publishability. Unsupported placements stay visibly unavailable with a reason. Do not add an unrestricted custom-size field before its validation/export contract exists.

### 6.7 Product images

Reuse the reference picker UI, querying **Products & Subjects**, never Approved designs. Organization-industry wording may say **Product / dish images** for a restaurant; core data types stay industry-neutral. Large preview, source/rights information and explicit selection are identical. Images provide the actual subject; without them, generated subjects are labelled illustrative, not authentic product photography.

### 6.8 Generate

Primary full-width action pinned within the controls area. Before admission validate permissions, configured cost limits, provider qualification, ready uploads, Exact design reference requirement, known ratios and input bounds. Capture a frozen input snapshot and idempotency key. Disable duplicate submissions while that request is being admitted. Failures preserve typed values.

## 7. Generation and streaming state machine

`editing → admitting → queued → preparing → generating → previewing → validating → ready`; terminal or exceptional branches `failed`, `cancel_requested`, `cancelled`, `outcome_unknown`.

- Immediately after accepted Generate, show the full-screen portal overlay used as visual inspiration by `src/components/analysis/analysis-progress.tsx`: pale backdrop, focused white card, labelled stage rows, completed checks, one active spinner/shimmer, reduced-motion support. Reuse visual primitives, not Channel endpoint semantics or fabricated progress percentages.
- The first independently decodable provider preview closes the blocking overlay and opens the right canvas with **Generating preview**. Each subsequent provider preview replaces that image in increasing sequence order.
- A provider text delta, arbitrary base64 fragment, blurred final image, CSS wipe or timed mock does not count as a progressive image preview. The design prototype simulates this solely to demonstrate the flow.
- Download, marker submission and campaign use stay disabled for previews. Keep the last usable preview through reconnect; mark it unfinished. A final image becomes Ready only after byte validation, private storage and atomic version commit.
- Persist ordered run events and preview object identities. Reconnect resumes from the last event sequence without starting a new paid call. Raw provider payloads and private continuation IDs never reach the browser.
- Cancellation is a request until the worker confirms the outcome. Closing a panel is not cancellation. Unknown paid-provider outcomes enter reconciliation; no blind chargeable retry.
- If a qualified provider unexpectedly emits no partial preview on a particular run, save a valid final image honestly and record a missing-preview failure of that acceptance condition. Do not fabricate a preview or claim the progressive path ran. Repeated absence disables qualification pending investigation.

## 8. Canvas and contextual marker editing

The finished poster dominates the right region, displayed with contain/fit against a neutral canvas; no crop by default. Toolbar exposes history/back, Fit, zoom, marker mode and current revision. Output actions: Download, Use in campaign / linked campaign, Create campaign. Show **Saved · Needs review**, actual dimensions and a compact image-review reminder.

Marker mode captures a numbered point and a specific instruction. Store normalized coordinates against the unrotated, orientation-normalized original image, not container pixels; account for fit letterboxing, pan and zoom. Keyboard users can add and position a marker; every marker has an accessible list entry, instruction field and remove control. Proposed bounds: 1–8 markers, each non-empty instruction ≤500 characters.

Submit all marker instructions in one edit request. Send the clean parent image, a separate annotated image or structured coordinate manifest, exact parent revision/hash, original input context, and the provider's documented continuation. Pins must never be baked into the saved result. The generating provider and exact image model are pinned through the revision chain; no silent fallback. If the pinned model/context is unavailable, retain the image and offer an explicitly labelled new editing branch.

Conversation continuity is not a cache promise. Depending on qualified provider, preserve ordered replay parts and opaque signatures or a server-side continuation identifier. Do not persist or show private model reasoning. Branching from revision 2 must use revision 2's context, not the latest unseen turn.

Marker editing is instruction-guided full-image editing, not the legacy deterministic outside-mask compositor. The whole poster needs review after an edit because unmarked areas can change. Preserve immutable revisions, before/after comparison and an explicit earlier-revision restore/new-branch action. Text-change marker instructions cannot silently redefine the frozen Text copy: show the resulting requested-copy change for confirmation before generation.

## 9. Saving, campaign use and Asset Library

Every successfully committed image lives in Studio history, including unassigned work. A completed revision is immutable. Its settings, supplied copy, selected assets, actual model, provider context lineage, dimensions and content hash remain attributable.

Studio history and Asset Library Creative History are distinct views with distinct purposes. Generated Studio output can be filed in Creative History as **Unreviewed** through the explicit **Save to Asset Library** action and its idempotent receipt defined by the technical contract; it does not become an approved reference because it was generated or linked to a campaign.

Campaign picker selection is an intended link. After success, record the exact selected Studio version and hash. If the campaign has a valid destination/direction/bundle slot, import those exact bytes as a new unreviewed deliverable source. Never substitute the image as mere inspiration, silently regenerate it, borrow an old approval, or publish it.

Create campaign gathers genuine required brief fields, creates a draft and records the selected creative link. Existing `createCampaignService.create` queues generation, so it is not a safe unchanged implementation of this button. A new draft with no real output slot displays **Linked to draft — finish campaign setup**; it must resolve the saved selected bytes into the eventual real slot without losing them or inventing direction IDs. The plan must test that later completion path, not stop after inserting a link row.

Changing a Studio revision does not mutate a campaign's selected revision. Replacing it is a separate exact-version selection, with a new campaign output review. Download returns the persisted final image through an authenticated private-object resolver and correct filename/content type; no approval required solely to save locally.

## 10. Security, observability and failure behavior

Follow the technical contract's additive schema/RPC/permission design. Tenant identity comes from the authenticated route, not request bodies. Composite organization foreign keys and database policies protect documents, references, outputs, previews, continuations and campaign links. User-facing requests use the caller session; worker privilege cannot review or publish.

Do not store signed URLs in immutable identities or digests. Private object retention/revocation and provider-context expiration must have explicit recovery states. Validate image bytes rather than MIME claims; reference/prompt text is untrusted data, never system policy.

Record run IDs, organization ID, version ancestry, provider/model, safe stage timings, time-to-first-preview, preview count, generation duration, usage/cost and safe failure code. Do not log prompts, raw copy, image bytes, secrets, provider continuation tokens or customer details. Emit durable generated/edited/linked/failed events at transactional boundaries; success in Trigger alone does not prove stored output.

Required visible failures: missing brand essentials, stale reference review, unsupported file/ratio, upload failure, no image/refusal, invalid final bytes, lost stream, late events, expired preview, lost provider context, unavailable pinned model, stale edit parent, failed campaign link and revoked access. Preserve usable prior revisions and in-progress form text; never convert an error into blank history or false success.

## 11. Acceptance and evidence

- Sidebar order and direct-entry blank canvas match the approved design.
- Both campaign-free and campaign-selected generation complete, survive reload and preserve all inputs.
- Reference and product pickers show correct tenant-scoped pools, large previews and functioning uploads; rejected historical designs never reach the final provider payload.
- Both style modes, exact-copy preservation, prompt suggestions and format/export rules have meaningful contract tests.
- A real authorized provider run supplies independently decodable partial images before final; timestamps and frame hashes prove the sequence. Browser video/screenshots show overlay→preview canvas→saved final.
- A real marker edit after reload uses the same pinned image model and saved parent continuation; visual review assesses instruction fulfillment and unintended changes.
- Downloaded bytes match the selected final revision hash. Preview bytes are never downloadable as final output.
- Existing/new campaign linking retains exact selected image bytes and eventually produces the correct unreviewed deliverable; no automatic publication or inherited approval.
- Tenant A/B and viewer/operator tests cover every read, mutation, stream, object and continuation boundary.
- Desktop 1728, desktop 1440, tablet 1024/768 and mobile 390/320 are reviewed against frozen references; keyboard, 200% zoom, reduced motion, loading/empty/error states and dialog focus pass.
- Fresh per-task code/spec reviewer and Chrome DevTools frontend verifier report findings; fix/re-review continues until clean. A final independent verifier performs a human-like real poster generation and edit flow. A prototype simulation cannot satisfy real-provider acceptance.

## 12. Documentation, approval and rollback

This is a Tier 3 boundary change. Before production implementation, approve this specification, the visual baseline and the execution plan. Draft a new ADR explicitly scoping the exception to ADR 0042/Spec 020 (model now renders complete posters) and preserving legacy compositor guarantees. Reconcile known stale status prose in Specs 019/020 and ADR 0049 without weakening the rejected-reference boundary. Do not mark existing draft ADRs approved by inference.

Migrations are additive and forward-only; hosted staging is the only database. Every new PL/pgSQL function reading existing tables must be called on staging before completion. Never run local Supabase, `pnpm db:types`, `git stash` or a broad formatting pass. Preserve unrelated dirty work. Deployment/push and provider spending are not implied by producing this design package.

Rollback disables new admissions/navigation behind the organization allowlist, drains or cancels runs through the state machine, retains saved outputs and legacy Studio read access, and leaves additive tables in place. Do not roll back by deleting creative history or unapplying shared migrations.
