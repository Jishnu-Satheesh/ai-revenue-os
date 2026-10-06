# Overview growth — visual and interaction contract

## V00 — Authority and scope

- Read specs/027-overview-growth-progress.md, the data contract, and .superdesign/overview-growth/REFERENCE.md first.
- Reproduce approved-behind.png and approved-ahead.png. Do not use the rejected large-number/bar-chart designs.
- Replace only the HomeRevenue section, its scoped styling and its data integration. Preserve the surrounding organization masthead, sidebar, campaigns, assets, organization management and their permissions.
- Keep id=home-revenue and accessible section name “Current vs projected growth”.
- Use the installed shadcn Card, Button, Dialog, Separator, Skeleton and Alert compositions. No global primitive restyling, font change, new design library or chart dependency.
- Keep Manrope. Heading and numeric hierarchy must remain restrained. No headline larger than the organization name; no hero marketing language, oversized currency display, nested metric cards, shadows on the main card, coloured advice background, decorative arrows, area fills, pulsing dots or automatic animation.

## V01 — Frozen reference geometry

- Canonical visual fixture canvas: 1672 × 940 CSS pixels, device scale 1, browser zoom 100%, light mode. Reference card rectangle: x=63, y=90, width=1550, height=792; radius=16. Tolerances for these outer anchors: ±2 CSS pixels.
- The ahead source canvas is 1673 pixels wide. Align card top-left, not whole-image centre, when comparing it with the canonical 1672 browser frame; tolerate the original extra rightmost pixel only.
- Canonical header bottom: y=199; body bottom/footer top: y=815; card bottom: y=882. Header height=109, body=616, footer=67.
- Canonical advice divider: x=1121, so left body width=1058 and advice width=492. Use a 68.25% / 31.75% grid at the canonical width. This measured ratio overrides earlier conversational 70/30 or 72/28 approximations.
- Canonical title top-left: x=93, y=113. Subtitle begins around y=158. Header horizontal padding=30; vertical padding=22.
- Summary row left padding=30, top padding=38; first legend at x=103, y=249; first value top near y=272. Second summary begins at x=553; separator x=485, y=242..323.
- Chart descriptive label begins x=93, y=384. Plot anchors: left axis x=149, rightmost data point x=992, plot top y=437, zero baseline y=710. Chart right label room extends to x=1090. Advice begins x=1162, y=240.
- Plot/date label positions are calculated from actual dates and values. AI raster point placement is approximate: mathematical scale takes priority over reproducing a misplaced pixel. No arbitrary x indexes for irregular dates.
- Reference overlay label “Design preview · Illustrative data” is fixture-only, outside the card. It never appears in production.
- In the real route the card sits in the existing home flow; do not apply the fixture's x=63/y=90 page offsets to the application.

## V02 — Typography and tokens

| Element | Canonical wide size / line-height / weight | Normal desktop size / line-height / weight |
|---|---|---|
| Section title | 26 / 34 / 700 | 20 / 28 / 700 |
| Subtitle | 17 / 24 / 400 | 13 / 20 / 400 |
| Summary labels | 17 / 24 / 400 | 13 / 20 / 400 |
| Summary values | 30 / 38 / 700 | 28 / 34 / 700 |
| Chart labels and values | 16 / 22 / 500 | 12 / 18 / 500 |
| Advice eyebrow | 13 / 20 / 600 | 11 / 16 / 600 |
| Advice title | 26 / 34 / 700 | 20 / 28 / 700 |
| Advice gap amount | 28 / 36 / 600 | 22 / 30 / 600 |
| Advice row title | 19 / 27 / 500 | 14 / 21 / 500 |
| Advice supporting text | 17 / 25 / 400 | 12 / 18 / 400 |
| Footer/hint | 15 / 22 / 400 | 12 / 18 / 400 |

