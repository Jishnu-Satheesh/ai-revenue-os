# Growth Intelligence UI redesign

## Status and scope

The user approved the information architecture and visual direction on 2026-09-07.
The production implementation is complete in the current working tree.

Target: `/organizations/[organizationId]/growth-intelligence`, within the existing
organization shell. Preserve the workflows in spec 022 and ADRs 0039/0044. This is
a redesign with additional reporting and interaction wiring, not a change to execution
authority. Ask questions directly in chat: the user could not see async tool questions.

## Accepted decisions

- Four tabs: **Overview**, **Recommendations**, **Your actions**, **Insights & market**.
- Overview opens first and orders performance, previous-action progress, then
  **Top Recommendations**, with a **More** link to the Recommendations tab.
- Performance is organization-wide, with one exact reporting-window selector. Channel and
  location filters were removed from this slice so an organization total cannot be mistaken
  for a filtered total.
- Fetch the latest available platform metrics on opening and on manual Refresh.
  Show the last successful fetch time and the reporting period. The user replaced
  the initial one-minute update request with manual refresh; no periodic refresh is required.
- Preserve the displayed figures and their timestamps on refresh failure, with Retry.
- Use Channel Audit's Acknowledge, Planned, helpful/not-helpful feedback and Snooze.
  Dismiss remains an existing workflow, accessible without dominating the action row.
- Planned records intent, helpfulness records opinion, and acknowledgement records
  that an item was seen. Campaign progress uses saved preparation states.
- The Overview preview and full Recommendations tab use the same source item IDs,
  saved decisions and feedback. A decision made in either is visible in both.

## Proposed visual direction for review

Use the current platform's Manrope font, neutral backgrounds, emerald emphasis,
restrained borders, accessible shadcn compositions and tabular figures. Channel Audit
is the reference for readable explanation, proportional graphics, evidence access and
action placement. Preserve the existing global sidebar and organization breadcrumb.

### Overview

- Header: Growth Intelligence, one short description, and Manage market monitoring.
- Four-tab navigation, followed by clearly scoped reporting controls.
- A performance section containing a plain-language summary, prominent values,
  contextual labels and simple charts. Keep profit/cost context visible when available.
- Use a trend only when comparable time-series observations exist. Use a channel
  comparison when comparable totals exist. State coverage next to each metric.
- A compact previous-actions preview with item titles, recorded status, last activity
  and the next available action; link to Your actions.
- Top Recommendations preview with the same evidence, limitations and controls as
  the complete list; More navigates to Recommendations and preserves relevant context.
- Important missing-data or monitoring-review prompts appear where they affect use.
  Advanced source and monitoring details stay in their dedicated surface.

### Recommendations

- Full list of manual recommendations, with a separate campaign-ready Opportunity
  section. Keep the exact action type visible; draft creation remains draft creation.
- Lead each item with what to do and why it matters. Keep source scope and period legible.
- Show supported impact ranges and assumptions together; absent estimates stay absent.
- Keep Acknowledge, Planned, helpful/not-helpful and Snooze readily accessible where
  the source item kind permits them. Preserve dismissal and pinning where supported.
- Evidence opens in a detail surface; it must not require leaving the current decision.
- Successful mutations display the saved outcome. Refusals preserve typed input and
  explain what to do next. Viewer roles retain readable state and evidence access.

### Your actions

- Show named items rather than generic timeline entries such as “Marked planned”.
- Make acknowledged, planned and snoozed decisions easy to scan, including decision
  dates and the snooze horizon. Preserve dismissed/history visibility.
- Campaign draft requests show waiting, preparing, ready, failed/retry and terminal
  states from their owning module. A ready draft links to its actual destination.
- Do not invent progress percentages or imply that a planned manual action is complete.
- Keep activity dates separate from the evidence period on which the advice was based.

### Insights & market

- Group business insights, market developments and missing information distinctly.
- Show market geography, source dates, freshness, limitations and conflicts in client
  language. Keep sources accessible and missing-input repair links specific.
