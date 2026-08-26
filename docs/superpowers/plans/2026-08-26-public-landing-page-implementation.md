# Public Landing Page Implementation Plan

> **For agentic workers:** Executed via subagent-driven development. One general orchestrator
> (this thread) owns shared files, composition, verification and gates; section components are
> built by dispatched subagents working strictly within claimed files.

**Goal:** A public landing page at `/` for signed-out visitors; signed-in users keep the
ADR 0015 resolver redirect unchanged.

**Architecture:** `src/app/page.tsx` stays the only `/` route and gains an in-place auth split.
All marketing UI lives in `src/components/marketing/` as server components composed by
`landing-page.tsx`. No new dependencies, no client-side animation libraries, no backend.

**Tech Stack:** Next.js App Router server components, Tailwind v4 semantic tokens,
shadcn/ui primitives, lucide-react icons, Vitest + Testing Library (jsdom).

**Spec:** `specs/021-public-landing-page.md`

## Global Constraints

- Controls must be shadcn/ui compositions only; no bare HTML controls.
- Semantic tokens only (`bg-background`, `text-muted-foreground`, `text-primary`, ...); no hex
  or oklch values in component code.
- No code comments anywhere (AGENTS.md).
- TypeScript strict, double quotes, Prettier/ESLint clean.
- No fabricated metrics, testimonials or logos. Forward-looking numbers only as estimate-labeled
  ranges. The opportunity mock is captioned "Illustrative".
- No `use client` in v1 sections; links are plain anchors / `next/link`.
- Subagents touch ONLY the files named in their task. Shared files (`content.ts`, `page.tsx`,
  `page.test.ts`, `landing-page.tsx`) are edited solely by the orchestrator.

## File inventory

| File | Owner | Purpose |
|---|---|---|
| `src/components/marketing/content.ts` | orchestrator | All copy, CTA targets, illustrative-card data |
| `src/components/marketing/content.test.ts` | orchestrator | Copy guardrails (estimate labels, forbidden phrases) |
| `src/components/marketing/marketing-nav.tsx` (+ test) | Agent A | Sticky minimal nav |
| `src/components/marketing/marketing-footer.tsx` (+ test) | Agent A | Footer |
| `src/components/marketing/opportunity-card.tsx` (+ test) | Agent B | Code-rendered product mock |
| `src/components/marketing/hero.tsx` (+ test) | Agent B | Hero composing the mock |
| `src/components/marketing/capabilities.tsx` (+ test) | Agent C | Capability trio |
| `src/components/marketing/how-it-works.tsx` (+ test) | Agent C | Four-step sequence |
| `src/components/marketing/governance.tsx` (+ test) | Agent D | Trust strip |
| `src/components/marketing/closing-cta.tsx` (+ test) | Agent D | Closing call-to-action |
| `src/components/marketing/landing-page.tsx` (+ test) | orchestrator | Section composition |
| `src/app/page.tsx`, `src/app/page.test.ts` | orchestrator | Auth split + metadata |

## Execution protocol

1. Orchestrator writes `content.ts` + guardrail test first; focused test green before dispatch.
2. Agents A–D dispatched in parallel, one per section pair above.
3. Each agent: read-first list → failing render test → implementation → focused test green →
   report files changed + honest test output.
4. Orchestrator reviews diffs, runs focused suites, composes `landing-page.tsx`.
5. Chrome DevTools verification per delivered section at ≥1280px and ~390px widths once
   composition renders on `/`; fixes dispatched back to the owning domain if needed.
6. Auth split + metadata land last; full gates: `pnpm typecheck lint test build`.
7. Docs: `context/05-module-map.md`, `README.md`. Board log updated throughout.

## Risks and rollback

- Risk: parallel agents drift stylistically → mitigated by shared tokens, shadcn-only rule, and
  orchestrator review of every diff before composition.
- Risk: unauthenticated `/` regresses for signed-in users → covered by extended `page.test.ts`
  before ship; rollback is `git revert` of the single feature commit range.

## Phase 2 — Linear-informed section rebuild (approved 2026-08-26, board row L2)

Follow-up to the v1 ship, driven by the user-approved clinical teardown of linear.app vs. the v1
page. The diagnosis: v1 asked visitors to read three consecutive text-plus-icon sections with no
product visual in any of them. The approved rebuild:

- **P1 — Visual anchor per section (the core fix).** Capabilities renders a FIG 01–03 trio of
  code-rendered product vignettes (`fig-twin-card`, `fig-opportunity-list`, `fig-outcome-row`);
  How-it-works renders a full-width gantt-style `timeline-strip` (W1–W8 ticks, four phase lanes,
  emerald fills, milestone diamonds); Governance renders an `approval-receipt` audit-trail card
  (DEC-2041, Proposed → Approved → Executed → Measured).
- **P3 — Asymmetric editorial splits.** Each of the three sections is now a giant left headline
  plus a compact right column (intro copy; numbered steps; governance items), matching Linear's
  "define the direction, then show the product" grammar.
- **P4 — Monochrome discipline.** Eyebrows and figure labels are muted mono; emerald survives only
  inside artifacts (score fills, status dots/checks, delta) and CTA buttons.
- **P5 — Motion (fast-follow, not in this phase).** framer-motion 13.0.0 is already a dependency;
  planned as thin `"use client"` wrappers (in-view reveal, chart draw-in) with reduced-motion
  support, landed and reviewed after this phase. Requires amending the spec-021 "no client-side
  animation libraries" constraint.

Files added/changed in this phase: `fig-twin-card.tsx`, `fig-opportunity-list.tsx`,
`fig-outcome-row.tsx`, `timeline-strip.tsx`, `approval-receipt.tsx` (each with its test),
`capabilities.tsx`, `how-it-works.tsx`, `governance.tsx` (+ rewritten tests), `content.ts`
(+ `capabilitiesIntro`, `howItWorksIntro`), `content.test.ts` (artifact/timeline/receipt
guardrails), `landing-page.test.tsx` (step titles now repeat inside the timeline strip; the
"exactly once" assertion moved to step numbers/descriptions). Verification: 53 marketing/page
tests green, typecheck clean, lint 0 errors, Prettier clean, `pnpm build` green, desktop and
mobile browser checks passed.