- Canonical wide rules apply at card width ≥1440. Normal desktop rules apply below 1440. Use discrete container-query tokens; do not scale an entire component using transform.
- Main text: existing foreground token; secondary text: muted-foreground. Card background: card. Header tint: primary at 5% over card. Border/dividers: border, 1px.
- Introduce only section-scoped series colours: current #2563EB, current text #173F83; projected #08785A, projected text #08785A. They intentionally distinguish actuals from estimates; do not recolour the app globally. These accessible tokens take precedence over incidental raster colour noise.
- Current line: solid 3px; projected line: dash 7px/gap 6px, 3px. Current dots: radius 5, filled current, white 2px border. Projected dots: radius 5, white fill, projected 2.5px border. Colours plus dash/dot treatments distinguish lines without relying on colour alone.
- Use tabular numerals. Full amounts use formatWholeMoney; compact chart amounts use locale-aware k/M labels with enough precision to distinguish different points. Never round two different adjacent values to an identical visible amount without the full-value tooltip.
- Dark mode: use existing surface/text tokens and scoped current #79A8FF / projected #69CFAC. Preserve contrast and geometry. Dark screenshots are adaptations, not approved PNG references.

## V03 — Responsive dimensions

| Card width | Layout | Padding | Chart / body behaviour |
|---|---|---|---|
| ≥1440 | 68.25% chart / 31.75% advice | 30 left/header, 40 advice | Canonical 792px card with sparse fixture; chart region fills remaining body |
| 1100–1439 | 68% / 32% | 24 header/chart, 24 advice | Header 96px; body min-height 500px; plot 260px plus labels; footer min-height 56px |
| 900–1099 | 65% / 35% | 20 | Same order; body min-height 500px; plot 260px; right rows wrap |
| 560–899 | Stacked: chart then advice | 20 | Header wraps only if needed; chart 280px; advice horizontal top border |
| <560 | Stacked | 16 | Title 18/26; values 22/30; two summary columns; chart 230px; footer stacked |

- Width means the card's container, not viewport. Respect the existing home container and sidebar.
- At 390px viewport, test sidebar collapsed and content width actually available. At 320px viewport, no body/document horizontal overflow. Do not shrink controls or force 1550px content into a phone.
- Below 560: title/subtitle row first, selector second; summaries remain two columns with 12px gap. “Current” and “Projected” may put the date on their own second line. Never truncate amounts or period bounds.
- Below 560, show point-value labels for the selected/latest comparable date and final projection; other values remain accessible by tap/keyboard. Show 3–4 x ticks; preserve first, latest observed, last. Advice retains two rows; no carousel.
- On stacked layouts advice min-height is content-driven, with 20px vertical gap after chart. Footer wraps its text and puts the method control on the next row. All tap controls have at least 44×44px interactive area.
- Long real recommendation titles wrap to at most three visible lines; use an accessible full title in the details view. Do not add a scrollbar inside the advice rail.
- Never use screenshot scaling as a substitute for responsive layout.

## V04 — Header, summaries and chart

- Exact title: “Current vs projected growth”.
- Subtitle: “Revenue this month · September 2026” ONLY for a whole calendar month. Rolling ranges: “Revenue over this period · 19 Sep–18 Oct 2026”. 3/6/12M: print exact start/end dates. Currency belongs beside the chart measure.
- Selector labels remain 1M, 3M, 6M, 12M; aria-labels spell out months. Selected state uses the existing secondary button treatment. Each selects that horizon's fixed period, not a new forecast.
- Current summary label: “Current · {comparison date}”; amount is cumulative REPORTED revenue for that date.
- Projected summary label: “Projected · {same date}”; amount is frozen central estimate; small “Estimate” text below. Range is in tooltip and the method dialog.
- Both summaries remain pinned to the latest comparable date while hovering. If no comparison exists, each explicitly names its own available date/state; do not display a mismatched pair as comparable.
- Axis measure: “Revenue so far ({currency})”. One y scale and one time scale. Four evenly spaced intervals by default (fixture 0/40k/80k/120k); use a tested nice-scale function for real data. Include zero and all actual/projection bounds; allow negative actual adjustments by expanding below zero.
- Current stops at latest fully supported observation; projected continues through its fixed period end. Never extend blue by forecast, extrapolation or forward fill. Never stretch the y-axis to exaggerate separation.
- Current and projected have independent points/values. At sparse fixture dates label every point. Use time-proportional x geometry, piecewise linear segments, no smooth curve or invented intermediate observations.
- For dense real data render all valid points, show labels at a deterministic ≤6 selected dates per series; endpoint/latest always retained. Points suppressed visually for density remain available in tooltip/table.
- Label collision rule: projected labels above by 12px; current below by 16px when blue is lower; swap blue above/green below when blue is higher. If bounding boxes still overlap, hide the nonselected interior label; do not shift point positions.
- Direct labels “Current” / “Projected” follow endpoints with 12px gap and bounded right label room. If endpoints are too close, place labels on separate rows linked to their respective dots. No clipping.
- “Latest report” dotted vertical guide sits at the latest comparable point. A bracket spans ONLY the difference between the two values on that date. Label “{money} gap” or “{money} ahead”. Hide bracket for exact equality; clamp its label within plot bounds.
- Grid: horizontal border-colour lines, light dashed 3/4; no heavy vertical grid. Future region after the last observation may use muted at 10%, never a filled area under either line.
- Low/high interval remains stored and readable; the dashed green line is the central scenario estimate, not a calibrated promise.

