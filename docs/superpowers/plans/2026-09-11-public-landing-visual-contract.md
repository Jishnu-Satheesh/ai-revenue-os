# Public landing — visual, copy and interaction contract

> **Visual direction rejected on 2026-09-12.** The user rejected `desktop.png` and requested separately generated platform artwork inspired by Linear. The old page composition, copy lock and code-only visual restrictions below are historical, not instructions to implement. See `docs/design/public-landing/v2/README.md` for the replacement artwork study. Owner-first positioning and the requested Resend walkthrough flow remain requirements; the replacement visual design still needs review.

Status: proposed; implementation requires approval of [the design](../specs/2026-09-11-public-landing-redesign.md). This file is the source of truth for copy, dimensions, fixture data and interaction states. The [execution plan](2026-09-11-public-landing-implementation.md) maps every requirement to files and checks.

## 1. Locked direction

**Concept: The growth briefing.** A composed, editorial introduction to RIO, followed by a tangible business example. Business owners first. Tone: clear, thoughtful, financially grounded.

Do not invent alternative headlines or add sections during execution. RIO is the public name; “AI Revenue OS” remains the repository name. Do not change the logo: retain the R monogram and RIO wordmark, recolored through scoped tokens.

## 2. Public design tokens

Define values only in `.marketing` in `src/app/globals.css`; components consume semantic variables. Preserve non-marketing declarations. The following are the proposed public values, not instructions to recolor the app.

| Token                                        | Value     | Purpose                               |
| -------------------------------------------- | --------- | ------------------------------------- |
| `--background`                               | `#101110` | Warm graphite canvas                  |
| `--foreground`                               | `#F3F2EE` | Main text                             |
| `--card`, `--popover`, `--surface`           | `#181A19` | Product surface                       |
| `--card-foreground`, `--popover-foreground`  | `#F3F2EE` | Surface text                          |
| `--muted`, `--secondary`, `--surface-subtle` | `#222523` | Recessed bands                        |
| `--muted-foreground`                         | `#ADB2AC` | Body explanations and metadata        |
| `--secondary-foreground`                     | `#F3F2EE` | Secondary control text                |
| `--primary`, `--ring`                        | `#B2B8FF` | Selected state, primary CTA and focus |
| `--primary-foreground`                       | `#14162B` | Primary button text                   |
| `--accent`                                   | `#2B2E40` | Hover/selected background             |
| `--accent-foreground`                        | `#F3F2EE` | Hover text                            |
| `--border`                                   | `#343A35` | Separators and surface outlines       |
| `--input`                                    | `#778178` | Interactive control outlines          |
| `--success`                                  | `#8ED7AF` | Explicit positive status only         |
| `--warning`                                  | `#E7C681` | Missing evidence/review required      |
| `--destructive`                              | `#FFB4AB` | Form validation errors                |
| `--destructive-foreground`                   | `#2B0F0D` | Text on an error-colored control      |

Remove public `--glow-accent` if no remaining marketing reference needs it. Do not add per-component hex colors or change global chart tokens. Both comparison bars use `--primary`; channel identity is communicated by labels, not arbitrary status colors.

Typography is the existing `--font-sans` / Manrope. No downloads or font additions. Headlines use weight 500, body 400, control labels 600. Monospace is limited to small chapter numbers and fixture metadata using the existing system mono stack.

| Element                | Desktop ≥1024                  | Tablet 768–1023 | Mobile <768                 |
| ---------------------- | ------------------------------ | --------------- | --------------------------- |
| H1                     | 72px / 1.06, tracking -0.045em | 56px / 1.08     | 42px / 1.08; 38px below 360 |
| Chapter H2             | 44px / 1.12, tracking -0.035em | 36px / 1.15     | 30px / 1.18                 |
| Hero description       | 18px / 1.65                    | 18px / 1.6      | 17px / 1.6                  |
| Body                   | 16px / 1.65                    | same            | same                        |
| Demo body and controls | 14px / 1.5                     | same            | same                        |
| Labels / metadata      | 12px / 1.5                     | same            | same                        |

Do not set meaningful example text below 12px. Do not fade headline text through gradients. Normal text contrast must reach 4.5:1; large text and essential non-text control boundaries 3:1. Validate actual rendered combinations, not just isolated palette values.

