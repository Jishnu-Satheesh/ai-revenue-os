# Task 8 visual review — Overview growth (V01/V02/V09)

Date: 2026-09-19. Worktree `.worktrees/governed-channel-intelligence`, branch
`feat/governed-channel-intelligence`. Frozen references untouched (hashes
re-verified below). No credentials, URLs, payloads, or prompts in this file.

## 1. Frozen references (never regenerated, never replaced)

- `.superdesign/overview-growth/approved-behind.png` — 887a0205… (1672x940)
- `.superdesign/overview-growth/approved-ahead.png` — 0a1e4d59… (1673x940, the
  one-pixel width difference is original per REFERENCE.md)
- Rendered browser shots are SECONDARY at most. Reviewer decision (below):
  CLOSE MATCH, originals stay authoritative, no adoption of browser baselines.

## 2. How the browser evidence was produced

- Spec: `e2e/overview-growth.visual.spec.ts` (7 tests, all pass, exit 0).
- Fixture catalog + frozen presentation: `e2e/support/overview-growth-fixtures.ts`
  (locale en-GB, timezone Asia/Dubai, deviceScaleFactor 1, light, fonts settled
  + 500ms fixed settle; no clock dependence — fixtures carry fixed Sep 2026 dates).
- Render path: the Task 6 harness procedure — committed non-executing copy at
  `.superdesign/overview-growth/browser-harness/temp-route-page.tsx`, temporarily
  copied to `src/app/overview-growth-harness/page.tsx` with two local-only
  states added (`failed-retained`, `failed-initial`), served by the already
  running worktree `pnpm dev` on :3000, then DELETED. `git status` after the run
  shows no `src/app` harness route (production import/route check, final-report).
- Artifacts (this task, `task8-` prefix; `task6-*` files from Task 6 untouched):
  `task8-behind.png`, `task8-ahead.png`, `task8-behind-side-by-side.png`,
  `task8-ahead-side-by-side.png`, `task8-behind-overlay.png`, `task8-ahead-overlay.png`.

## 3. Measured anchors (real Chromium, canonical 1672x940)

| Anchor | Behind | Ahead | Delta | Tolerance | Verdict |
|---|---|---|---|---|---|
| Card width / left | 1550px / x=63 | 1550px / x=63 | 0 | outer ±2px | PASS |
| Title size / weight | 26px / 700 | 26px / 700 | 0 | type ±1px | PASS |
| Divider x (offset in card) | 1120.875 (1057.875) | 1120.875 (1057.875) | 0 | divider ±2px | PASS |
| Series strokes | #08785A projected, #2563EB current | identical | 0 | exact token colors | PASS |
| Projected dot cx/cy (first 4) | 230.4/247.6, 433.9/184.1, 637.3/111.6, 898.9/30 | byte-identical | 0 | line/dot ±0.5px | PASS |
| `data-projection-digest` | fixture-digest-september-2026-v1 | identical | — | reload identity | PASS |

The projected series is pixel-identical between states in the browser, matching
the unit-level byte-identity pin (`home-revenue.test.tsx`).

## 4. Overlay review (every non-arithmetic deviation)

- Structure coincides: card, horizon pills, summary pair, two-line chart with
  7/14/21/30 Sep ticks, Latest-report boundary, right rail, footer identity
  line. All measured deviations are 0 (table above).
- Remaining visible doubling in overlays is font-metric/antialiasing difference
  between the generative PNG and browser text (not geometry): label glyphs
  render at the same positions with different rasterization.
- Screenshot-environment chrome OUTSIDE `#home-revenue` (dev-overlay dot
  bottom-left, bubble bottom-right of the viewport) is excluded from the
  comparison; it is not product UI and never enters a baseline.

## 5. Reviewer decision

CLOSE MATCH on both states. Browser renders are recorded as secondary evidence
only (maxDiffPixelRatio gate ≤0.005 retained for any future adoption — no
adoption in this task). The approved PNGs remain the single visual authority;
no original was modified, and no browser baseline replaces them.

## 6. Explicit non-claims

- Fixture rendering is not live-data acceptance and not authenticated
  acceptance. Live populated comparison needs eligible fresh reports or a
  designated test tenant (final-report § live gates).
- Full-route sidebar expanded/collapsed at 1440 is a retained live gate
  (functional-review § V09); the harness renders the isolated card only.