## V05 — Interaction state machine

- Initial: select 1M; use latest comparable date for summaries/bracket/advice. No request to an AI model on page load, hover, focus or horizon change.
- Hover nearest date: vertical crosshair and a small shadcn-styled popover/tooltip show date, Current, Projected central value, projected range, and signed difference. Use an 8px viewport inset and flip placement to avoid collisions. No big overlay panel.
- A date without current data says “Current: not reported” and has no difference. A future date never gets a fabricated current value.
- Pointer leave: dismiss transient tooltip; keep any explicitly selected point.
- Tap/click a date: pin tooltip at that date; a second tap or Escape dismisses. Summaries and right panel remain at latest report, so incidental exploration never presents today's advice as historical evidence.
- Keyboard: one focusable chart group; ArrowLeft/Right select valid chronological dates, Home/End select first/last, Enter/Space pin/unpin, Escape closes. Screen-reader text announces date, both values, range and difference once per intentional selection.
- “View data” accessible control in the method dialog exposes a real table of date/current/projected low/central/high/comparability; no chart-only access.
- Horizon change: preserve projection ID for an unchanged horizon; switch to its own stored period, update period label and comparison together, clear pinned tooltip. Announce period and latest comparison politely. No transient zero or stale comparison under a new period label.
- Pending horizon read, if server query is needed: keep prior period labelled and disabled selection pending until the complete next view is available. Never mix old advice with a new chart.
- Recommendation row: a real Link to the existing source-owned destination when supplied; keyboard focus ring visible. No click implying action execution.
- “How this is estimated” opens Dialog; focus returns to trigger on close. Display fixed issue time, period, scope, baseline sources, even-pace assumption, action assumptions, central/range explanation and revision/freshness limitations, followed by the accessible table.
- Reduced motion: all plotting static, no pulse, count-up or chart-entry animation. In ordinary mode only existing button/hover colour transitions ≤150ms.

## V06 — Right panel and copy

- “AS OF {latest comparison date}” always visible; status titles and exact amount from the deterministic comparison, not model prose.
- Behind: “Below the projection”; “{money} behind”; “{rounded percentage}% below the projected revenue”; heading “What to look at”.
- Ahead: “Above the projection”; “{money} ahead”; “{rounded percentage}% above the projected revenue”; heading “Build on this progress”.
- Inside the scenario range: “Within the projected range”; “Tracking within the estimate”; no alarming behind/ahead label just because actual differs from midpoint.
- Exact equality: “In line with the projection”; “Current revenue matches this estimate.”
- Show no percentage for zero/nonpositive central estimate; explain comparison in money only.
- At most two evidence/recommendation rows. Each has a concise source-owned title plus plain supporting link. No numbered badges, contribution bars, progress controls, or large primary button.
- Related findings are signals to review, not claimed causes of the exact gap. Planned means intent, not completed execution. Do not assert “The platform earned…” from crossing the projection.
- Relevant evidence absent: “We can see the difference, but do not yet have enough evidence to explain it.” Show available useful advice or the scoped Growth Intelligence link; do not invent an explanation.
- Restricted evidence absent: omit its title, count, href and derived reason; do not hint at confidential items.
- Footer link “View recommendations →” only when permitted; otherwise omit without inventing a replacement mutation.

## V07 — Empty, partial, stale and failure states

