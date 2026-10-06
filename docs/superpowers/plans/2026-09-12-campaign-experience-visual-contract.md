# Campaign experience — proposed visual and interaction contract

- Status: design recommendation for review, not an approved mockup or implemented UI.
- Read the [product design](../specs/2026-09-12-campaign-experience-design.md) and [workflow audit](../../verification/campaigns/2026-09-12-workflow-audit.md). This contract covers all four requested workspaces and the campaign handoff in Growth Intelligence.
- A successor must build and obtain review of a standalone interactive prototype before changing production composition. Use fictional data visibly labelled as such; include the states listed below. No real model calls, uploads or provider actions in that prototype.

## 1. Reference decisions

- **Local Growth Intelligence:** `.superdesign/growth-intelligence/prototype.html`; retain quiet Manrope type, understandable evidence, emerald primary actions, distinct advice and campaign sections. Do not transplant its performance-first four-tab layout into every Campaign page.
- **Local Channels:** `.superdesign/channels/desktop.png` and `prototype.html`; use open summary rows, restrained separators, readable scoped figures and deliberate comparison. Channel Audit is outside this redesign.
- **Local Overview:** `.superdesign/organization-home/desktop.png` and `prototype.html`; use real artwork as identity and give work visual prominence. The pending revenue-first Home amendment is separate; do not copy its old full information order or illustrative poster rotations.
- **[Linear's interface refresh](https://linear.app/now/behind-the-latest-design-refresh):** quieter navigation, predictable action placement and fewer competing borders. Adapt that hierarchy within the current light shell.
- **[Buffer's All Channels view](https://support.buffer.com/en-us/articles/how-to-use-the-all-channels-view-in-buffer-oqqE4Sdf3T):** explicit drafts, approvals, scheduled and sent work. Borrow state-specific views; retain this platform's organization timezone rather than Buffer's device-timezone behavior.
- **[Motion's creative reporting](https://motionapp.com/solutions/creative-reporting-tool):** artwork beside comparable performance. Borrow side-by-side creative inspection; do not borrow marketing claims that visual patterns establish causal profit.
- **[Foreplay's creative workflow](https://www.foreplay.co/):** organized visual research and a path from reference to brief. Borrow discoverable folders and evidence inspection; do not assume competitor artwork is licensed for generation or that an advertised tool's results prove a campaign works.
- Sources were consulted on 12 September 2026. They are design references, not evidence of this platform's implemented capabilities.

## 2. Shared presentation rules

- Keep AppShell, organization switcher, global sidebar, breadcrumbs, Manrope and semantic tokens from `src/app/globals.css`. No global restyle or client-brand recoloring of the application shell.
- Use typography and whitespace for hierarchy. Avoid a large icon tile at every title, an explanatory architecture banner, and boxes inside boxes. Primary action stays at the upper right or persistent review footer.
- Use a 32px desktop page title, 24px mobile title, 18–20px section headings, 14px body/control text, and 12px supporting labels; align with installed font tokens before implementation. Important evidence and money never depend on tiny text.
- Use existing shadcn Buttons, Cards where meaningful, Tabs, Dialog/Sheet, Select, Checkbox, Field, Alert, Empty and Tooltip primitives. Tooltip-only action labels are insufficient for unfamiliar actions.
- Use neutral gallery backgrounds, soft one-pixel borders and the existing emerald for action/selection. Amber means attention; red indicates failure or destructive intent; gray means unavailable, pending or unknown. Always pair color with a label/icon.
- Keep posters upright and `object-fit: contain`; preserve aspect ratio and readable text. Labels sit outside the creative, not across it. Use real current-version artwork, with a named no-preview state when missing.
- Money shows its currency; dates show the organization timezone where scheduling matters. Evidence period, last successful data fetch, campaign schedule and action date are different labels.
- Interactive server state uses organization-shaped TanStack Query keys. Table/grid/search/filter/tab state is shareable in URL parameters; preview URLs, customer payloads and unsaved text do not enter the URL.
- Dirty text edits remain on failed save. Close/navigation prompts apply only to unsaved work. Review/approval buttons wait for committed domain results and show a single understandable next step on refusal.

## 3. Growth Intelligence campaign section

- Location: Recommendations tab, after the full ordinary advice list, matching the supplied prototype.
- Heading: **Campaign recommendations** with a short explanation, “Proposals to grow the business, ready for your review.” Preserve Campaign-ready opportunities as the prototype reference; final label is a presentation proposal, not a new domain action key.
- Do not hide the entire section when empty. Show one of: no proposal warranted; research in progress; awaiting specific information; research failed; ready for proposal review. A lack of launch permissions is shown on the affected proposal, not misrepresented as no ideas.
- Add **Request a campaign** and **Research settings** alongside this section's status. Settings show automatic research enabled/paused, schedule in the organization timezone, qualifying business changes, cooldown, pending-proposal limit and research allowance/usage. Show last evaluation, last successful research and next scheduled evaluation separately. Missing configuration shows Set up research; exhausted allowance explains when its window resets. Only authorized managers can save changes; viewers see current settings. Pausing research explicitly leaves existing campaign monitoring running.
- Proposal row: title, one-sentence business problem, source window/scope, organic/paid channel chips, proposed budget, optional qualified estimate and short readiness statement. No fabricated generated artwork before creative generation.
- For confirmed D07, use precise gaps such as “Profit impact not yet estimated” and “External market research unavailable.” Keep a supported proposal reviewable; its Sources & unknowns group separates business observations, hypotheses and missing evidence. Do not label unavailable research Pending unless work is actually queued.
- Primary **Review proposal** opens a wide Dialog/Sheet with anchored groups: Why this campaign; Audience & offer; Channels & creative plan; Budget & timing; Success & stop conditions; Sources & unknowns.
- Approval footer repeats the proposal revision, preparation cost limit and action **Approve & prepare creatives**. Request changes accepts focused text with saved scope; Snooze/Dismiss record their own outcomes.
- After approval, replace its decision control with the linked saved preparation state. Your actions uses the same identity and record: Approved proposal → Preparing creatives → Ready for creative review / Attention required.
- Direct links preserve organization, proposal ID and return tab. Viewer can inspect everything allowed by read permission; no approval controls and no writable instruction field.

## 4. Campaign portfolio

- Route remains `/organizations/[organizationId]/campaigns`.
- Header: **Campaigns**, “Your marketing work, from approved idea to results.” Primary **Request a campaign** goes to the manual request/proposal flow. Secondary **Asset Library**; small **Review campaign recommendations** link returns to the exact Growth Intelligence section.
- Opening section: a compact **Needs your attention** strip with real counts and named next actions, at most three previews with a View all filter. Examples: Review proposal; Review 3 creatives; Publishing needs setup; Pause confirmation pending. Count query and preview query are separate so three rows cannot imply the total.
- Below: status filters **All / Needs review / Preparing / Scheduled / Live / Completed**, search, channel and date controls, gallery/list toggle. These are display groupings over real source states; Needs your attention additionally exposes blocked/failed work. Do not introduce a new Campaign archive lifecycle through a visual filter.
- Default gallery: two or three substantial artwork-led cards depending on content width, with fixed consistent media frame, title, business objective, plain stage, next action, schedule and real latest status. Image-less proposals remain useful text-led cards.
- Under each card, choose facts by phase: proposal shows budget proposal; live shows actual spend and one declared primary metric; results shows settled verdict/limitations. Do not show null as zero or a forecast as achieved revenue.
- List view: thumbnail, title/objective, phase, approval/attention, channels, schedule, spend, primary metric, last update. Header scopes all performance columns to the selected reporting window.
- A no-version campaign is openable to a useful detail recovery state; it must never be a dead title. Until that is implemented, preserve current safe fallback navigation.
- Empty states: new organization with request/library entry points; no matches with Clear filters; source failure with Retry; partial source failure retaining available campaigns. No demo substitute records.

## 5. Campaign detail

- Route remains `/campaigns/[campaignId]`; preserve exact `?version=` links. Proposed additional query keys: `tab`, `deliverable`, `compare`. Validate all IDs and enum values; ignore invalid view options without widening data access.
- Header: campaign title, plain objective, current phase, latest saved update; primary next action depends on state. Secondary exact-version selector and More menu. Technical digest/worker IDs live in Activity → Technical details.
- A compact phase strip shows **Proposal → Creating → Review → Scheduled / Live → Results & learning**. Completed marks derive from saved outcomes. A failed generation does not advance to Review and a local pause request does not become Paused.
- Five tabs: **Overview**, **Creative**, **Publishing**, **Results**, **Activity**.
- Overview: business rationale and hypothesis, summary of approvals/next action, approved audience/offer/budget/success plan, relevant sources and a small creative preview. Prelaunch has no invented metrics; active campaigns show measured status only where available.
- Creative: artwork grid organized by declared direction/variant. Card includes format, language, channel, review state, verification state and revision. Open a large preview with real caption, CTA and destination. Edit opens Studio; Review selected opens a review summary; declined work retains reasons/history.
- Publishing: one row per exact output/action, final thumbnail, destination/account, paid/organic type, schedule/timezone, budget, current provider state and recovery. Offer List first; Calendar is a derived optional view. Failed and confirmation-pending actions remain visible beside successful ones.
- Results: scope/window/freshness controls, spend and primary metric, delivery diagnostics, comparable creative table, Compare selection and Clinical review below. Show missing tracking, late conversion data and uncertainty where they affect conclusions.
- Activity: named proposal/creative decisions, revision summary, queued/started/blocked work, provider receipts, pause/resume, outcome settlement and lessons. Separate action time from evidence window. Human-readable descriptions link to exact source versions.
- Expired approval disables relevant future mutations while retaining fleet, results, artwork and historical actions. A newer draft cannot replace the visual identity of an already running older launch.

## 6. Creative Studio

- Route remains `/campaigns/[campaignId]/studio`. Incoming context pins bundle version, deliverable/direction and language; user returns to Creative review after save/render.
- Top bar: breadcrumb/back, output name, format/language, **Unsaved changes / Saved / Rendering / Needs changes / Ready for review**, undo/redo for local edits, primary **Save & render**, secondary **Return to review**.
- Desktop composition within the available content width: 240–280px editing rail, flexible large neutral canvas and optional 280px context inspector. Below 1200px available content width, the context inspector becomes a Sheet. Below 800px, show canvas first with accessible control tabs below. Do not force a 3-column editor into a narrow AppShell.
- Editing rail tabs: **Text**, **Image**, **Layout**. Text exposes headline, offer line, CTA and free line with original/current values. Offer and price changes show the business value and required approval change; never editable solely as image pixels.
- Image tab: selected subject/background, Change image from Library, Annotate an area, clear/remove region, short AI instruction and affected-area preview. Confirming a local edit creates a new candidate; it does not overwrite the accepted parent.
- Layout tab: approved template thumbnails, aspect/placement presets, readable available/unavailable reasons, supported alignment/crop/type choices. No full freeform canvas, arbitrary layers or arbitrary uploaded code/fonts.
- Canvas tools: fit, zoom, before/after, safe-area toggle and platform crop preview. Browser preview is immediate and labelled Preview until the authoritative render returns; do not claim pixel parity across scripts without a tested shared layout/shaping strategy.
- Context inspector: current proposal terms, selected positive references with reasons, negative rules as text, provenance and check results. Rejected images belong only in an explicit Blueprint/history inspector, never the image-generation input path.
- Checks: exact text, fit, glyph coverage, readable language/script, brand/subject checks and image-verification availability. Unknown is not pass. Refusal offers a specific action such as Shorten headline or Choose another layout.
- Save with stale version returns a conflict surface: compare current changes, reload or apply a fresh deliberate revision. Do not silently retarget edits to latest.
- Keep undo local before save. Persisted undo means a new revision restoring earlier values. Display progress as named stages, not invented percentages; cancel retains existing versions.

## 7. Asset Library

- Route remains `/organizations/[organizationId]/assets` and is usable before a campaign exists.
- Header: **Asset Library**, “Your designs, products and brand.” Primary **Upload assets** plus New folder when Creative History is active. No upload action hidden inside Campaign creation.
- Exactly three purpose tabs from ADR 0049: **Creative History / Products & Subjects / Brand Kit**. Proposed URL keys: `tab`, `folder`, `verdict`, `search`, `asset`, `version`. A verdict filter is not a folder.
- Creative History desktop: 200–240px folder tree; flexible visual grid; selected-item inspector in a Sheet so the grid keeps usable width. Folder tree collapses to a selector on narrow screens. Show All designs, Uncategorized and saved folders; tree operations respect cycle/depth validation and ownership.
- Toolbar: search; **All / Approved / Rejected / Unreviewed**; scenario/channel/format/language filters; newest/relevant sorting; clear current filters; selected count. Show count scope explicitly.
- Grid: actual finished design, readable name, type, latest version/verdict and date. Human review does not inherit from a folder or an earlier file version. Rejected designs remain visible within the library and carry reasons.
- Inspector: large contained image; metadata and confirmation state; rights; folder; version history; review history/reasons; source campaign/render; selected-as-reference receipts; comparable performance where present. Separate human brand decision from observed performance.
- Review actions: **Approve as reference**, **Reject as reference**, **Leave unreviewed** where the state machine supports it. Rejection requires registered reasons and may include a note; no automatic negative policy from an unrelated personal dislike.
- Products & Subjects: photographs plus confirmed descriptions, with human-readable missing/confirmation states. Add subject, attach photo, edit description, confirm or archive under the correct role. Synthetic depiction is explicit and traceable.
- Brand Kit: logos, approved palette, typography identity and reusable brand material, with source/version/rights. Do not infer a brand kit from random past creatives or overwrite saved identity from an AI description.
- Upload flow: choose files → local preview and purpose → folder/scenario/rights → per-file upload/finalization → metadata review. Multi-file progress identifies each file by a client-generated local ID, not filename alone. Same-named files and partial success must remain distinguishable.
- Completed Studio renders enter Creative History as **Unreviewed** with source linkage. Raw plates stay in Campaign/subject contexts and cannot silently become finished designs.
- Replace file creates an immutable new version and resets its review eligibility. Archive affects future selection, preserves receipts and is reversible. Delete is not the default correction action.

## 8. Responsive, accessible and failure acceptance

- Prototype and production verification widths: 1440, 1280, 1024, 768, 390 and 320px. Verify available content width inside the real AppShell, not only a full-width isolated component.
- No page-level horizontal overflow. Wide comparison tables may scroll in a labelled region with a readable compact alternative; artwork remains contained.
- Keyboard: tabs, filters, gallery item opening, multi-select, review, file selection, inspector, undo/save, schedule and dialogs. Focus returns to the initiating item after close. Announce mutations and loading with restrained live regions.
- Touch and keyboard users need a non-drag path for region editing and folder operations. Preserve Arabic RTL text and Malayalam shaping; use `dir=auto` on user text rather than flipping the entire shell.
- Respect reduced motion; no decorative animation around running work. Progress reflects saved stages and remains understandable after reload.
- Verify no data, one campaign, no art, expired private preview, partial upload, failed finalization, stale version, reviewer/viewer, two simultaneous editors, no Meta connection, unknown provider result, delayed metrics, expired approval and inconclusive outcome.
- Inspect console errors and failed requests. Capture screenshots for each workspace at desktop/mobile and for the proposal approval, Studio edit, library upload, unknown publish, confirmed pause and clinical comparison states.
- Design acceptance is separate from authenticated workflow, hosted RLS and controlled provider evidence. A static prototype never proves production completion.
