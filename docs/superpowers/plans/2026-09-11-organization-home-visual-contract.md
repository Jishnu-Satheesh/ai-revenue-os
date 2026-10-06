- **2026-09-11 revision pending:** The user now requests a revenue metrics/current-course-versus-potential section first, with action contribution shares on its right. Campaigns and the other planned sections follow below. Revenue headline is confirmed; profit is separate where supported. Read `docs/superpowers/specs/2026-09-11-organization-home-growth-feasibility.md`. The earlier campaign-first prototype, screenshots and ZIP do not include this addition. This document remains reference material for the lower sections; do not execute the old handoff unchanged. The calculation model and revised full execution plan are not yet approved.

# Organization home: visual and interaction sign-off

- **Read with:** organization-home design and data contract dated 2026-09-11. The prototype fixes visual intent; this file fixes production adaptations. Do not redesign while implementing.
- **Reference:** `.superdesign/organization-home/prototype.html`, `desktop.png`, `tablet.png`, `mobile.png`, `asset-detail.png`, `new-organization.png`.
- **Canvas:** https://superdesign.dev/teams/c3d56832-bb79-49b6-910a-6450fc30e0a4/projects/8393ba3e-6abf-458c-a693-bac68f26161b?node=draft-variant-7950207a-e504-4ee6-82a8-b86aa05b2464
- **Interactive preview:** https://p.superdesign.dev/draft/7950207a-e504-4ee6-82a8-b86aa05b2464
- **Meaning of exactness:** match hierarchy, proportions, text sizes, image handling and controls; customer text/art and the existing shell naturally differ from the fixture. Never force an overflowing title or inaccessible color to match sample pixels.

## Production geometry

- Home root fills the existing shell's available content width. No additional outer page padding; the existing shell already provides 16px below 640 and32px above, with 32/40px top padding. Give the home root `container-type:inline-size` for responsive composition.
- Home content width >=960px: primary `minmax(0,1fr)` + 288px rail; gap 28px. Campaign cards2 columns, gap 14px; covers204px tall. Gallery4 columns gap 12px, thumbnails143px tall.
- Home content width 760–959px: primary `minmax(0,1fr)` +250px rail; gap 22px. Campaign covers170px; gallery2 columns with 165px thumbnails. This is based on **available content width**, not assumed sidebar width.
- Home content width 560–759px: single main column; campaigns2 columns with 215px covers; gallery4 columns with 140px thumbnails; attention+goals2 columns, gap 24px, after the gallery.
- Home content width 328–559px: single column; campaigns2 columns gap 10px and147px covers; gallery2 columns gap 12px with 170px thumbnails; attention and goals stack. Action buttons share a row only if their labels fit.
- Home content width <328px: campaigns1 column with 220px covers; gallery2 columns with 140px thumbnails; header action buttons stack full width. This explicitly handles the320px viewport failure found during prototype verification.
- At content widths below 760px, Around-your-business destinations use2 columns; otherwise4. An odd number or a gate-hidden destination leaves no blank placeholder cell. Activity uses3 columns at >=760px, otherwise a vertical list.
- Primary section-to-section gap 30px. Main grid begins28px below the organization context divider. Masthead details divider spacing24px. Rail attention padding 20px, goal top gap 22px. Workspace/activity are separated with 1px neutral rules, not large raised cards.
- Actual viewport checklist:1920,1440,1280,1024,768,390,320px. Test with sidebar expanded and collapsed where supported; production container-based reflow deliberately improves on the prototype's mocked viewport-based sidebar.

## Typography and controls

- Use inherited Manrope; no new font dependency or Google Fonts request in application code. h1 32px/1.25, weight 800, letter spacing about-1px; narrow content h1 25px. Long names wrap.
- Section headings19px, weight 700, letter spacing-.4px; small rail heading16px. Card title15px desktop,12–14px narrow. Body13–14px; supporting copy12px. Metadata may be11px; avoid copying prototype9px fixture captions into production for essential state.
- All status/CTA text must meet contrast requirements against its actual semantic background. Use `text-foreground`, `text-muted-foreground`, `text-primary`, semantic amber text where supplied. If muted text fails contrast at small sizes, strengthen it rather than reducing font size.
- Buttons use installed shadcn `Button` styles, minimum 38px desktop/44px touch target; secondary border1px, radius7–8px. Small text links may have transparent padding to reach44px on touch without visually enlarging text.
- Neutral card background and borders, radius12px; subtle hover border/shadow only. User images bring brand colors. Do not sample colors from an image to recolor UI controls or add a new organization theme.
- Icon mapping: Waypoints for platform/channel; Megaphone for Campaigns; Images/ImageIcon for library/fallback; Sparkles for Growth; BrainCircuit for Memory; Cable for Integration; MapPin for locations; Clock for timezone/context; Target for goals; SlidersHorizontal for management; Plus for create; ArrowRight for onward navigation.
- Images: contain, intrinsic dimensions, neutral frame, no clipping, rotations, decorative marks over customer content, or image stretched to fill landscape. Labels sit in the surrounding frame, not over essential poster text. Gallery button has explicit accessible name even when its img alt is empty to prevent repeated narration.
- Motion: border/shadow transition160ms. No position/rotation animation. Under prefers-reduced-motion, transition none. No content auto-scroll or automatic carousel.

