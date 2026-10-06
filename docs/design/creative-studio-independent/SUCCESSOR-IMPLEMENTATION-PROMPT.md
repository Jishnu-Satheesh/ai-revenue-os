# Successor implementation prompt — Independent Creative Studio

Copy everything below this line into the implementing agent's session. The receiving agent works in the same repository and must treat referenced files as the source of truth.

---

You are the implementation coordinator for the **Independent Creative Studio** Tier 3 feature in AI Revenue OS. Your job is to carry the approved design into a production-complete, tenant-safe implementation and continue until every authorized task and acceptance gate is complete.

The visual prototype is approved. The original wireframe was unavailable, and the user explicitly approved this prototype as its replacement on September 24, 2026. The approved visual bytes and hashes are frozen in `docs/design/creative-studio-independent/reference-manifest.json`.

The visual approval is not proof that the provider, persistence, permissions, campaign handoff or real streaming flow works. Never claim production completion from the prototype. The specification and execution plan remain separately marked **PROPOSED** until the user explicitly approves Tier 3 implementation. If this prompt is accompanied by an explicit instruction such as “implement this plan,” treat that as the implementation instruction. If it is pasted only for review, stop after the read-only preflight and ask for plan approval because repository `AGENTS.md` requires it.

## 1. Work in the correct place

- Repository worktree: `/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence`.
- Start by confirming `pwd` and the current branch. Never implement on `main` or `master` without explicit user consent.
- Prefix every shell command with `rtk`, following `/home/spy/.codex/RTK.md`.
- Read `/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence/AGENTS.md` before touching any file.
- Read `docs/collaboration/asset-library-and-studio-board.md`, then append a narrow claim listing the files for the first task before writing them.
- Run `rtk git status --short` and record the existing dirty baseline. This worktree contains unrelated work. Never stash, reset, clean, broad-stage, overwrite or reformat unrelated changes.
- Never use `git stash`. Never push. Never create or use a local Supabase/Docker database. Never run `pnpm db:types`.
- Hosted staging is shared and live. Do not push a migration, spend provider credits, deploy or publish merely because a local task is ready. Follow the authorization and staging rules in `AGENTS.md` and the plan.

## 2. Read these files in this exact order

Do not skim only this prompt. The files below carry the exact contracts and resolve ambiguity.

1. `AGENTS.md` and `/home/spy/.codex/RTK.md`.
2. `README.md`.
3. `context/00-vision.md`.
4. `context/01-project-overview.md`.
5. `context/03-architecture.md`.
6. `context/04-domain-model.md`.
7. The Campaign, Creative Studio, Creative History and Asset Library entries in `context/05-module-map.md`.
8. `docs/superpowers/specs/2026-09-20-independent-creative-studio-design.md` — the assigned product and UX authority.
9. Existing Specs 019 and 020, whose exact filenames are identified by the assigned spec and repository search.
10. ADR 0042 and every other ADR linked by the assigned spec or the task being executed.
11. `context/14-coding-standards.md`.
12. `context/15-ai-coding-standards.md`.
13. `context/18-anti-patterns.md`.
14. `docs/collaboration/asset-library-and-studio-board.md`.
15. `docs/design/creative-studio-independent/README.md`.
16. `docs/design/creative-studio-independent/HANDOFF.md`.
17. `docs/design/creative-studio-independent/reference-manifest.json`.
18. `docs/design/creative-studio-independent/REFERENCE.md`.
19. `docs/design/creative-studio-independent/technical-contract.md` — schema, API, events, concurrency, security and exact-byte handoff authority.
20. `docs/design/creative-studio-independent/current-studio-audit.md` — current implementation and blast radius.
21. `docs/design/creative-studio-independent/provider-and-assets-audit.md` — provider evidence, preset evidence and unresolved qualification work.
22. `docs/design/creative-studio-independent/design-review.md` and `browser-review.md` — corrected findings and known prototype limits.
23. `docs/superpowers/plans/2026-09-20-independent-creative-studio.md` — execute Tasks 0 through 12, including Task 11A, in dependency order.
24. The current Campaign, Creative Studio, Creative History and Asset Library source files named by the task being executed, plus their callers, schemas, policies, workers and tests.

