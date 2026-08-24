# Organization Asset Library — Execution Plan

**Spec:** `specs/019-organization-asset-library.md` (approved 2026-08-24)
**ADR:** `adrs/0041-every-generation-is-anchored-to-a-declared-subject.md`
**Tier:** 3. This document is the approval gate required by `AGENTS.md` §4. **Approved 2026-08-24.**
**Board:** `docs/collaboration/asset-library-and-studio-board.md` — task ownership and live status.
**Goal:** a campaign generation for Al Noor Kitchen that draws their actual dish, from their photo
where one exists and from their confirmed description where one does not, and refuses when nobody
has said what the campaign is about.

---

## Sequencing

- Two vertical slices, not one big-bang. Each ends production-complete — schema, domain, route,
  screen, authorization, tests — rather than leaving a layer for later.
- **Slice A first: draw from a description.** This is the path most campaigns will take, because
  most dishes will never have a good photograph. It also proves the resolver, the provider seam and
  the worker wiring end to end with the smallest surface.
- **Slice B second: draw from a photograph, and learn from rejections.** It reuses everything Slice A
  built and adds the library, reviews and negative rules.
- Tasks 1–3 are foundation both slices need. Task 13 is the live proof and the browser gate.
- Nothing in the `decisions`, `analysis`, `reports` or `economics` modules is touched.

---

## Task 1 — Schema, seeds and write functions

- One migration, `supabase/migrations/20260825090000_organization_asset_library.sql`. Additive only.
- Add to `organization_brand_assets`: `conditioning_roles text[]`, `tags text[]`, `scripts text[]`,
  `ownership text not null default 'third_party'` (`owned | third_party`), `archived_at timestamptz`.
  Element checks on roles and scripts; `scripts` non-empty exactly when `conditioning_roles` contains
  `typography`; tags bounded by `char_length`, never `octet_length`, and carrying no Latin-only
  pattern. `avoid` joins the conditioning-role element check.
- Add to `campaign_source_snapshots`: `reference_slots jsonb`, `negative_rules jsonb`,
  `resolver_version integer`, `resolution_outcome text`, `subject_profile_id uuid`,
  `subject_description text`, `avoid_reference_version_ids uuid[] not null default '{}'`,
  `blueprint jsonb`, `plan_model_id text`, `creative_direction text`. All nullable or defaulted so
  existing rows stay valid. **That is ten columns, not six** — amended 2026-08-24, see the board.
- New table `creative_review_reasons` — registry, not tenant-owned, mirroring the `permissions` and
  `subject_kinds` pattern. Seeded with the eleven core codes and the four Restaurant Pack codes from
  spec §7.2.
- New table `creative_asset_reviews` — append-only, forced RLS, `authenticated` select-only, an
  append-only trigger, a reason-code foreign key, and the verdict/reason CHECK in both directions.
- New table `organization_subject_profiles` — forced RLS, `authenticated` select-only, unique
  `(organization_id, slug)`, and the confirmed-state CHECK requiring a description and a confirmer.
- New security-definer functions with `search_path = ''` and explicit organization checks:
  `record_creative_asset_review`, `upsert_subject_profile`, `confirm_subject_profile`,
  `read_reference_candidates`.
- Change `create_campaign_with_source` to persist the six new snapshot columns, and
  `load_campaign_generation_context` to return them.
- Seed four permissions: `asset.read`, `asset.manage`, `asset.review`, `subject.manage`, and their
  role mappings.
- Hand-maintain `src/lib/supabase/database.types.ts` for the three new tables. `pnpm db:types`
  cannot run. Keep this edit narrow and in one commit — another agent is editing the same file for
  the recommendations module.
- **Gate:** every changed or new plpgsql function is called once against staging before this task is
  done. `load_campaign_generation_context` and `create_campaign_with_source` both read tables they
  did not create, and this has bitten the project twice.

## Task 2 — Domain types and vocabulary

- New `src/domain/campaigns/asset-library.ts`: conditioning roles, ISO 15924 script codes, review
  verdicts, reason codes, resolution outcome codes, refusal codes.
