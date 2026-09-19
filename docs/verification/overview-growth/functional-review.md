# Task 8 functional review — Overview growth (V07/V09, AC07)

Date: 2026-09-19. Command: `pnpm exec playwright test
e2e/overview-growth.spec.ts e2e/overview-growth.visual.spec.ts` → exit 0,
24 passed (incl. 1 expected-fail), 4 skipped. No credentials in this file.

## 1. Route protection (runs everywhere, seeded or not) — PASS

- Unauthenticated overview visit redirects to `/login` with a visible h1.
- Unauthenticated API callers get 401 with no marker leakage (`signedUrl`,
  `signed_url`, `storage_path`, `credential_reference`, `internalCause`,
  `supabase` all absent).
- Reduced-motion visitors reach the same navigable boundary.

## 2. V09 matrix, isolated harness card — PASS with 1 finding + 1 gate

- 8 widths (1672x940 canonical, 1920x1080, 1440x1100, 1280x900, 1024x900,
  768x1024, 390x844, 320x800): no sideways scrolling of `#home-revenue` at any
  width; heading stays visible. PASS.
- Keyboard: Tab-focus the 3M pill, Enter switches horizon, polite announcement
  fills `growth-horizon-announcement`, `aria-pressed` exact. PASS.
- Hover: first plotted dot opens `#growth-chart-tooltip` with the same-date
  comparison. PASS.
- 200% zoom approximation (720px CSS frame): no sideways scroll, heading
  visible. PASS.
- Reduced motion: full card renders with all dots. PASS.
- Forced colors: shaped failure copy + Retry reachable. PASS.
- Touch FINDING: a real touchscreen tap on a plotted point fires
  touchstart/touchend plus synthesized mouseenter but opens NO tooltip, while a
  mouse click on the same glyph does (`final-report.md` § Task 8 probing evidence).
  Task 7 touch coverage is jsdom fireEvent-level only. Encoded in-spec as
  `test.fail` with the finding inline; the chart fix is outside the Task 8
  narrow file map and is tracked as a follow-up, not silently dropped.
- Sidebar expanded/collapsed at 1440: harness renders the isolated card without
  the route shell — retained as an explicit skipped live gate in-spec, not
  asserted, not dropped.

## 3. Authenticated operator/viewer/nonmember — SKIPPED, gate retained

- Reason: the seeded E2E environment (`NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `E2E_INTEGRATION_ORGANIZATION_ID`,
  `E2E_OTHER_ORGANIZATION_ID`, `E2E_OPERATOR_*`, `E2E_VIEWER_*`) is absent, and
  inventing credentials or seeding the client org with PNG numbers is
  forbidden. Specs skip via `readIntegrationHubEnvironment()` with the reason.
- Live-acceptance gate stays OPEN: operator load without markers, viewer
  invariance, nonmember refusal must run against staging with the flag on
  before any live claim. Fixture rendering above is never called authenticated
  acceptance.

## 4. Neighbor suite note (not owned, not fixed)

- `e2e/organization-home.spec.ts`: 2 failed on the pre-existing peer drift
  "Sign in to Lunes AI" vs the stale `/sign in to ai revenue os/i` heading
  regex (peer login page change, same assertion fails identically in 4 other
  pre-existing specs); 16 skipped (no seeded env). Owned spec deliberately uses
  a drift-proof h1 assertion. No peer file touched.
