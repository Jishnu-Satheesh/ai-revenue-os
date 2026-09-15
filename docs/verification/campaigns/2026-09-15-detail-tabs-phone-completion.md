# Campaign detail — Publishing, Results, Activity, and a true phone width

Date: 2026-09-15
Organization: `2dda45b8-82db-4f5f-b17d-611b9bbb7846` (Al Noor Kitchen), staging data
Campaign: `5f2292f5-946d-4607-87f3-163ac0f3cdb2` ("8v confirmed-description
generation proof"), phase Review — the only campaign in the organization that
has reviewed deliverables, so the only one whose Publishing table has rows.
Surface: local dev server, Chrome via chrome-devtools MCP.

## Why this exists

The Task 11 board entry closed with the Publishing, Results and Activity tabs
and a true ~390px width recorded as **not exercised**, because the
chrome-devtools MCP dropped mid-pass. This finishes that pass.

The earlier `2026-09-14-experience-browser-verification.md` was in fact less
incomplete than the board entry claimed: it had already opened all five tabs by
click and by deep link. What it did not have was phone-width proof for these
three tabs, or any capture of Results and Activity at all. That is what is
added here. **Nothing below contradicts the 2026-09-14 findings.**

## Evidence

| Surface | 1440 | 390 |
| --- | --- | --- |
| Detail — Publishing | `2026-09-14-detail-publishing-1440.png` (existing) | `2026-09-15-detail-publishing-390-true.png` |
| Detail — Results | `2026-09-15-detail-results-1440.png` | `2026-09-15-detail-results-390.png` |
| Detail — Activity | `2026-09-15-detail-activity-1440.png` | `2026-09-15-detail-activity-390.png` |
| Detail — Activity, Technical details expanded | — | `2026-09-15-detail-activity-390-expanded.png` |

The phone width is a real 390x844 device viewport at DPR 3 with `mobile` and
`touch`, set through `emulate`. `resize_page` floors at the Chrome window
minimum of 500px and cannot reach this width — anyone repeating this pass must
use `emulate`, or they are measuring a narrow desktop and calling it a phone.

## Result: no defects found

**No horizontal page scroll at 390px on any of the three tabs.**
`documentElement.scrollWidth === clientWidth === 390` throughout, including with
the Activity tab's Technical details disclosure expanded over a 64-character
version digest.

**The Publishing table overflows its container, and that is correct.** The table
carries `min-w-[48rem]` and measures 768px inside a 356px viewport column. It
sits in its own `overflow-x-auto rounded-lg border` wrapper, which is exactly
what the responsive rule requires of a table: the table scrolls, the page does
not. Every descendant measured as "overflowing the viewport" was checked for a
scrollable ancestor; all 28 had one. A count of uncontained overflow was run on
each tab and returned 0.

**The tab strip scrolls, and Activity is reachable.** At 390px the five tabs
measure 421px inside a 358px strip, so Activity sits off the right edge on
arrival. The strip is `overflow-x: auto` and scrollable, and the capture shows a
visible scrollbar affordance beneath the tabs. Scrolling the strip to its end
brings Activity fully inside its bounds (verified by rect comparison, not by
eye). This is the same pattern as the Asset Library tab strip fix, and unlike
that case it was already correct here.

**Both empty states name what is absent instead of showing a zero**, which is
the rule Task 11 was built around:

- Results: "No result has been measured yet … Below the observed evidence tier
  the conclusion is inconclusive, not a smaller number."
- Activity: "The loop has not recorded a decision for this campaign. That is an
  empty record, not a decision to do nothing."

**Publishing states its own blockage truthfully.** Each of the three organic
Instagram actions reads `No account connected` / `Blocked` / "Nobody has
connected an account that is allowed to publish on this channel", and the
authorization panel says the composer "is not built yet, so publication cannot
be authorized from this screen. Nothing is blocked by permission here — the
terms themselves have nowhere to come from." Organic budget renders `—`, not a
currency zero.

**Deep links work.** `?tab=publishing`, `?tab=results` and `?tab=activity` each
select their tab on load.

**Console clean.** No errors or warnings across the pass.

## One observation, deliberately not changed

The header's green `Authorize publication` button stays prominent while the
Publishing tab is already open, where clicking it does nothing visible.

It is not a false promise: it is a `nextAction` with `tab: "publishing"`
(`src/domain/campaigns/phase.ts:343`) — a pointer to where the action lives, and
the destination explains why the action cannot complete yet. Suppressing it
would mean the domain declining to name the true next step, which is worse than
a button that is a no-op on one of five tabs.

**This resolves itself in Task 13**, which builds the composer for the terms a
publication binds to. Whoever does Task 13 should make this button perform the
action rather than only navigate to it.
