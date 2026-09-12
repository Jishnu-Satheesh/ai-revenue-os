# Public landing redesign — The growth briefing

> **Visual direction rejected on 2026-09-12.** The user rejected `desktop.png` and requested separately generated platform artwork inspired by Linear. The old page composition, copy lock and code-only visual restrictions below are historical, not instructions to implement. See `docs/design/public-landing/v2/README.md` for the replacement artwork study. Owner-first positioning and the requested Resend walkthrough flow remain requirements; the replacement visual design still needs review.

## Status and authority

- Proposed design, prepared 2026-09-11. Planning is requested; implementation is not yet approved.
- Confirmed audience: business owners seeking profitable growth. Agencies are a secondary audience, mentioned once in the FAQ.
- Existing surface: signed-out `/`, branded **RIO**. This is not the authenticated organization Overview redesign.
- Tier 3 after the user added public walkthrough capture: presentation plus an unauthenticated, rate-limited email endpoint. Extend existing Spec 021 rather than allocate a second landing-page spec. This design and the walkthrough contract are its proposed blueprint; ADR 0056 records the new public data-handling boundary.
- On explicit approval, this document and its linked visual, execution and walkthrough contracts amend the presentation requirements of `specs/021-public-landing-page.md`. Until then, that shipped specification remains unchanged.
- Companions: [research](../plans/2026-09-11-public-landing-research.md), [visual and content contract](../plans/2026-09-11-public-landing-visual-contract.md), [execution plan](../plans/2026-09-11-public-landing-implementation.md), [agent handoff](../plans/2026-09-11-public-landing-handoff.md), [walkthrough contract](../plans/2026-09-11-public-walkthrough-contract.md), and [proposed ADR 0056](../../../adrs/0056-public-walkthrough-email-capture.md).

## Business outcome

A business owner can explain what RIO does after the first screen, inspect a useful example without signing in, and understand that evidence informs recommendations while people retain control over consequential actions.

The first-screen message is **“A clearer path to profitable growth.”** Supporting copy supplies the category: **“RIO brings your business reports, goals, and constraints together to help you understand performance and decide what to do next.”** AI appears as a supporting capability, not an unexplained claim of autonomy.

Success is comprehension and a working next step. Do not fabricate conversion targets, customer proof, attribution, or availability to compensate for missing evidence.

## Current implementation findings

- `src/app/page.tsx` already performs the public/authenticated split. Signed-in users go through `resolveLandingPath`; rejected `getUser()` calls fall back to the public page. Preserve this behavior.
- `src/components/marketing/landing-page.tsx` composes nav, hero, capabilities, how-it-works, governance, closing CTA and footer. Almost all visual controls inside its mock dashboard are noninteractive spans.
- The current hero uses a long agency-oriented headline, a dense description, a decorative announcement and several competing interface artifacts. In a 1280 × 720 browser capture, the product preview is below the first screen.
- The existing public palette is emerald within `.marketing`; Spec 021 still describes indigo. Its theme and illustration descriptions also lag implementation. Approval must resolve those contradictions explicitly in Spec 021.
- Public examples currently include an uncalibrated confidence percentage, a named staging-pilot business, completed provider actions, and an uplift chart without a complete visible attribution explanation. Replace this collection with one clearly fictional, internally consistent example.
- `WALKTHROUGH_MAILTO` is explicitly documented as unconfirmed. The user explicitly selected **Book a walkthrough → dialog** collecting email, phone and business industry. Submit through Resend to a customer-service inbox configured in server-only environment variables. **Explore the example → `#product`** is the hero secondary action. Remove the old mailto; no fallback to it.
- Existing Manrope, shadcn primitives, Tailwind and local SVG/HTML can support the design. No new runtime dependencies are necessary.

## Alternatives considered

| Direction                                                              | Benefit                                                                             | Trade-off                                                                            | Decision                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------- |
| The growth briefing: dark editorial page with a guided product example | Closest to the user's preference; connects visual craft to a real business decision | Requires disciplined copy and readable mock content                                  | Recommended and fully specified |
| Light financial workspace: paper-white surfaces and restrained tables  | Approachable and easy to read; strong finance association                           | Less aligned with the requested mood and current public identity                     | Not selected                    |
| Cinematic AI canvas: spatial scenes and elaborate transitions          | Strong initial spectacle                                                            | Larger asset/performance burden; harder for a single agent to implement consistently | Not selected                    |

