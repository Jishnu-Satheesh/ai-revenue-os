# Feature Specification: Campaign Creative Studio

## Status

**Approved 2026-08-24.** Tier 3. Implemented against
`docs/superpowers/plans/2026-08-24-campaign-creative-studio-implementation.md`.

Revised before approval to adopt four practices from a design studio the user has already shipped to
real clients: multi-region annotated editing, named text slots in the operator's language, a
creative-direction field with a prompt optimizer, and aspect presets. §7.6 and §7.3 carry those
changes.

**No task in this specification may begin before the renderer spike in §18.1.** Everything here rests
on shaping Malayalam correctly, and that is unproven.

Depends on `specs/019-organization-asset-library.md` and ADR 0041, and cannot be built before them:
a studio that composes over an invented dish composes a better-looking wrong answer.

Depends on ADR 0015 (bundle as system of record), ADR 0017 (runtime and approval), ADR 0020
(bounded creative family approval), ADR 0023 (permission as data). Introduces ADR 0042.

## 1. Business outcome

Turn a picture of the right dish into something a restaurant would actually post: a flyer with a
headline, an offer, a price and a call to action, spelled correctly, in Malayalam, English or
Arabic.

Release 1 succeeds when the pilot client can publish a poster whose every word is exactly what the
approved campaign says, in the script they chose, without a designer and without correcting it.

Spec 019 fixed *what is depicted*. This fixes *what it says* — the half of the original complaint
that 019 deliberately left open.

## 2. Problem statement

The four assets examined on 2026-08-24 failed in two independent ways. Spec 019 addressed the first:
the platform drew a French duck breast for a Kerala restaurant. This specification addresses the
second, which is narrower and more embarrassing.

**Asset `f4a13d71` is the whole case.** It is the only one of the four that attempted text. It
rendered *"Explore Our Mezza"* — misspelled — above *"'The Joy of Sharing'"* with a stray leading
apostrophe, over shapes that resemble Arabic script without being Arabic at all.

That is not a bad prompt. It is what diffusion models do. They draw letters as shapes they have seen,
so they approximate. Latin comes out *nearly* right often enough to be dangerous. Arabic comes out
as ornament. Malayalam — with conjunct consonants, reordering vowel signs, and far less training
data — comes out worse. A Kerala restaurant in Dubai posting mis-spelled Malayalam to its own feed
has done itself more damage than posting nothing at all.

The platform's current answer is to forbid text entirely. `model-router.ts:245` instructs *"Do not
render text that states a price, a discount, or a claim."* That was written to stop a model
inventing a discount, and it works. It also removes the only thing a promotional flyer exists to
say. Campaign `783ab4e1` proves the cost: it went out as three scheduled Instagram posts with
`offer: null` and a photograph, which is not a campaign.

Four things are missing, and none of them is a better prompt:

- **No compositor.** Nothing in the tree renders text onto an image. `sharp` is present and used
  only to re-encode uploads in `asset-intake.ts`.
- **No fonts.** No font file is vendored anywhere. No text-shaping or text-rendering package is
  installed — no `satori`, no `resvg`, no canvas binding, no `opentype`.
- **No layout.** A poster has a safe area, a type scale, a logo slot and a legal line. The manifest
  has none of these concepts.
- **No verification.** `asset-intake.ts` sniffs bytes and re-encodes. There is no OCR, no face
  check, no glyph-coverage check. That is why nine invented faces and two misspellings passed.

`campaign_visual_attestations` exists and holds four rows, but it records a **human** stating they
looked at an exact bundle digest. It is an approval instrument, not a verification pass, and this
specification does not weaken it.

## 3. User stories

- As a restaurant owner, I publish a flyer whose price is the price I approved, because a machine
  typed it from the approved figure rather than a model drawing it from memory.
- As a Malayali restaurant owner in Dubai, I publish the same offer in Malayalam, English and Arabic
  and each one is spelled correctly.