## Visual inventory and acceptance IDs

- **V01 — Shell and masthead.** Existing shell and Overview breadcrumb intact; one h1 organization name; real/eligible logo or name-only layout; saved description; no prototype selector or fictional org identity. Manage and New campaign align right when space permits and stack at narrow widths.
- **V02 — Organization context.** Saved status, active locations, timezone, currency; divider before campaigns. Location count opens the read-only location Dialog. Branchless and zero states are distinguished. Organization status chip is not business health.
- **V03 — Campaign composition.** Two primary cover cards and optional third compact row; no filling gaps with duplicate records. Section All campaigns destination remains clear. First viewport at 1440 should show the masthead and both primary campaign cards, with library beginning below them.
- **V04 — Campaign cards.** Exact current state, objective if saved, absolute update date and CTA; title and next action readable without hover. Artwork source label remains clear when raw generated image is the fallback. No-version row is a named compact campaign, never an endless spinner or broken detail link.
- **V05 — Artwork integrity.** Full poster visible via contain; no production fixture angle/crop. Preview unavailable retains status, title and action. Approved reference visual treatment must not imply approved campaign, rendered poster or published ad.
- **V06 — Attention.** Warm/neutral subdued surface, not an alarm wall. Named records and concrete reasons. `N shown` count, maximum 3; explicit partial-check wording. Viewers see informational/read wording. Permission-blocked repairs are not offered as actions.
- **V07 — Focus goal.** One saved organization goal, target/unit and deadline. Read-only View goals dialog lists all goals and scope. No fabricated progress bar or timeline. No org goal gets a useful prompt without erasing branch goals.
- **V08 — Creative shelf.** Four-or-fewer thumbnail buttons; title, source kind, review state. Source metadata can extend card height; don't clip to one line. Asset Library link always reaches the actual library for allowed users, even when no thumbnails exist.
- **V09 — Asset details.** shadcn Dialog max-width 780px; desktop image/details two equal columns gap 26px, padding 24px, image310px high contained. Below640px viewport: one column, padding 18px, image245px, primary source button full width. Scroll within the dialog if taller than viewport; close control always reachable.
- **V10 — Read-only details.** Dialog title, description, organization name, recorded date, source and review label; source CTA uses exact campaign version or existing `/assets`. No approve/archive/download/generate controls added. Source destination is an actual link, not the prototype's explanatory modal.
- **V11 — Around your business.** Compact icon/title/description navigation summaries. No fake counts, active connection dot or result claim. Hidden destinations reflow based on permission/gate; static entry says what the workspace lets the user do, not that data was fetched.
- **V12 — Activity.** Up to5 source-backed updates; semantic label and optional authorized title, absolute date/time in org zone. On mobile stack without horizontal scroll. No unknown raw event names/payload or inferred “published.”
- **V13 — First-use home.** Preserve organization identity and available navigation. Campaign empty state offers creation only when allowed; library invites existing Asset Library use; absent goals say how to add them for authorized roles. No stock photography or sample campaign magically appears in production.
- **V14 — Error/disabled differences.** Optional-source errors remain local with Retry, partial gallery keeps surviving records, image-only failure keeps metadata. Gated sections are omitted and do not show error panels or Retry. Required org snapshot failures retain existing route error boundary.
- **V15 — Refresh.** Refresh button visibly pending/disabled during `router.refresh()`, then reflects returned state. No global blur of already-readable home; no worker execution, automatic research or silent state change. Previously cached signed images must not be persisted beyond their actual expiry.
- **V16 — Management preservation.** Header Manage points to `#organization-management`, whose original explicit open trigger and forms remain below the new home. Viewer sees no mutation control. Operator cannot gain policy/lifecycle authority. Prototype's destination dialog is not production UX.
- **V17 — Keyboard and semantics.** No positive tabindex, native links for navigation, accessible named thumbnail buttons, focus ring, focus trap/return for dialogs, Escape close, sensible reading order, reduced motion. Touch targets44px. Test Arabic/Malayalam and long names at 320px.
- **V18 — No content overflow.** At all 7 widths, page and shell main have no horizontal overflow. Sidebar remains usable and header pinned according to current shell. Long labels wrap rather than being hidden. No new nested full-page scroll region inside main.

## Reference interactions to preserve versus adapt

- Preserve: asset click -> details, goals/locations -> details, create/manage/source navigation, transparent source/review labels, local error/empty states.
- Replace prototype destination explanation modals with real internal links; do not implement mock success messages.
- Replace fictional fixture dates/names/wordmark/artwork with authorized persisted values. Asset source labels use the data contract even if longer than the sample.
- Remove prototype review dropdown and its simulated Retry behavior; production Retry performs a server refresh. Remove “Design review,” fixture explanatory footer and any prototype-only link IDs.
- Keep illustrative SVG art only in this handoff package. It is not a brand asset, campaign output, testimonial, or real customer image.

## Visual verification record

- Prototype browser command: `node .superdesign/organization-home/verify.cjs`.
- Current prototype checks cover7 viewport widths, image load, dialog/focus/keyboard, viewer actions, no-version destinations, empty/partial/image failures, reduced motion and runtime errors.
- `verification.json` is the authoritative latest prototype result. Source application and RLS acceptance must be recorded separately during implementation; do not rename prototype checks as end-to-end product verification.
