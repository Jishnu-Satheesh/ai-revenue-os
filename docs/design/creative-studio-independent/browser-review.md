# Independent browser review

Review started September 21, resumed September 24, 2026. Actual Chrome DevTools MCP tools were invoked through the local JSON bridge at 127.0.0.1:4318 against the static prototype at 127.0.0.1:4317/prototype.html. Interaction used snapshot UIDs with click/fill/fill_form; read-only evaluate_script measured geometry. No page-state function was invoked to simulate clicks. No provider, database or production app call was made.

## Verdict

The tested prototype flow is usable as a design reference. After this review, the user explicitly approved it on September 24, 2026 as the replacement for the missing original sketch. This remains visual approval only; it is not complete functional acceptance, provider-streaming evidence, persistent history, tenant isolation or real campaign delivery verification.

## Actual interactions observed

- Initial history: four long horizontal cards, no selected canvas, Campaigns submenu Overview → Creative Studio → Asset Library, optional No campaign, Instagram Feed 4:5.
- Exact design with no reference: Generate refuses and shows a reference requirement.
- Approved reference: opens a large preview; selecting a different library row changes preview; explicit Use reference closes picker. Product picker separately shows Products & Subjects and explicit Use product.
- Enhance: original and suggestion appear in a dialog; Apply changes Prompt while Text copy remains unchanged.
- Generate: full-screen Creating your creative dialog with stage rows and simulation disclosure, then saved Unreviewed canvas. The intermediate timed preview was not captured by this reviewer and is not counted as verified progressive streaming.
- Download: explicit notification identifies the downloaded sample SVG, not an AI-generated production image. Downloaded file bytes were not independently hashed in this design review.
- Marker: Add edit marker → instruction → Apply edits yields Revision 2, Show before, and warning that surrounding details may change. This is a simulated revision, not model/context evidence.
- History search: nonexistent query yields No matching creatives; Clear filters restores four cards.
- Existing campaign: Link campaign → Everyday essentials → Save link updates selected canvas label; no approval claim.
- New campaign: Create a new campaign opens name/goal fields. Empty name keeps dialog open and focuses the name. Supplying name and goal creates a session-only draft/link with an explicit non-publication notification.
- Mobile 390×844: Creative settings tab exposes settings and hides workspace; read-only DOM measurement confirms document scrollWidth=390. Desktop controls are not compressed into a 20% mobile rail.

## Screenshot and geometry

Desktop.png is an actual 1728×1080 viewport screenshot after the canonical-height settings correction, captured September 24 through MCP to /tmp/studio-review-desktop.png then copied unchanged because MCP refused the repository path. Reviewer opened and visually inspected this PNG.

- Settings: x288, y201, width276.796875, height855.
- Workspace: x588.796875, y201, width1107.203125, height855.
- Inter-pane gap24; exact 20/80 available-pane split; document scrollWidth1728.
- Product trigger: y927–976; Generate: y1004–1043. Both fit within1080; controls panel ends1056.
- Mobile settings capture is /tmp/studio-review-mobile.png; controller owns final companion captures/reference manifest.

## Findings and limits retained

- P2 found September21: Exact missing-reference warning remained after selecting a reference. The author corrected the state reset. Controller rechecked the final source through Chrome DevTools MCP on September24: choosing **Use reference** changed the selected button to **Objects worth keeping** and removed the warning (`staleWarning:false`). Closed.
- P2 found September24: picker order placed upload beneath library choices instead of the requested upload-first sequence. The author moved **Upload an image** above the labelled **Approved designs** list. Controller reloaded the final prototype, inspected the accessibility snapshot and captured `Reference-picker.png`; the required order and large preview are present. Closed.
- The prototype demonstrates one selected reference/product rather than the complete multi-reference/count/removal/primary-reference contract. This needs full production implementation tests; no claim of complete picker coverage.
- Upload, Keep original, all filter combinations, logo substitution, export conversion consent, expired/revoked states, full keyboard/zoom/reduced-motion matrix and selected-byte Campaign setup resolution were not exercised here.
- Session-only state, timer/blur/SVG generation and marker simulation are disclosed. They cannot establish real partial frames, exact-copy fidelity, original-context continuation or reload persistence.
- Console after final navigation contained only the Tailwind CDN production-use warning; no error was reported in that sampled console. Production must use repository styling/build tooling.
- Initial Chrome startup and concurrent-access attempts hung; serial exclusive access after startup recovered. No timeout was converted into a pass. Screenshot geometry and above interactions were obtained only after successful tool responses.

Final real poster generation, actual progressive preview display, same-model edit after reload, private download hash and full existing/new Campaign handoff remain future implementation acceptance gates in the plan.