## 3. Layout and page rhythm

- Content width: 1184px maximum; centered. At 1440px, outer margins are 128px.
- Outer gutters: 24px desktop/tablet; 20px mobile; 16px below 360px.
- Nav: 64px tall desktop, 60px mobile; sticky, border below, background at 94% opacity. Content may not show through enough to reduce legibility.
- Hero: 88px top padding after nav, 64px bottom. At mobile: 52px top and 48px bottom. No `min-height: 100vh`.
- H1 max width 850px; description max width 640px; heading-to-description 24px; description-to-CTA 28px; CTA-to-example 48px desktop / 32px mobile.
- At desktop, desired H1 break: “A clearer path to” / “profitable growth.” Use a breakpoint-specific line break, not fixed-height text clipping. Let mobile wrap naturally.
- Example surface: full content width, minimum panel height 320px desktop; intrinsic height mobile. Reserve sufficient height for all desktop tab panels so switching does not jump the page.
- Principles band: 64px vertical padding desktop, 40px mobile, horizontal separators; three text columns desktop and stacked rows mobile. Not three raised cards.
- Chapters: 104px vertical padding desktop; 72px tablet; 56px mobile. Text/visual grid ratio 5:7, gap 64px desktop / 32px tablet; stacked below 768px with text first.
- Context and Control: text left, visual right. Recommendation: visual left, text right on desktop only. Economics: wide chart under a split heading row. This deliberate variation replaces repetitive cards.
- FAQ: 820px max width, 80px vertical padding desktop / 48px mobile.
- Closing: 112px vertical padding desktop / 64px mobile, centered. Footer: 40px vertical padding.
- Visual borders 1px; product surface radius 16px; inner cards 10px; control radius follows existing Button. No exaggerated pill containers around entire sections.
- The evidence-line motif is a 1px vertical/horizontal rule connecting three labeled context inputs and the resulting briefing. Decorative connector SVG is hidden from assistive technology; the DOM lists the same relationship in reading order.
- Desktop target overall height: approximately 5000–6000px at 1440px width; this is a pacing guide, never a fixed height. Mobile is content-driven.

## 4. Exact page order and copy

### Navigation

Brand home link `/#top`, accessible name “RIO home”. Navigation labels: **Product** → `#product`, **How it works** → `#understand`, **Your control** → `#control`. **Sign in** → `/login`. Primary CTA **Book a walkthrough** opens the shared dialog.

Below 768px, show brand, Sign in and a 44px Menu button. Put the three anchor links and primary CTA in an existing shadcn Sheet. Its title is “Explore RIO”; description “Learn how RIO supports business decisions.” Close on link selection or Escape; return focus on dismissal. SheetContent must receive `className="marketing ..."` because its portal is outside the page wrapper. Keep the built-in close button and do not create a second one.

### S01 — Hero and example (`#top`, example `#product`)

- Eyebrow: **BUSINESS INTELLIGENCE, DESIGNED FOR THE AI ERA**
- H1: **A clearer path to profitable growth.**
- Description: **RIO brings your business reports, goals, and constraints together to help you understand performance and decide what to do next.**
- Primary CTA: **Book a walkthrough** opens the shared dialog
- Secondary text link: **Explore the example** → `#product`
- Reassurance below controls: **Evidence behind the advice. People in control.**
- Example title: **From business signal to next step**
- Example caption, permanently visible above tabs: **Interactive product illustration · fictional data.**
- Period line: **Example business · 1–28 Aug 2026 · AED**
- Tabs, in order: **Signal / Evidence / Action / Review**. Default Signal. Full state content is in section 5.

The example is a product illustration, not a pixel replica of the authenticated app. No fake browser URL, window traffic lights, sidebar icon rail, avatar photos, floating revenue chips or “live” badge.

### S02 — Principles

Intro sentence: **A useful recommendation starts with understanding your business.**

Three title/body pairs:

- **Context before conclusions.** / **Your goals and constraints belong beside the numbers.**
- **Evidence you can inspect.** / **Understand what supports the advice and what is still missing.**
- **Decisions stay with you.** / **Review consequential changes before they happen.**

### S03 — Understand (`#understand`)

