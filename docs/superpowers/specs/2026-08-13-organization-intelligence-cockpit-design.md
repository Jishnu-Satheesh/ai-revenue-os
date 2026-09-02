# Organization Intelligence Cockpit Design

> **Superseded 2026-08-24.** The locked Growth Intelligence Hybrid direction is specified in
> `docs/superpowers/specs/2026-08-24-organization-growth-intelligence-overview-design.md`. This
> document remains historical context for the cockpit implementation it originally approved.

**Date:** 2026-08-13

**Status:** Approved visual direction; awaiting written-spec review

**Route:** `/organizations/[organizationId]/overview`

**Selected Superdesign draft:** [Intelligence Cockpit - Performance & Readiness Corrected](https://p.superdesign.dev/draft/dce2a54d-ef04-47cd-b070-9741786a4d98)

## 1. Purpose

Redesign the organization Overview as the shared front door for client owners, agency operators,
and administrators. The page must explain how the organization is doing without requiring the
reader to understand data models, integrations, attribution, or campaign machinery.

The first viewport answers four questions:

1. Is the organization's operating context ready?
2. What does the current evidence say?
3. How are its channels performing?
4. What needs human attention next?

The page remains an organization-scoped control-plane view. It does not become a provider console,
an execution surface, or a substitute for the full Digital Twin, Channel Economics, Integration
Hub, or Campaign workspaces.

## 2. Scope and tier

This is a Tier 2 slice inside the existing Organization, Channel Economics, Integration Hub, and
Campaign specifications. It changes presentation and adds a composed read model; it does not move
the control-plane or execution-plane boundary.

Included:

- The selected Intelligence Cockpit layout and responsive behavior.
- A compact, real Digital Twin readiness strip.
- A deterministic evidence-backed Strategic Briefing.
- A three-view shadcn Chart for real Channel Economics data.
- Real Integration Hub health when that feature is enabled for the organization.
- The latest three Campaign demo ideas, visibly marked as preview data.
- A progressive-disclosure summary of current Digital Twin records.
- Role-aware management controls and a compact real audit activity feed.
- Loading, empty, partial, unavailable, and error states for each optional module.

Excluded:

- New tables, migrations, RLS policies, events, or provider calls.
- An LLM-generated narrative in this slice.
- Persisting Campaign Bundles or presenting campaign demo values as real business state.
- Executing, approving, publishing, scheduling, or spending from the Overview.
- A new export format. The mockup's `Export intelligence` action is omitted until a backed export
  exists.
- New attribution, causal-lift, benchmark, or forecast claims.
- Replacing the full Channel Economics, Integration Hub, Campaign, Guided Onboarding, or audit
  workspaces.

No ADR is required. The design composes existing module contracts without introducing or reversing
a durable architectural decision.

## 3. Users and permission behavior

Every authenticated organization member can read the Overview through the existing session-bound,
RLS-filtered organization context.

| Role | Read intelligence | Edit profile, branches, facts, goals, constraints | Edit policies | Activate or archive |
| --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes | Yes |
| Operator | Yes | Yes | No | No |
| Viewer | Yes | No | No | No |

The UI mirrors those permissions, while the existing API authorization remains authoritative.
Viewers never see mutation controls that will fail after selection. Operators see edit actions only
for the records they may change. Policy, activation, and archive controls appear only for owners and
admins.

## 4. Information architecture

### 4.1 Organization header

The header shows:

- Organization name and lifecycle status.
- A plain reporting-window label: the last 30 complete days in the organization's timezone.
- `Manage organization` for roles with at least one available mutation. The action moves focus to
  the management section and selects the relevant Digital Twin area.
- No decorative or unbacked action.

The existing sidebar and application header remain unchanged.

### 4.2 Digital Twin readiness strip

A full-width strip sits directly under the organization header. It contains:

- Readiness percentage.
- `x of 6 sections grounded`.
- Six named states: Identity, Branches, Business profile, Facts, Goals, and Policies.
- The exact missing section or sections, expressed in text as well as color and icon.
- `Manage data foundation` for a role allowed to resolve the missing item; otherwise
  `View data foundation`.

Readiness uses the existing deterministic rules from `OverviewPage`. It is not a model score and is
never inferred from activity or economic performance.

### 4.3 Main desktop composition

Desktop uses the selected 8/4 grid.

The primary column contains, in order:

1. Strategic Briefing.
2. Channel Economics.
3. Current Digital Twin Data.
4. Strategic Campaign Ideas.
5. Organization management, collapsed by default and available only to mutation-capable roles.

The right rail contains, in order:

1. Action Required.
2. Integration Health, only when Integration Hub is enabled for the organization.
3. Recent Activity.

The right rail is normal document flow, not sticky. It must remain usable on short screens and may
not obscure lower content.

### 4.4 Mobile and tablet

Below the desktop breakpoint the page becomes one column in this order:

1. Organization header.
2. Readiness strip, with the six states wrapping into a two-column list.
3. Action Required.
4. Strategic Briefing.
5. Channel Economics.
6. Integration Health when enabled.
7. Current Digital Twin Data.
8. Strategic Campaign Ideas.
9. Recent Activity.
10. Organization management when permitted.

Charts retain a readable minimum height, tabs remain horizontally scrollable when necessary, and
all management targets remain touch-sized. No desktop card is miniaturized into unreadable text.

## 5. Strategic Briefing

The briefing is AI-native in interaction design but deterministic in this slice. It translates
current structured evidence into plain business language without paying model latency or inventing
judgment that the runtime cannot yet support.

The briefing builder emits at most three statements:

- **Foundation:** the most important Digital Twin readiness gap, if one exists.
- **Economics:** the most important trustworthy economics observation or trust limitation.
- **Operations:** the highest-priority enabled Integration Hub health issue, if one exists.

Each statement contains:

- A short conclusion.
- Why the page can say it.
- Evidence state and freshness.
- One inspect link to the responsible section or workspace.

Rules:

- Prefer a limitation over a performance claim when economics data is partial or indicative.
- Do not claim lift, causality, efficiency gains, a benchmark difference, or future performance
  without the corresponding real baseline and attribution evidence.
- Do not turn Campaign preview fixtures into briefing evidence.
- Do not expose confidence percentages unless a calibrated domain contract supplies them.
- Missing data remains visible and never becomes a guessed sentence.

The component contract is intentionally typed so a future model-backed narrative can replace only
the wording stage. Any future model output must still cite the same deterministic evidence items and
pass schema validation; that future change is outside this slice.

## 6. Action Required

The queue merges real actionable states and displays at most three items. Priority is deterministic:

1. A missing access policy or another Digital Twin condition blocking activation or governed work.
2. A degraded, stale, or revoked enabled integration.
3. An economics trust gap the current role can resolve.
4. Other incomplete Digital Twin sections.

Each row contains a severity icon, plain title, one-line impact, and a role-valid next action. A gap
that no current UI can resolve is informative but is not rendered as a clickable task. Campaign
preview items do not enter this queue.

When nothing requires action, the card says that no blocking issue is visible in the current data.
It does not promise that the business itself is healthy.

## 7. Channel Economics chart

### 7.1 Component choice

Install the official shadcn `chart` component with the repository's pnpm runner. This adds the
project-local `ChartContainer`, `ChartTooltip`, `ChartTooltipContent`, `ChartLegend`, and
`ChartLegendContent` composition and its Recharts dependency. Do not draw the production chart with
handwritten SVG or styled percentage bars.

The Card contains shadcn `Tabs` with three views:

1. **Trend** — gross revenue and trustworthy contribution margin across the last 30 complete local
   days.
2. **Channel comparison** — gross revenue and trustworthy contribution margin grouped by channel.
3. **Data trust** — complete, partial, and indicative coverage, plus measured/priced/applicable cost
   coverage.

### 7.2 Overview economics read model

The Overview reuses:

- `resolveWindow` for the 30-day organization-timezone window.
- `loadLedgerEntries` for tenant-scoped ledger rows.
- `loadCatalogCoverage` for governed cost coverage.
- Existing economics rollup rules for channel totals and completeness.

A new pure overview presenter groups ledger entries by their existing local period and produces:

- Window and currency.
- Daily gross-revenue points.
- Daily contribution-margin points only where the rollup permits a figure.
- Optional indicative ceiling points, never named or styled as profit.
- Channel rollups with their completeness grade.
- Counts of complete, partial, and indicative periods.
- Governed cost coverage and actionable gaps.

The Overview aggregate and the full Channel Economics aggregate must use the same domain rollup
functions. Two separate financial formulas are prohibited.

### 7.3 Chart semantics

- Gross revenue and contribution margin use distinct shades from `--chart-1` through `--chart-5`.
- Axis and tooltip values include the ledger's ISO currency.
- Tooltips include date or channel, value, and completeness state.
- The legend names full business terms; it does not use unexplained abbreviations.
- Indicative margin is represented as a neutral dashed ceiling or an omitted line segment with an
  explicit annotation. It is never plotted as an ordinary contribution-margin series.
- The card ends with one deterministic plain-language takeaway and `View channel economics`.
- A visually hidden data summary makes the same values available without interpreting the chart.
- Recharts `accessibilityLayer` is enabled.

### 7.4 Economics states

- **No ledger rows:** render the existing no-trade Empty state; do not render an all-zero chart.
- **Gross revenue but no usable margin:** default to Data trust, show revenue, and explain why margin
  is unavailable.
- **Some indicative periods:** render gaps or ceiling markers and state how many periods are
  excluded from profit conclusions.
- **Catalog unavailable:** state that cost coverage could not be checked; never render an all-clear.
- **Read failure:** contain the failure in the economics Card with safe retry copy and retain the
  rest of the Overview.

## 8. Current Digital Twin Data

This section is read-first progressive disclosure, built from shadcn `Collapsible` rows. It does not
open as a wall of forms.

Seven rows preserve the current authoritative data:

1. Identity.
2. Branches.
3. Business profile.
4. Facts.
5. Goals.
6. Constraints.
7. Policies.

Constraints are intentionally included even though the readiness score remains the current six-part
score. A constraint is important operating context but is not currently a readiness requirement.

Every collapsed row shows its state and one useful summary. Expanded content shows only fields the
current snapshot actually supplies, including source, verification state, and freshness where those
fields exist. The UI does not manufacture freshness for records without a timestamp or provenance
field.

For authorized roles, an Edit action focuses the corresponding form in Organization management.
Viewers receive Inspect-only rows. Facts retain their verified/imported/inferred/stale states, and a
verified fact must never appear visually weaker because a later inferred value exists.

## 9. Organization management

The existing `OverviewEditor` behavior is preserved but moved behind a secondary, collapsed
management surface. Its large equal-weight form grid is not part of the default client story.

The management surface uses shadcn `Tabs` for Business profile, Branches, Facts, Goals,
Constraints, and Policies. Existing mutation endpoints, validation, audit events, and refresh
behavior remain authoritative.

- Owner/admin: all tabs plus activation and draft archive controls.
- Operator: Business profile, Branches, Facts, Goals, and Constraints only.
- Viewer: management surface omitted.

Opening management from a summary row selects the matching tab and moves keyboard focus to its
heading. Success and safe error Alerts remain visible within the management region. Archiving keeps
its existing `AlertDialog` confirmation.

## 10. Integration Health

The card is rendered only when Integration Hub is enabled for the organization. The Overview reuses
the existing authenticated context and `IntegrationHubSnapshot`; it does not infer connection state
from catalog visibility or onboarding channel names.

The compact card shows:

- Healthy connections over total connections.
- Action-required count.
- At most three real connections, ordered with action-required states first.
- Provider/account label, text health state, freshness, and the existing safe health explanation.
- `Manage connections` linking to the Integration Hub.

The UI never substitutes mock Google Ads, Instagram, or Shopify connections. A disabled rollout
renders no Integration Health card and contributes no fake `0 of 0 healthy` statement.

Integration read failure is contained within this card and does not fail Digital Twin or economics
content. No credential reference, provider error, secret, or raw payload reaches the page.

## 11. Strategic Campaign Ideas

The section reads `demoCampaigns`, sorts by `updatedAt` descending, and shows exactly the latest
three entries. The section header carries a persistent `Preview data` Badge.

Each shadcn `Collapsible` summary shows:

- Title.
- Lifecycle.
- Source label.
- Channels.
- Last update in the organization timezone.

Expanded content shows:

- Objective.
- Spend ceiling when present.
- Blocker count.
- Link to the existing Campaign detail or portfolio route.

The cards never say that a campaign was published, executed, measured, approved, or profitable
unless the fixture itself explicitly represents that lifecycle. Preview campaigns do not influence
the briefing, action queue, Channel Economics, or Recent Activity.

When production campaign persistence replaces the fixtures, the Overview consumes that module's
RLS-backed summary contract without changing the page's presentation contract.

## 12. Recent Activity

Recent Activity uses the latest three Digital Twin audit events already returned by
`getDigitalTwin`. It shows event name, entity type, actor type, and organization-local time. A link
opens a shadcn `Dialog` containing the existing full audit timeline. The Dialog is read-only and
available to every organization role, independently of the mutation-only management surface.

Integration activity stays inside Integration Health. Campaign preview activity is not mixed into
the authoritative audit list.

## 13. Server composition and failure isolation

`OverviewPage` validates membership once with `getOrganizationContext` and carries the returned
organization ID, role, and session-bound Supabase client into every read.

The Digital Twin read is foundational. Optional economics and enabled-integration reads run in
parallel and settle independently:

- Digital Twin failure uses the route error boundary because the page cannot identify the
  organization or compute readiness without it.
- Economics failure renders the economics-contained error state.
- Integration failure renders the integration-contained error state.
- Integration Hub disabled is a valid omitted state, not an error.
- Campaign demo data is local and does not participate in server failure handling.

No Overview query uses a service-role client. Every database read remains RLS-filtered and explicitly
scoped to the route organization. Client component props contain only the presentation data needed
by the chart and interactive disclosures.

## 14. Visual and interaction rules

- Preserve the existing shadcn Nova/Radix shell, system sans typography, neutral surfaces, emerald
  primary, semantic status colors, and restrained borders/shadows.
- Use semantic tokens and the existing emerald chart ramp only.
- No gradients, glass effects, decorative AI orb, external font, or consumer-dashboard styling.
- Use complete shadcn compositions for Card, Tabs, Collapsible, Alert, Empty, Badge, Button,
  Progress, Tooltip, and Chart.
- AI is communicated through evidence-first briefing and inspectable reasoning, not glowing
  decoration.
- Status is never color-only; text and icons accompany every state.
- Motion is limited to short collapsible-height and tab-content transitions and respects reduced
  motion.

## 15. Performance

- Start Digital Twin, economics, and enabled-integration reads in parallel after one authorization
  check.
- Do not fetch the full Campaign detail for the three summaries.
- Do not send raw ledger entries to the browser. Build chart points on the server.
- Keep the chart Client Component boundary narrow; the rest of the page remains Server Components
  where practical.
- Avoid a second Integration Hub client refetch on Overview. The card is a server snapshot and links
  to the realtime-capable full workspace.

## 16. Accessibility

- The page has one `h1`; Card headings follow a logical hierarchy.
- Readiness progress has an accessible percentage and `x of 6` label.
- Tabs, collapsible triggers, buttons, and links are keyboard operable shadcn primitives.
- Expanded disclosures maintain focus and expose `aria-expanded` through the primitive.
- Chart meaning is available through accessible Recharts output and a textual data summary.
- Error, warning, complete, partial, indicative, and preview states use text in addition to color.
- Desktop and 390 px mobile browser checks include horizontal-overflow and focus-order review.

## 17. Testing

### Pure read-model tests

- Readiness for zero through six grounded sections.
- Readiness section labels and the restaurant physical-branch rule.
- Briefing priority and the prohibition on unsupported lift, causal, benchmark, and forecast copy.
- Action queue priority and role-valid recovery actions.
- Thirty-day trend grouping in the organization timezone.
- Overview economics totals equal the existing domain rollup totals.
- Complete, partial, indicative, no-margin, no-catalog, empty, and mixed-period states.
- Integration feature-disabled and action-required ordering.
- Latest three Campaign fixtures by `updatedAt`.

### Component tests

- All requested sections render with representative real read models.
- Exactly three Campaign ideas and one persistent Preview data label.
- Chart tabs, legend, tooltip content, textual summary, and indicative-ceiling copy.
- Viewer sees no mutation controls.
- Operator cannot edit policies or use lifecycle controls.
- Owner/admin can reach every allowed management section.
- Empty and contained error states do not remove unaffected sections.
- Readiness and health states remain understandable without color.

### Authorization and tenancy

- A member cannot load another organization's Overview.
- Every economics and integration input is scoped to the route organization.
- The implementation introduces no service-role user-facing path.
- Existing API authorization tests continue to prove mutation roles independently of UI hiding.

### Browser acceptance

- Desktop matches the selected Intelligence Cockpit hierarchy at 1280 px or wider.
- Mobile at 390 px has no horizontal page overflow.
- All six readiness states, all seven Digital Twin rows, chart tabs, and three Campaign ideas are
  reachable with keyboard navigation.
- Preview data, indicative ceilings, partial data, and integration failures remain plainly labeled.

### Required commands

- `PATH=/home/spy/.local/node/bin:$PATH pnpm typecheck`
- `PATH=/home/spy/.local/node/bin:$PATH pnpm lint`
- Focused Vitest suites for the overview read model and components.
- `PATH=/home/spy/.local/node/bin:$PATH pnpm test`
- `PATH=/home/spy/.local/node/bin:$PATH pnpm build`
- Relevant Playwright Overview acceptance scenarios.

No database migration is planned, so a new pgTAP suite is not required. Existing RLS coverage remains
part of the trust boundary and must stay green if related repository code changes.

## 18. Acceptance criteria

1. The Overview visibly follows the selected Performance & Readiness Corrected cockpit direction.
2. The first viewport shows organization context, Digital Twin readiness, Strategic Briefing,
   Action Required, and the beginning of Channel Economics at desktop size.
3. Readiness is computed from the existing six deterministic Digital Twin sections.
4. Strategic Briefing is evidence-backed and makes no unsupported business-impact claim.
5. Channel Economics uses the official shadcn Chart composition and real ledger data.
6. Trend, Channel comparison, and Data trust views remain understandable to a non-technical reader.
7. Indicative margin is always presented as an upper bound and excluded from profit conclusions.
8. Current Digital Twin Data preserves identity, branches, profile, facts, goals, constraints, and
   policies through progressive disclosure.
9. Exactly three recent Campaign ideas appear and remain unmistakably preview data.
10. Enabled Integration Hub health is real; disabled or failed Integration Hub state never becomes
    fake health data.
11. Viewer, operator, admin, and owner controls match existing server permissions.
12. Optional module failures are contained to their cards.
13. The page has no unbacked export, execution, publishing, approval, or spend action.
14. Component, authorization, type, lint, build, and browser acceptance checks pass.

## 19. Files and dependencies anticipated by the implementation plan

Expected areas, subject to the implementation plan's final inspection:

- Modify the organization Overview page and editor presentation.
- Add focused Overview read-model and presentation components.
- Add the official shadcn Chart source and Recharts dependency through the pnpm shadcn CLI.
- Reuse existing Organization, Economics, Integration, and Campaign contracts.
- Add focused unit, component, and browser tests.
- Update `.superdesign/design-system.md` with this Overview contract.

No schema, migration, event contract, worker, provider adapter, public write API, or external AI call
is expected.

## 20. Risks and rollback

- **Financial drift:** a second aggregation formula could disagree with Channel Economics. Reuse
  existing rollups and assert equality in tests.
- **Page latency:** combining module reads could slow the landing page. Run optional reads in
  parallel, keep chart data server-shaped, and contain optional failures.
- **Preview confusion:** Campaign fixtures could look operational. Keep one persistent Preview data
  label and exclude fixtures from authoritative summaries.
- **Permission confusion:** hidden-only authorization could drift. Derive visible actions from the
  current membership role while retaining API enforcement and tests.
- **Integration leakage:** provider metadata could expose credentials or unavailable capabilities.
  Consume only the existing safe snapshot and never infer availability.
- **Client overload:** management forms could reclaim the whole page. Keep them collapsed and
  secondary to the intelligence story.

Rollback is a normal application-code revert: restore the current Overview composition, remove the
new overview components and chart dependency if unused elsewhere, and retain all existing data.
There is no database rollback.
