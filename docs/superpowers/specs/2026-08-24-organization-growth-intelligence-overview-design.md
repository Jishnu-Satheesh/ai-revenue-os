# Organization Growth Intelligence Overview Design

**Date:** 2026-08-24

**Status:** Superseded on 2026-09-02 by the report-anatomy redesign in `docs/design/overview-redesign/` (published canvas, plus the `.dc.html` artboards it is seeded from). This document remains historical evidence for the implementation it produced — `OrganizationIntelligenceCockpit`, `ChannelEconomicsOverview`, the Strategic Briefing builder and the three demo campaign previews — all of which were retired with that redesign. Its hierarchy is no longer an implementation requirement.

**Route:** `/organizations/[organizationId]/overview`

**Selected Superdesign draft:** [Growth Intelligence — Hybrid v2](https://p.superdesign.dev/draft/8de86a1e-5f2b-477c-ab6e-5d2eddeae8dd)

**Canvas:** [AI Revenue OS — Organization Intelligence Overview](https://superdesign.dev/teams/c3d56832-bb79-49b6-910a-6450fc30e0a4/projects/8393ba3e-6abf-458c-a693-bac68f26161b?node=draft-variant-8de86a1e-5f2b-477c-ab6e-5d2eddeae8dd)

## 1. Supersession

This design supersedes `docs/superpowers/specs/2026-08-13-organization-intelligence-cockpit-design.md` for the organization Overview presentation. The earlier document remains historical evidence for the existing implementation, but its Strategic Briefing-first hierarchy, separate Integration Health card, three Campaign demo previews, and chart-tab layout are no longer implementation requirements.

The underlying tenancy, Digital Twin, Channel Economics, Integration Hub, opportunity, audit, and permission contracts remain authoritative. This redesign changes how those existing contracts are composed and does not replace them.

## 2. Purpose

The Overview is the first client-facing page after sign-in. It must read as an executive growth workspace rather than a collection of setup cards.

The first viewport answers four questions in plain language:

1. What revenue and margin evidence is visible now?
2. How trustworthy is that picture?
3. What needs human attention next?
4. Is there a real, open, evidence-tiered opportunity to review?

The page remains a read-first organization-scoped control-plane view. It does not execute recommendations, change provider state, approve spend, or substitute for the full Economics, Opportunities, Integration Hub, or Digital Twin workspaces.

## 3. Scope and tier

This is a Tier 2 UI and read-composition slice inside existing approved module contracts.

Included:

- The locked light hybrid layout from Superdesign version 2.
- A pale semantic light treatment for `Current revenue picture`; it must not use a dark surface.
- Real tenant-scoped Channel Economics values and evidence gaps.
- Real tenant-scoped Integration Hub health when enabled.
- Real tenant-scoped open opportunities from the existing Opportunity Feed contract.
- Deterministic Digital Twin readiness and role-valid action priorities.
- Safe audit history and progressive-disclosure organization foundation.
- Rolling 7-, 30-, and 90-complete-local-day views, defaulting to 30 days.
- Loading, empty, unavailable, partial, and permission-aware states.

Excluded:

- New tables, migrations, RLS policies, events, RPCs, workers, provider calls, or model calls.
- New financial formulas, contribution-margin writes, economics recomputation, or cost-rate reads.
- Aggregating channel-analysis recommendations across channels.
- Demo campaigns or any other preview fixtures on the client landing page.
- Forecasts, benchmarks, causal lift, attributed impact, or guaranteed results.
- Recommendation execution, approval, publishing, budget, price, discount, or external action controls.

No new ADR is required because the slice composes existing module contracts without introducing or reversing a durable architectural boundary.

## 4. Authoritative data sources

| Surface | Existing source | Required boundary |
| --- | --- | --- |
| Organization identity, lifecycle, timezone, readiness, foundation | `getDigitalTwin` through the session-bound Supabase client | Fatal route error when unavailable; no service role |
| Revenue, contribution, grade, channel comparison, cost coverage | `loadLedgerEntries`, `loadCatalogCoverage`, `buildEconomicsView`, and existing domain rollups | Optional contained failure; indicative values stay ceilings |
| Connection health and freshness | Enabled `IntegrationHubSnapshot` through the existing service | Omitted when rollout is disabled; contained failure when enabled |
| Open opportunity summary | `createDecisionRepository().listOpportunities` and `buildOpportunityFeed` | Existing evidence-tier ordering; contained failure; no overview mutation controls |
| Latest authoritative change | Newest `auditEvents` row already returned by `getDigitalTwin` | Display safe event metadata only; never render payload contents |
| Action priorities and foundation status | Existing deterministic overview builders and role permissions | No model scoring; no action a role cannot complete |

Every read uses the organization ID returned by `getOrganizationContext`. Client props contain presentation models, not raw ledger entries, credentials, workbook content, or unrestricted audit payloads.

## 5. Information architecture

### 5.1 Header

The header shows:

- `Growth intelligence` as the single page heading.
- Organization name, lifecycle state, and reporting timezone.
- A compact range control for 7, 30, or 90 complete local days.
- In-page links to Overview, Evidence, and Activity.
- A role-aware Manage action that targets Organization foundation.

The range control updates the server-rendered query through `?window=7d|30d|90d`. It does not introduce client-owned server state or a second economics API.

### 5.2 Current revenue picture

The primary canvas is a pale light emerald-neutral surface built from semantic tokens such as `bg-primary/[0.04]`, standard foreground text, restrained borders, and the existing chart ramp. No arbitrary color, gradient, glass effect, decorative font, or dark background is allowed.

For a ready window it shows:

- Total recorded gross revenue.
- Number of recorded local days.
- Leading channel and its recorded gross revenue.
- Measured cost coverage over applicable cost components.
- Healthy connections over total connections when Integration Hub is enabled.
- A sparse full-window chart whose absent days remain null gaps, never zeroes.
- Contribution margin only for complete or partial evidence.
- An `at most` ceiling for indicative evidence.
- Exact local date range and timezone.

The headline is deterministic by evidence state:

- Empty: revenue evidence has not arrived for this window.
- Read failure: the revenue picture is temporarily unavailable.
- Indicative: revenue is visible; profit is not proven yet.
- Partial: revenue is visible; some cost evidence remains estimated.
- Complete: recorded economics are comparable for this window.

None of these statements implies lift, causality, forecast, or attributed impact.

### 5.3 Attention and opportunity rail

The right rail shows at most three deterministic action items in existing priority order:

1. Missing access policy or another blocking foundation gap.
2. Stale, degraded, or revoked enabled integration.
3. Economics evidence gap the current role can resolve.
4. Other incomplete foundation sections.

The highest-priority item receives the strongest visual emphasis. A viewer sees the issue but no mutation link.

Below the action list, the opportunity state uses the real Opportunity Feed:

- When open opportunities exist, show the first item from the already evidence-tiered feed with its title, impact range, evidence tier, expiry context, and a link to Opportunities.
- When the feed is empty, state `No open supported recommendation` and explain that missing evidence creates a readiness need rather than a weak opportunity.
- When the read fails, state that opportunities are temporarily unavailable; never convert failure into an empty all-clear.

The Overview never exposes approve, edit, reject, snooze, or request-evidence mutations. Those remain in the Opportunities workspace.

### 5.4 Channel performance

The channel section presents one row per real rollup channel:

- Channel label.
- Recorded gross revenue.
- Contribution margin for complete or partial evidence, or `at most` for indicative evidence.
- Evidence grade in text and icon form.
- Share of recorded revenue where total gross revenue is non-zero.
- A link to Channel Economics for deeper inspection.

The desktop layout may use a comparison table composition. Narrow screens use stacked labelled rows rather than forcing horizontal page overflow.

### 5.5 Evidence health

The evidence section presents a four-stage source-to-decision path:

1. Source health from enabled Integration Hub state.
2. Economics coverage from recorded periods and governed cost coverage.
3. Finding state from the deterministic evidence limitation or supported comparison.
4. Decision state from the real open Opportunity Feed.

Each stage has a text state, one sentence of evidence, and the correct destination link. Disabled, failed, empty, partial, and ready are distinct states. Disabled Integration Hub must never render as `0 of 0 healthy`.

This section does not expose workbook rows, cells, formulas, filenames, signed URLs, prompts, model output, credentials, or customer data.

### 5.6 Latest authoritative change

The activity card uses the first audit event from the existing descending audit list and shows:

- Readable event name.
- Readable entity type.
- Actor type.
- Organization-local timestamp.
- A control that opens the existing read-only audit timeline.

The compact activity card may retain the semantic dark `bg-foreground` treatment from the locked draft. The user's light-surface instruction applies specifically to `Current revenue picture`.

### 5.7 Organization foundation

Organization foundation is one collapsed secondary surface below the intelligence sections. Its closed state shows:

- Grounded sections over total readiness sections.
- The next missing section.
- `Needs input` or `Grounded` in text, not color alone.

Opening it reveals the seven existing authoritative Digital Twin rows: Identity, Branches, Business profile, Facts, Goals, Constraints, and Policies. Role-aware management remains nested and secondary:

- Owner/admin: core records, policies, activation, and draft archive.
- Operator: core records only.
- Viewer: read-only foundation, no management controls.

## 6. Failure isolation

- Digital Twin failure uses the route error boundary because organization identity and foundation cannot be established.
- Economics failure preserves actions, opportunities, activity, and foundation.
- Opportunity failure preserves economics and renders an explicit unavailable state.
- Enabled Integration Hub failure preserves every other section and renders an explicit source-health failure.
- Disabled Integration Hub is omitted from connection metrics and described as unavailable to this organization, never as healthy or empty.
- Empty data uses purpose-built Empty states and em dashes with explanations, never synthetic zeroes.
- Structured warning logs include `organizationId` and `correlationId` but no labels, workbook values, provider payloads, or audit payloads.

## 7. Performance and component boundaries

- Authorize once with `getOrganizationContext`.
- Start optional integration and opportunity reads immediately after authorization.
- Resolve the Digital Twin to obtain the authoritative timezone, then start ledger and coverage reads together.
- Settle optional modules independently.
- Shape chart and summary data on the server; send no raw ledger entries to the chart Client Component.
- Keep the Recharts Client Component boundary limited to the revenue chart.
- Use focused Overview components rather than extending the existing 651-line cockpit file.
- Reuse installed shadcn/ui primitives and existing Recharts infrastructure; add no UI dependency.

## 8. Accessibility and responsive behavior

- Exactly one `h1`; sections follow a logical heading hierarchy.
- Every status uses text and iconography in addition to color.
- Charts use Recharts `accessibilityLayer` plus a visually hidden textual summary.
- Sparse days are described as absent evidence, not zero revenue.
- Range, disclosure, dialog, and navigation controls use shadcn/ui compositions and remain keyboard operable.
- Focus order follows document order on desktop and mobile.
- The page has no horizontal overflow at 390 px and remains usable at 200 percent zoom.
- Motion is limited to existing disclosure transitions and respects reduced motion.

## 9. Acceptance criteria

1. The route visually follows the locked Growth Intelligence Hybrid version 2 direction.
2. `Current revenue picture` uses a light semantic surface, not a dark surface.
3. No Campaign demo or preview fixture appears anywhere on Overview.
4. Revenue, contribution, channel, cost-coverage, connection, opportunity, readiness, and activity content comes from existing organization-scoped read contracts.
5. Sparse periods remain absent and never render as zero.
6. Indicative margin is always an upper bound and never a profit conclusion.
7. Open opportunities retain their impact range and evidence tier; no point estimate appears alone.
8. Empty, failed, disabled, partial, indicative, and ready states remain distinguishable.
9. Viewer, operator, admin, and owner controls match existing authorization contracts.
10. Optional failures remain contained to their surface.
11. Organization foundation preserves all seven authoritative Digital Twin sections through progressive disclosure.
12. The page exposes no unbacked export, provider action, recommendation mutation, execution, publishing, approval, spend, price, or discount control.
13. Component, route, type, lint, build, and representative desktop/mobile browser checks pass.
14. Cross-tenant route access remains refused by the existing organization context and RLS boundary.

## 10. Rollback

Rollback is an application-code revert to the existing cockpit composition and route loader. No data rollback, migration reversal, worker cancellation, or external cleanup is required because the slice introduces no persistence or side effect.
