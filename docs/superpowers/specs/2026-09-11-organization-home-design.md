# Overview: the home of the organization

## Status

Product purpose, information hierarchy, and prominent campaign/artwork direction approved by the user on 2026-09-11: “Let's make Overview, the home of the organization,” followed by “Looks good.” This is a design and implementation handoff, not authorization to execute the implementation. The rendered reference and detailed technical adaptations below are delivered for review. No production UI or hosted data changed during design.

Route: `/organizations/[organizationId]/overview`. Keep the route and navigation label **Overview**. The organization name is the page's h1. The home is shared by organization members, with permission-aware actions; it is not a personal task inbox.

This supersedes the presentation in `docs/design/overview-redesign/` and the earlier 2026-08-24 Overview design/plan. The current `OverviewReport` remains the running implementation until the new plan is executed. Underlying organization, permission, Campaign, Asset Library, and evidence contracts remain authoritative.

## Outcome and boundaries

Help a member recognize the organization, return to its campaigns and assets, understand its goals and pending work, and reach the appropriate workspace. Optimize for successful navigation and clear state, not number of cards or an invented business-health score.

Overview answers “Where is our work, and what needs us?” Channels answers “How is each channel doing?” Growth Intelligence answers “What should we improve, and why?” Do not rebuild either analytical workspace inside the home.

This is a Tier 2 composition/read slice across existing modules. No new table, migration, provider integration, worker, autonomous action, or money-moving authority is required. A route-specific design specification is sufficient; there is no new domain architecture decision requiring an ADR. ADRs 0039, 0041, and 0049 continue to govern advice, grounding and Creative History. Source-owned readers remain inside the Campaign module; the Organizations module composes their safe output.

## Reference package

- Visual/interactions: `.superdesign/organization-home/prototype.html`.
- Desktop, tablet, mobile, asset dialog and first-use captures in the same directory.
- `.superdesign/organization-home/source-baseline.json` records the source actually inspected, including existing dirty content.
- Execution: `docs/superpowers/plans/2026-09-11-organization-home-implementation.md`.
- Exact data and behavior: `docs/superpowers/plans/2026-09-11-organization-home-data-contract.md`.
- Visual sign-off: `docs/superpowers/plans/2026-09-11-organization-home-visual-contract.md`.

The prototype uses **Juniper Kitchen**, fictional campaigns and original illustrative SVG posters. Its review-state dropdown, sidebar identity, navigation-explanation dialogs, decorative poster angles, and sample business copy are design aids. Never copy fixture records into production or present them as this organization's assets. The platform stays industry-neutral.

## Visual direction

White canvas, existing Manrope typography, quiet neutral borders, existing emerald actions. The organization's approved logo and real creative work provide personality. Do not retheme the application to each organization's brand palette. Keep the shared AppShell, sidebar, breadcrumb, main scroll container and shell controls unchanged.

At desktop width, use a generous primary column and a 288px secondary column. The primary column holds campaigns followed by the creative library. The secondary column holds attention items and goals. Workspace destinations and recent activity span both columns below. An organization masthead unifies the page above them.

Use varied content shapes with a stable order: two large campaign covers, a compact third campaign row, four smaller asset thumbnails, short attention rows, and a plain goal summary. Give artwork a neutral frame with `object-fit: contain`. No aspect-ratio distortion or cropping of poster text. Production artwork stays unrotated; the reference's small angles are illustrative art direction, not a transformation to apply to customer designs.

## Section 1: organization masthead

- Organization name, persisted `value_proposition` where present, status, active-location count, configured timezone and base currency.
- No generated tagline, inferred location, arbitrary logo from `brand_context`, simulated team avatars or online status.
- Logo: show a safe current brand logo only when a unique eligible logo exists. Eligibility and ambiguity are defined in the data contract. Otherwise keep a name-led header without an invented emblem.
- `Manage organization` scrolls to the existing `#organization-management` surface. That surface retains its explicit Open/Close control and existing editor authorization. Do not silently move configuration out of the route.
- `New campaign` navigates to `/campaigns/new` only when the existing rollout gate and `campaign.create` permission allow it. Navigation itself does not start generation.
- Location count opens a read-only Dialog listing active locations and their saved kinds. Zero locations explains branchless confirmation when recorded; it does not invent a missing-setup error for a branchless business.

## Section 2: Your campaigns

