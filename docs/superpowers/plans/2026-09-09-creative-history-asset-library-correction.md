# Creative History Asset Library Correction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Asset Library's generation-ingredient model with an organization’s reviewed visual history, while making it structurally impossible for rejected design bytes to reach final image generation.

**Architecture:** Preserve the declared-subject resolver and Studio compositor. Add a separate, versioned Creative History model and selector; it produces two pinned evidence sets: approved designs for final generation and rejected designs for Blueprint analysis. The provider port expresses those sets as different types, so only the validated Blueprint rules—not rejected bytes—can reach the image call.

**Tech Stack:** Next.js App Router, TypeScript strict mode, Zod, Supabase/Postgres/RLS/private Storage, Trigger.dev, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-26-creative-history-asset-library-correction-design.md`

## Global Constraints

- This is Tier 3. Do not begin a task until the user approves this plan; draft every migration for independent review before applying it to hosted staging.
- There is no local database. Do not run `supabase start`, `supabase db reset`, or `pnpm db:types`.
- All schema changes are additive and forward-only. Old `avoid_reference_version_ids` receipts remain readable and are never rewritten.
- Every tenant-owned table enables and forces RLS, uses composite tenant foreign keys where possible, and exposes no direct browser writes.
- Every `SECURITY DEFINER` function uses `SET search_path = ''`, performs explicit organization and permission checks, and is revoked from `PUBLIC`.
- The worker may read only pinned, organization-checked evidence; storage remains private. No service-role client is introduced on a request path.
- The final image-input type has no rejected-design variant. Runtime validation and integration tests must prove that rejected bytes cannot arrive at the final adapter.
- A model may propose descriptive metadata or Blueprint observations, but a human confirms metadata and exclusively decides a verdict. Text stays outside image generation and is composited by Studio.
- Preserve unrelated dirty work. Do not stash, reset, run repository-wide formatting, or `git push`.

---

## File map

| Area | Files | Responsibility |
| --- | --- | --- |
| Governing documents | `specs/019-organization-asset-library.md`, `specs/020-campaign-creative-studio.md`, `adrs/0041-every-generation-is-anchored-to-a-declared-subject.md`, new `adrs/0049-creative-history-separates-blueprint-negative-evidence-from-final-generation.md` | Replace the legacy rejected-`avoid` rule and make the corrected product boundary durable. |
| Creative History domain | new `src/domain/campaigns/creative-history.ts`, `creative-history-selector.ts` and tests | Strict records, metadata, receipt, eligibility and deterministic selection. |
| Data boundary | two forward migrations and new `supabase/tests/database/creative_history_*_test.sql` suites; narrow `database.types.ts` commit | Folders, items, immutable versions/reviews/evidence, pinned run receipts, RLS, grants, RPCs and Studio-render linkage. |
| Application/API | new Creative History service/repository/route wiring and `/api/organizations/[organizationId]/assets/creative-history/*` routes | Session-scoped reads; permission-checked reserve, finalize, review, archive, list and receipt inspection. |
| Asset UI | `src/app/(platform)/organizations/[organizationId]/assets/page.tsx`, `asset-workspace.tsx`, new Creative History components and tests | One page with Creative History, Products & Subjects, and Brand Kit tabs. |
| Generation boundary | `src/ai/campaign-generation-provider.ts`, `generate-bundle.ts`, `generation-readers.ts`, `blueprint-planner.ts`, `reference-prompt.ts`, Gemini provider, planner, factories and tests | Separate Blueprint and final evidence, pin selection before spend, and prevent rejected bytes from reaching the image call. |

## Task 1: Reconcile the durable governing documents

**Files:**
- Modify: `specs/019-organization-asset-library.md`, `specs/020-campaign-creative-studio.md`, `adrs/0041-every-generation-is-anchored-to-a-declared-subject.md`, `docs/collaboration/asset-library-and-studio-board.md`
- Create: `adrs/0049-creative-history-separates-blueprint-negative-evidence-from-final-generation.md`

**Interfaces:**
- Supersedes only ADR 0041’s rejected-reference routing; retains its declared-subject, deterministic-resolution and truth-class decisions.
- Declares the exact three-tab Asset Library and the two distinct evidence paths used by later tasks.

- [ ] **Step 1: Write the documentation acceptance checklist**

  Record these non-negotiable statements in ADR 0049 and cross-link them from Specs 019 and 020:

  ```text
  approved creative bytes -> Blueprint and final image generation
  rejected creative bytes -> Blueprint only
  validated Blueprint rules + human reasons -> final image prompt
  rejected creative bytes -> impossible final-image input
  ```

- [ ] **Step 2: Rewrite the legacy Spec 019 sections that call an asset a generation ingredient**

  Define `Creative History`, `Products & Subjects`, and `Brand Kit` as separate records on one page; remove every statement that allows an `avoid` image in a final image-provider request.

- [ ] **Step 3: Update Spec 020’s dependency and lineage language**

  State that a final poster links back to a Creative History item as `unreviewed`; raw plates never enter Creative History merely because they exist.

- [ ] **Step 4: Add ADR 0049**

  Document the forward-only cutover, legacy-receipt readability, final-provider structural fence, caps, human-review authority, and the reason this supersedes ADR 0041’s negative-image route.

- [ ] **Step 5: Review documentation consistency**

  Run:

  ```bash
  rg -n "avoid.*(final|image)|rejected.*(final|provider)|same reference set" specs/019-organization-asset-library.md specs/020-campaign-creative-studio.md adrs/0041-every-generation-is-anchored-to-a-declared-subject.md adrs/0049-creative-history-separates-blueprint-negative-evidence-from-final-generation.md
  git diff --check
  ```

- [ ] **Step 6: Commit the documentation boundary**

  ```bash
  git add specs/019-organization-asset-library.md specs/020-campaign-creative-studio.md adrs/0041-every-generation-is-anchored-to-a-declared-subject.md adrs/0049-creative-history-separates-blueprint-negative-evidence-from-final-generation.md
  git commit -m "docs: correct creative history evidence boundary"
  ```

  Leave the shared collaboration board unstaged when it has another session's changes; its entry is the durable coordination record, not a reason to sweep another task into this commit.

## Task 2: Define strict Creative History and evidence-boundary domain contracts

**Files:**
- Create: `src/domain/campaigns/creative-history.ts`, `src/domain/campaigns/creative-history.test.ts`, `src/domain/campaigns/creative-history-selector.ts`, `src/domain/campaigns/creative-history-selector.test.ts`
- Modify: `src/ai/campaign-generation-provider.ts` and its tests

**Interfaces:**
- Produces `CreativeFolder`, `CreativeItem`, `CreativeItemVersion`, `CreativeReview`, `CreativeHistorySelectionRequest`, and `CreativeHistorySelectionReceipt` strict Zod schemas.
- Produces `selectCreativeHistory(input): CreativeHistorySelectionReceipt` with `selectorVersion = 1`.
- Produces distinct `BlueprintEvidenceReference` and `FinalImageReference` types; `FinalImageReference["role"]` excludes `rejected_creative` and legacy `avoid`.

- [ ] **Step 1: Write failing domain tests for verdict and metadata rules**

  ```ts
  expect(() => creativeReviewSchema.parse({ verdict: "rejected", reasonCodes: [] })).toThrow();
  expect(creativeEligibility(itemWithUnconfirmedMetadata)).toEqual("metadata_unconfirmed");
  expect(creativeEligibility(unreviewedItem)).toEqual("unreviewed");
  ```

- [ ] **Step 2: Add immutable Creative History schemas**

  Model one optional nested folder level, source kinds `historical_upload | studio_render | qualified_legacy_delivered_creative`, design-level review history, rights, confirmed versus proposed metadata, and a receipt snapshot that cannot be recomputed from current rows.

- [ ] **Step 3: Write failing selection tests**

  ```ts
  expect(receipt.approved.map((entry) => entry.versionId)).toEqual(expectedStableIds);
  expect(receipt.rejected).toHaveLength(5);
  expect(receipt.finalImageReferences).toHaveLength(3);
  expect(receipt.exclusions).toContainEqual(expect.objectContaining({ code: "weak_match" }));
  ```

- [ ] **Step 4: Implement the pure versioned selector**

  Score subject, occasion, format/channel, market/language, objective, tags, and comparable verified performance. Enforce relevance dominance, stable tie-breaking, approved diversity, rejected reason coverage, caps of three approved and five rejected designs, and explicit exclusions rather than quota filling.

- [ ] **Step 5: Split evidence types at the AI port**

  ```ts
  export type BlueprintEvidenceReference = GroundingReference | ApprovedCreativeReference | RejectedCreativeReference;
  export type FinalImageReference = GroundingReference | ApprovedCreativeReference;
  ```

  Keep declared-subject grounding in `GroundingReference`; do not recast it as Creative History.

- [ ] **Step 6: Run focused domain suites**

  ```bash
  pnpm vitest run src/domain/campaigns/creative-history.test.ts src/domain/campaigns/creative-history-selector.test.ts src/ai/campaign-generation-provider.test.ts
  ```

- [ ] **Step 7: Commit the pure contracts**

  ```bash
  git add src/domain/campaigns/creative-history.ts src/domain/campaigns/creative-history.test.ts src/domain/campaigns/creative-history-selector.ts src/domain/campaigns/creative-history-selector.test.ts src/ai/campaign-generation-provider.ts
  git commit -m "feat: define creative history evidence contracts"
  ```

## Task 3: Add the Creative History core schema and governed write paths

**Files:**
- Create: migration generated by `pnpm dlx supabase migration new creative_history_core`; `supabase/tests/database/creative_history_core_test.sql`
- Modify: `src/lib/supabase/database.types.ts`, `src/lib/supabase/database.types.test.ts`

**Interfaces:**
- Adds `creative_folders`, `creative_items`, `creative_item_versions`, `creative_item_reviews`, and `creative_item_performance_evidence`.
- Adds worker-safe/session-safe RPCs: `create_creative_folder`, `create_creative_item`, `finalize_creative_item_version`, `record_creative_item_review`, `archive_creative_item`, and the dormant, service-role-only `backfill_studio_renders_to_creative_history`.

- [ ] **Step 1: Write pgTAP tests before migration SQL**

  Cover one organization creating/reading its own folder and item, another organization receiving no row, rejected review without reasons refusing, approved review with reasons refusing, one-level nesting enforcing, append-only version/review records refusing update/delete, and only members with `asset.manage` or `asset.review` reaching the correct write function.

- [ ] **Step 2: Draft the additive migration for review**

  Use composite `(organization_id, id)` keys, forced RLS, private `creative-assets` object paths, source-kind CHECKs, rights fields, content hash/dimension fields, and a check requiring exactly one source reference for a stored file versus a linked Studio render. Add the `source_poster_render_id` composite foreign key and a dry-run-capable, service-role-only `backfill_studio_renders_to_creative_history` function here so Task 8 never needs a schema amendment. Do not apply it yet.

- [ ] **Step 3: Review security and query shape**

  Confirm every child table has an index beginning with `organization_id`; use partial indexes for active, reviewed candidates; revoke all direct authenticated mutation grants; set `search_path = ''` on each definer function; verify the function’s explicit organization membership/permission checks.

- [ ] **Step 4: Apply only after independent migration review**

  ```bash
  pnpm db:migrations:dry-run
  pnpm db:migrations:push
  pnpm db:test -- --file supabase/tests/database/creative_history_core_test.sql
  ```

- [ ] **Step 5: Call every changed database function on hosted staging**

  Exercise one successful own-organization operation and the foreign-organization/insufficient-permission refusal for each callable function; roll back probe data where the test harness supports it.

- [ ] **Step 6: Hand-maintain generated types in a narrow commit**

  Add only the new tables/RPC shapes to `database.types.ts`, update its coverage test, and commit it separately from the migration.

## Task 4: Add Creative History application, private storage intake, and routes

**Files:**
- Create: `src/modules/campaigns/application/creative-history-service.ts`, its test; `src/modules/campaigns/infrastructure/creative-history-repository.ts`, its test; `src/modules/campaigns/infrastructure/creative-history-storage.ts`, its test; `src/modules/campaigns/infrastructure/creative-history-route-wiring.ts`
- Create: `src/app/api/organizations/[organizationId]/assets/creative-history/folders/route.ts`, `items/route.ts`, `items/[itemId]/route.ts`, `items/[itemId]/versions/route.ts`, `items/[itemId]/versions/[versionId]/complete/route.ts`, `items/[itemId]/reviews/route.ts`, and route tests
- Modify: `src/modules/campaigns/application/asset-route-handlers.ts` only to link the existing Assets page, not to overload Brand Kit mutations

**Interfaces:**
- Reuses reserve → private upload → read-back → re-encode → hash → finalize for historical files.
- Keeps Product & Subject records and Brand Kit records on their existing services; Creative History has its own store and routes.

- [ ] **Step 1: Write route/service red tests**

  ```ts
  expect(await listAsForeignTenant()).toEqual({ status: 404 });
  expect(await finalizeUnreadableUpload()).toMatchObject({ code: "ASSET_INTAKE_REJECTED" });
  expect(await reviewerRejectWithoutReason()).toMatchObject({ status: 422 });
  ```

- [ ] **Step 2: Implement the application boundary**

  Validate folder defaults, item overrides, rights, review submissions and archive requests with strict Zod schemas. Persist proposed model metadata separately from human-confirmed metadata and expose the distinction in the read model.

- [ ] **Step 3: Implement repository and storage adapters**

  Use the session client for reads and governed RPCs for writes. Sign only tenant-checked preview/download paths. Do not expose a public bucket or a service-role browser path.

- [ ] **Step 4: Implement routes**

  Reuse `getOrganizationContext`, existing campaign feature access, correlation IDs, safe API errors and permission checks. `asset.read` gates reads, `asset.manage` gates folder/item/version/archive writes, and `asset.review` gates verdicts.

- [ ] **Step 5: Run focused application and route suites**

  ```bash
  pnpm vitest run src/modules/campaigns/application/creative-history-service.test.ts src/modules/campaigns/infrastructure/creative-history-repository.test.ts src/modules/campaigns/infrastructure/creative-history-storage.test.ts "src/app/api/organizations/[organizationId]/assets/creative-history"
  ```

- [ ] **Step 6: Commit the governed library API**

  ```bash
  git add src/modules/campaigns/application/creative-history-service.ts src/modules/campaigns/application/creative-history-service.test.ts src/modules/campaigns/infrastructure/creative-history-repository.ts src/modules/campaigns/infrastructure/creative-history-repository.test.ts src/modules/campaigns/infrastructure/creative-history-storage.ts src/modules/campaigns/infrastructure/creative-history-storage.test.ts src/modules/campaigns/infrastructure/creative-history-route-wiring.ts "src/app/api/organizations/[organizationId]/assets/creative-history"
  git commit -m "feat: add governed creative history library"
  ```

## Task 5: Deliver the unified Asset Library surface

**Files:**
- Modify: `src/app/(platform)/organizations/[organizationId]/assets/page.tsx`, `src/components/assets/asset-workspace.tsx` and tests
- Create: `src/components/assets/creative-history-folder-tree.tsx`, `creative-history-grid.tsx`, `creative-history-evidence-panel.tsx`, `creative-history-upload.tsx`, and their tests

**Interfaces:**
- Renders exactly three tabs: `Creative History`, `Products & Subjects`, `Brand Kit`.
- Creative History supports a folder tree, scenario filters, design-level verdict, upload/review, and an evidence panel without exposing model prompts or storage paths.

- [ ] **Step 1: Write component tests for the tab model**

  ```tsx
  expect(screen.getByRole("tab", { name: "Creative History" })).toBeVisible();
  expect(screen.queryByText("References")).not.toBeInTheDocument();
  expect(screen.getByText("Unreviewed")).toBeVisible();
  ```

- [ ] **Step 2: Replace the old reference/output split**

  Move finished rendered posters and historical uploads into Creative History. Retain the existing subject list under Products & Subjects and existing brand-asset controls under Brand Kit; do not duplicate their records.

- [ ] **Step 3: Implement controlled upload and review feedback**

  Use server-provided permission booleans, show a plain recovery for every refusal, require rejection reasons before submit, and refresh from the server only after a successful domain outcome.

- [ ] **Step 4: Verify accessibility and responsive behavior**

  Test keyboard tabs, labelled folder/filter controls, focus after upload/review errors, and no horizontal overflow at 1440px and 390px.

- [ ] **Step 5: Commit the Asset Library surface**

  ```bash
  git add "src/app/(platform)/organizations/[organizationId]/assets/page.tsx" src/components/assets/asset-workspace.tsx src/components/assets/asset-workspace.test.tsx src/components/assets/creative-history-folder-tree.tsx src/components/assets/creative-history-folder-tree.test.tsx src/components/assets/creative-history-grid.tsx src/components/assets/creative-history-grid.test.tsx src/components/assets/creative-history-evidence-panel.tsx src/components/assets/creative-history-evidence-panel.test.tsx src/components/assets/creative-history-upload.tsx src/components/assets/creative-history-upload.test.tsx
  git commit -m "feat: organize assets by purpose"
  ```

## Task 6: Pin selection receipts before model spending

**Files:**
- Create: migration generated by `pnpm dlx supabase migration new creative_history_generation_receipts`; `supabase/tests/database/creative_history_generation_receipts_test.sql`
- Modify: `src/lib/supabase/database.types.ts`, `src/workflows/campaigns/generate-bundle.ts`, `src/modules/campaigns/infrastructure/generation-readers.ts`, `src/modules/campaigns/infrastructure/creation-repository.ts`, and focused tests

**Interfaces:**
- Adds immutable `campaign_creative_selection_receipts` with one receipt per `(organization_id, campaign_generation_run_id)`.
- Receipt stores selector version, normalized request, effective metadata snapshots, approved/rejected selections, scores, exclusions, manual overrides, and both source-version ID sets.
- Adds claim-fenced `pin_campaign_creative_history_selection` and worker read `load_campaign_creative_history_selection`.

- [ ] **Step 1: Write pgTAP and worker red tests**

  ```ts
  expect(pinWithExpiredClaim).toReject();
  expect(replaySameReceipt).toEqual("idempotent");
  expect(otherOrganizationReceipt).toBeNull();
  expect(runReceipt.createdAt).toBeDefined();
  ```

- [ ] **Step 2: Draft, review, then apply the receipt migration**

  The pin RPC must verify the service worker role, organization, run, active claim token and immutable replay digest. It must insert the selection before either Blueprint or image model spending; no update to `campaign_source_snapshots` is allowed.

- [ ] **Step 3: Add the worker’s selection/pinning flow**

  Load only eligible Creative History rows, invoke the pure selector, persist its exact receipt, then pass the pinned identifiers—not a fresh query—to each downstream byte loader.

- [ ] **Step 4: Run focused suites and first-call checks**

  ```bash
  pnpm db:test -- --file supabase/tests/database/creative_history_generation_receipts_test.sql
  pnpm vitest run src/workflows/campaigns/generate-bundle.test.ts src/modules/campaigns/infrastructure/generation-readers.test.ts src/modules/campaigns/infrastructure/creation-repository.test.ts
  ```

- [ ] **Step 5: Commit migration and types separately**

  Keep the generated type edit in its own path-limited commit; record the applied migration and staging function probe on the board.

## Task 7: Enforce Blueprint-only rejected evidence at the provider boundary

**Files:**
- Modify: `src/ai/campaign-generation-provider.ts`, `src/modules/campaigns/infrastructure/gemini-campaign-generation-provider.ts`, `blueprint-planner.ts`, `reference-prompt.ts`, `campaign-planner.ts`, `generation-readers.ts`, `generate-bundle.ts`
- Modify tests: `gemini-campaign-generation-provider.test.ts`, `blueprint-planner.test.ts`, `reference-prompt.test.ts`, `campaign-planner.test.ts`, `generate-bundle.test.ts`

**Interfaces:**
- `generatePlan` accepts `BlueprintEvidenceReference[]`; it may include `rejected_creative` with reasons.
- `generateImage` accepts `FinalImageReference[]`; it cannot accept rejected references at compile time or after Zod parsing.
- `loadBlueprintEvidenceBytes` and `loadFinalImageEvidenceBytes` are separate functions with separate return types.

- [ ] **Step 1: Write the boundary regression tests first**

  ```ts
  expect(blueprintCall.references).toContainEqual(expect.objectContaining({ role: "rejected_creative" }));
  expect(finalImageCall.references).not.toContainEqual(expect.objectContaining({ role: "rejected_creative" }));
  expect(finalImageCall.references.map((reference) => reference.bytes)).not.toContain(rejectedBytes);
  ```

- [ ] **Step 2: Implement separate byte loaders and provider schemas**

  The Blueprint loader may read up to five pinned rejected creative versions and includes human reasons. The final loader reads declared-subject/Brand Kit grounding plus at most three approved Creative History versions. It never reads a rejected version’s storage path.

- [ ] **Step 3: Rebuild prompts around the corrected evidence flow**

  Blueprint receives approved/rejected context and produces validated rules with their support references. Final generation receives approved bytes, the parsed Blueprint and fixed no-text/subject constraints. It does not receive legacy `avoid` bytes; legacy receipt fields remain display-only.

- [ ] **Step 4: Run integration-level proof tests**

  ```bash
  pnpm vitest run src/ai/campaign-generation-provider.test.ts src/modules/campaigns/infrastructure/gemini-campaign-generation-provider.test.ts src/modules/campaigns/infrastructure/blueprint-planner.test.ts src/modules/campaigns/infrastructure/reference-prompt.test.ts src/modules/campaigns/infrastructure/campaign-planner.test.ts src/workflows/campaigns/generate-bundle.test.ts
  ```

- [ ] **Step 5: Commit the final-image fence**

  ```bash
  git add src/ai/campaign-generation-provider.ts src/modules/campaigns/infrastructure/gemini-campaign-generation-provider.ts src/modules/campaigns/infrastructure/gemini-campaign-generation-provider.test.ts src/modules/campaigns/infrastructure/blueprint-planner.ts src/modules/campaigns/infrastructure/blueprint-planner.test.ts src/modules/campaigns/infrastructure/reference-prompt.ts src/modules/campaigns/infrastructure/reference-prompt.test.ts src/modules/campaigns/infrastructure/campaign-planner.ts src/modules/campaigns/infrastructure/campaign-planner.test.ts src/modules/campaigns/infrastructure/generation-readers.ts src/modules/campaigns/infrastructure/generation-readers.test.ts src/workflows/campaigns/generate-bundle.ts src/workflows/campaigns/generate-bundle.test.ts
  git commit -m "fix: keep rejected creative out of final generation"
  ```

## Task 8: Link finished Studio designs and safely backfill eligible history

**Files:**
- Modify: `src/modules/campaigns/infrastructure/poster-render-repository.ts`, `poster-studio-reader.ts`, `src/modules/campaigns/application/poster-studio-view.ts`, tests
- Create: one worker-safe link/backfill service and its tests

**Interfaces:**
- A completed `campaign_poster_render` creates or links one `creative_item_version` with source kind `studio_render`, current verdict `unreviewed` and no copied blob.
- A legacy asset is eligible only if it is provably a completed final poster; raw campaign plates and failed/refused renders are excluded.

- [ ] **Step 1: Write eligibility tests**

  ```ts
  expect(canBackfill(completedPosterRender)).toBe(true);
  expect(canBackfill(rawCampaignPlate)).toBe(false);
  expect(canBackfill(refusedRender)).toBe(false);
  ```

- [ ] **Step 2: Implement idempotent Studio linkage**

  Link to the existing private object path and immutable render receipt; never copy asset bytes or change an existing Studio row. The link must be organization-scoped and safe on replay.

- [ ] **Step 3: Backfill only proven finished designs**

  Invoke Task 3's dry-run-capable RPC with an idempotency constraint. Do not create another migration or alter historical generation receipts, approval digests, old dimensions or verdicts.

- [ ] **Step 4: Verify and commit**

  Run the focused tests plus a staging probe for a completed render, a raw plate and a foreign tenant; record the exact counts and exclusions in the board log.

## Task 9: End-to-end controlled staging and browser acceptance

**Files:**
- Modify: `docs/verification/campaigns/creative-history-correction-live-proof.md` (create), `docs/collaboration/asset-library-and-studio-board.md`
- Test: focused Vitest suites above, the two pgTAP suites, and existing campaign/Studio regression suites

- [ ] **Step 1: Run static and database gates**

  ```bash
  pnpm typecheck
  pnpm lint
  pnpm vitest run src/domain/campaigns/creative-history.test.ts src/domain/campaigns/creative-history-selector.test.ts src/modules/campaigns src/workflows/campaigns/generate-bundle.test.ts
  pnpm db:test -- --file supabase/tests/database/creative_history_core_test.sql
  pnpm db:test -- --file supabase/tests/database/creative_history_generation_receipts_test.sql
  ```

- [ ] **Step 2: Prove one controlled generation on hosted staging**

  Create reviewed Approved and Rejected Creative History examples for one organization, run one governed generation, retain bounded request metadata/identifiers and hashes, and verify: deterministic selected IDs; max three Approved bytes in final input; max five Rejected bytes in Blueprint input; zero Rejected bytes in final input; current text absent from the generated plate; exact pinned receipt readable afterward.

- [ ] **Step 3: Complete the browser gate**

  At 1440px and 390px, exercise the three tabs, folder defaults, upload/intake failure, confirmed metadata, approval, rejection-with-reasons refusal, selector explanation, receipt panel and cross-tenant unavailable response. Check keyboard navigation, labels, no horizontal overflow and console errors caused by this surface.

- [ ] **Step 4: Publish evidence and update CP1**

  Write only safe identifiers, hashes, counts, verdicts and refusal codes to the verification record. Mark CP1 `done` only after the staging proof and browser gate pass; otherwise record the exact blocker and leave the next Campaign Progress step unopened.

## Plan self-review

- Coverage: Tasks 1–2 define the corrected model; Tasks 3–5 establish its governed data/UI surface; Tasks 6–7 pin and enforce the two evidence paths; Task 8 closes Studio lineage; Task 9 supplies staging and browser proof.
- No backward rewrite: legacy `avoid` fields and historical receipts remain readable but are never written on the corrected path.
- Tenant safety: every database task includes forced RLS, composite organization scope, permission checks, worker claim fences, foreign-tenant tests and private storage checks.
- Final-image safety: compile-time types, runtime parsing, separate loaders, provider tests and staging evidence all independently demonstrate that rejected bytes cannot reach final generation.