The spec wins if the plan and spec conflict. The technical contract supplies exact interfaces. Record a ruling in the SDD ledger before changing a contract or task order. A material scope change returns to the user for approval.

## 3. Open the approved visual reference before coding UI

- Canonical desktop image: `docs/design/creative-studio-independent/Desktop.png`.
- Companion states in the same folder: `Canvas.png`, `Reference-picker.png`, `Loading.png`, `Streaming.png`, `Markers.png`, `Empty.png`, `Error.png`, `Desktop-1440.png`, `Mobile-history.png`, and `Mobile-settings.png`.
- Interactive source: `.superdesign/creative-studio-independent/prototype.html`.
- Hosted prototype: `https://p.superdesign.dev/draft/21d0f45c-6ad2-4d78-a831-03df6684d43a`.
- Superdesign canvas: `https://superdesign.dev/teams/c3d56832-bb79-49b6-910a-6450fc30e0a4/projects/1acb3016-c8be-4e30-a461-3e06e9782041?node=draft-variant-21d0f45c-6ad2-4d78-a831-03df6684d43a`.
- Local prototype command from repository root: `rtk proxy python3 -m http.server 4317 --bind 127.0.0.1 --directory .superdesign/creative-studio-independent`, then open `http://127.0.0.1:4317/prototype.html`.
- Stable state URLs: `?state=history`, `canvas`, `picker`, `loading`, `streaming`, `markers`, `empty`, and `error`.

Do not modify or overwrite approved design images. Implementation screenshots belong under `docs/verification/creative-studio-independent/`. Use the hashes in `reference-manifest.json` to prove the reference was unchanged.

The prototype uses fictional sample data, in-memory state, timers, SVG artwork and a blurred simulated preview. Those are interaction demonstrations only. Do not copy its state store, timer sequence, poster renderer or blur/reveal behavior into production. Real streaming must use independently decodable provider preview images.

## 4. Approved layout and interaction contract

- New routes: `/organizations/[organizationId]/campaigns/studio` and `/organizations/[organizationId]/campaigns/studio/[documentId]`.
- Sidebar order under Campaigns: **Overview → Creative Studio → Asset Library → Research settings**.
- Direct sidebar entry opens Studio history with a blank setup. It must not auto-select a previous poster.
- Opening a saved Studio document or campaign-specific creative opens that exact saved revision in the canvas.
- Canonical viewport: 1728 × 1080, light theme, 100% zoom, device scale 1, Manrope.
- Existing global sidebar: 256px. Existing top header: 64px. Page gutters: 32px. Pane gap: 24px.
- Usable Studio panes: settings x=288, width=276.8; workspace x=588.8, width=1107.2. This is the approved 20/80 split after global navigation, gutters and gap.
- At the canonical viewport all sections and Generate fit. At smaller desktops the settings body scrolls and the rail never becomes narrower than 256px.
- Mobile uses **Creative settings** and **Your creatives/Canvas** tabs. Never compress controls into an unreadable 20% mobile column. No horizontal page overflow at 390px.
- Desktop history is a vertical stack of long horizontal cards. Filters are above it. Canvas replaces history after the first real preview.
- Reference/product pickers show upload first, then a labelled source list, then a large preview. Previewing and selecting are separate actions.
- Use the specification section **Left-side sections, in exact order** for every label, helper, validation and state. Do not reorder fields.

## 5. Product behavior that must not drift

