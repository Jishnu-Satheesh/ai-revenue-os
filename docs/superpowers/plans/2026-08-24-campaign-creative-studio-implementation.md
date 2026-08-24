# Campaign Creative Studio — Execution Plan

**Spec:** `specs/020-campaign-creative-studio.md` (approved 2026-08-24)
**ADR:** `adrs/0042-the-model-draws-and-the-platform-writes.md`
**Depends on:** `specs/019-organization-asset-library.md` Slice A must be landed. This plan composes
over the plate that 019 produces; there is nothing to compose over until it exists.
**Tier:** 3. This document is the approval gate required by `AGENTS.md` §4.
**Board:** `docs/collaboration/asset-library-and-studio-board.md`
**Goal:** a poster for Al Noor Kitchen carrying their approved offer, spelled correctly, in
Malayalam, English or Arabic.

---

## Task 0 — The renderer spike. Everything is blocked on this.

**Do this before anything else in this plan, and before installing any dependency it might imply.**

- Try the leading candidate first: a Skia-class binding with explicit font registration. Fall back to
  a resvg-class renderer. **Do not use anything that relies on the container's font configuration**
  — not `sharp`'s SVG text path, not Pango via fontconfig. A worker's ambient fonts are not an input
  anybody approved, and they differ between machines.
- Vendor three fonts under an open licence, covering Latin, Malayalam and Arabic. Register them
  explicitly by path. Nothing is fetched at runtime.
- Render three strings at poster size, output as PNG:
  1. Malayalam, containing a conjunct and a reordering vowel sign — use the pilot client's own dish
     names, which is what has to work;
  2. Arabic requiring contextual joining, laid out right to left;
  3. a mixed string — Latin digits inside an Arabic sentence — exercising bidi.
- Also render one string containing a codepoint the font deliberately does not cover, and confirm the
  renderer reports it rather than silently drawing a box. If it cannot report unmapped codepoints,
  say so: the glyph-coverage refusal in Task 3 depends on it, and a renderer that cannot report is
  disqualified regardless of how it shapes.
- **Post the three PNGs to the board and stop.** A reader of each script judges them — Claude can
  spot tofu boxes and unformed conjuncts, but the user is the authority on whether the Malayalam is
  right.
- **Pass requires all three correct.** Partial credit is not a pass: a renderer that handles Arabic
  and mangles Malayalam has failed for a client whose own language is Malayalam.
- If nothing passes, stop the plan and report. Scope reduces to Latin and Arabic, the client is told
  plainly, and Tasks 1–11 are re-cut. That outcome is acceptable; shipping unreadable Malayalam is
  not.

## Task 1 — Fonts as pinned inputs

- Vendor the font files under `assets/fonts/`, with a checked-in manifest recording family, version,
  licence and SHA-256 per file.
- A boot assertion compares each file's hash to the manifest. **A mismatch is a hard failure that
  stops the worker**, not a warning — silently rendering with a different font changes what a client
  publishes.
- Add the renderer to `trigger.config.ts` `external` alongside `sharp`. It is a native module; miss
  this and the worker fails at runtime on the first render rather than at build.

## Task 2 — Schema

- One additive migration. Claim the filename on the board before creating it.
- `campaign_poster_templates` — registry, not tenant-owned, mirroring `creative_review_reasons`.
  Unique `(key, version)`. Seed `core` rows only.
- `campaign_poster_renders` — append-only, forced RLS, `authenticated` select-only. Unique
  `(organization_id, bundle_version_id, template_key, template_version, script, render_digest)` so an
  identical re-render is idempotent rather than duplicated.
- `campaign_plate_edits` — append-only, forced RLS, with `annotations jsonb` as an ordered array of
  `{ ordinal, bounds, instruction }`, at most 8 regions, each instruction bounded at 500 characters.
- `campaign_bundle_versions.manifest` gains an optional `posterPlan`. Existing V2 manifests stay
  valid; no backfill.
