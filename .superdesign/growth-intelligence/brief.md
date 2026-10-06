# Growth Intelligence: approved information architecture and design brief

This targets `/organizations/[organizationId]/growth-intelligence`, NOT the older
organization Overview route. Read current source files over outdated onboarding or
demo-campaign compositions in the shared design-system document. The current root
uses Manrope; white and neutral gray surfaces; emerald primary/chart colors; Lucide;
shadcn New York controls, 10px base radius, restrained borders. Preserve the current
shell's organization sidebar and 64px breadcrumb header. Source brand is the Lucide
Waypoints icon in a dark square with the AI Revenue OS wordmark. No separate logo
image is used in this render branch. Keep it exactly as source, using the Lucide icon.

## Approved page structure

Four local tabs, distinct from the global sidebar:
Overview (default), Recommendations, Your actions, Insights & market.
Overview orders Business performance, Your previous actions, Top Recommendations.
The Top Recommendations section has an explicit More link to Recommendations and
the preview cards carry the same controls as their full-list versions.

## Reviewable visual direction

A calm, readable business review for a nontechnical client. Draw on Channel Audit's
headline-first story, large values, proportional visuals, evidence drawer and pale
emerald advice panels. Avoid a wall of identical KPI cards. Use spacious section
headers, readable chart labels and short prose. No decorative images or AI imagery.
Keep Top Recommendations visible within a normal short scroll; do not let a giant
hero or tall chart bury it. Single-column mobile order mirrors the desktop reading
order. Tabs scroll horizontally on mobile; controls wrap; dialogs fit the viewport.

## Data and interaction boundaries

- Latest available platform data loads on open. A manual Refresh with a spinning
  icon, last successful fetch label and explicit Retry on failure. No automatic timer.
- Reporting period, channel and location controls belong to performance. Initially
  all channels/all locations. Keep exact report dates and source coverage visible.
  Activity records show their own dates, and recommendation cards their evidence periods.
- Sales, order counts, menu/listing views, cancellations and operating availability
  exist in inspected report mappings. Do not relabel menu views as sessions or
  total-minus-cancelled orders as verified fulfillment.
- Comparisons require matching periods, scopes and definitions. Missing figures
  display a reason. No fabricated confidence score, revenue outcome or ROI badge.
- Manual recommendations: Acknowledge, Planned, thumbs up (Helpful), thumbs down
  (Not helpful), Snooze; secondary Dismiss with reason. Acknowledged and Planned are
  decisions; helpfulness is a separate preference. No manual percentage-complete bar.
- Campaign opportunities form a separate section on Recommendations; creating a
  draft requires objective and audience, then shows persisted preparation status.
  Do not include Approve, Launch, Publish, Increase budget or automatic execution.
- Your actions shows titles, saved decisions, dates, snooze horizons and draft state.
  Acknowledge, Planned and Snooze changes should be reflected in the preview and list.
- Insights & market contains business insights, market developments, source inspection
  and missing-data repair links. Manage market monitoring exposes the existing profile
  confirmation/rejection and research-retry workflow using plain language.

## Mockup fixture only

Use a persistent small badge: “Design preview · illustrative data”. Use fictional
“Example Kitchen”, three generic channels (Delivery A, Delivery B, Direct), and
Downtown/Marina locations. No real client payload, identifiers, credentials or contacts.
The eventual application will use live tenant-scoped reads; mockup values are design
fixtures only. Do not add sample data to production code.

Use one consistent February 2026 fixture for performance:
- Reported sales AED 120,000; matching January AED 100,000; +20% comparison.
- Orders placed 2,400; January 2,000; +20%.
- Menu views 12,000; January 10,000; +20%; available from Delivery A only.
- Cancelled orders 120 of 2,400, 5%; January 100 of 2,000, 5%.
- Sales channel split: Delivery A AED 60,000; Delivery B AED 40,000; Direct AED 20,000.
- Source coverage for sales/orders: 3 of 3 channels and 2 locations. Menu views: 1 of 3.
- Fulfillment detail: delivery completion and delivery time were not supplied. Make
  this a concise information row in Operations detail; do not draw invented delivery KPIs.
- Example fetch time 10:42 AM, with reporting dates 1–28 Feb 2026 shown independently.
- Trend chart, if drawn, uses four labelled February weekly buckets with sales
  24,000 / 28,000 / 32,000 / 36,000. Their sum is exactly 120,000.
- Scope filters must use coherent subsets in the mockup or show an explicit preview
  explanation; do not keep all-organization figures under a narrowed scope label.

Illustrative recommendation preview: 3 items, with full list of 5. Proposed preview
length is for visual review, not a new priority policy.
1. “Review the opening hours behind cancelled orders” — February report includes
   avoidable cancellations. Advice to compare listed hours with actual availability.
2. “Check where menu visitors stop before ordering” — Delivery A menu and cart
   reports support investigating the funnel. State that traffic covers Delivery A.
3. “Review the items that attracted first-time orders” — a qualitative follow-up,
   no financial impact estimate without cost evidence.

Previous-action fixture: one recommendation Marked planned on 3 Mar; one insight
Acknowledged on 4 Mar; one recommendation Snoozed until 10 Mar; one campaign draft
Preparing. These are recorded actions, not measured business improvement.
The full Recommendations tab can contain an empty campaign-ready section with the
clear explanation that supported advice is available while draft inputs are incomplete.
Never fabricate a campaign-ready impact range to make the design look richer.

## Current-source baseline instruction

If reproducing the current UI, reproduce source order exactly: heading and operational
subtitle; Market profile review; Activity month navigation and counts; 3:2 two-column
workspace, left Priority actions and Data gaps, right Insights, Market Watch and Activity.
The baseline has no tabs, performance hero or charts. Use the same fictional-data label.
The approved four-tab design belongs to the subsequent redesign, not this baseline.

Use ONLY the fonts, colors, spacing, and component styles defined in the design
system and current source. Do not introduce unrelated fonts, colors or visual styles.