- Campaign is optional. A campaign-free generation is saved in Studio history and can be linked later.
- The AI creates the complete raster poster, including the exact submitted Text Copy. Do not add deterministic text layers to this new path.
- Preserve Text Copy Unicode, punctuation, numerals and line breaks. Prompt Enhance/New Idea may change only Prompt after explicit user acceptance; it never changes Text Copy.
- Human review of spelling, prices, addresses, phone numbers, claims, product details and logos remains required. OCR is an aid, not proof.
- Default format is **Instagram Feed · 4:5 · 1080 × 1350**. Use the qualified preset registry and export rules in the technical contract. Do not advertise generic Meta/Google/Amazon compliance.
- **Exact design** requires a primary selected design reference. It requests close layout adherence without promising identical pixels, fonts or logos.
- **Take Inspiration** allows more composition freedom while remaining grounded in brand assets and supplied product/reference images.
- Approved design references come only from eligible versioned Creative History. Rejected and Unreviewed designs never reach final generation. Fresh uploads are current-use references and do not become approved library history.
- Product/dish images come from Products & Subjects. Platform-core schemas remain industry-neutral.
- Channel-name-to-logo replacement requires explicit selected chips, exact copy ranges and approved logo bytes. Never ask the image model to invent a channel logo from a name.
- Generated output enters Studio history automatically. **Save to Asset Library** is a separate explicit action and creates an Unreviewed Creative History item. It gains no reference eligibility until existing human review and metadata confirmation.

## 6. Streaming and provider gate

- Visible progressive image previews are a hard requirement. Status text, spinners, arbitrary base64 fragments, a CSS wipe, a blurred final image or a timer do not pass.
- Qualify a real provider/model/API profile before enabling generation. The same profile must demonstrate independently decodable partial frames and same-model contextual edits.
- Gemini is not assumed to pass. Qualify an alternate provider if necessary. Never hard-code a model because a documentation page mentions it; record the exact account-available model proven by the qualification harness.
- Record preview index, time, hash, MIME and decoded dimensions. At least one real non-final frame must be shown in Chrome before final for acceptance.
- If a valid final unexpectedly arrives without a preview, save it honestly and record `missing_progressive_preview`; do not fabricate a preview or claim the progressive path passed. Repeated failures disable the profile.
- Keep provider handles/continuations private. Pin provider, exact image model, adapter version, parent revision and continuation. Context/caching is an accelerator, never the durable source of truth.
- A Trigger run marked completed is not enough. Ready means validated bytes, private object, immutable Studio version and committed final event.
- Require an explicit authorized cost cap before any real qualification or generation call.

## 7. Marker edit contract

- Store marker positions as normalized coordinates against the EXIF-normalized image, accounting for contain-fit letterboxing, pan and zoom.
- Send the clean parent image and a separate numbered overlay/coordinate manifest. Never bake pins into saved pixels.
- Send all marker instructions in one edit request with the exact parent revision/hash, original request context and pinned provider continuation.
- Earlier revisions remain immutable. Editing an older revision creates a branch.
- A marker is edit intent, not a deterministic mask. The full poster may change; review the whole child image.
- If original context expires, retain history/download and offer an explicitly labelled new-context branch. Never silently switch model/provider and call it the same context.

## 8. Campaign boundary that must remain exact

- Existing `createCampaignService.create` enqueues generation. Do not call it unchanged from **Create campaign from creative**.
- Create a real draft plus a durable selected-creative link without hidden generation, fake bundle IDs or fake direction IDs.
- The selected identity is exact `{studioVersionId, studioExportId|null, contentHash}`. Never use the image merely as inspiration and regenerate it.
- A campaign-selected creative inherits no approval. It must enter the existing Campaign exact-output review as a new Unreviewed deliverable.
- If a campaign lacks a real bundle/direction/slot, retain `awaiting_campaign_setup`. Later real Campaign setup must resolve the same selected bytes.
- The existing setup seam is documented in `technical-contract.md`: `generateCampaignBundle` → publisher → `createCampaignVersionWriter(...).createVersion` → `create_campaign_bundle_version`. Add durable resolution intent and bounded recovery around the committed real bundle.
- Preserve every legacy deterministic-compositor canonical JSON representation and digest byte-for-byte. Add the new `studio_version` source and version-2 full-poster render-input arm without rewriting legacy records.
- Studio creates no publishing authority, media-spend authority or automatic public action.

