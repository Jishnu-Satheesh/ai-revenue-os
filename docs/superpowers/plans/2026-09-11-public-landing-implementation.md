# Public Landing Redesign Implementation Plan

> **Visual direction rejected on 2026-09-12.** The user rejected `desktop.png` and requested separately generated platform artwork inspired by Linear. The old page composition, copy lock and code-only visual restrictions below are historical, not instructions to implement. See `docs/design/public-landing/v2/README.md` for the replacement artwork study. Owner-first positioning and the requested Resend walkthrough flow remain requirements; the replacement visual design still needs review.

- **For the implementing agent:** Use `executing-plans` in one session, one agent, sequentially. No subagents. Follow each checkbox; do not reinterpret the design. The user's explicit request for a single-agent handoff overrides skill suggestions to delegate.
- **Approval:** Proposed, not yet approved for implementation. The user confirmed owner-first positioning and a Resend-backed walkthrough dialog; those confirmations are not approval of the entire visual/technical plan. Once the user approves this packet, continue through all tasks without asking again about the same decisions.
- **Goal:** Replace the public landing page with the specified owner-focused design and working Book a walkthrough collection flow.
- **Architecture:** Server-rendered page composition with isolated local interaction components. A dedicated public Node route validates three contact fields and sends one bounded customer-service email through existing Resend/Upstash packages. No tenant reads or lead database.
- **Stack:** Existing Next.js 16.0.10, React 19.2, TypeScript, Manrope, Tailwind 4, shadcn/Radix, Zod 4, Resend 6.20.0, Upstash, Vitest and Playwright. Do not upgrade packages.
- **Specification:** [design](../specs/2026-09-11-public-landing-redesign.md), [visual and copy contract](2026-09-11-public-landing-visual-contract.md), [walkthrough contract](2026-09-11-public-walkthrough-contract.md), and [ADR 0056](../../../adrs/0056-public-walkthrough-email-capture.md). Read all four before editing.
- **Research:** [reference study](2026-09-11-public-landing-research.md). It is rationale, not permission to substitute a new aesthetic.

- **Execution constraints:**

  - Preserve current dirty work. The worktree already contains unrelated organization-home, memory, channels, config and generated changes. Record `git status --short`; never stash, add-all, reset, reformat the repository, regenerate database types or push.
  - Read AGENTS.md, README, context 00/01/03/04, the Experience entry of context 05, Spec 021, ADRs 0015/0039/0056, relevant context 13 sections, context 14/15/18 and collaboration board. Read email/security skills before coding those boundaries.
  - Claim the exact touched files on the collaboration board before edits. Treat historical claims as history, not blocking reservations.
  - All controls/surfaces use installed shadcn compositions. Do not change shared primitive source or add a UI dependency; all needed primitives exist.
  - Preserve public brand RIO, existing Manrope font and server root redirect. No production financial/action claims from the example.
  - No Supabase migrations, service role, tenant queries, Trigger tasks, external image generation, analytics or CRM writes. Only the explicitly specified fixed-recipient walkthrough send is added.
  - User approval allows implementing and testing the whole packet, including the controlled service-inbox smoke described in the request contract. Configuration values still must come from the user/environment, never invention.
  - Do not commit `.env.local`, browser storage state, email contents or secrets. Logs/evidence are limited to safe operational fields.
  - Do not promise live delivery acceptance without configured sender/recipient/limiter and mailbox confirmation. Finish all code and mock-based checks even if those operational inputs are absent.

- **Task 0 — Establish baseline and reconcile the approved specification.**

  - Files: modify `specs/021-public-landing-page.md`, `adrs/0056-public-walkthrough-email-capture.md`, `docs/collaboration/asset-library-and-studio-board.md`; create `docs/verification/public-landing-redesign.md` as a factual checklist/report.
  - [ ] Confirm the user approved this packet. Record the approval date in design/ADR/spec without claiming implementation is done.
  - [ ] Run `git status --short`, `git diff --name-only`, and `pnpm exec vitest run src/components/marketing src/app/page.test.tsx`; record baseline exit/results. These existing public tests should be evaluated before replacing them.
  - [ ] Amend Spec 021 to the final scope: new page chapters, local interactivity, fictional comparison, Book a walkthrough dialog and Resend endpoint. Replace stale placeholder mailto, static-only/no-backend language, provider-result examples and emerald/indigo contradictions. Reference this packet and ADR 0056; don't erase the prior shipped history.
  - [ ] Mark the ADR Accepted only after explicit approval. If another session allocated 0056 first, preserve its file and assign this proposal the next free number, updating only this packet's references.
  - [ ] In the report, separate planned checks, checks actually run, configured live acceptance, and user visual acceptance. No test result may be inferred from a previous task/session.