- As an agency operator, I nudge one thing on the picture — remove the fork, warm the light — by
  marking that area and saying so, without regenerating the whole image.
- As an agency operator, I am refused rather than shipped a poster where a Malayalam character came
  out as an empty box.
- As an agency operator, I see the same poster render identically today and next month, so what I
  approved is what publishes.
- As a compliance-minded operator, an edit after approval sends the campaign back for approval, and
  I would be alarmed if it did not.

## 4. Governing principles

- **The model draws; the platform writes.** No text is ever requested inside a generated image, in
  any script. Every visible word is composited by deterministic code from an approved value.
- A render is a pure function of its inputs — plate bytes, template version, text values, font
  versions. The same inputs produce the same bytes, and the digest proves it.
- Text that cannot be rendered correctly is refused, never approximated. A missing glyph is a
  refusal with a codepoint, not a box on a customer's screen.
- Nothing is silently truncated. A headline that will not fit is shrunk within declared bounds and
  then refused with a stable code.
- **In a masked edit, the platform decides which pixels changed, not the model.** The result is
  composited back only inside the mask, so the rest of the image is byte-identical by construction.
- An edit produces a new version. Nothing is edited in place, because approval binds a digest.
- A model may report what it sees in an image. It may not decide whether that image passes.
- Fonts are vendored and pinned. A font that updates changes what publishes, so it is an input with
  a version, not an ambient fact about the machine.
- **Operator-facing text may be any script. Model-facing text is always English. Rendered text is
  composited from the operator's original and is never round-tripped through a model.** This is the
  rule that carries the user's existing English-only studio into three scripts. A Malayalam creative
  direction is translated to English before it reaches a model, because image models understand
  English best whatever the target script — but a Malayalam *caption* is never translated,
  regenerated or paraphrased. It is typed once and drawn with a real font, because anything that
  goes to a model and comes back comes back mangled, and neither the operator nor the platform can
  see it.

## 5. Scope

### 5.1 In scope

- A deterministic compositor: plate plus text and logo layers to a final poster, in the exact pixel
  dimensions each placement requires.
- Vendored fonts covering Latin, Malayalam and Arabic, pinned by version and content hash.
- Correct shaping and bidirectional layout, including RTL Arabic and Malayalam conjuncts.
- A glyph-coverage check that refuses before rendering rather than after.
- Versioned, declarative poster templates owned by the platform.
- Text values sourced from the approved manifest — headline, offer, price, call to action, legal
  line — never from the image model.
- Multi-region annotated editing of the plate — several marked regions, each with its own
  instruction, submitted together — with the result composited back inside their union only, and
  full lineage.
- Named text slots in the operator's language, and one governed free slot.
- A creative-direction field with a prompt optimizer, bounded to treatment. Its semantics and its
  fence live in spec 019 §7.7; this specification owns the surface.
- Aspect presets for a render with no placement to derive dimensions from.
- Download of a rendered poster. "Share" links to the campaign, never to a public asset URL, so it
  cannot become an unaudited path around the Tool Gateway.
- A verification pass: text-on-plate detection, face detection, and glyph coverage. Blocking.
- A studio surface: template choice, per-script preview, annotated editing, refusal states.
- Re-render reproducibility, and the render digest inside the bundle digest.
- Replacing the `model-router.ts:245` text prohibition with an absolute one on the plate.

### 5.2 Out of scope

- Video, animation, carousels, Reels.
- Operator-authored or per-organization templates. Release 1 templates are platform-owned; the
  seam is a template `owner_scope` column that only ever reads `core` in this release.
- Free-form canvas editing — dragging layers, arbitrary type placement. Templates are the contract.
- Translating copy. Multilingual **copy generation** is a text-model concern and remains with the
  campaign module; this specification renders whatever approved text it is given, in whichever
  script that text is written.
- Automatic layout choice by a model.
- Removing text from a client's own uploaded photograph.
- Print formats, bleed, CMYK.

### 5.3 The one-line division from spec 019