- New private `campaign-masks` bucket, organization-prefixed, with its policies.
- Security-definer write functions with `search_path = ''` and explicit organization checks.
  **Identify the worker by `pg_catalog.current_setting('role', true) = 'service_role'`** — the actual
  `SET ROLE` state, not the JWT claim and not `current_user`. Inside a `SECURITY DEFINER` function
  `current_user` is the function owner, so a `current_user` check there is always wrong. See the
  correction on the board dated 2026-08-24.
- Hand-maintain `database.types.ts` in one narrow commit.
- **Gate:** every new function called once against staging before this task is done.

## Task 3 — Domain: templates, fitting, coverage

- New `src/domain/campaigns/poster-template.ts`: the declarative template schema — canvas per
  placement, safe areas, logo slot, plate crop focus, and per text box a max line count, min and max
  font size, alignment, and whether required.
- New `src/domain/campaigns/text-fitting.ts`: shape at max size, shrink by a declared step until it
  fits the box and the line cap, refuse with `text_does_not_fit` at the minimum. **No code path
  truncates, ellipsises or overflows.**
- New `src/domain/campaigns/glyph-coverage.ts`: every codepoint in every value must be covered by the
  registered font for its script; otherwise refuse with `glyph_not_covered` and the codepoint.
  Deterministic, runs before any render.
- Named slots — caption, body, footer, extra — mapping to manifest fields, with `extra` the one free
  slot that still passes `evaluateContentPolicy`.

## Task 4 — The compositor

- New `src/modules/campaigns/infrastructure/poster-compositor.ts`: plate plus layers to final bytes,
  through the renderer for text and `sharp` for compositing.
- Deterministic by construction. The render digest covers plate hash, template key and version, text
  values, script, and the font manifest hash.
- Golden-image tests per script, checked in, so a library upgrade that changes shaping is caught by
  the suite rather than discovered on a client's feed.

## Task 5 — Render worker

- New `src/workflows/campaigns/render-poster.ts` and its registration in `src/trigger/campaigns.ts`
  as `campaign.render-poster`.
- **Register it.** Five campaign workers in this repository are written, tested and never registered;
  do not make it six. Verify by dispatching one run.

## Task 6 — Verification pass

- New `src/modules/campaigns/application/creative-verification.ts`.
- Blocking: glyph coverage (deterministic), text present on the plate, identifiable faces on the
  plate. Advisory and never blocking: subject likeness.
- Detection may use a model through a Zod boundary; **the pass or refusal is deterministic code
  reading that report.** No model chooses a verdict.
- A checker that cannot run records `verification_unavailable` and blocks. Unknown is not a pass.

## Task 7 — Annotated editing: domain and union compositing

- New `src/domain/campaigns/plate-edit.ts`: annotations, region bounds, per-region instruction,
  minimum region area, maximum union coverage, region cap of 8.
- The union mask is rasterised by the platform and feathered at the edges.
- **The composite-back rule is the test that matters:** across a range of mask shapes including one
  touching every edge, every pixel outside the union is byte-identical to the parent — asserted
  programmatically, including against a model returning a wholly different image.

## Task 8 — Edit worker

- New `src/workflows/campaigns/edit-plate.ts`, registered as `campaign.edit-plate`.
- Instructions carried as data in a delimited block, with spec 019 §7.4's fixed constraints appended
  after them.
- Produces a new plate version with parent, mask hash and annotations recorded. Nothing in place.
- Where the parent version was approved, the digest change invalidates approval. Surface it before
  the edit, not after.

## Task 9 — Routes

- `GET .../campaigns/:campaignId/studio`, `POST .../campaigns/:campaignId/renders`,
  `POST .../campaigns/:campaignId/plate-edits`, `GET .../poster-templates`.
- Session client only, permission-checked, correlation header, `apiErrorResponse`.
- New permission `poster.render`; `campaign.edit` already covers editing an unapproved campaign and
  is reused. Seed all four organization roles — owner, admin, operator, viewer — with viewer
  read-only.

## Task 10 — Studio surface

- Components under `src/components/campaigns/studio/`: template picker showing unavailable templates
  with their reason rather than hiding them, per-script tabs, named text slots, the annotation canvas,
  the verification panel, and every refusal state.
