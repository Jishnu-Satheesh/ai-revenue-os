# RIO public landing — single-agent handoff

> **Visual direction rejected on 2026-09-12.** The user rejected `desktop.png` and requested separately generated platform artwork inspired by Linear. The old page composition, copy lock and code-only visual restrictions below are historical, not instructions to implement. See `docs/design/public-landing/v2/README.md` for the replacement artwork study. Owner-first positioning and the requested Resend walkthrough flow remain requirements; the replacement visual design still needs review.

## Read this first

This packet was prepared on 2026-09-11 at the user's request. **The proposal is ready for review; implementation is not yet approved.** The confirmed requirements are business owners first, Linear-inspired minimal design, useful interactivity, and **Book a walkthrough** collecting email, phone and industry in a dialog and emailing a configured customer-service inbox through Resend.

| Document                                                           | Role                                                                       |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [Design](../specs/2026-09-11-public-landing-redesign.md)           | Scope, product claims, alternatives and acceptance                         |
| [Research](2026-09-11-public-landing-research.md)                  | Linear/Attio/Raycast/Ramp study and current-page findings                  |
| [Visual contract](2026-09-11-public-landing-visual-contract.md)    | Exact section order, copy, tokens, dimensions, data and interaction states |
| [Walkthrough contract](2026-09-11-public-walkthrough-contract.md)  | Required fields, public API, env names, Resend, abuse limits and retries   |
| [Execution plan](2026-09-11-public-landing-implementation.md)      | Sequential tasks, exact paths, dependencies and verification               |
| [ADR 0056](../../../adrs/0056-public-walkthrough-email-capture.md) | Proposed public email boundary and retention/delivery limits               |

No design-service link, temporary screenshot, external asset or missing mockup is required to execute the packet. Reference sites can change; the local visual contract remains authoritative after approval.

## Intended page

**RIO — A clearer path to profitable growth.**

Warm graphite, off-white Manrope, restrained indigo, readable product illustrations. The sequence is hero/example → principles → business context → recommendation → costs comparison → human control → practical questions → walkthrough CTA.

The guided example is fictional and explicitly labeled. Book a walkthrough is the real action. It opens a single shared dialog and sends only to the configured customer-service recipient. The page never creates an organization, runs business AI, claims real profit uplift or performs a business approval.

## Prompt to send after approving the packet

Implement the approved RIO public landing redesign in `/home/spy/Documents/ai-revenue-os/.worktrees/governed-channel-intelligence` as one coding agent. Start with AGENTS.md and `docs/superpowers/plans/2026-09-11-public-landing-implementation.md`, then read every linked contract before changing code. Approval of this packet covers the design, exact copy, scoped palette, fictional demonstration, Book a walkthrough dialog, public rate-limited Resend endpoint and specified verification. Do not ask again about those decisions.

Execute Tasks 0–9 sequentially using executing-plans. No delegation, no alternative redesign, no new packages, no placeholder destinations, and no missing sections. Keep the landing composition server-rendered with small client interactions. Preserve the signed-in root resolver. The sole new public side effect is the validated email to CUSTOMER_SERVICE_EMAIL. Implement the documented failure, privacy, rate-limit and retry behavior rather than a happy-path-only form.

Read the existing code and repository boundary rules before implementing each task. In particular, ordinary application services cannot import runtime infrastructure: compose it in `application/api.ts`. A portal does not inherit `.marketing` from the page. Radix tabs may expose `data-state` rather than the custom active selectors. The Resend SDK may resolve with an error, and the existing analysis limiter fails open. The contracts explain exactly how to handle these traps.

The worktree contains unrelated dirty changes. Claim only your files on the collaboration board; preserve everything else. Never stash, add-all, run repository formatting, edit database types, start local Supabase, push migrations or push Git. Do not edit authenticated home, Growth Intelligence, memory, channels or campaign workers for this redesign.

Complete all implementation and mock-based tests before reporting missing deployment setup. Configuration must be real: RESEND_API_KEY, WALKTHROUGH_FROM_EMAIL, CUSTOMER_SERVICE_EMAIL, NEXT_PUBLIC_APP_URL, existing Upstash URL/token and WALKTHROUGH_RATE_LIMIT_SECRET. Do not fabricate values, print `.env.local`, use the invitation sender's default From, or claim delivery while settings are missing. The approved live smoke is one synthetic request to the configured service inbox plus one same-id retry; don't send any other test email. Record inbox confirmation separately from provider acceptance.

Run required focused checks, full lint/typecheck/tests/build, public browser scenarios and the visual contact sheet. Fix all introduced failures. Name unrelated baseline failures with evidence. Update Spec 021, ADR 0056, README, module map, board and verification report to match the final result. Don't mark the work production-complete unless required live email acceptance and visual/quality gates actually passed. Finish with changed files, exact check results, inspected screenshots, operational setup names still missing, and honest remaining acceptance items. Do not push.

## Planning verification

- Current signed-out page inspected in a local browser; sections/CTA controls rendered and no browser errors were reported during the inspection.
- Root routing, marketing components, semantic CSS, installed primitives, package versions, invitation email sender, rate limiter, proxy and layer restrictions were inspected.
- Primary external references and relevant Resend/Upstash documentation were read. No customer data or provider result was used as a marketing proof point.
- This turn writes documentation only. The new page, endpoint, dialog and tests have not been implemented or run. No email was sent and no environment value was changed.