- Zod schemas for each, strict objects, no passthrough.
- Tag normalization helper — NFC on write, case-folded compare — living in domain code so the route,
  the repository and the resolver cannot disagree about what two tags matching means.
- Extend `src/domain/campaigns/schemas.ts`: subject profile schema; remove `truthClass` from the
  model-facing manifest schema.

## Task 3 — The resolver

- New `src/domain/campaigns/reference-resolution.ts`. Pure, no I/O, `RESOLVER_VERSION = 1`.
- Takes candidates and a request (`subjectTags`, `subjectDescription`, `settingTags`,
  `occasionTags`, `styleTags`, `scripts`); returns `resolved`, `synthesis_permitted` or
  `insufficient`.
- Enforces the slot caps and the total cap of 7, the four-key total ordering, and the typography
  exception of one slot per requested script to a maximum of three.
- Derives negative rules from rejected candidates' reason codes: map through the registry, dedupe,
  sort by code, cap at 12.
- Excludes archived candidates. **Rejected candidates are not excluded — they are routed to a
  separate `avoid` set**, capped at 2, each carrying its own reason codes, and counted apart from the
  positive budget of 7. A rejected asset may never occupy a positive slot.
- Carries the reference mode per positive slot: `inspiration` by default, `exact_match` only where
  the asset's `ownership` column reads `owned`. The resolver refuses `exact_match` on a
  `third_party` asset rather than silently downgrading it.

## Task 4 — Subject profiles: application and infrastructure

- New `src/modules/campaigns/application/subject-service.ts` — create, draft, edit, confirm, archive.
  Confirmation is a distinct operation carrying its own permission.
- New `src/modules/campaigns/infrastructure/subject-repository.ts` — reads through the session
  client, writes through the new RPCs.
- Model-drafted descriptions go through the existing text model router with the existing Zod
  boundary. The draft is stored as `draft` and is unusable for generation until confirmed.
- The drafting prompt reads Business Memory for what the organization sells and treats the
  operator's own words as data, not instruction.

## Task 5 — Subject profile routes

- `GET`, `POST` on `/api/organizations/[organizationId]/subjects`; `PATCH` on
  `/api/organizations/[organizationId]/subjects/[subjectId]`.
- Modelled on the existing analysis and campaign routes: `getOrganizationContext`, correlation
  header, `apiErrorResponse`, permission check, session client only.
- `subject.manage` gates write; `asset.read` gates read; confirmation additionally checks the
  confirming role.

## Task 6 — Provider seam

- Widen `CampaignImageGenerationInput` in `src/ai/campaign-generation-provider.ts` with an optional
  ordered `references` list of role, mime type and bytes.
- `src/modules/campaigns/infrastructure/gemini-campaign-generation-provider.ts` sends them as file
  parts, ordered by slot then ordinal, so a rerun is byte-reproducible.
- **This is a small change, verified before planning.** `drawOnce` already calls `generateText` with
  the image model and `responseModalities: ["TEXT", "IMAGE"]`, reading the picture out of
  `result.files` — the comment there explains that Gemini's image models return a file part rather
  than answering the Imagen predict endpoint. Adding references is therefore a `prompt` string
  becoming a `messages` array with file parts. No transport work, no SDK change.
- Incidental: `experimental_generateImage` is imported at the top of that file and nothing calls it.
  Remove the dead import while in there.
- New prompt builder in `src/modules/campaigns/infrastructure/reference-prompt.ts`: the per-role
  instruction lines from spec §7.1, the fixed synthesis constraints from §7.4, and the negative
  rules — assembled in that fixed order, with the operator-authored description carried in a
  delimited data block and the constraints appended after it.
- `campaign-planner.ts` stops passing `subject: asset.altText` as the drawing instruction and passes
  the built prompt instead. Alt text remains what it was written for — accessibility.
- No prompt path requests rendered text in any script. **State this absolutely** — "no text of any
  kind, in any script" — not the narrower "no price, discount or claim" that `model-router.ts:245`
  says today. Spec 020 depends on the plate being textless.
- `avoid` references are sent in their own clearly demarcated block, after the positive references,
  each with its reason codes attached, and are never presented as something to draw from.

## Task 6b — The art-direction blueprint

