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