| State | Chart / summaries | Right panel / action |
|---|---|---|
| No original projection | Actuals where supported; green absent; “Projection not set for this period” | Named upcoming start if already frozen, otherwise explain missing inputs |
| Upcoming period | Green outlook visible; blue absent; date range explicit | “Tracking starts {date}”; no ahead/behind |
| No actuals yet | Green visible; Current “Awaiting reports” | “Waiting for reported revenue” |
| Incomplete coverage | Disconnected valid actual points; no manufactured total | “Comparison unavailable for the latest reports” plus missing-scope explanation |
| Source interval coarser than chart | Period-end points only | State available reporting grain; no daily disaggregation |
| Stale complete observation | Preserve latest valid comparison with its date | “Latest complete report: {date}”; do not call it today's performance |
| Read/refresh failure | Keep last successful displayed view, label its timestamp; initial load uses a shaped failure state | shadcn Retry; safe copy without raw provider/database error |
| No source permissions | Hide restricted row/series as data contract requires | No hidden source details in DOM or tooltips |
| Mixed currency / unresolved overlap | Do not plot a combined amount | Plain reason; source-owned review link if permitted |

- Loading skeleton reserves the card's summary, chart and rail space; no fake wavy lines or example amounts.
- Footer default: “Projection set {date} · Reports through {date} · {scope}”. Scope must state partial channel/branch coverage. Existing short assumption disclosure appears on the same surface, e.g. “Estimate assumes steady sales and the included actions.”
- Footer may wrap to a second line for required assumptions; this is an allowed data-dependent height increase. Never hide required material assumptions just to mimic the one-line fixture.

## V08 — Canonical visual fixtures

- Behind fixture period: 1–30 September 2026; clock fixed to 22 September 2026 in Asia/Dubai; latest report 21 September; AED; two channels.
- Dates: 7/14/21/30 September. Projected central values: 24,000 / 52,000 / 84,000 / 120,000 AED. These exact drawing values are an ILLUSTRATIVE view fixture, not a specification for the even-pace production algorithm.
- Corresponding projected ranges: 22–26k / 48–56k / 80–88k / 112–128k.
- Behind actuals: 18,000 / 38,000 / 60,000 / absent. Last difference −24,000; rounded midpoint difference −29%.
- Ahead actuals: 18,000 / 56,000 / 98,000 / absent. Last difference +14,000; rounded midpoint difference +17%. Green series and period identity are byte-identical between fixtures.
- Behind advice exactly matches reference: “Missed orders have increased” / “Review cancellation findings”; “Repeat-customer action is still planned” / “Review the recommended action”.
- Ahead advice exactly matches reference: “Expand the strongest channel” / “Review capacity and opportunities”; “Build on repeat purchases” / “Explore the next recommended action”.
- Fixture adapters feed a presentational view directly. They are excluded from production imports and never persisted. Domain tests separately exercise real even-pace projection arithmetic.
- Never make production data resemble these fixtures through data seeding, source rewriting or hardcoded fallback values.

## V09 — Pixel and interaction acceptance

- First reproduce both canonical reference states in a test-only fixture harness. Capture with Playwright and inspect with Chrome DevTools where available. Save harness screenshots separately under docs/verification/overview-growth/.
- Use real installed Manrope; await document.fonts.ready. Disable chart animation; freeze clock/timezone/device scale/locale. Screenshot only after data and fonts settle.
- Produce side-by-side and 50% opacity overlay artifacts against the untouched approved PNGs. Do not use a new generated image as the reference.
- Measured pass criteria: outer/major divider anchors ±2px; content anchors ±3px; type sizes per V02 ±1px; line/dot widths ±0.5px; colours exact CSS tokens; same hierarchy and wrapping at canonical fixture width; no overlap/clipping.
- Correct numerical point positions may differ from the approximate raster. Record only those differences with expected coordinates from the shared scales. This is not permission to move layout anchors.
- Raw pixel percentages against generative artwork are not a sole acceptance metric. Record masks only for text antialiasing and the declared arithmetic correction. Review every other visible difference.
- Once the implementer and independent visual reviewer accept the browser render against the frozen design, save that browser image as a SECONDARY automated regression baseline. Never overwrite or remove the original PNGs.
- Secondary Playwright baselines: screenshot maxDiffPixelRatio ≤0.005 at identical environment; no blanket full-card masks. Any new baseline requires independent review.
- Width matrix: canonical1672×940; application1920×1080,1440×1100,1280×900,1024×900,768×1024,390×844,320×800, plus sidebar expanded/collapsed at1440. Full app context and isolated card are separate evidence.
- Verify behind/ahead/within-range/no projection/no current/partial/error/long copy; tooltip at first/latest/future; keyboard traversal; 200% zoom; reduced motion; mobile touch; contrast.
- Pixel, functional, real-data and tenant-isolation checks are separate gates. A nice screenshot or green fixture suite is not live acceptance.