## Design principles

- One continuous story: business context → evidence → recommendation → human review.
- Quiet framing, detailed product moments. Whitespace belongs around the demonstration; the demonstration itself must be useful and readable.
- Distinctive motif: a thin evidence line, paired with small chapter labels **Understand / Decide / Compare / Control**. It connects information conceptually; it never becomes a decorative node editor.
- Warm graphite, off-white typography, restrained indigo for navigation and selection; semantic green and amber only where their meaning is explicit.
- Interactions change something understandable. No autoplay carousel, fake command prompt, simulated agent chat, mouse-following orb, or arbitrary spinning illustration.
- The exact approved copy and UI fixtures are in the visual contract. The implementation agent does not invent slogans, figures, provider availability, or extra sections.

## Scope

### Included

- One public page with nav; hero and guided example; three short product principles; business-context chapter; recommendation chapter; economics comparison; human-control chapter; FAQ; closing CTA and footer.
- Local tab selection, an economics comparison toggle, collapsible FAQ, responsive mobile navigation, a shared walkthrough dialog, and restrained CSS state transitions.
- A bounded public POST endpoint, server-side validation, abuse limits, Resend delivery, private configuration, safe failure messages, and retry idempotency. No application database storage of leads.
- New static page title and description, Open Graph text, and accessible document landmarks.
- Public demonstration fixtures, explicitly labeled fictional, with exact integer-minor-unit arithmetic.
- Focused component/behavior tests, public browser coverage, and documented manual visual acceptance.

### Excluded

- Authenticated home/Overview, dashboards, pricing, public signup, CRM synchronization, database schema, business-data providers, workers, tracking scripts, CMS, customer logos, testimonials, and new public routes.
- External research running on the visitor's behalf, cost-bearing AI calls, real recommendations, approval mutations, publishing, unsolicited outbound messages, spending changes, or persistent demo state. The requested inbound walkthrough email is the only new side effect.
- Generated artwork, copied competitor screenshots in the shipped page, paid assets, new fonts, animation packages, analytics or performance-reporting infrastructure.

## User journey

1. A signed-out visitor sees RIO, the business outcome, an explanatory sentence, and an obvious link to explore the example.
2. The example shows two sales channels. Channel A sells more, but both retain the same amount after the recorded channel fees.
3. **Signal / Evidence / Action / Review** tabs let the visitor follow the reasoning. Nothing automatically advances or changes after a timeout.
4. Deeper sections explain business context, supported recommendations, cost-aware comparison and human control.
5. FAQ answers practical objections. Book a walkthrough opens a short dialog; validated details are emailed to the configured customer-service inbox. The success state means Resend accepted the request email, not that a meeting is scheduled.
6. **Sign in** goes to `/login`. Authenticated visits to `/` keep the existing server redirect and never see a landing-page flash.

## Product truth and example boundaries

| Topic                                       | Evidence read                                                                                                | Allowed public treatment                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Business profiles, goals and constraints    | README; `context/04-domain-model.md`; organization modules                                                   | Describe business context in plain language                                                 |
| Governed report intake and channel analysis | Spec 018; current marketing and channel surfaces                                                             | Explain supplied reports and evidence; no universal connector promise                       |
| Advice vs execution                         | ADR 0039; Spec 022 semantics                                                                                 | Recommendations can be useful with visible limitations; approval is distinct from execution |
| Campaign opportunities                      | `src/modules/decisions/infrastructure/campaign-evidence-repository.ts` still supplies `impactEvidence: null` | Do not advertise a universally populated executable opportunity feed                        |
| Market research                             | Spec 022 status retains provider/canary/browser release limitations                                          | Omit claims of live, continuous or universally enabled market monitoring                    |
| Realized financial results                  | No live attributed-result evidence inspected in this planning task                                           | No achieved uplift, ROI, savings or automated-learning claims                               |
| Multiple businesses                         | Tenancy and organization model                                                                               | FAQ may mention agencies supporting several businesses; do not invent a portfolio dashboard |