## 9. Tenant, permission and data rules

- Tenant identity comes from authenticated route/session context, not arbitrary body input.
- Every new tenant table needs composite organization keys/FKs, forced RLS and explicit grants. Continuation state is worker-only.
- User-facing paths never use a service-role client to bypass RLS.
- Proposed permissions and policy behavior are in `technical-contract.md`. Do not invent aliases.
- Generation requires both actor permission and an explicit enabled bounded policy. Do not seed a nonzero default budget.
- Use Zod at every external/AI boundary and database validators for versioned JSON persisted as authority.
- Leases, idempotency, cancellation, unknown paid outcomes and durable event sequence belong to the database contract. Never blindly retry an uncertain paid request.
- Do not log prompts, Text Copy, image bytes, signed URLs, secrets, opaque continuation tokens or customer data. Log safe IDs, stages, timing, hashes, usage/cost and safe failure codes.

## 10. Execute through Subagent-Driven Development

Load and follow the available `subagent-driven-development` skill. The implementation plan is:

`docs/superpowers/plans/2026-09-20-independent-creative-studio.md`

Use the skill's own scripts for the workspace, task briefs and review packages. The installed script directory is `/home/spy/.agents/skills/subagent-driven-development/scripts/`. Invoke its commands through `rtk proxy`; do not recreate their behavior manually. The authoritative plan must remain bullet-only under `AGENTS.md`, while the installed `task-brief` script recognizes `## Task` headings. Therefore, use the checked-in mechanical extraction adapter `docs/design/creative-studio-independent/SDD-PLAN-ADAPTER.md` only for `task-brief`; the original plan remains the authority. The SDD ledger is the recovery map across session compaction. Do not track progress only in chat.

- Resolve the workspace with `rtk proxy /home/spy/.agents/skills/subagent-driven-development/scripts/sdd-workspace docs/superpowers/plans/2026-09-20-independent-creative-studio.md`.
- Store the workspace path printed by `sdd-workspace` as `<SDD_WORKSPACE>`. Extract each task with `rtk proxy /home/spy/.agents/skills/subagent-driven-development/scripts/task-brief docs/design/creative-studio-independent/SDD-PLAN-ADAPTER.md <EXTRACTION_ID> <SDD_WORKSPACE>/task-<TASK_LABEL>-brief.md`.
- `<TASK_LABEL>` is the authoritative label. `<EXTRACTION_ID>` is the same label for Tasks 0–10, 11A and 12. For authoritative Task 11 only, use extraction ID `011`. This zero padding prevents the installed parser from merging Task 11A into Task 11. Examples: Task 11 uses `... task-brief ... 011 <SDD_WORKSPACE>/task-11-brief.md`; Task 11A uses `... task-brief ... 11A <SDD_WORKSPACE>/task-11A-brief.md`.
- Before Task 0, verify that the adapter differs from the authoritative plan only by its explanatory header, conversion of each `- [ ] **Task N ...**` line to `## Task N ...`, and the documented Task 11 → `Task 011` extraction workaround. Run extraction smoke checks for 0, 011, 11A and 12. Confirm each output starts with exactly its intended task and contains no adjacent task. If the plan changed, regenerate/review the adapter before extracting briefs; never edit task requirements only in the adapter.
- After an implementer finishes, create the reviewer input with `rtk proxy /home/spy/.agents/skills/subagent-driven-development/scripts/review-package docs/superpowers/plans/2026-09-20-independent-creative-studio.md <BASE_COMMIT> <HEAD_COMMIT>`.
- Use the workspace path printed by the scripts rather than guessing it. Never use `HEAD~1` as the review base; record the exact task base before dispatch.