- **Task 1 — Implement the public request schemas, ports and deterministic email text.**

  - Create `src/modules/marketing/domain/walkthrough-request.ts` + `.test.ts`; `src/modules/marketing/application/walkthrough-ports.ts`; `src/modules/marketing/application/walkthrough-email.ts` + `.test.ts`; `src/modules/marketing/application/read-bounded-json.ts` + `.test.ts`.
  - Consumes: the complete field/result/body contracts in walkthrough sections 2/4/6. Produces: their exact exported types and helper signatures, including `WalkthroughRequest`, `WalkthroughResponse`, `WalkthroughDependencies`, `BoundedJsonResult` and `buildWalkthroughEmailText`.
  - [ ] Write failing schema cases for all three required fields, phone normalization, field limits, unknown recipient fields, honeypot and CR/LF; use synthetic values such as `visitor@example.com`, `+971501234567`, `Retail` and UUID `11111111-1111-4111-8111-111111111111`.
  - [ ] Implement strict Zod request/response schemas with only the specified keys and safe field-error projection. Do not expose raw validation issues or make phone optional.
  - [ ] Write text tests asserting the normalized phone, exact three labels, stable request reference and byte-identical repeated output; implement the plain text builder without dynamic dates or HTML.
  - [ ] Write bounded-reader tests for a 4097-byte stream with no Content-Length, a declared oversized body, malformed JSON, missing stream and a stream exceeding 5 seconds. Implement streaming byte count, cancellation and deadline; don't rely only on `request.json()` or Content-Length.
  - [ ] Run `pnpm exec vitest run src/modules/marketing/domain src/modules/marketing/application/walkthrough-email.test.ts src/modules/marketing/application/read-bounded-json.test.ts`. All new boundary tests pass; normal invalid input produces typed outcomes rather than uncaught exceptions.

- **Task 2 — Implement configuration, abuse limits and email adapter.**

  - Create `src/modules/marketing/infrastructure/walkthrough-config.ts` + `.test.ts`, `walkthrough-rate-limit.ts` + `.test.ts`, `walkthrough-email-sender.ts` + `.test.ts`. Modify `.env.example` only for documented new settings.
  - Consumes: port types and builder from Task 1. Produces: `readWalkthroughConfig`, `consumeWalkthroughAllowance`, `sendWalkthroughRequest` with exact contract signatures.
  - [ ] Test missing, invalid and configured settings without loading real environment credentials. Implement module-local server-only parsing; do not import/modify the shared eager `src/lib/env.ts` validator.
  - [ ] Add empty examples for `RESEND_API_KEY` if absent, `WALKTHROUGH_FROM_EMAIL`, `CUSTOMER_SERVICE_EMAIL`, and `WALKTHROUGH_RATE_LIMIT_SECRET`. Reuse documented APP URL and Upstash variables. Include sender-domain verification and restart/deploy notes in README in Task 9.
  - [ ] Test limiter refusal and timeout reason even when `success` is true. Implement all four ceilings, HMAC identifiers, IPv6 /64 grouping and shared-unattributed fallback. Do not reuse `consumeAnalysisRunAllowance` or modify its behavior. No provider send when a limit cannot be verified.
  - [ ] Mock Resend; test accepted result, returned error, missing id, thrown rejection, 12-second timeout, idempotency conflict and repeated key. Assert the recipient/from/subject are server-selected and no visitor message is sent.
  - [ ] Implement the adapter with explicit response checks, stable idempotency key and bounded waiting as specified. No automatic retry, invented SDK `signal` parameter or no-op success.
  - [ ] Test safe logs and no raw PII in Redis keys. Use fake timers where needed, clean them up, and prevent late rejected promises from becoming unhandled rejections.
  - [ ] Run `pnpm exec vitest run src/modules/marketing/infrastructure` and `pnpm exec eslint src/modules/marketing`. No real network/email is used by the suites.