- Show up to three most recently updated campaigns, ordered `updated_at DESC, id DESC`, including terminal states. Caption **Recent work, ready to pick up.** Do not call this an exhaustive active-campaign list or expose a total derived from three rows.
- First two records use large cards. Third uses a compact row. One record occupies the first column, not two duplicated cards. Zero records gets the purposeful first-campaign empty state.
- Preserve `CampaignListItem.state`, `generation`, `openable`, title, objective and update date. Use the existing domain formatter where accessible, otherwise an exhaustive mapping tested against `CAMPAIGN_STATES`.
- Current-version rendered poster is preferred cover. A usable current-version campaign image is a fallback labelled **Campaign image**; do not imply a source photograph was generated. No image still leaves title, status and destination available. Do not select a poster from a previous bundle version for the latest proposal.
- `ready_for_review` + openable: **Review campaign**, or **View campaign** for a read-only user. `draft` + openable + edit permission: **Continue draft**. Other openable records: **View campaign**.
- A campaign with no saved version never links to its detail page. Its **View in Campaigns** link opens the portfolio, which owns generation/retry behavior. An expired worker lease must not appear as active generation.
- **All campaigns** is always the section destination when module access is enabled. No approve, publish, retry-generation or archive mutations on the home.

## Section 3: Your creative library

- Show up to four recent items from source-owned readers: completed poster renders and current usable brand references. Keep source type visible on every item.
- A completed render is **Finished poster render · Review not recorded**. Rendering success is not human approval. Do not inherit a plate's review or unrelated Creative History verdict.
- Brand references carry **Approved reference**, **Unreviewed reference**, or **Rejected reference**, derived from the latest review of the selected version. Rejected bytes are not used in home decoration or campaign covers; the home gallery omits rejected references after reading their latest verdict. It does not “fall back” to their previously approved version.
- The gallery is a recent preview, not a replacement for Creative History, Products & Subjects, or Brand Kit. The current `/assets` implementation still has References, Campaign output, and Dishes; ADR 0049's redesigned tabs are not wired in the inspected source. Do not rename or reimplement that workspace in this task.
- Raw generated campaign plates do not become finished designs in this gallery. They may only appear as labelled previews within the owning campaign card.
- Clicking an item opens a read-only Dialog with image, exact source type, review state, saved date, and source destination. Render destinations bind the original campaign **and bundle version**; brand references open Asset Library. No invented asset-detail route or unsupported tab hash.
- Image failures show **Preview unavailable** and retain metadata. Signed URLs expire; reopening/retrying uses a refreshed server render without changing the selected organization.
- Gallery partial-source failure preserves the other source's records and adds **Some assets could not be loaded** with Retry. Both sources failing produces a local error panel. A source error never looks like an empty library.

## Section 4: For your attention

- Bounded, deterministic preview, maximum three items. Prioritize failed/stalled campaign generation, then blocked/needs-data campaigns, then review-ready campaigns; sort within category by update date descending and id descending.
- Use only the three loaded campaigns, explicitly label the count **N shown**, and link to All campaigns. No claim of an exhaustive organization approval queue.
- Add existing authorized organization-setup gaps only if fewer than three campaign items occupy the preview. Goal/profile gaps link to management or onboarding according to permissions. Do not expose policy payloads.
- Every row names its source, record, reason and destination. Status comes from saved data. It is not a new recommendation, urgency score or inferred deadline.
- Viewers see **For your information** and read destinations; no instruction to approve, upload, retry a worker, or edit settings.
- Zero items says **Nothing in the recent work shown needs attention.** It must not claim the whole organization is healthy or caught up. If source reads failed, say attention could not be checked for those sources.

## Section 5: Your focus

- Display the first organization-scoped saved goal by ascending priority, then id ascending. Show its saved name, target, unit and optional deadline. **View goals** opens a read-only list of all saved goals with their explicit organization/branch scope.
- Reuse domain money formatting only when the goal's unit/currency are applicable. Do not relabel generic goal units or compute attainment from an unrelated metric.
- No progress meter, “on track” statement, realized increase, or percentage without a separately implemented measurement contract. This slice displays targets only.
- No organization goal: a neutral prompt; branch goals remain reachable in View goals. Management remains authorized and secondary.

## Section 6: Around your business