All examples use “Example business”, never a real organization name or staging identifier. Numerical content is fictional comparison data, not forward-looking earnings, not measured customer results, and not a picture of the current authenticated UI. Caption: **“Interactive product illustration · fictional data.”** A second visible line supplies the period and currency.

The displayed money after fees must never be called gross profit. Product costs and other expenses are absent. The recommendation remains useful: inspect fees and costs before increasing spend. No numeric impact estimate is shown because the fixture does not support one.

## Data, APIs, AI, security and observability

- No database schema changes and no AI behavior. New API: `POST /api/public/walkthrough-requests`; no tenant account is required. Emit bounded operational logs for accepted/refused/failed sends using the existing logger.
- Static typed fixtures stay under `src/components/marketing/`. Local React state owns selection only; no Query hooks, persistence or cookies for illustrations. The separate walkthrough dialog calls only its own public endpoint and keeps draft contact details in memory.
- Keep marketing components independent of platform repositories, clients, secrets, organization identifiers, and domain loaders. The existing root session probe remains. The exact new public endpoint bypasses session refresh in `src/proxy.ts`; no other path is exempted.
- Preserve ADR 0015. Do not add route-level caching that could share authenticated responses with public visitors.
- No marketing tracker. Walkthrough logs contain only random correlation id, bounded outcome code, status and duration; no email, phone, industry, IP, body or Resend error text. Provider/mailbox retention and pseudonymous rate-limit counters are described in the walkthrough contract.

## Failure states

- Missing/invalid email configuration or rate-limit service: dialog preserves entered fields and shows “Walkthrough requests are temporarily unavailable. Please try again later.” No success or email is produced. Deployment is not accepted until the real configuration and delivery check are complete.
- JavaScript unavailable: the headline, navigation, default Signal example, all static chapters, economics default view, FAQ answer fallback and footer remain readable. A `noscript` note explains that booking needs JavaScript; never imply it submitted. Do not hide text for reveal animations.
- Narrow viewport: charts reflow; evidence rows wrap; no scaled desktop screenshot or page-level horizontal scroll.
- Reduced motion: every control remains functional with immediate state changes and no animation.
- Session probe rejection: retain the current public fallback test. A server-client-construction error is not covered by the existing fallback and is outside this redesign; do not silently claim otherwise.

## Acceptance criteria

1. Business owner positioning, RIO branding and exact visual-contract copy are implemented.
2. Above-the-fold desktop composition shows the start of the example at 1440 × 900; mobile shows the headline, explanation and CTA without horizontal scrolling at 390 × 844.
3. Every demo step is keyboard/touch usable; the economics comparison is numerically correct and always states its missing cost basis.
4. Book a walkthrough opens the same dialog from every placement; validation, provider refusal, timeout, duplicate retry and success work. Anchors, Sign in, mobile menu and FAQ work; no unconfirmed mailto remains.
5. No copied brand assets, confidential data, fictional proof presented as real, calibration percentages or implied completed provider actions.
6. Route-split tests pass; public interaction, endpoint, validation, email and limiter tests and browser checks pass; failure/JS-off/reduced-motion behaviors are verified. A configured service inbox receives one controlled test request; a retry with the same id does not produce a second message.
7. Public tokens and state styling do not alter authenticated UI or shared primitives. Portal content receives its marketing theme explicitly.
8. Production build, typecheck, lint and tests are run and outcomes recorded accurately. Any unrelated pre-existing failures are named with baseline evidence, not counted as green.
9. Spec 021, ADR 0056, `.env.example`, README and module map match the approved implemented result. The agent records browser acceptance separately from automated checks and requests visual review only after all implementation work is reviewable.

## Migration and rollback

No migrations. Missing email setup blocks live acceptance but not implementation/testing. Configure secrets locally without printing or committing them; deployed environments need the same server-only settings. Use an isolated path-limited implementation commit. Revert only that commit to restore the previous marketing surface and page metadata. Do not revert unrelated shared-tree changes or use `git stash`.