| | Spec 019 — Asset Library | Spec 020 — Creative Studio |
|---|---|---|
| Answers | what is in the picture | what the picture says |
| Produces | the **plate** — a photograph or a drawing of the declared dish, with no text | the **poster** — plate plus composited layers |
| Model's role | draws the dish | draws nothing new except inside a mask |
| Refuses when | nobody declared the subject | a glyph is uncovered or text will not fit |

## 6. UX flow

1. **Open the studio** on an approved-or-draft bundle version. The plate is shown as spec 019
   produced it, with its truth class in plain words.
2. **Pick a template.** Two or three per placement, previewed with this campaign's real text rather
   than lorem. Templates that cannot hold this campaign's text are shown as unavailable with the
   reason, not hidden.
3. **Check the words.** Headline, offer, price, call to action and legal line are shown as editable
   text bound to the manifest. Editing one is a manifest change and carries the usual consequence:
   a new version, and re-approval if the version was approved.
4. **Switch scripts.** A tab per script the campaign declares. Each renders live. A script whose
   text is missing says so rather than falling back to English silently.
5. **Nudge the picture.** Paint over a region of the plate, type what should change there, and get a
   new plate version. The unmasked area is guaranteed unchanged. Every edit is listed with its
   instruction, so the chain from the original is readable.
6. **Read the verification.** Pass or refusal per check, each with a plain-language reason and the
   action that clears it. A refusal is never styled as a warning.

Nothing blocked is styled as ready. Every refusal carries its stable code, an explanation and a
recovery.

## 7. Domain rules

### 7.1 The plate and the layers

- A **plate** is an image with no text. It comes from spec 019 — the client's photograph, or a
  drawing of their declared dish — or from a masked edit of one.
- A **layer** is text or a logo, positioned by a template, filled from an approved manifest value,
  rendered by the platform.
- A **poster** is a plate plus its layers, rendered deterministically.
- The plate prompt forbids text absolutely. This is stronger than today's rule, which forbids only
  price, discount and claim text.

The division exists because the two halves have opposite failure modes. An image model draws food
convincingly and spells badly. A layout engine spells perfectly and cannot draw food. Asking either
to do the other's job is what produced *"Explore Our Mezza"*.

### 7.2 Templates

- Declarative, versioned, platform-owned. Not model-authored and not model-selected.
- A template declares: canvas size per placement, safe areas, a logo slot, plate crop focus, and per
  text box a maximum line count, a minimum and maximum font size, alignment, and whether the field
  is required.
- A template version is immutable. A changed template is a new version; posters already rendered
  keep the version that produced them.
- Fitting is deterministic: shape at the maximum size, shrink by a declared step until it fits
  within the box and the line cap, and refuse with `text_does_not_fit` if the minimum is reached and
  it still does not. **Never truncate, never ellipsise, never overflow.**
- A template that declares a required field the manifest cannot supply is unavailable for that
  campaign, and says which field is missing.

### 7.3 Text slots, in the operator's language

Text boxes are named the way a person composing a flyer names them — **caption**, **body**,
**footer**, **extra** — rather than by the manifest field they happen to bind to. Adopted from the
user's production studio, where labelling the field at the point of entry proved clearer than
inferring it from a layout.

Each named slot binds to an approved manifest value: caption to the headline, body to the offer and
price, footer to the call to action and legal line. The label is presentation; the value is
governed.

**One slot is genuinely free.** `extra` accepts operator-authored text that has no manifest
equivalent — an opening time, a branch name, a hashtag. It is not a loophole: it passes through
`evaluateContentPolicy` exactly like every other piece of campaign copy, so it cannot carry a price,
a discount or a claim that the manifest did not approve. A free box that skipped content policy is
where "50% off" would get typed around the governance, which is why it does not skip it.

A slot with no value is not rendered, and a template that requires it is unavailable rather than
rendered half-empty.

### 7.4 Text comes from the manifest