- Four concise destinations: Channels, Growth Intelligence, Business Memory, Integration Hub. Campaigns and Asset Library already have richer sections above.
- Use specific descriptions as in the reference. These are navigation summaries, not fabricated live counts or data-health indicators.
- Only show a destination whose read permission and applicable feature gate permit entry. Use Growth Intelligence's `market` gate, matching its actual page entry; Integration Hub uses its existing gate. Hide absent entries and reflow without blank columns.
- Growth Intelligence and Channels provide the detailed performance experience. This home does not add a second period selector or retain the report's 30-day economics chapters. This is an explicit presentation adaptation for the approved organization-home purpose.
- Guided onboarding remains reachable from setup empty states and the existing sidebar. Do not add Agents/Executions as active modules; their sidebar entries are “Soon.” Do not add Asset Library to the shared sidebar as part of this slice.

## Section 7: Recent activity

- Maximum five records; allowlisted organization events plus updates from the bounded campaign and asset candidates. Sort by timestamp descending, stable key ascending. Caption the scope **Campaign, asset and organization updates**.
- Say **Campaign updated**, not “Campaign published,” when the source only proves `updated_at`. Render timestamps use **Poster rendered**. Reference version timestamps use **Reference added**; do not call an ingestion a human review.
- Organization events use an exact safe-name mapping and never render raw payload JSON, email addresses, actor IDs, model text or unknown event names. Names are resolved only from already-authorized organization records; otherwise use generic copy.
- This is recorded activity, not personal “Since your last visit.” No new visit tracking or unread counts.

## Responsive and accessibility contract

- Match the companion visual contract at 1920, 1440, 1280, 1024, 768, 390 and 320px. AppShell's real sidebar state, not the standalone mock sidebar breakpoint, governs available width.
- Use container queries in the home where feasible so collapsing the existing sidebar reflows the content correctly.
- DOM sequence: identity, campaigns, creative library, attention, goals, destinations, activity, existing management. Small screens use that sequence. Do not reorder focus with positive tabindex or CSS order.
- Real controls use installed shadcn primitives. Dialog has title, description, focus trapping, Escape close and return focus. Full metadata is reachable without hover. Thumbnail buttons have unique accessible names.
- Respect reduced motion. No auto-advancing carousel, autoplay, hidden horizontal scroll, chart-only labels, or global page takeover for an optional module read.
- Long organization/campaign names and Arabic/Malayalam content use appropriate `dir="auto"`, wrapping and readable line height. Never clip actionable text to make a screenshot fit.

## Loading, authorization and error behavior

- Existing organization authentication/tenant context remains the hard boundary. Continue using the session client and RLS for every read and private Storage signing operation.
- Required Digital Twin snapshot errors use the existing route error behavior. Campaigns, references, renders and logo are optional and independently settled. A campaign source failure must not blank the library, goals or management.
- Permission/gate-disabled sections perform no reads or signing calls. They are omitted, not reported as broken integrations.
- New reads use Zod at the persistence boundary, validate tenant/linkage IDs, bounded results and safe timestamps. Throw domain-safe failures; log only operation, organizationId, correlationId, duration and safe failure code. No raw rows or signed URLs.
- Prototype Retry simulates recovery. Production Retry uses `router.refresh()` via a shared pending state; no research, rendering, provider calls, mutations or worker dispatch on page load/refresh.

## Implementation and acceptance

The execution/data/visual contracts form one handoff. Implementers must read all three. No migrations, changes to `database.types.ts`, new HTTP endpoints, dependencies, background work, broad formatting, stash or push.

The implementation is accepted only when real tenant-scoped records populate the home, every control reaches its stated destination, private images and roles are verified, the empty/failure states work, and browser evidence shows the responsive composition. A fixture prototype is visual evidence only and cannot establish staging or production completion.

## Research and adaptation

- [Figma file browser](https://help.figma.com/hc/en-us/articles/14381406380183-Guide-to-the-file-browser): recognizable previews and direct access to work. Adapted to campaigns/assets; no invented personal recents tracking.
- [Notion workspace navigation](https://www.notion.com/en-gb/help/navigate-with-the-sidebar): home as access to workspace content. Adapted to organization-scoped records; calendars, agents and generic task databases are excluded.
- [Linear Pulse](https://linear.app/docs/pulse): meaningful updates with context. Adapted to bounded existing records; no synthesized daily digest or unread state.
- Local Channels prototype and current Growth Intelligence: shared visual language and clear scope, not duplicated analytics hierarchy.

Research was inspected on 2026-09-11. These sources inform design choices; they do not establish a capability of this repository.