- Retain market-profile proposal review, confirm/reject/disable behavior supported by
  existing routes, retryable research requests and source controls in reachable surfaces.
- Opening or refreshing the page must not enqueue research or campaign execution.

## Current implementation evidence

- The route currently mounts MarketProfileReview above a two-column workspace.
- The GrowthIntelligenceView currently composes Opportunities, Recommendations,
  Insights, Data Gaps and Timeline. It contains no performance-metric read contract.
- Channel reporting has declared evidence windows and channel/branch scope. Existing
  channel totals intentionally refuse mixed currencies and identify partial coverage.
- Inspected report mappings expose sales, order counts, cancellations, listing/menu
  views, cart additions and operational metrics. They do not establish generic website
  sessions or verified delivery completion. Labels must match the actual measurements.
- Planned items leave the current active recommendation list; timeline records lack
  item titles. A usable previous-actions view needs additional source-owned reads.
- Channel Recommendation helpfulness is already saved separately from triage.
  Synthesized Growth Intelligence items currently have decisions and pin preferences,
  but no equivalent helpfulness field/route was found in the inspected contract.
- Draft-request state exists in the Growth Intelligence read model. Some broader
  campaign execution visualization components use demo fixtures; those are not evidence
  of a production progress source and must not feed this page.
- Saved Superdesign init documents describe older routes. Current source code and this
  route-specific brief must govern the redesign; older Overview previews are separate work.

## Implemented decisions

- Performance reuses the existing organization Channel Overview read model and its declared
  evidence windows, currency refusal, channel rows, and coverage statements. Sales is named
  from reported revenue. Sessions and completed fulfillment remain explicitly unavailable
  because the current evidence contract does not verify them; provider-recorded loss is shown
  without being relabelled as fulfillment.
- The latest analysed declared window opens by default. The reporting window uses `?window=`;
  activity history keeps its separate `?month=` meaning. Tab state uses a URL hash, so both
  query parameters survive tab navigation and shared links.
- Overview shows three recommendations from the existing deterministic order and links to the
  full Recommendations tab. It also shows named previous actions from the saved timeline.
- Synthesized-item helpfulness is persisted through
  `growth_intelligence_item_feedback` and `record_growth_intelligence_item_feedback`. The API
  accepts the strict `{ helpful: boolean }` contract, allows members with read access, and keeps
  decision writes under the existing manage permission.
- Manual refresh requests a new server render. The client keeps the last successful performance
  and timestamp if the fresh performance read fails, and exposes Retry without blanking the page.

## Acceptance and validation outline

- Default tab, More links, URL navigation/back, channel/location/period filters work
  without losing the selected organization or mislabelling evidence.
- Acknowledge, Planned, feedback, Snooze, Dismiss, existing pins, draft creation/retry,
  profile review, source inspection and missing-data repair remain reachable as applicable.
- Saved decisions remain consistent across Overview, Recommendations, Your actions
  and the owning Channel Audit surface; failed writes never appear successful.
- No double-counted overlap, averaged percentages, mixed-currency totals, inferred
  sessions, invented fulfillment, unsupported deltas or fabricated financial results.
- Refresh succeeds, fails and retries without losing prior data or falsely updating
  the last-success timestamp; opening the route creates no research/execution work.
- Verify organization and role boundaries at the application and database layers for
  every new read/write path; preserve actor-scoped preferences.
- Test focused read-model, route and interaction regressions; run cold type checking,
  lint and appropriate integration checks. Authenticate browser acceptance separately.
- Verify keyboard focus, readable chart alternatives, mobile tab overflow, responsive
  controls, source drawers and reduced-motion behavior.

## Verification status

The hosted feedback pgTAP suite passes 17 of 17 assertions, including viewer voting,
cross-tenant refusal, actor binding, direct-write denial, and vote replacement. The complete
Vitest suite passes 4,349 tests with 6 skipped; TypeScript, lint, and the production build pass.
Lint retains 31 pre-existing warnings. Authenticated browser acceptance remains a separate
manual walkthrough because this workspace has no reusable signed-in browser session.