- **Task 3 — Wire the endpoint and exact public proxy exception.**

  - Create `src/modules/marketing/application/submit-walkthrough-request.ts` + `.test.ts`, `src/modules/marketing/application/api.ts`, `src/modules/marketing/index.ts`, `src/app/api/public/walkthrough-requests/route.ts` + `.test.ts`, `src/proxy.test.ts` if absent. Modify `src/proxy.ts` narrowly.
  - Consumes: validated requests and injected ports. Produces: `handleWalkthroughRequest(request, deps)`, facade `submitWalkthroughRequest(request)` and `POST(request)` returning the specified HTTP/JSON contracts.
  - [ ] Write service/route tests for configuration, Origin, content-type, size, validation, rate-limit and provider outcomes. Rejections assert zero sender calls; accepted body contains only accepted outcome + matching request id. Every response asserts no-store.
  - [ ] Implement the ordered orchestration in walkthrough section 5. Map statuses exactly: invalid 400, foreign/missing origin 403, payload 413, content-type 415, allowance 429, config/limiter 503, provider unconfirmed 502, payload conflict 409, accepted 202.
  - [ ] Wire adapters only in `application/api.ts`, then export through the server-only module facade. `eslint.config.mjs` explicitly permits infrastructure composition there; importing runtime infrastructure in the ordinary application service is a known trap.
  - [ ] Add exact proxy early return for `/api/public/walkthrough-requests` using `NextResponse.next()`. Do not widen matcher exclusions. Tests must show `/api/public/walkthrough-requests-other`, `/`, `/login` and an organization API still reach `updateSession`.
  - [ ] Run `pnpm exec vitest run src/modules/marketing src/app/api/public/walkthrough-requests src/proxy.test.ts` and focused lint. Add the route to the verification report as implemented only when its refusal and accepted paths pass.

- **Task 4 — Build the shared walkthrough dialog and submission lifecycle.**

  - Create `src/components/marketing/use-walkthrough-request.ts`, `walkthrough-provider.tsx`, `walkthrough-form.tsx`, `walkthrough-provider.test.tsx`. All client controller/prop names follow walkthrough section 2.
  - Consumes: browser-safe domain schemas and the POST contract. Produces: `WalkthroughProvider`, `BookWalkthroughButton`, `WalkthroughForm` and `useWalkthroughRequest`.
  - [ ] Write interaction tests for required fields, valid submit, returned refusal, pending double click, response JSON validation, request-id match, offline retry reuse, edit-after-failure new id, conflict, success and reset.
  - [ ] Implement one provider-owned controller outside DialogContent so closing the Radix portal does not discard a pending request/id or sensitive draft prematurely. Do not import server facade/env/Resend/crypto into client code.
  - [ ] Compose three Input/Field controls and inline Alert/errors using exact copy. Match dialog dimensions and portal `.marketing` tokens. All CTA wrappers use one shared context, no independent dialogs.
  - [ ] Prevent duplicates in the handler and disabled controls; implement explicit retry with stable normalized payload and id. Keep failures editable, reset only after accepted/Done as the contract specifies.
  - [ ] Test focus on first invalid field, success heading, Escape, trigger restoration and close/reopen during pending. Add visually-hidden honeypot without taking keyboard focus.
  - [ ] Run `pnpm exec vitest run src/components/marketing/walkthrough-provider.test.tsx`; no real sends. Successful HTTP with malformed or rejected body cannot show Request received.

- **Task 5 — Replace marketing content and build the guided product illustration.**

  - Modify `src/components/marketing/content.ts` + `content.test.ts`, `hero.tsx` + `hero.test.tsx`. Create `example-data.ts` + `example-data.test.ts`, `product-story.tsx` + `product-story.test.tsx`.
  - Exports: keep `hero.headline` for existing route-test integration; `nav.productName` remains RIO. New named `ProductStory(): ReactElement`; typed `StoryStep = "signal" | "evidence" | "action" | "review"`; fixture `exampleChannels`; helper `amountAfterFees(channel: ExampleChannel): number`; `formatExampleMoney(minor: number): string`.
  - [ ] Put all exact final prose in content.ts and all fictional numerical inputs in example-data.ts. Remove WALKTHROUGH_MAILTO, announcement, fabricated confidence/impact arrays and old demo exports once their consumers are replaced; do not retain dead dummy values just to satisfy old tests.
  - [ ] Write arithmetic tests: Channel A 1200000−300000=900000; Channel B 1000000−100000=900000; formatting yields AED 9,000. No financial estimate or metric scoring implementation.
  - [ ] Write story tests selecting all four tabs via click and keyboard; assert the correct evidence, limitation and review-only state. Test default server-rendered Signal content.
  - [ ] Implement four equal-width shadcn tabs with manual activation and `.marketing` scoped `data-state="active"` styling; no primitive patch. Cards and values match visual section 5 exactly.
  - [ ] Rebuild hero according to exact spacing/typography and CTA order. Use BookWalkthroughButton plus example anchor; delete decorative announcement, fake browser bar, sidebar and floating result chips from the rendered hero.
  - [ ] Run `pnpm exec vitest run src/components/marketing/content.test.ts src/components/marketing/example-data.test.ts src/components/marketing/product-story.test.tsx src/components/marketing/hero.test.tsx src/app/page.test.tsx`. If hero render tests need context, wrap with the real provider, not a bypass that hides a production dependency.

