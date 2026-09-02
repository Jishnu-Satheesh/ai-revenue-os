# Feature Specification: Public Landing Page

## Status

Done — shipped 2026-08-26. Walkthrough CTA currently points at a placeholder mailto
(`walkthroughs@airevenueos.com`); replace with the live address in
`src/components/marketing/content.ts` when confirmed.

**Rebuilt 2026-08-26 (approved Linear-informed revision).** The three mid-page sections were
rebuilt to match the approved design direction more closely: every section now carries a
code-rendered visual anchor — a FIG 01–03 vignette trio in Capabilities, a gantt-style timeline
strip in How-it-works, and an approval-receipt audit card in Governance — and sections use
asymmetric left-headline splits with muted mono eyebrows; color is reserved for semantic/data
accents inside the artifacts and for CTA buttons. Hero, nav, closing CTA and footer are unchanged.
Motion (scroll reveals, chart draw-in) is an approved fast-follow and will amend the
"no client-side animation libraries" constraint in scope when it lands.

## Business outcome

A prospective client who lands on the product domain understands within one scroll what AI
Revenue OS does, why it can be trusted with consequential revenue decisions, and has one obvious
way to book a walkthrough. Today the root path shows nothing to strangers: signed-out visitors
are bounced into authentication with no explanation of the product.

## User stories

- As a **prospective client**, I visit the root URL and understand what the platform does, see
  what the product actually looks like, and can request a walkthrough without an account.
- As an **invited team member**, I arrive at the root URL, recognize this is my workspace, and
  reach the sign-in page without hunting for it.
- As a **signed-in user**, I land where I always landed — my most recent organization — and the
  public page never flashes in front of me.

## Design direction

Approved synthesis: **Linear's restraint** (layout, typography, quiet confidence) + **Mercury's
trust choreography** (realistic product preview, trust signals near CTAs) + **Ramp's quantified,
estimate-labeled copy** + **Anthropic's editorial voice** for how the AI decides.

Binding constraints from `context/13-ui-ux-context.md`: neutral canvas, indigo primary,
`--font-sans` (Manrope, already shipped by the root layout), shadcn/ui primitives only, semantic
tokens only, calm-not-flashy personality. No dark-gradient AI clichés.

**No raster/generated imagery.** The hero visual is a code-rendered product mock — an opportunity
card showing evidence, cost, an explicitly labeled estimated profit range, and an approval state —
built from the same primitives the product interface uses. It stays crisp at any density and never
claims pixels the product cannot produce.

## Scope

### In scope

- Auth-split at `/`: session present → existing resolver redirect (behavior unchanged); no
  session → landing page.
- Single long-form landing page composed of: sticky minimal nav, hero with code-rendered
  opportunity-card mock, capability trio, how-it-works sequence, governance/trust strip, closing
  CTA, footer.
- Page-level metadata and Open Graph tags (static; title/description already partially exist in
  the root layout).
- Primary CTA "Book a walkthrough" pointing at a mailto link (address confirmed at
  implementation); quiet secondary "Sign in" → `/login`.
- Unit tests for the split behavior and per-section render tests.

### Out of scope

- Pricing, blog, changelog, about/security pages, CMS, i18n, analytics/telemetry scripts.
- Any backend: no form endpoint, no database writes, no migrations, no new dependencies.
- Theme switcher; the page uses the application's existing tokens under the default theme.
- Changes to `(platform)` or `(auth)` routes, layouts, or middleware.

## UX flow

1. Unauthenticated visitor opens `/` → landing page renders server-side.
2. Authenticated user opens `/` → `resolveLandingPath` redirect exactly as documented in
   ADR 0015. No landing flash.
3. Nav CTA and closing CTA open the walkthrough mail link; nav "Sign in" routes to `/login`.

## Domain rules

- No fabricated customer counts, logos, testimonials, or realized-result claims anywhere on the
  page. Forward-looking numbers appear only as ranges explicitly labeled "estimated".
- Product language reuses the platform's own vocabulary: Digital Twin, opportunities, approval,
  incremental gross profit, evidence.
- The page is industry-neutral in its claims; the restaurant pilot may flavor the example card
  because the Industry Pack exists, but no section addresses restaurants only.

## Data model

None. The page reads nothing but the auth session.

## API and events

None.

## AI behavior

None.

## Security and tenancy

- Session detection through the existing server Supabase client (`createClient()`), identical to
  the current root route. No service role, no RLS surface, no tenant data rendered.
- If the session read fails, the route renders the public landing rather than throwing — a failed
  auth probe must not break the one page strangers see.

## Observability

None added. A static page has no failure modes worth instrumenting beyond Next.js defaults.

## Failure states

- Auth probe failure → landing renders (see above).
- Mail client absent on visitor machine → the CTA also exposes the raw address as copyable text.

## Copy skeleton

- Eyebrow: `Revenue intelligence for client businesses`
- H1: `The operating cockpit for measurable client revenue.`
- Subhead: `AI Revenue OS builds a living twin of every business you serve, surfaces the safest
  high-value action each day, and measures what actually moved gross profit — with a human
  approving every consequential step.`
- Capabilities: `See every business clearly` / `Act on ranked opportunities` /
  `Prove what worked`.
- How it works: `Twin → Opportunities → Approval → Measurement`.
- Governance strip: `Advise freely, execute narrowly` — human approval gates, complete audit
  trail, tenant isolation, policy-bounded execution.
- Closing H2: `Know exactly what to do next.`

Final wording is reviewed by the user at implementation before ship.

## Acceptance criteria

1. Signed-out visit to `/` renders the landing page at desktop (≥1280px) and mobile (~390px)
   widths, verified in a real browser.
2. Signed-in visit to `/` redirects via `resolveLandingPath`; existing test coverage updated and
   green.
3. No fabricated metrics or testimonials; every number on the page is either the product name or
   an estimate labeled as such.
4. All controls are shadcn/ui compositions; colors come from semantic tokens only.
5. Lighthouse accessibility audit passes with no critical issues on the landing route.
6. `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` all pass.

## Test plan

- `src/app/page.test.ts` extended: mocked resolver still consulted when a session exists;
  landing rendered when none does; auth-probe failure falls back to landing.
- Each marketing section component gets a focused render test asserting its heading and key
  copy exist.
- Tenant isolation: not applicable — the page renders no tenant data; asserted by the absence of
  any data fetch besides the session probe in review.

## Migration and rollback

None. Pure presentation plus one modified route file. Rollback is `git revert`.

## Documentation updates

- `context/05-module-map.md` — add the landing surface under Experience.
- `README.md` — one line noting the public landing page and the auth-split root.
- No ADR: routing semantics remain exactly those of ADR 0015; no durable decision is introduced.
