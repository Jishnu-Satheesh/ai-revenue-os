# Independent Creative Studio — handoff entrypoint

**Design package only. Production implementation is not approved by this file.** Started 2026-09-20; resumed 2026-09-21. Read the final review report for known gaps. The original wireframe attachment was not visible; no sketch comparison has been claimed.

## Open first

1. `Desktop.png` and the other state screenshots in this directory.
2. Interactive `.superdesign/creative-studio-independent/prototype.html` (serve that directory over HTTP).
3. `docs/superpowers/specs/2026-09-20-independent-creative-studio-design.md`.
4. `technical-contract.md`, then `provider-and-assets-audit.md` and `current-studio-audit.md`.
5. `docs/superpowers/plans/2026-09-20-independent-creative-studio.md`.
6. `REFERENCE.md`, `design-review.md` and `browser-review.md`.

The prototype's local sample organization, artwork, uploads, generation, campaign creation and saving demonstrate interaction. They do not prove production persistence, paid-provider behavior or authorization. Do not copy the mock state store, timers or SVG poster renderer into the application.

## Approval and prerequisite ledger

| Decision/gate | State |
| --- | --- |
| Generate without a campaign and save Studio history | Explicitly confirmed by user |
| AI creates complete poster, including supplied Text Copy | Explicitly confirmed by user |
| Visible progressive preview images; qualify alternate provider if needed | Explicitly confirmed by user |
| Build reviewable prototype, screenshot, spec and detailed plan | Authorized in this session |
| Original sketch received and clinically compared | Not received in visible conversation |
| Proposed prototype/visual contract approved | Pending user review |
| Proposed specification and execution plan approved | Pending user review |
| Provider account/model access, cost cap and real qualification | Not tested; required before enablement |
| New application, migrations and workers implemented | Not performed in this design task |
| Final real poster generation through production UI | Future implementation acceptance, not performed here |

A successor must not interpret this package, its screenshots, an agent's review or a completed prototype simulation as approval of production changes. Once the user approves the concrete scope, execute it without asking again between routine authorized tasks. Ask only for genuinely missing authorization or a material change to the agreed scope.

## Non-negotiable implementation traps

- Campaign identity cannot be removed by hiding the picker. Current Studio persistence requires campaign/bundle data. Use independent Studio records.
- Existing `createCampaignService.create` enqueues generation. The new Create campaign action must create a draft and preserve this selected image, with no hidden generation request.
- A campaign-selected creative is neither an approved design reference nor an approved campaign output. Import exact bytes into the real output slot and require the existing exact-output review. No new publishing permission is introduced.
- New drafts can lack a bundle or direction. Preserve the selected image in a durable link, show pending setup, and test eventual resolution to the real slot. Never invent a direction UUID to satisfy a foreign key.
- Existing deliverable render inputs assume a deterministic template. Use a new source/input arm without changing the canonical representation or hashes of old versions.
- The new full-poster workflow deliberately differs from Spec 020 / ADR 0042. Record the scoped ADR before implementation; preserve legacy templates and exact-text renderer regression tests.
- Approved design references come from eligible, versioned Creative History. Product images come from Products & Subjects. Fresh uploads are explicit current-use references, not automatically approved library history.
- Prompt helpers only suggest prompt changes. Text Copy is exact user input and cannot be silently enhanced, translated or replaced with campaign copy.
- Do not request logos by name and hope the model knows them. Supply approved image bytes and explicit channel substitutions; review the result.
- A streamed chunk is not necessarily a displayable preview. Require real provider partial-image evidence. Never implement streaming as a timed blur/reveal of the final image.
- Pin the image model through edits, not only the text/orchestration model. Persist provider continuation per exact parent revision. Cached context is not a durability or accuracy guarantee.
- Markers are normalized to image coordinates. Container offsets, letterboxing, zoom and EXIF orientation matter. Preserve a clean parent image; overlay pins are separate inputs.
- Full-poster marker edits may alter unmarked areas. Do not borrow the old plate compositor's outside-mask guarantee for this workflow.
- Native generation size, export dimensions and platform placement eligibility are separate. A generic poster is not automatically a compliant Amazon or Google ad asset.
- Final Ready means validated bytes + private object + committed version. A green Trigger task alone is insufficient.

## Swarm structure for the implementing model

Use the available `subagent-driven-development` skill. The skill describes execution after approval; loading it does not approve this plan. The user mentioned Muse Spark 1.3 as a potential successor; do not assume any model identifier or delegate capability exists without checking the actual host.

Use four roles within the available concurrency limit:

1. **Coordinator:** owns task order, interface decisions, source ledger, file claims and evidence. Gives each agent a bounded task brief, not the whole conversation.
2. **Implementer / fix agent:** one writer at a time. Implements the smallest task and its meaningful tests. Fixes review findings; never self-certifies the task.
3. **Independent code/spec reviewer:** reads the actual diff and contracts, reruns relevant checks and reports severity/file/line/impact. Checks tenant boundaries, state transitions and claimed behavior.
4. **Independent browser verifier:** uses Chrome DevTools MCP to exercise the real frontend and compare the exact approved reference. Records viewport, role, route, state, screenshot and interaction evidence.