- Create or resume `.superpowers/sdd/2026-09-20-independent-creative-studio/progress.md` with the plan path in its first line.
- Run the plan-wide preflight conflict table before Task 1, covering every shared file/interface pair.
- Execute Tasks **0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 11A, 12** in dependency order.
- Do not skip Task 0. It freezes approvals, drafts the scoped ADR/reconciles Specs 019/020, records the dirty baseline, checks provider/budget/browser/staging prerequisites and allocates collision-free migration/ADR identifiers.
- Never run two implementation writers in parallel. One implementer owns a task's write set.
- Use a fresh implementer per task. Mechanical tasks may use a fast model; cross-module integration uses a standard model; architecture, concurrency/security review and final review use the strongest available model.
- After implementation stops writing, run an independent task reviewer for both spec compliance and code quality. For frontend/integration tasks also run an independent Chrome DevTools browser verifier against the actual app.
- If a reviewer finds an issue, send the exact finding to the original implementer/fix agent, rerun covering tests, then have the original reviewer perform a scoped re-review. Do not let an implementer self-certify.
- Use the SDD skill's first five fix rounds as its escalation sequence: rounds 1–3 resume the original implementer; rounds 4–5 use a fresh stronger implementer. Record every round and ruling in the ledger. The five-round breaker is a coordination checkpoint, not permission to park a known security, data-loss, global-acceptance or task-acceptance defect. After round 5, adjudicate scope disputes, then continue with a fresh capable fixer and independent re-review until every load-bearing finding is clean, unless one of the skill's explicit stop conditions applies.
- Code review and browser review may run in parallel after the writer is idle. Reviewers are read-only. Do not ask an implementer to spawn its own reviewer.
- Never mark a backend task browser-passed when the UI seam is not wired. Record **Pending integration — Task N**, then close that evidence gap in the named later task.
- After all tasks, run one strongest-model whole-branch review. Send every valid finding to a fresh capable fix agent, rerun the covering checks and obtain an independent scoped re-review. Repeat for unresolved security, data-loss and acceptance findings until clean; do not declare completion at an arbitrary fix cap.

Each implementer brief must contain only: the extracted task brief path, approved spec sections, interfaces already established, exact owned files, non-goals, tests, browser state, report path and known ledger findings. Do not paste the entire conversation or full plan into every agent.

## 11. Browser verification requirements

Use Chrome DevTools MCP for frontend verification. Do not substitute source reading, component tests, Playwright screenshots or direct DOM mutation for required real interactions.

- Compare against `reference-manifest.json` and the approved screenshots at the same viewport, zoom, scale, theme and font.
- Major box geometry tolerance is 2px. Font antialiasing may differ. Missing controls, reordered sections, altered pane relationships or inaccessible actions fail.
- Exercise actual clicks, keyboard focus, typing, uploads, dialogs, error recovery, reload and downloads.
- Test 1728×1080, 1440×900, tablet, 390px, 320px, 200% zoom and reduced motion.
- Verify the state matrix: history, empty, reference picker, product picker, suggestion review, loading overlay, first real preview, later preview, completed canvas, marker edit, campaign link/create, failure, reconnect and viewer.
- Save implementation screenshots separately. Record route, role, organization, fixture, viewport, screenshot path, console/network errors and verdict.
- Never update the approved reference to make an implementation diff pass.

## 12. Database and staging rules

- There is no local database. Do not run `supabase start`, `supabase db reset`, Docker Postgres or anything that assumes one.
- Inspect the current hosted schema before authoring migrations. Migrations are additive and forward-only.
- `pnpm db:migrations:list`, `:dry-run` and `:push` target shared staging. A push is immediately live; obtain the authorization required by the current session before pushing.
- `pnpm db:test` is a shared-staging integration check, not a hermetic unit suite.
- Maintain `src/lib/supabase/database.types.ts` narrowly by hand or update `UNTYPED_TABLES` as required. Never run `pnpm db:types`.
- Every new/changed PL/pgSQL function that reads existing tables must be invoked at least once on staging before completion so deferred field-resolution errors cannot hide behind a successful migration.
- Prove tenant A/B isolation, viewer/operator/admin behavior, direct table-write denial, foreign object denial, continuation secrecy and same-tenant composite FK enforcement.