Chapter label: **01 / UNDERSTAND**

Heading: **Your business, in context.**

Body: **Bring reports, goals, and operating constraints into one place. Give every recommendation a clear starting point.**

Supporting sentence: **Start with the information you have. Keep missing information visible.**

Visual: three input rows on the left connect to one context Card on the right. On mobile they become a vertical sequence with a short connector. Input labels: **Business reports / Goals / Constraints**. Card title: **A shared picture of the business**. Rows:

| Fact          | Value                           | Source label        |
| ------------- | ------------------------------- | ------------------- |
| Priority      | Improve profitable sales        | Business goal       |
| Channels      | Compare Channel A and Channel B | Example reports     |
| Spending      | Review before increasing        | Business constraint |
| Product costs | Not supplied                    | Information needed  |

Caption: **Illustrative business context.** No percentage readiness score, invented verified badge or provider logo.

### S04 — Decide (`#decide`)

Chapter label: **02 / DECIDE**

Heading: **Know what deserves your attention.**

Body: **See a recommendation alongside its reasoning, supporting evidence, and limits. Useful advice can start before every answer is known.**

Visual: one recommendation Card using the fixture in section 5. Display the Action title, rationale, evidence count and limitation. Label the card **Example recommendation** and use **For your review** as the status. Show **Impact not estimated** beside **Product costs are missing.** This is a sample recommendation, not an executable Opportunity.

Text link: **Follow the reasoning** → `#product`. This navigates to the example and does not claim to select the Evidence tab.

### S05 — Compare (`#economics`)

Chapter label: **03 / COMPARE**

Heading: **More sales are only part of the picture.**

Body: **Compare the costs behind the headline before deciding where to grow.**

A two-option Tabs control labeled “Compare channel amounts” offers **Sales** and **After channel fees**. Both modes use the exact fixture below. Default Sales. Render two horizontal bars and a plain text data table. Mode switching updates values and the chart caption; names and axis range stay fixed.

Permanent caption above chart: **Illustrative comparison · 1–28 Aug 2026 · AED**.

Permanent limitation below: **Amounts after channel fees are not gross profit. Product costs and other expenses are not included.**

Sales mode insight: **Channel A reports more sales.**

After-fees mode insight: **Both channels leave AED 9,000 after the recorded fees.**

Permanent text below insight: **Review the fee breakdown and missing costs before increasing spend.**

### S06 — Control (`#control`)

Chapter label: **04 / CONTROL**

Heading: **AI brings the analysis. You make the call.**

Body: **Review the evidence and set the boundaries. Spending and public-facing changes require the relevant permissions and approvals.**

Three text rows: **Evidence stays attached. / Missing information stays visible. / Planning an action does not mark it complete.**

Visual: reuse the approval-receipt filename for a static example record. Header **Example decision record**; status **Awaiting review**. Exactly three rows: **Recommendation prepared** — “Review Channel A’s fees”; **Information needed** — “Product costs have not been supplied”; **Human decision** — “Awaiting review”. No named approver, timestamp, execution completion, payout, audit id or approval button.

Below record: **Illustration only. No business action is taken.**

### S07 — FAQ (`#questions`)

Heading: **A few practical questions.**

Use four independent existing shadcn Collapsibles with Button triggers. Start closed with JS enabled; answers also appear as a visible static list inside `noscript` for JS-off visitors.

1. **Do I need all my systems connected?** — **You can start with business context and supported reports. The information available determines what RIO can explain; gaps stay visible.**
2. **Will RIO change my budgets or publish automatically?** — **Recommendations and execution are separate. Spending and public-facing changes require the relevant permissions, readiness checks, and approvals. This page does not perform those actions.**
3. **Are these real business results?** — **No. The interactive example uses fictional data to explain the product. Amounts after channel fees exclude product costs and other expenses.**
4. **Can my agency use RIO with me?** — **RIO supports teams working across separate business workspaces, with access controlled for each business.**

### S08 — Closing and footer

Heading: **Make your next decision a clearer one.**

Body: **See how RIO could support the decisions in your business.**

CTA: **Book a walkthrough** opens the shared dialog; secondary **Explore the example** → `#product`.

