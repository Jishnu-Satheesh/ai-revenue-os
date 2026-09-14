# Campaign experience — browser verification

Date: 2026-09-14
Organization: `2dda45b8-82db-4f5f-b17d-611b9bbb7846` (Al Noor Kitchen), staging data
Surface: local dev server, Chrome via chrome-devtools MCP
Compared against: `docs/superpowers/plans/2026-09-12-campaign-experience-visual-contract.md`
§4 (portfolio) and §5 (detail), and the prototypes in `.superdesign/campaign-experience/`.

## What was exercised

Both real campaigns in the organization, at 1440px and at an emulated 390x844
phone viewport. `resize_page` floors at the Chrome window minimum of 500px, so
the phone width is reached with `emulate` and a device viewport, not by resizing.

| Surface | 1440 | 390 |
| --- | --- | --- |
| Portfolio | `2026-09-14-portfolio-1440.png` | `2026-09-14-portfolio-390.png` |
| Detail — Overview | `2026-09-14-detail-overview-1440.png` | — |
| Detail — Publishing | `2026-09-14-detail-publishing-1440.png` | `2026-09-14-detail-publishing-390.png` |

All five detail tabs were opened by click and by direct URL. Each writes `?tab=`
and each is reachable as a deep link. Creative, Results and Activity render
their real content or a named empty state. No console errors or warnings on any
page.

## Matches the contract

- Portfolio header, the three entry points, the attention strip with a count
  over every campaign and a capped preview, the status filter pills, the
  search box and the gallery/list toggle.
- Detail header (title, objective · phase · last saved, primary action), the
  connected phase strip in the contract's vocabulary, five tabs, and the
  two-column Overview with the Next action / Two-gate approval / Sources rail.
- The Publishing dispatch table's six columns in the contract's order, with an
  organic action's budget rendered `—` rather than a currency zero.

## Defects found in the browser and fixed

**The portfolio would not link the one campaign that most needed explaining.**
A card whose campaign had no proposal rendered its title as plain text, on the
stated grounds that the detail route "would render nothing". Opening that route
directly disproved it: the page names whether the campaign is still being built
or whether generation stopped, which is exactly what somebody looking at a
stalled card wants to know. The attention strip had been linking the same
campaign all along, so two surfaces disagreed about the same record. Titles and
artwork now link unconditionally. A campaign with a run still in flight gets a
link labelled plainly "Open" rather than the phase's next action, which would
have read "Generate the proposal" and invited a second, racing run.

**The tab bar was hand-rolled and did not match.** `TabsList` already ships a
`line` variant — underline tabs, `bg-primary` rule, `data-active:text-primary`.
Overriding the default variant by hand instead left the triggers' `flex-1` and
border in place, so five tabs spread across the full width with a boxed active
state. Switched to `variant="line"` with `flex-none`, which is what the
prototype shows.

## Widths

At 390px the document does not scroll horizontally. Two elements are wider than
the viewport by design, each inside its own scroller: the dispatch table
(768px in a `overflow-x-auto` container) and the tab bar (421px). Both were
confirmed scrollable. The phase strip wraps to two rows and its decorative
connectors drop out, so no rule points at nothing.

## Not verified here

- Publication authorization end to end. The screen states plainly that the
  composer for the terms does not exist yet, so there is no control to exercise.
- Any provider dispatch. No channel is connected for this organization, so every
  row reports `Blocked` with the real reason.
- A campaign in `Scheduled / Live` or `Results & learning`. Neither campaign in
  this organization has reached those phases, so those strip positions and the
  Results tab's populated state are covered by unit tests only.

---

# Creative Studio — browser verification

Date: 2026-09-14. Same organization and campaign, same method.
Compared against visual-contract §6 and `.superdesign/campaign-experience/03-studio-1440.png`.

Proof: `2026-09-14-studio-1440.png`, `2026-09-14-studio-390.png`.

## What was exercised, live

- The three-column composition: editing rail, canvas, context inspector. With the AppShell
  sidebar the content is ~1120px at a 1440px window, which is below the contract's 1200px
  threshold, so the inspector is correctly a Sheet at that width rather than a third column.
  It becomes a column only at `2xl`.
- **The preview.** It places the campaign's real Malayalam headline into the template's own
  text box, wrapped by `fitTextToBox` — the renderer's own shrink-to-fit rule — over the real
  plate. Editing the headline re-wraps it live: a shorter headline moved from three lines to
  two. It is labelled Preview, with a sentence saying sizes land close to the finished poster
  and not identical to it.
- **Undo.** Typed 18 characters into the headline in one burst, clicked Undo once, and the
  approved text came back. Undo then correctly disabled and the state pill returned to Saved.
- **The language check.** See below.
- Text / Image / Layout tabs, the state pill, Return to review, and the adaptive primary
  button (Render this poster when the approved words are untouched, Save changes once they
  are not).
- 390x844: no horizontal overflow, single column, canvas above the controls as §6 requires.

## Defects found in the browser and fixed

**Nothing warned that the words and the chosen language disagreed.** The header read
"English" while the copy was Malayalam. The language picker chooses which font draws the
poster; the copy is whatever the approved manifest holds, and nothing stopped those
disagreeing. Drawing Malayalam with the Latin face is the exact failure the renderer spike
recorded — seven empty boxes, no exception, a plausible measured width. `findUncoveredGlyphs`
catches it from the font's cmap, but only after the render has been queued and spent.

Added `src/domain/campaigns/script-detection.ts`, which answers the one question Unicode
block membership settles on its own: which writing systems are present in a string. The
Studio now warns before the render and offers the language that would work. It is
deliberately a mismatch detector and never a coverage check — a block-range approximation
that returned "covered" would be a green tick nobody earned. It can fire; it can never clear
anything.

**Undo was per-keystroke.** Reverting a headline would have meant clicking Undo forty times.
Typing is now coalesced into one history entry per burst per field, and editing after an undo
discards the redo branch rather than leaving Redo pointing at a draft that no longer follows
from what is on screen.

## Deliberate divergences from the contract, with reasons

**No single "Save & render" button.** §6 names one. Editing approved copy writes a *new
version* through `/edits`, and rendering draws *one* version through `/renders`. Chaining
them client-side would render against a version whose assets this page has not read, which is
how the wrong picture ends up under the right words. The button therefore says which act it
is about to perform, and a save routes to the version it created.

**The offer line is not an input.** §6 lists it among the Text tab's fields. The manifest
holds no governed short offer sentence — `lockedOfferRef` is an internal key, the brief's
offer text never reaches the manifest, and the only money-typed fields are advertising spend
ceilings. A text box there would be the one place in the product where somebody could type
"50% off" onto artwork nobody approved. It is shown with its reason instead, which serves
§6's own rule that offer changes must never be editable solely as image pixels.

## Not verified here

- A completed render. Queueing one needs a worker; the Posters/verification panel therefore
  shows its honest "Nothing checked yet" state, and before/after is correctly not offered
  when there is no "after".
- The stale-version conflict surface. It is unit-tested and its trigger is a concurrent write
  to the same version, which this session could not stage against shared staging safely.