- Every rendered string is a manifest value that already passed `evaluateContentPolicy` and the
  approval binding. The compositor reads; it does not compose prose.
- The offer and the price are rendered from the manifest's integer minor units and ISO currency
  through the existing money formatting, so the poster cannot disagree with the campaign.
- This is what allows the prohibition in `model-router.ts:245` to change rather than be lifted. The
  concern behind it — a model inventing a discount — is fully answered by the model no longer
  writing any text at all. The prohibition becomes absolute on the plate, and the offer becomes
  renderable because it is now quoted from a governed figure rather than recalled by a generator.
- A realized-result claim remains prohibited by `AGENTS.md` §6 whatever surface it is rendered on.
  The compositor renders approved offer text; it does not become a licence for new claims.

### 7.5 Scripts, fonts and shaping

This is the hardest technical requirement in the specification and the one most likely to be
underestimated.

- Fonts are **vendored into the repository** under an open licence, pinned by version and by content
  hash, covering at minimum Latin, Malayalam and Arabic. They are never fetched at runtime and never
  taken from the host's font configuration, because a worker container's fonts are not an input
  anybody approved.
- The renderer must perform real shaping — HarfBuzz-class — not glyph-per-codepoint drawing.
  Malayalam requires conjunct formation and vowel-sign reordering; Arabic requires contextual forms
  and joining. A renderer that lays out codepoints left to right produces text that is wrong in a
  way a non-reader cannot see.
- Bidirectional text follows the Unicode bidi algorithm. Mixed Arabic and Latin — a price in Latin
  digits inside an Arabic sentence — is the common case, not the exotic one.
- **Glyph coverage is checked before rendering.** Every codepoint in every text value must be
  covered by the registered font for its script. An uncovered codepoint refuses with
  `glyph_not_covered` and names the codepoint. This is deterministic, exact, and is the check that
  makes the empty-box failure impossible rather than unlikely.
- The font manifest — family, version, content hash per file — is an input to the render digest. A
  font upgrade produces a different digest and therefore a new version, which is correct: it changes
  what publishes.

The recommended implementation is a Skia or resvg-class native renderer with explicit font
registration, compositing through the `sharp` already present and already externalised in
`trigger.config.ts`. §18 records this as the first thing to be de-risked, because the whole
specification rests on it.

### 7.6 Masked editing

- A mask applies to the **plate only**. Text is never edited by painting over it; text changes by
  changing the manifest value and re-rendering. Painting over text to fix it would reintroduce
  exactly the failure this specification removes.
- **An edit is a set of annotations, not one mask.** The operator marks as many regions as they
  like, each carrying its own instruction — *remove the fork here*, *warm the light there* — and
  submits them together as a single edit. This is adopted from the user's production studio, where
  batching annotations proved better than one-note-at-a-time both for the operator and for the
  number of model round trips.
- Each annotation is a region plus a bounded instruction. Regions are stored as one single-channel
  raster at plate resolution with a content hash, plus the per-region coordinates and instructions,
  so the edit is replayable and auditable rather than a blob.
- Annotations are bounded individually and collectively. A region below a minimum area is a
  mis-click and is refused; a union above a maximum proportion of the canvas means the honest action
  is to regenerate, and the studio says so rather than attempting it.
- Instructions are operator free text, carried to the model as data in a delimited block, with the
  fixed constraints of spec 019 §7.4 appended after them — no faces, no invented components, no text
  of any kind.
- **The returned image is composited back inside the union of the marked regions only.** The
  platform blends the model's output through that union, feathered at the edges to avoid a seam, so
  every pixel outside it is byte-identical to the parent plate. This is a property of the code, not
  a promise from the model, and it is asserted by test. Batching annotations does not weaken it: the
  boundary is the union, computed by the platform.
- The result is a **new plate version** with its parent recorded, the mask hash, the instruction and
  the model. Nothing is edited in place.
- Because the bundle digest changes, an edit after approval invalidates approval under ADR 0017.
  That is intended and is surfaced before the edit is made, not after.