Footer tagline: **Business intelligence for thoughtful growth.** Links: **Product** → `#product`, **Your control** → `#control`, **Questions** → `#questions`, **Sign in** → `/login`. Copyright: render the current year on the server and “RIO”. Do not invent privacy, terms, social, pricing or contact links.

### Walkthrough dialog — confirmed user requirement

Every Book a walkthrough button opens one shared shadcn Dialog. The complete [walkthrough contract](2026-09-11-public-walkthrough-contract.md) defines fields, API, safety and delivery tests. No mailto or scheduling embed.

- Title **Book a walkthrough**; description **Tell us a little about your business. Our team will contact you to arrange a walkthrough.**
- Required fields: **Email address**, **Phone number**, **Business industry**. Industry is a short text input, with hint **For example, retail, hospitality, or professional services.** Phone hint **Include your country code, for example +971.**
- Disclosure **We’ll use these details to contact you about your walkthrough.** No newsletter checkbox or bundled subscription.
- Submit **Request a walkthrough**; pending **Sending request…**; cancel **Cancel**.
- Success heading **Request received**; body **Thanks. Our team will contact you to arrange your walkthrough.**; action **Done**. A success requires a validated accepted API response, not just HTTP completion.
- Pending and failure preserve entered fields. Errors are inline with a summary; no technical codes, recipient address, service credentials or provider details in the UI.
- Desktop width 480px, mobile width `calc(100% - 32px)`, max height `calc(100dvh - 32px)`, scrollable content. Use existing Dialog padding/header behavior. Add `.marketing` to DialogContent for portal tokens. Do not recolor shared Dialog globally.
- Focus starts on email; invalid submit focuses the first invalid field; failure summary announces once; success focuses the success heading; close restores the triggering control. Mobile Sheet must close before the Dialog opens; test the focus handoff.
- Show a `noscript` message near closing CTA: **Please enable JavaScript to request a walkthrough. You can still explore the product example.**

## 5. One fictional fixture, exact states

The fixture is local marketing data. Currency **AED**. Period **1–28 Aug 2026**. No organization/customer ids or provider names.

| Channel   | Sales, minor units | Recorded fees, minor units | After fees, minor units |
| --------- | -----------------: | -------------------------: | ----------------------: |
| Channel A |            1200000 |                     300000 |                  900000 |
| Channel B |            1000000 |                     100000 |                  900000 |

Money arithmetic is `salesMinor - feesMinor`. Formatting uses a local `Intl.NumberFormat("en-AE", { maximumFractionDigits: 0 })` on minor units divided by 100, prefixed by `AED `; the fixture uses only whole dirhams. Chart scale is fixed at AED 12,000 in both modes. Accessible labels and visible value text must update together.

Public fixture fields: `id` (`channel-a` or `channel-b`), `label`, `salesMinor`, `feesMinor`. Derive after-fee values; do not store a second editable total. The helper `amountAfterFees` is a marketing-local function, not a financial domain export. This is not production economics logic.

Recommendation title: **Review Channel A’s fees before increasing spend.**

Rationale: **Channel A has higher sales, but both channels leave AED 9,000 after the recorded fees. Check the fee breakdown and product costs before deciding where to invest.**

Limitation: **Product costs are missing. Gross profit and the impact of a change cannot be estimated from this example.**

| Tab      | Heading                                          | Main content                                                                                                                                              | Permanent state note                               |
| -------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Signal   | More sales. The same amount after fees.          | Two channel rows showing sales and amount after fees; values from fixture                                                                                 | Product costs and other expenses are not included. |
| Evidence | See what supports the comparison.                | Two source Cards: “Channel A example report” and “Channel B example report”; each shows period, sales and fees. Third row: “Product costs — Not supplied” | Fictional sources supplied for this illustration.  |
| Action   | Review Channel A’s fees before increasing spend. | Exact rationale; “Impact not estimated”; exact limitation                                                                                                 | Recommendation only.                               |
| Review   | A person decides what happens next.              | “Suggested next step: review fees and collect product costs.” Then “Status: awaiting review.”                                                             | Illustration only. No business action is taken.    |