- **Task 6 — Build the editorial chapters and economics interaction.**

  - Modify `src/components/marketing/capabilities.tsx` + test to S02 principles; `how-it-works.tsx` + test to S03 context; `governance.tsx` + test and `approval-receipt.tsx` + test to S06. Create `recommendation-section.tsx`, `economics-explainer.tsx` + test, `marketing-faq.tsx` + test.
  - Named exports: `RecommendationSection()`, `EconomicsExplainer()`, `MarketingFaq()`; preserve existing default exports for Capabilities/HowItWorks/Governance until final composition. Economics mode type is `"sales" | "after-fees"`.
  - [ ] Build the S02/S03/S04/S06 semantic structures and exact copy from the visual contract. Reuse the same example-data source everywhere; no staging identifiers, invented provider names, additional cards or unsolicited feature claims.
  - [ ] Economics tests first: sales mode shows A 12,000/B 10,000; after-fees shows 9,000/9,000; axis remains 12,000; limitation and period remain visible. Keyboard mode changes update visible text and table caption together.
  - [ ] Implement comparison with simple bars and Table composition; desktop two-channel plot, mobile full readable labels. Do not import Recharts or build a general charting engine.
  - [ ] Implement four Collapsibles with exact FAQ questions/answers, independent open states and noscript answer list. Test keyboard opening/closing and simultaneous answers.
  - [ ] Retain only meaningful composition assertions in old section tests; replace expectations about Gantt stages or executed/measured results. Remove tests coupled to deleted behaviors in Task 8, not production protections.
  - [ ] Run `pnpm exec vitest run src/components/marketing` and focused lint; resolve all slice failures before layout polish.

- **Task 7 — Compose responsive page, navigation, portals and motion.**

  - Modify `src/components/marketing/landing-page.tsx` + test, `marketing-nav.tsx` + test, `closing-cta.tsx` + test, `marketing-footer.tsx` + test; `src/app/globals.css` inside `.marketing` and scoped descendants only; `src/app/page.tsx` metadata only.
  - [ ] Compose provider + nav + main in exact S01–S08 order, footer outside main. Server children remain server components; don't put "use client" on LandingPage or HomePage merely to share the dialog.
  - [ ] Add scoped token palette, typography, spacing and active-state selectors from the visual contract. Add marketing `--destructive: #FFB4AB` and `--destructive-foreground: #2B0F0D` for form errors and verify contrast; don't inherit low-contrast light-theme error colors into the dark dialog.
  - [ ] Add anchors, skip link and scroll margin. At mobile, close Sheet completely before opening the shared Dialog. Suppress Sheet trigger focus restoration only during that handoff; normal dismiss still returns to Menu. Test that there is only one active focus trap and one visible modal.
  - [ ] Add only prescribed 140/180/240ms state transitions and reduced-motion overrides. Test Radix state attributes from actual browser DOM. No global scroll listener, reveal wrapper, time-based cycling or motion import.
  - [ ] Update page metadata: title **RIO — A clearer path to profitable growth**; description exactly the hero description; same Open Graph text, type website. Do not invent a deployment URL, canonical domain or OG image. Root layout and resolver function are unchanged.
  - [ ] Footer copyright year comes from server rendering. Verify every footer/nav link exists and each Book control opens the shared dialog. No unconfirmed email is exported to the browser.
  - [ ] Run `pnpm exec vitest run src/components/marketing src/app/page.test.tsx` and `pnpm exec eslint src/components/marketing src/app/page.tsx`.