### 7.7 Verification

Runs before a poster is offered to an operator. Three checks block; one advises.

| Check | Method | Blocking | Catches |
|---|---|---|---|
| Glyph coverage | Deterministic, from the font tables | **yes** | the empty-box failure |
| Text on the plate | OCR or a narrow vision extraction | **yes** | *"Explore Our Mezza"* |
| Identifiable faces on the plate | Face detection | **yes** | the nine invented customers |
| Subject likeness | Vision model, structured | no — advisory | a drawing that drifted from the dish |

- A model may be used to **report** what it sees. The pass or refusal decision is deterministic code
  reading that report. This is the extraction role `AGENTS.md` permits, not a verdict, and it is
  consistent with spec 016's rule that no model chooses a verdict.
- A detection failure that cannot be performed — the checker is unavailable — is recorded as
  `verification_unavailable` and blocks. Unknown is not a pass.
- The advisory likeness check is shown to the operator and never blocks, because a model judging
  another model's output is weak evidence and should not be able to stop work.

### 7.8 Truth class, and a naming trap

Spec 019's `truth_class` describes **the plate** and continues to mean exactly what it means there:
`authentic_source`, `synthetic_composite`, `synthetic_generated`.

A poster's composition is recorded **separately** and is never called a composite in this codebase's
vocabulary. It is a **render**, with a render digest, a template version, a font manifest and a
plate version.

The trap is real: `synthetic_composite` in spec 019 means *a drawing conditioned on the client's
photograph* and has nothing to do with compositing layers. Anyone who conflates the two will label
posters wrongly, and the label is a truth claim shown to a client.

## 8. Data model

Tenant-owned tables carry forced RLS, composite tenant foreign keys, explicit grants, and
`authenticated` select-only. Writes go through security-definer functions with `search_path = ''`
and an explicit organization check. Every new function that reads a table it did not create is
called once against staging before its task is done.

### 8.1 New — `campaign_poster_templates`

Registry, not tenant-owned, mirroring `creative_review_reasons` from spec 019.

`id`, `key`, `version`, `placement`, `canvas_width_px`, `canvas_height_px`, `layout jsonb`,
`owner_scope` in `core | pack | organization`, `pack_slug` nullable, `state` in `active | retired`,
`created_at`. Unique `(key, version)`. Release 1 seeds only `core` rows.

### 8.2 New — `campaign_poster_renders`

One row per render. Append-only.

`id`, `organization_id`, `campaign_id`, `bundle_version_id`, `plate_asset_id`, `template_key`,
`template_version`, `script`, `text_values jsonb`, `font_manifest jsonb`, `render_digest`,
`output_asset_id`, `verification jsonb`, `rendered_at`, `created_at`.

Unique `(organization_id, bundle_version_id, template_key, template_version, script, render_digest)`
so an identical re-render is idempotent rather than duplicated.

### 8.3 New — `campaign_plate_edits`

Append-only lineage of masked edits.

`id`, `organization_id`, `campaign_id`, `parent_plate_asset_id`, `child_plate_asset_id`,
`mask_storage_path`, `mask_content_hash`, `union_coverage_ratio`, `annotations jsonb`, `model_id`,
`edited_by`, `edited_at`.

`annotations` is an ordered array of `{ ordinal, bounds, instruction }` — one entry per marked
region, each instruction bounded at 500 characters, at most 8 regions per edit. The rasterised union
is stored once at `mask_storage_path`; the per-region bounds and instructions live here so the edit
is readable and replayable rather than an opaque blob.

Constraints: `union_coverage_ratio` between the declared minimum and maximum; `annotations` non-empty
and within the region cap; parent and child both belong to this organization; append-only trigger.

### 8.4 Changed — `campaign_bundle_versions`

- The manifest gains a `posterPlan`: the chosen template key and version per placement, and the
  scripts to render. Inside the manifest, therefore inside the digest, therefore inside the
  approval binding — the same treatment ADR 0020 gave the generation policy.