## 13. Definition of implementation completion

Do not call this feature complete until all of the following are evidenced:

- Direct sidebar entry works independently and saves campaign-free history across reload.
- Exact and inspiration modes use the correct reference/product/brand manifests.
- Text Copy is preserved in the immutable input and visibly reviewed in the complete poster.
- A real authorized provider run displays independently decodable partial images before final.
- Final bytes are validated, privately stored, versioned and downloadable with matching hash/MIME/dimensions.
- A marker edit after reload uses the same pinned image model and correct saved parent context, with immutable ancestry.
- Existing and newly created Campaign flows preserve exact selected bytes, use no hidden generation and require fresh Campaign review.
- Explicit Save to Asset Library produces an Unreviewed exact-source item that remains absent from Approved references until existing human review.
- Tenant, role, stream, preview, continuation, object and download boundaries pass.
- Legacy Campaign compositor fixtures and digests remain byte-identical.
- Required lint, typecheck, focused/unit/integration/pgTAP/E2E checks pass after the final change.
- Independent code/spec/security and human-like Chrome reviews have no unresolved Critical or High finding.
- Documentation, scoped ADR, migrations, provider qualification, policy/profile versions, rollback and known limitations are recorded.

The final human-like flow must create one real poster without a campaign, observe real partial images, reload it, download and hash it, perform a real contextual marker edit, link the exact child to an existing campaign, create a new campaign draft with no hidden generation, resolve the same bytes into a real output slot, and verify second-tenant/viewer denials. A prototype screenshot or injected database fixture cannot satisfy this flow.

## 14. Forbidden shortcuts

- Do not hide current Campaign dependencies behind an optional UI field.
- Do not create hidden campaigns for standalone Studio work.
- Do not treat a final-only image response as progressive streaming.
- Do not fake streaming with blur, CSS or timers.
- Do not send rejected Creative History bytes to final generation.
- Do not make generated work Approved automatically.
- Do not mutate Text Copy through Enhance/New Idea.
- Do not invent provider support, model availability, placement compliance, schema fields, bundle IDs, directions or permissions.
- Do not change legacy deliverable hashes/canonicalization.
- Do not expose provider continuation handles. Issue private-object signed URLs only from authorized routes, scoped to the allowed object and the contract's five-minute lifetime. Never log them, leak them publicly, accept them as durable identity or persist them where immutable object IDs/hashes belong.
- Do not regenerate a campaign-selected image when exact saved bytes were requested.
- Do not inherit Studio, Asset Library or Campaign approval across boundaries.
- Do not claim completion because Trigger is green, a row exists, a mock test passes or a screenshot resembles the prototype.
- Do not overwrite or “refresh” the approved PNG references.
- Do not push, merge, deploy, publish or spend outside the authorization supplied in the implementation session.

## 15. Reporting contract

Give short progress updates that state what was learned, which gate is being resolved and what evidence will close it. Do not narrate routine commands.

For every task, retain the brief, implementation report, review package, spec/code review, browser report, fix reports, test commands/results and commit/diff identity in the SDD workspace. Keep the collaboration board current.

At the end report:

- changed files grouped by domain/UI/worker/schema/docs;
- migrations actually pushed and first-call evidence, or clearly state none were pushed;
- tests actually run with counts/results;
- provider/model/profile and cost-cap qualification evidence;
- real browser run/version/hash evidence;
- tenant/role evidence;
- exact remaining limitations or blocked gates;
- rollback procedure;
- all SDD ledger rulings and what each would cost if wrong;
- user-owned push/deployment steps.

Do not use the word “complete” while any mandatory real-provider, persistence, exact-byte Campaign, tenant or final browser gate remains unproven.

Begin with the read-only preflight, verify the approval gate that applies in the receiving session, create/resume the SDD ledger, and then execute continuously without asking “should I continue?” between authorized tasks.

---

End of successor prompt.