- New `src/domain/campaigns/art-direction.ts`: the strict Zod blueprint schema — composition,
  framing, lighting, camera treatment, palette, focal point, surface and prop notes, avoid list.
  **No subject field. No text field.** The absence is the fence; do not add them "for completeness".
- New `src/modules/campaigns/infrastructure/blueprint-planner.ts`: one call through the existing
  `plan` slot of `createModelRouter`, configured by `CAMPAIGN_PLAN_MODEL`. The slot already exists
  and is currently unused for images — this is its first real use, not a new dependency.
- Input: system prompt, operator creative direction, brand and subject context, every resolved
  reference including the negatives with their reason codes.
- Output: parsed blueprint. One bounded repair pass through the existing `repair` slot on a parse
  failure, then fail the run. **Never fall back to sending raw text through.**
- The subject is injected deterministically after parsing; the §7.4 fixed constraints are appended
  after the blueprint in the assembled prompt.
- Metered like any other model call. Two model calls per image is the cost of this architecture.

## Task 7 — Truth class derivation

- New pure function mapping resolution outcome to `truth_class`.
- `campaign-planner.ts:106` stops asking the model for the field; the manifest schema stops carrying
  it; the worker writes the derived value.
- Existing rows are not rewritten. A retrospective assertion about how an old image was made is
  exactly the claim this work exists to prevent.

## Task 8 — Wire the worker (Slice A closes here)

- `src/modules/campaigns/application/generation-context.ts`: carry the resolution request, replace
  the misleading `brand_constraints` refusal with `no_declared_subject`, and re-scope
  `syntheticAssetsAllowed` to the setting slot only.
- `src/workflows/campaigns/generate-bundle.ts`: call the resolver, refuse on `insufficient`, pin the
  outcome and the exact confirmed description onto the snapshot, fetch reference bytes, pass them to
  the planner, and write the derived truth class.
- `src/modules/campaigns/infrastructure/generation-readers.ts` and `creation-repository.ts`: read and
  write the six new snapshot fields.
- Populate `campaign_assets.provenance.derivedFromBrandAssetVersionIds` from the pinned set, and pin
  `avoid_reference_version_ids`, `blueprint`, `plan_model_id` and `creative_direction` alongside it.
- Call the blueprint planner (Task 6b) before the image call, and pass the parsed blueprint through.
- `src/workflows/campaigns/generate-variants.ts` follows the same path, since a variant is generated
  under the same policy.
- **Gate:** one real generation on staging from a confirmed description, inspected by eye. Requires
  `pnpm run:trigger` running with the task registered, or the dispatch queues with nobody to execute
  it.

## Task 9 — Asset library: application, infrastructure and reviews

- New `src/modules/campaigns/application/asset-library-service.ts` — list, filter, tag, archive, and
  record a review over either subject kind.
- Extend `brand-asset-service.ts` rather than replacing it. The three-step reserve, upload,
  read-back-and-re-encode flow is retained unchanged; it is the part that already works.
- Rejection without at least one reason code is refused in domain code, in the service, and by a
  database CHECK. Three layers, because this is the only channel through which human judgement
  reaches the next generation.

## Task 10 — Asset library routes

- `GET`, `POST` on `/api/organizations/[organizationId]/assets`; `PATCH` on `.../assets/[assetId]`;
  version reserve and complete under it; `POST .../assets/reviews`; `GET .../assets/resolve`.
- The two existing `campaigns/brand-assets/uploads` routes are retained and delegate, so nothing
  already deployed breaks.
- `.../assets/resolve` calls the same resolver the worker calls. The brief must never predict
  something different from what generation does.

## Task 11 — Asset and subject workspace

- New route `/organizations/[organizationId]/assets` with two sections: References and Campaign
  output, the second grouped by campaign then bundle version.
- Components under `src/components/assets/`: library grid, batch upload with per-file outcome, tag
  editor, review form, truth-class chip, subject list and subject form.
- The reject form cannot submit without a reason. Reason chips show plain-language labels, never
  codes.