- Existing V2 manifests without a `posterPlan` remain valid and render nothing, so no backfill.

### 8.5 Fonts

Vendored files under `assets/fonts/`, with a checked-in manifest recording family, version, licence
and SHA-256 per file. Asserted at worker start; a mismatch is a hard failure rather than a warning,
because silently rendering with a different font changes what a client publishes.

### 8.6 Storage

Masks go to a new private `campaign-masks` bucket, organization-prefixed. Rendered posters go to the
existing `campaign-assets` bucket alongside plates.

## 9. API and events

- `GET /organizations/:id/campaigns/:campaignId/studio` — plate, templates, text values, renders.
- `POST /organizations/:id/campaigns/:campaignId/renders` — render a template and script.
- `POST /organizations/:id/campaigns/:campaignId/plate-edits` — reserve a mask upload and queue an
  edit.
- `GET /organizations/:id/poster-templates` — available templates with per-campaign availability.

Workflows: `campaign.render-poster` and `campaign.edit-plate`, both registered Trigger tasks. Note
that five campaign workers already exist in `src/workflows/campaigns/` and are **not** registered;
these two must be registered or they will queue with nobody to execute them.

Permissions, seeded as data: `campaign.edit` already covers editing an unapproved campaign and is
reused. New: `poster.render`.

Events: `campaign.poster_rendered`, `campaign.plate_edited`, `campaign.render_refused`.

## 10. AI behavior

- The model draws the plate and, inside a mask, an edit. It draws nothing else.
- **No prompt in this feature requests text in any script**, and the plate prompt says so
  absolutely.
- A model may report detections — text present, faces present, likeness — as structured output
  parsed by Zod. It decides nothing.
- The masked-edit instruction is operator-authored free text and is the one injection surface added
  here. It is delimited as data, the fixed constraints follow it, and the mask composite means even
  a fully successful injection cannot change a pixel outside the marked region.
- No model chooses a template, a font, a size, a colour, or whether a render passes.

## 11. Security and tenancy

- Every read is through the caller's session so RLS decides visibility; worker writes go through
  security-definer functions with explicit organization checks.
- Mask uploads follow spec 019's proven pattern: reserve a path, upload, read the bytes back, and
  validate them server-side. A mask is an image and is untrusted like any other.
- Mask storage paths are validated against the tenant prefix before any byte is fetched.
- A render request naming a plate from another organization is refused before any work is queued.
- Rendered posters inherit the existing campaign-asset access rules. No new public surface.
- Font files are read from the repository, never from user input, never from a URL.
- No secret, token or customer PII is logged. Operator instructions are tenant content.

## 12. Observability

Logs and spans carry `organizationId`, `campaignId`, `bundleVersionId`, `renderId`, `runId`,
`workerId`, `correlationId`, plus `templateKey`, `templateVersion` and `script`.

Tracked: render latency and failure stage; refusals by code, split by script — a Malayalam refusal
rate materially above Latin means the font coverage is wrong, not the operator; shrink-to-fit
distance from maximum size, as an early signal that a template is too tight; mask coverage
distribution; edits per plate; verification outcomes by check; and font-manifest mismatches, which
should always be zero.

Alerts: any font-manifest mismatch at worker start; any `verification_unavailable` streak, since
unknown blocks and a broken checker silently stops all work; and a render digest that changes for
unchanged inputs, which would mean reproducibility has been lost.

## 13. Failure states

- **Glyph not covered** — `glyph_not_covered` with the codepoint and the script. Recovery is a font
  with that coverage, or different text. Never a box on screen.
- **Text does not fit** — `text_does_not_fit` after shrink-to-fit reaches its minimum, naming the
  field and the template. Recovery is shorter text or another template.
- **Required field missing** — the template is unavailable and names the field.
- **Script declared with no text** — refuses that script's render rather than falling back to
  English. A silent language fallback is worse than an error, because nobody notices it.