Code and browser review may run in parallel after the implementer stops writing. A shared file never has two implementers. Backend tasks still receive browser regression checks of any affected existing surface; a not-yet-wired new flow is marked **Pending integration**, not **Passed**. The later integration task must close that named evidence gap.

Each task follows: brief → implementation/tests → code review + browser verification → written findings → fix agent → both relevant re-reviews → clean task report. After three unsuccessful fix rounds, escalate the implementer/reviewer capability and narrow the failing case. Never declare success because a retry limit was reached. A genuinely blocked dependency remains open with a precise reason.

## Dispatch templates

**Implementer brief:** Task ID and exact task text; approved spec sections; input/output interfaces; owned files; dependencies already verified; non-goals; test commands; required browser state; expected report path; no other agents; no unrelated changes. Carry exact values from the plan once, rather than paraphrasing them into contradictory briefs.

**Code reviewer brief:** Task ID, baseline and complete changed-file list, task requirements, report/test evidence, relevant shared contracts. Review implementation against the spec, not against the implementer's summary. Output findings with severity and reproduction. If clean, identify tests actually run and limitations. Read uncommitted work when it is the review target; do not review an older HEAD instead.

**Browser verifier brief:** Fixed reference path/hash, target URL and authenticated role, viewport/device scale/zoom/theme, state fixture, user interaction sequence, screenshot paths and acceptance bounds. Use DOM geometry and pixels together. Do not replace the reference with a new screenshot of the implementation. Missing browser access or credentials means blocked browser acceptance, never a screenshot-free pass.

**Fix brief:** Finding IDs, evidence and exact acceptance condition; smallest owned file set; required regression tests; report file. The fix agent replies with changed paths and evidence. The original reviewer then verifies the finding is closed.

## Visual evidence rules

- After user approval, record original screenshot/prototype SHA-256 hashes and freeze them. Keep proposed and approved states distinct.
- Capture implementation screenshots separately under `docs/verification/creative-studio-independent/`; no overwrite of design files.
- Use the same viewport, scale, theme, font, fixture and UI state. Wait for fonts/assets; disable animation only for static comparison, then separately test motion/reduced motion.
- Compare sidebar order, header, pane bounds, label baseline alignment, input heights, button placement, history-card layout, picker preview, canvas fit and overlay transition. Use a 2px tolerance for major box geometry; allow font anti-aliasing differences, not missing controls or changed layouts.
- A numerical screenshot diff is supporting evidence. The reviewer must inspect the screenshot and explain any permitted difference. Do not pass by raising a threshold after a failure.
- At 320/390px and 200% zoom, verify all controls remain reachable, dialogs trap/restore focus, Generate is visible, no accidental page-wide horizontal overflow and marker instructions can be entered without hiding the image permanently.
- Preserve a state matrix: initial History, empty History, reference picker, full preview, product picker, loading, streaming, completed canvas, marker edit, create/link dialog, failure, reconnect and viewer.

## Final human-like browser acceptance

Use Chrome DevTools MCP for actual clicks and text entry, with a real authenticated permitted actor in the designated staging organization and an approved generation cost limit. Use authorized non-sensitive assets. Do not manufacture a result by directly inserting database fixtures.

1. Open Campaigns → Creative Studio. Observe history and no selected poster.
2. Leave Campaign blank. Preview and select an approved reference; select a product; choose style; type a prompt and exact multiline copy; verify default Feed size.
3. Exercise Enhance or New Idea, review its suggestion, keep or apply it, and confirm Text Copy has not changed.
4. Click Generate once. Record the initial whole-screen loader, first real partial preview replacing it, subsequent refinement and final saved state. Correlate browser events with the real worker run and durable version.
5. Reload. Confirm the same image/settings/version and no duplicate generation. Download; verify actual MIME/dimensions and hash against stored output.
6. Add a marker on a recognisable element, enter a concrete edit, submit. Verify the same pinned image model, correct parent context, real edit previews, immutable child, visible intended change and review of surrounding content.
7. Link that exact child to an existing campaign; show new unreviewed output or a clear setup-pending link, then complete real slot resolution and prove byte identity. No inherited approval.
8. Create a new campaign draft from a creative using required real inputs; prove no hidden image-generation task. Complete setup and prove the same saved creative becomes its selected output.
9. Switch to viewer and a second organization; exercise relevant denied mutation, stream, preview and download boundaries without exposing foreign records.
10. Save screenshots, interaction transcript, safe run/version identifiers, data/worker receipts, console/network errors and final reviewer verdict. A remaining critical/high defect or unmet progressive-preview/context gate prevents completion.

## Workspace rules

Use `rtk` for shell commands and pnpm for package tasks. Read repository `AGENTS.md` and the collaboration board. This shared tree already contains unrelated Growth Intelligence changes; never stash, clean, reset or broadly stage them. Keep one writer for shared files such as `database.types.ts`, sidebar and Campaign source unions.

Only hosted staging exists. Read schema first; additive migrations; dry-run before push; hosted pgTAP and first real invocation of each table-reading PL/pgSQL function. Never start Docker/Supabase locally or run `pnpm db:types`. Do not mutate shared staging or spend on providers merely to validate this design package. Production implementation approval and any account-specific spending/deployment authorization must be established at execution time.