No Approve/Publish/Run buttons. All four tabs can be selected in any order, without implying workflow completion. The active tab does not mark previous tabs as complete. No analytics request, network request, toast, saved state or page reload occurs when changing illustration tabs. Walkthrough submission is the separate authorized network action.

## 6. Interaction, motion and accessibility

- Use installed shadcn Tabs and Collapsible primitives. Current Tabs wraps Radix but has selectors using `data-active`; verify rendered `data-state="active"` and supply marketing-scoped active selectors if needed. Do not edit `src/components/ui/tabs.tsx` for this page.
- Hero tablist is four equal columns at every width; 44px minimum targets. Use manual activation: arrow keys change focused tab, Enter/Space selects, Home/End focus first/last. Economics tabs use the same model. Do not intercept Tab, which leaves the tablist normally.
- The selected panel needs an accessible name. Keep focus on the selected tab after selection. Content controls do not automatically move focus or scroll.
- Nav anchors account for sticky header with `scroll-margin-top: 88px` on target sections. Include a visible-on-focus Skip to content link to `#main-content`; `main` has that id and `tabIndex={-1}`.
- Hover/focus feedback: 140ms color/border transition. Tab-panel entrance: optional single 180ms opacity transition keyed to the chosen tab, never an exit delay. Comparison bars: 240ms width transition, with a stable plot container. Values change immediately; no count-up.
- `prefers-reduced-motion: reduce`: zero-duration transitions/animations for marketing descendants and marketing portal descendants. No smooth-scrolling requirement; native anchor scrolling is sufficient.
- No reveal that starts content at opacity zero before JS; no auto-rotation, scroll pinning, parallax, background video, WebGL, hover-only evidence, or forced cursor effects.
- Use a visible table as the accessible chart alternative: channel, sales, recorded fees and selected amount. Caption names the selected basis. Chart SVG is decorative if all information is already in the table; otherwise give it a meaningful accessible label without duplicating table reading.
- Mobile: all evidence fields and qualifications wrap. Do not truncate money/limitations. No viewport-dependent JavaScript branches in the first render; responsive layout is CSS.
- Each FAQ trigger has its complete question as its name and correctly exposes expanded state. Chevron is decorative. Multiple answers may remain open.
- All static copy is server-rendered. For JS-off, default demo/comparison content renders, and FAQ answers are available through `noscript`; interactive controls may be inert but must not be the only way to learn the product.

## 7. Asset and technical budget

- No required external design service, asset generation, raster art, paid stock, font download or reference screenshot.
- Visuals are semantic HTML and local SVG using shadcn Card/Badge/Table/Button compositions. No Recharts needed for two horizontal bars.
- Use existing Manrope, lucide icons, Radix-based shadcn controls and CSS. Do not import framer-motion simply because it is installed.
- Client boundaries: mobile nav, guided example, economics comparison, FAQ, and one shared walkthrough provider/dialog. The provider accepts server-rendered children; wrapping them does not require moving the whole page into client code. All other chapters remain server components, including static recommendation and control record.
- First-view rendering cannot depend on hydration. No product data fetch or extra remote illustration resource. Only walkthrough submission uses the public request API; Resend and Upstash are server-side.
- On a production-mode run, target Lighthouse mobile performance ≥90, accessibility ≥95 with zero serious/critical issues, LCP ≤2.5s and CLS ≤0.1. These are acceptance targets to measure, not achieved scores. Test interactions for visible responsiveness; a lab run does not establish field INP.
- If the existing session boundary or environment dominates performance, document its contribution rather than changing auth/caching. The redesigned marketing code must not introduce large assets or unbounded animation to compensate.

## 8. Visual review contact sheet

Capture at 1440 × 900, 1024 × 768, 768 × 1024, 390 × 844 and 320 × 740. Check a 200% browser zoom separately. Required evidence: desktop hero, each of four example states, full desktop page, mobile full page, mobile menu open, both comparison states, FAQ open, walkthrough empty/invalid/pending/failed/success, reduced motion and JS-off.

Reject: purple fog/gradient headlines; a tiny scaled dashboard; eight identical card grids; real pilot names; charts with unlabeled axes/periods; blanket “AI runs your business” copy; neon-positive coloring for unknown results; information hidden below fake browser chrome; clickable-looking decorative controls; a live-looking approval or execution result.