- **Mask too small or too large** — refused with the measured ratio and the bound.
- **Edit returns an image the mask cannot accept** — wrong dimensions or unreadable bytes — the edit
  fails and the parent plate is untouched, because nothing was ever edited in place.
- **Verification unavailable** — blocks, recorded as unknown, never passed.
- **Font manifest mismatch at boot** — the worker refuses to start rather than rendering with
  whatever it found.
- **Template retired between approval and render** — the pinned template version is used. Retirement
  stops new selections; it does not rewrite an approved plan.

## 14. Acceptance criteria

- A poster renders with headline, offer, price and call to action, and every string is exactly the
  approved manifest value, verified by comparing rendered text values to the manifest rather than by
  eye.
- The same poster renders byte-identically twice, and its render digest is stable across worker
  restarts.
- Malayalam renders with correct conjuncts and reordered vowel signs, and Arabic renders right to
  left with correct joining, both confirmed by a reader of the script rather than by the renderer's
  own claim.
- A price in Latin digits inside an Arabic headline renders in the correct visual order.
- A text value containing a codepoint the font does not cover is refused before rendering, naming
  the codepoint. No empty box reaches a rendered image.
- A headline too long for its box is shrunk within declared bounds and then refused. No render is
  ever truncated, ellipsised or overflowed.
- No generated plate contains text, and the verification pass refuses one that does.
- A masked edit changes pixels only inside the mask: every pixel outside is byte-identical to the
  parent, asserted programmatically.
- A masked edit produces a new plate version with parent, mask hash and instruction recorded, and
  invalidates approval when the version was approved.
- A face detected on a plate blocks; the advisory likeness check never blocks.
- A font file whose hash does not match the manifest stops the worker.
- Tenant isolation holds across all three new tables, both new workers, the mask bucket and every
  new route.

## 15. Test plan

- **Shaping and coverage** — golden-image tests per script for a fixed string, font and size, so a
  library upgrade that changes shaping is caught rather than published. Malayalam conjunct and
  vowel-reorder cases, Arabic joining and RTL cases, and a mixed bidi case, each asserted against a
  checked-in reference rendering.
- **Coverage refusal** — a string containing an uncovered codepoint refuses before any render, and
  names the codepoint.
- **Fitting** — shrink-to-fit at boundary values; refusal at the declared minimum; no code path
  truncates.
- **Determinism** — identical inputs render identical bytes; a changed font hash, template version
  or text value changes the digest; an unchanged input never does.
- **Mask compositing** — the unmasked region is byte-identical to the parent across a range of mask
  shapes, including a mask touching every edge; feathering does not leak outside the declared
  boundary; a model returning a wholly different image still cannot alter an unmasked pixel.
- **Mask bounds** — refusals below the minimum and above the maximum coverage ratio.
- **Verification** — each blocking check refuses; the advisory check never blocks; an unavailable
  checker blocks rather than passes.
- **Manifest binding** — a rendered value that disagrees with the manifest fails; a template change
  produces a new version; an edit after approval invalidates approval.
- **Tenant isolation, explicitly** — two-organization pgTAP on `campaign_poster_renders` and
  `campaign_plate_edits`; a cross-tenant plate, mask path or campaign id in path or body is refused;
  forced RLS asserted per table; append-only triggers refuse update and delete.
- **Worker registration** — both new tasks are registered and reachable, checked by dispatching one
  of each. Five campaign workers are already unregistered in this repository; this is a live
  failure mode, not a hypothetical.
- **Live proof** — one poster per script for organization `2dda45b8-82db-4f5f-b17d-611b9bbb7846`,
  reviewed by a Malayalam reader and an Arabic reader, recorded redacted under
  `docs/verification/campaigns/` with the exact text values alongside the images.
- **Browser** — Chrome DevTools MCP at 1440×900 and 390×844 across template choice, the script tabs,
  the mask editor, every refusal state and the verification panel. RTL layout checked at both
  widths. No console errors.