- **Task 8 — Remove replaced artifacts and verify module boundaries.**

  - Delete after `rg` verifies no outside consumers: `src/components/marketing/dashboard-mock.tsx` + test, `fig-twin-card.tsx` + test, `fig-opportunity-list.tsx` + test, `fig-outcome-row.tsx` + test, `timeline-strip.tsx` + test. New ProductStory/context/economics replace these; ApprovalReceipt remains but is rewritten.
  - [ ] Search `rg -n 'DashboardMock|FigTwinCard|FigOpportunityList|FigOutcomeRow|TimelineStrip|WALKTHROUGH_MAILTO|illustrativeOpportunity|dashboardMock' src`; remove only obsolete marketing imports/exports/tests. Do not delete unrelated product components with similar names.
  - [ ] Update content.test.ts to check final public branding, consistent fictional/limitation text, exact validated fixture and absence of unsupported proof, not an arbitrary blanket ban on percentages elsewhere in the application.
  - [ ] Check `src/lib/client-module-boundary.test.ts` and `eslint.boundaries.test.ts`; no path from client components to server facade/config/Resend/Node crypto or tenant loaders.
  - [ ] Confirm no edits to shared primitive implementations, global app tokens, database types, invitations, existing analysis limiter, organization-home plans or worker code.

- **Task 9 — Browser acceptance, full gates and documentation.**

  - Create `e2e/public-landing.spec.ts`. Modify `README.md`, `context/05-module-map.md`, Spec 021 status, ADR status if appropriate, collaboration board and `docs/verification/public-landing-redesign.md`.
  - [ ] Add public Playwright scenarios for anchors/tabs/chart/FAQ/mobile navigation and all dialog submission states. Intercept only `/api/public/walkthrough-requests` in UI tests with deterministic accepted/rejected payloads containing the submitted request id; do not call real Resend.
  - [ ] Add JS-off, reduced-motion and no-horizontal-overflow checks at the contract viewports; include 200% zoom manual review. Test a fresh context with no auth state. Retain root unit redirect tests; do not claim authenticated-browser routing was checked if no authorized session is available.
  - [ ] Run `pnpm exec playwright test e2e/public-landing.spec.ts --workers=1`. Existing Playwright config starts/reuses port 3000; do not rewrite it for unrelated tests. If 3000 belongs to another session, document the condition and use a dedicated invocation/config rather than terminating their server.
  - [ ] Capture and inspect the contact sheet from visual section 8, including dark portal colors, all demo states, long error copy, comparison equality and mobile focus behavior. Store only public/fictional screenshots under `docs/verification/public-landing/`.
  - [ ] Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` with real exit codes captured separately. Run focused Prettier check only on files touched in this slice, then correct only those files. Do not run `pnpm format` or db commands.
  - [ ] Run Lighthouse against the production build, not dev. Record scores and LCP/CLS against visual section 7; no field-INP claims. Use available browser accessibility audit tooling or a one-off audit CLI; do not add a runtime dependency just to generate the report.
  - [ ] Configure or document the exact Resend/Upstash/service-inbox requirements. Run the approved single-message + same-key-retry live smoke only when configured; distinguish provider acceptance from inbox confirmation. No raw email details in committed evidence.
  - [ ] Update README/module map for the final public sections and request flow. State only configured/verified availability; don't leave old placeholder mailto or “no backend beyond auth” wording.
  - [ ] Update the board with files touched, test results, bounded limitations and any outstanding live/visual acceptance. Make a path-limited commit only if appropriate for the session; never push.

- **Blast radius, risks and rollback:**

  - Callers affected: public `/`, marketing components, new POST route, exact-path proxy exemption. Existing root redirect, invitation delivery, tenant policies, analysis runs and provider workflows keep their interfaces.
  - New public contracts: marketing request/response schemas, one POST endpoint and local component exports. No SQL schemas, migrations, RLS policies or product execution events.
  - Browser PII risk: contact data must remain in memory and only travel to the request endpoint; screenshots/tests use fictional contact values.
  - Public cost/abuse risk: four distributed ceilings, fixed recipient and fail-closed behavior bound the email side effect; production settings are required.
  - Delivery risk: provider acceptance is not inbox arrival; 24-hour provider dedupe is not permanent storage. No durable lead archive exists in this slice.
  - UI risk: dark tokens do not inherit through portals; shared Tabs state selectors need local verification; long mobile values may overflow if truncated/scaled. The visual/browser checks target these exact regressions.
  - Rollback: revert the isolated implementation commit(s), including endpoint/proxy exception/metadata. Remove or disable walkthrough config to stop sends if immediate containment is needed. Never revert unrelated dirty work or change auth/database state.

- **Completion report required from the agent:** list changed paths, exact test results, visual captures inspected, live email acceptance status, remaining setup values by name only, and any baseline failures. State no migrations. Do not label the feature production-complete while email delivery, required quality checks or material accessibility problems remain unverified.
