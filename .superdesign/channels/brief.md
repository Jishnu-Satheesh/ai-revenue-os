# Channel landing — design review

Requested scope: redesign the Channels landing and its management dialogs; exclude the inner Channel Audit page. Deliver `prototype.html`, comparable to the Growth Intelligence artifact. No application changes.

## Design direction

- Share Growth Intelligence's Manrope typography, neutral shell, emerald actions, readable figures and visible reporting scope.
- Give Channels its own composition: an open summary strip, horizontal comparison plot with an inset coverage panel, then a compact channel directory. No four-tab advice workspace or sage performance hero.
- Make management secondary: search, evidence-state filters, categories, edit/create dialogs and a separate archived list. Preserve channel identity, category, outlet mappings, aliases and archive/restore concepts.
- Proposed presentation choices (directory search/sort and coverage dialog) are prototype interactions, not claims that the live application already implements them.

## References researched 2026-09-10

- https://linear.app/now/behind-the-latest-design-refresh — quiet navigation, stronger task hierarchy, restrained borders; adapted to the existing light shell.
- https://linear.app/now/dashboards-best-practices — match the dashboard to its purpose and lead with useful context.
- https://www.shopify.com/analytics — readable commerce metrics and channel comparisons, adapted to exact reported windows.
- https://help.shopify.com/en/manual/reports-and-analytics/shopify-reports — summary metrics with a route to detail.
- Local reference: `.superdesign/growth-intelligence/prototype.html`.

## Evidence and semantics

Read the current ChannelsPage, ChannelsManagement, ChannelsRollup, ChannelPortfolioChart, Spec 018 sections 5–6, ADR 0032 and its superseding ADR 0043. The current overview groups declared windows by month and preserves the exact range; this prototype offers two exact full-month fixtures. It does not redesign the audit calendar.

Fictional Example Kitchen, AED, two locations; no hosted database reads. February fixture: Delivery A reported 80,000, loss 4,000, earned 76,000; Delivery B reported 40,000, loss 2,000, earned 38,000; Direct reported 18,000 with loss unknown; In-store has no analysis. Reported total 138,000. Earned 114,000 and loss 6,000 cover only the two complete channels. Figures are reported-window semantics, never profit, realized uplift or guaranteed recoverable revenue. January uses separate illustrative values. No fabricated daily trend or benchmark.

## Acceptance and verification

- Responsive desktop/mobile; keyboard-operable controls and native modal focus trapping.
- Working period selector, chart metric toggle, evidence dialog, directory search/filter/sort, local add/edit/archive/restore.
- Scope changes update chart, totals and directory consistently; directory filters affect directory only.
- Missing evidence stays missing and never becomes zero.
- Channel Audit affordance explains the existing destination; it does not open a redesigned inner page.
- Reload clears local management edits; no network writes or provider connection claims.
- Capture and inspect desktop/mobile renders; exercise key interactions with the installed browser tools.

## Runtime

The HTML uses inline CSS, inline SVG icons/charts and JavaScript. It works without a bundler or CDN scripts. Manrope is requested from Google Fonts with a system fallback. No production shadcn components are changed; the standalone artifact mirrors their control geometry and must be implemented with repository primitives if approved.

Superdesign startup was slow through npm; the cached CLI subsequently confirmed authentication. This deliverable is the user-requested local HTML; no remote canvas draft was published.

## Completed verification

`node .superdesign/channels/verify.cjs` passed 26 browser checks. Covered 1440×1080, 390×844, 320×760 and 768×1024 layouts, portfolio arithmetic, period changes, search, filtering, sorting, dialogs/Escape, safe text rendering, local create/edit/archive/restore, reload reset, no-data totals, and no JavaScript runtime errors. `desktop.png` and `mobile.png` were visually inspected. Detailed check names are in `verification.json`. No application build or staging test is claimed for this isolated HTML artifact.