- Malayalam and Arabic render correctly, including the RTL case.
- Empty state names the one useful next action rather than describing the feature.
- **Ad-hoc reference attach.** A reference may be uploaded at the point of generating and used in
  that same request, landing in the library automatically as an unreviewed asset. Curation must not
  be a precondition for a one-off; nothing uploaded is lost afterwards.
- An `ownership` control on upload — *this is our own work* versus *this is a reference we admire* —
  because `exact_match` is gated on it. Default is `third_party`, the safe answer.

## Task 12 — Brief picker (Slice B closes here)

- `src/components/campaigns/new-campaign-brief.tsx` gains subject selection and a reference picker
  defaulting to what the resolver would choose, showing why each slot was filled.
- Three states rendered distinctly: drawing from your photo, drawing from your description, and
  nobody has said what this is about — the last disabling submit with an inline recovery.

## Task 13 — Live proof, browser gate and documentation

- The five-step live proof in spec §15, in order, against organization
  `2dda45b8-82db-4f5f-b17d-611b9bbb7846`. Recorded redacted under `docs/verification/campaigns/`,
  including prompts and images, so the fidelity judgement is reviewable rather than asserted.
- Three baseline generations on `gemini-3.1-flash-image` kept for the later model comparison.
- Chrome DevTools MCP at 1440×900 and 390×844 across the library, upload, review form, subject form,
  empty state, the brief's three states and the refusal. Frontend work is not done until exercised
  at both widths; if that MCP is unavailable, stop and report rather than claiming completion.
- Update `context/04-domain-model.md`, `context/05-module-map.md`, and the notes in specs 016 and
  009.

---

## New or changed schemas, migrations, events and public exports

- **Migration:** one, additive, listed in Task 1.
- **New tables:** `creative_review_reasons`, `creative_asset_reviews`,
  `organization_subject_profiles`.
- **Changed tables:** `organization_brand_assets` (four columns), `campaign_source_snapshots` (six).
- **Changed functions:** `create_campaign_with_source`, `load_campaign_generation_context`.
- **New functions:** `record_creative_asset_review`, `upsert_subject_profile`,
  `confirm_subject_profile`, `read_reference_candidates`.
- **Events:** `asset.version_added`, `asset.reviewed`, `asset.archived`, `subject.confirmed`,
  `campaign.reference_set_pinned`.
- **Permissions:** `asset.read`, `asset.manage`, `asset.review`, `subject.manage`.
- **Changed public export:** `CampaignImageGenerationInput` gains an optional `references` field.
  Additive, so existing callers compile unchanged.
- **Removed from the model contract:** `truthClass` leaves the manifest schema the model fills in.

## Blast radius

- **Campaign generation worker** — behaviour changes. A campaign with no declared subject now
  refuses where it previously drew. This is the intended correction and it will affect campaign
  `783ab4e1` on staging.
- **`campaign.generate-bundle`, `campaign.revise-bundle`, `campaign.generate-variants`** — all three
  registered Trigger tasks read the generation context and are affected. The five unregistered
  campaign workers are untouched.
- **Decision Engine** — `campaign-opportunity-source.ts` reads `brandAssetsUsable` and
  `syntheticAssetsAllowed`. Its gate is unchanged by this work, but the meaning of the second flag
  narrows, so its evidence mapping is read and left consistent.
- **RLS** — three new policy sets. No existing policy is altered.
- **`database.types.ts`** — shared with the agent working on recommendations. One narrow edit,
  committed on its own.
- **Storage** — no new bucket, no path change.
- **Not touched** — the `analysis`, `reports`, `economics`, `memory` and `decisions` modules; the
  Tool Gateway; every execution guardrail.

## Open assumptions

Two were settled before this plan was submitted, because each would have changed the size of a task.

- **Settled.** `create_campaign_with_source` writes `campaign_source_snapshots` directly and
  `load_campaign_generation_context` reads it directly. Task 1 changes exactly those two functions,
  and both must be called against staging before it is done.
- **Settled, favourably.** The image path already uses `generateText` with file-part responses, so
  reference inputs need no transport change. Task 6 is smaller than first estimated.

Still open:

- Business Memory holds enough about what Al Noor Kitchen sells for a drafted description to be
  worth editing rather than rewriting. Four dish names are seeded in prose. If the drafts are poor,
  Task 4 degrades to a plain form and the model-drafting step is deferred — the human confirmation
  is what matters, not who typed first.