- Aspect presets where no placement determines dimensions. Download of a render; **share links to the
  campaign, never to a public asset URL.**
- RTL layout correct at both widths.

## Task 11 — Live proof and browser gate

- One poster per script for organization `2dda45b8-82db-4f5f-b17d-611b9bbb7846`, reviewed by a
  Malayalam reader and an Arabic reader. Recorded redacted under `docs/verification/campaigns/` with
  the exact text values beside the images, so the judgement is reviewable rather than asserted.
- Re-render each and confirm byte-identical output and a stable digest across a worker restart.
- Chrome DevTools MCP at 1440×900 and 390×844 across template choice, script tabs, the annotation
  canvas, refusals and the verification panel. No console errors.

---

## Blast radius

- **`campaign_bundle_versions.manifest`** gains an optional field, so the digest changes for any
  bundle that adopts a poster plan. Approval binding is unaffected for existing versions.
- **`model-router.ts:245`** — the text prohibition becomes absolute on the plate rather than limited
  to price, discount and claim text. This is a strengthening; Task 6 of the 019 plan already carries
  it.
- **`src/trigger/campaigns.ts`** — two new registrations. Currently three tasks are registered and
  five workers are not.
- **`database.types.ts`** — contended with two other agents. One narrow commit.
- **New native dependency** — the renderer, which must be externalised in `trigger.config.ts`.
- **Not touched** — `analysis`, `decisions`, `reports`, `economics`, the Tool Gateway, any execution
  guardrail, and `campaign_visual_attestations`.

## Open assumptions

- A renderer exists that shapes Malayalam correctly in a Node worker. **Unverified and gating.**
  Task 0 answers it.
- The image model accepts a marked-up image usefully for editing. The union-composite rule means the
  boundary is enforced either way, so this decides edit quality rather than safety.
- Two templates per placement is the right Release 1 number. A judgement, not a technical unknown.
- Nothing supplies a legal line today. If that holds, the field is optional and templates requiring
  it are simply unavailable.

## Test plan

- **TDD per task.** Failing test, verify it fails for the stated reason, minimal implementation,
  verify it passes, commit.
- **Golden images per script** so a shaping regression is caught by the suite.
- **Coverage refusal** — an uncovered codepoint refuses before any render and names the codepoint.
- **Fitting** — boundary values; refusal at the minimum; no path truncates.
- **Determinism** — identical inputs give identical bytes; a changed font hash, template version or
  text value changes the digest; an unchanged input never does.
- **Union compositing** — pixels outside the union are byte-identical across mask shapes, including
  one touching every edge and one where the model returns an unrelated image.
- **Verification** — each blocking check refuses; the advisory check never blocks; an unavailable
  checker blocks rather than passes.
- **Tenant isolation, explicitly** — two-organization pgTAP on both new tenant tables; cross-tenant
  plate, mask path or campaign id refused in path and body; forced RLS asserted per table;
  append-only triggers refuse update and delete; the mask bucket refuses a foreign prefix.
- **Worker registration** — both tasks reachable, proved by dispatch.
- **Known flake** — `src/workflows/reports/pdf-text-layer.integration.test.ts`. Not touched.

## Risks and rollback

- **Malayalam shaping is unproven.** The dominant risk. Task 0 exists to fail fast and cheaply rather
  than discovering it in Task 10.
- **Reproducibility depends on a native library's behaviour staying stable.** Golden images per
  script are the guard, and a renderer upgrade is a deliberate act with a visible test diff.
- **Templates constrain design.** Some posters an operator can imagine will not be expressible. That
  is the price of text being exact by construction, and it is the right trade.
- **Two model calls already exist per plate under 019; edits add more.** Metered, and the cost is
  stated rather than discovered.
- **Rollback** — the compositor, both workers and the studio are a code revert; the tables can be left
  unused; the manifest field is optional and needs no reversal. The fonts and the renderer can stay
  installed harmlessly. The one change with a consequence is the absolute plate text prohibition, and
  reverting it restores *"Explore Our Mezza"*.