- **Known flake** — `src/workflows/reports/pdf-text-layer.integration.test.ts`. Pre-existing, not
  touched.

## 16. Migration and rollback

One additive migration: three tables, the template seed, the permission seed, the mask bucket and
its policies, and the security-definer write functions. The manifest gains an optional `posterPlan`,
so existing V2 bundles stay valid and no backfill exists.

The dependency additions — a text renderer and vendored fonts — are the substantive change. The
renderer is a native module and must be added to `trigger.config.ts` `external` alongside `sharp`,
or the worker will fail at runtime on the first render rather than at build.

Pushed migrations are live on shared staging immediately. There is no local rehearsal.

Rollback: the compositor, the workers and the studio surface are a code revert; the tables can be
left in place unused; the manifest field is optional and needs no reversal. The one change with a
consequence is the plate prompt becoming absolute about text — reverting it restores today's partial
prohibition, and *"Explore Our Mezza"* with it.

## 17. Documentation updates

- ADR 0042 — the model draws and the platform writes; a render is reproducible from pinned inputs;
  in a masked edit the platform decides which pixels changed.
- `context/04-domain-model.md` — plate, layer, poster, render, template, mask.
- `context/05-module-map.md` — the compositor and the two new workers.
- `specs/016-campaign-feedback-loop.md` — a note that an approved version now carries a poster plan.
- `specs/019-organization-asset-library.md` — a note that the plate is this specification's input,
  and a pointer to §7.7 on the naming trap.

## 18. The gate, and what remains open

### 18.1 The renderer spike — a gate, not a question

The single riskiest choice in this document, and everything else rests on it. **No other task may
begin until this is answered.**

A Skia-class binding with explicit font registration is the recommendation, with a resvg-class
renderer as the fallback. Both avoid depending on the container's font configuration, which is the
option that must not be chosen at any price.

The spike renders three strings at poster size with vendored fonts, and a reader of each script
judges the output:

- a Malayalam string with a conjunct and a reordering vowel sign;
- an Arabic string requiring contextual joining, laid out right to left;
- a mixed string — Latin digits inside an Arabic sentence — exercising the bidi algorithm.

It passes only if all three are correct to a reader. Partial credit is not a pass: a renderer that
handles Arabic and mangles Malayalam has failed for this client, whose own language is Malayalam.

**If no renderer shapes Malayalam correctly, the scope reduces to Latin and Arabic and the client is
told plainly rather than shipped boxes.** That outcome is acceptable. Shipping unreadable Malayalam
is not.

**Resolved 2026-08-24 — the spike passed on all four cases.** `@napi-rs/canvas` 1.0.8 with fonts
registered by explicit path shaped Malayalam conjuncts and pre-base vowel reordering, Arabic
contextual joining right-to-left, and Latin digits inside an Arabic sentence in correct bidi order.
Evidence on the coordination board.

One constraint stated earlier here was wrong and is withdrawn: the renderer was required to report
unmapped codepoints or be disqualified. **Glyph coverage is a cmap question, not a renderer
question.** The control case proved why it matters — Malayalam drawn in a Latin font produced seven
empty boxes silently, with no error and a perfectly plausible measured width. A `fontkit` cmap
lookup named all seven codepoints *before* rendering. Coverage checking therefore sits in its own
module, independent of whichever renderer is chosen.

### 18.2 Still open

1. **Does the image model accept a mask, or only a marked-up image?** The compositing rule in §7.6
   makes this less critical than it appears — the platform enforces the boundary either way — but it
   decides whether edit quality is good or merely safe. Not answerable without running it.
2. **How many templates ship in Release 1?** The recommendation is two per placement, because one is
   not a choice and five is a design project. This is a judgement about scope, not a technical
   unknown.
3. **Who supplies the legal line?** A promotional flyer in the UAE may need terms, and neither the
   manifest nor Business Memory has a field for them today. If the answer is "nobody yet", the
   field is optional in Release 1 and the templates that require it are simply unavailable.