- Whether `gemini-3.1-flash-image` honours a `subject` reference faithfully enough to be recognisable
  as the same dish. Not answerable without running it; Task 13 is where it gets answered, and spec
  §18 says what happens if the answer is no.
- No existing pgTAP suite asserts the current `truth_class` write path. If one does, Task 7 updates
  it rather than leaving a contradiction.
- The client may have no dish photographs at all in Release 1. Slice B is built and tested against
  the fixture organization in that case, and the live evidence is recorded as weaker rather than
  quietly substituted.

## Test plan

- **TDD throughout** — failing test, verify it fails for the stated reason, minimal implementation,
  verify it passes, commit. Per task, not per slice.
- **Domain unit** — the three-way outcome across every combination of photograph present or absent
  and description confirmed, draft or absent; slot caps at boundaries; all four ordering tiebreaks;
  negative-rule dedupe, sort and cap; truth-class derivation per outcome; typography matching per
  script including a request for a script nothing declares; resolver version stamping.
- **Unicode** — NFC on write; case-folded matching that is a no-op for Malayalam and Arabic;
  `char_length` bounds so a 24-character Malayalam tag is not rejected; a combining mark
  round-trips byte-identically.
- **Prompt builder** — fixed constraints present in every synthesis prompt; no component absent from
  the description appears; no prompt requests rendered text; the description sits in a data block
  with constraints after it.
- **Provider seam** — parts ordered deterministically; each carries its role instruction; a rejected
  asset's bytes appear only in the separately capped `avoid` set with that asset's reason codes and
  never as a positive reference; an unreadable reference fails the run rather than degrading it.
- **Application** — a draft profile cannot generate; rejection without a reason is refused; archive
  excludes from resolution; a re-approved asset becomes a candidate again.
- **Route** — permission enforced per verb; a viewer is refused write; `.../assets/resolve` returns
  what the worker computes.
- **Tenant isolation, explicitly** — two-organization pgTAP on all three new tables and all four new
  functions; a cross-tenant asset, subject or campaign id in path, body or storage path is refused;
  `read_reference_candidates` returns nothing for a foreign organization; the review writer refuses
  a `campaign_asset` belonging to another organization; forced RLS asserted on each new table; the
  append-only trigger refuses update and delete.
- **Staging pgTAP** — non-hermetic by design. Treated as integration checks.
- **Known flake** — `src/workflows/reports/pdf-text-layer.integration.test.ts` times out under full
  suite load. Pre-existing. Not touched.
- **Full gate before done** — lint, typecheck, unit, integration, the pgTAP suites, then the live
  proof, then the browser gate.

## Risks and rollback

- **The drawn dish is still not good enough.** The central risk, and the reason Task 13 keeps three
  baseline generations. Mitigated by measuring approval rate separately for the photograph path and
  the description path, so the model is identified as the constraint by evidence rather than by
  argument. Escalation to a pro-tier image model is defined in spec §18 and is not taken pre-emptively.
- **A refusal blocks a client who has done nothing wrong.** `no_declared_subject` fires on the state
  every existing campaign is in. Mitigated by making the recovery inline in the brief and by
  drafting the description for them. Watched via the alert in spec §12.
- **Description quality determines everything and is unowned.** A vague description produces a
  generic dish, and nothing in code can detect that. This is the weakest point in the design and is
  named as such; Task 4's form prompts for the six components, and spec §19 leaves the repeatable
  fidelity standard open.
- **Prompt injection through a subject description.** The one new injection surface. Delimited data
  block, constraints appended after, and the operator authored it themselves — but it is a real
  surface and is tested rather than assumed.
- **Concurrent edits to `database.types.ts`.** One narrow commit, coordinated by keeping Task 1
  self-contained.
- **Rollback** — the provider seam, resolver call, prompt builder and truth-class derivation are all
  a code revert. The three tables can be left in place unused; the migration is additive and needs
  no reversal. The one behavioural revert with a consequence is re-widening
  `syntheticAssetsAllowed`, which restores the previous permissive outcome and the duck breast with
  it.
