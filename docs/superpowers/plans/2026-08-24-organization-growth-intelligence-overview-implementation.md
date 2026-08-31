# Organization Growth Intelligence Overview Implementation Plan

- **For agentic workers:** REQUIRED SUB-SKILL: use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task by task. Keep this checklist current during execution.
- **Goal:** Replace the broken organization cockpit with the locked light Growth Intelligence Hybrid, backed only by existing organization-scoped Digital Twin, economics, integration, opportunity, and audit reads.
- **Architecture:** Keep `OverviewPage` as the authenticated React Server Component orchestrator. Extend the pure Overview read model to shape sparse economics, opportunity, and evidence-path presentation data, then compose focused shadcn/ui sections around one narrow Recharts client boundary.
- **Tech stack:** Next.js 16 App Router, React 19 Server Components, TypeScript strict mode, Tailwind CSS v4, shadcn/ui, Recharts, Supabase session client with RLS, Vitest, Testing Library, and Playwright.
- **Spec:** `docs/superpowers/specs/2026-08-24-organization-growth-intelligence-overview-design.md`

## Global constraints

- Use Node 22 through `PATH=/home/spy/.local/node/bin:$PATH` and pnpm only.
- Do not start local Supabase or Docker and do not run `pnpm db:types`.
- Add no table, migration, RLS policy, RPC, event, worker, provider call, model call, or dependency.
- Use `getOrganizationContext` once and pass only its organization ID, effective role, user ID, and session-bound Supabase client into reads.
- Never use a service-role client in the route or its components.
- Use installed shadcn/ui primitives for every user-facing control and surface.
- Use semantic CSS tokens and the existing chart ramp; no gradient, arbitrary color, decorative font, glass effect, or neon AI styling.
- `Current revenue picture` must use a pale light surface such as `bg-primary/[0.04]`; it must not use `bg-foreground`, a hard-coded dark fill, or dark-mode inversion.
- Money remains integer minor units plus ISO currency until formatting at the presentation boundary.
- A missing period is absent, never zero; an indicative margin is an `at most` ceiling, never contribution margin.
- Open opportunities retain their impact range and evidence tier. Never display the ranking point estimate without its range.
- Demo campaigns and other local preview fixtures must not appear on Overview.
- The Overview is read-only for recommendations and integrations. Mutations remain in their existing workspaces.
- Preserve owner, admin, operator, and viewer behavior from the existing authorization contracts.
- Keep optional read failures contained and distinguish disabled, failed, empty, partial, indicative, and ready states.

## File structure

- Modify `src/app/(platform)/organizations/[organizationId]/overview/page.tsx` to parse the window, orchestrate real optional reads, and pass presentation models.
- Create `src/app/(platform)/organizations/[organizationId]/overview/page.test.tsx` for loader scoping, window selection, failure containment, and cross-tenant refusal.
- Modify `src/app/(platform)/organizations/[organizationId]/overview/loading.tsx` to mirror the locked hero, rail, comparison, evidence, activity, and foundation hierarchy.
- Modify `src/modules/organizations/application/overview.ts` to own pure Overview-only presentation models and remove Campaign demo selection.
- Modify `src/modules/organizations/application/overview.test.ts` to cover sparse windows, headline states, opportunity selection, evidence-path states, action priority, and role behavior.
- Modify `src/components/organizations/organization-intelligence-cockpit.tsx` so it becomes a small composition root for the locked hierarchy.
- Modify `src/components/organizations/organization-intelligence-cockpit.test.tsx` for section order, role controls, contained failures, and removal of preview data.
- Create `src/components/organizations/overview/overview-formatters.ts` for organization-timezone date, instant, channel-label, and money formatting.
- Create `src/components/organizations/overview/revenue-picture.tsx` and `revenue-picture.test.tsx` for the pale light economics canvas and sparse accessible chart.
- Create `src/components/organizations/overview/channel-performance.tsx` and `channel-performance.test.tsx` for the responsive channel comparison.
- Create `src/components/organizations/overview/attention-rail.tsx` and `attention-rail.test.tsx` for deterministic actions and the real opportunity summary.
- Create `src/components/organizations/overview/evidence-health.tsx` and `evidence-health.test.tsx` for the source-to-decision path.
- Create `src/components/organizations/overview/latest-authoritative-change.tsx` for safe audit metadata and the existing audit timeline dialog.
- Create `src/components/organizations/overview/organization-foundation.tsx` and `organization-foundation.test.tsx` for the collapsed Digital Twin summary and role-aware management content.
- Delete `src/components/organizations/channel-economics-overview.tsx` after its real behavior is covered by the new revenue and channel components.
- Delete `src/components/organizations/channel-economics-overview.test.tsx` after equivalent empty, failure, indicative, chart-summary, and channel tests pass in the new suites.
- Modify `e2e/shell.spec.ts` only if its old cockpit copy assertion needs the new page heading.
- Create `e2e/organization-overview.spec.ts` for representative authenticated desktop, viewer, cross-tenant, and 390-pixel checks using the existing seeded-environment helper.
- Modify `README.md` and `context/13-ui-ux-context.md` to describe the locked growth-intelligence landing hierarchy and its real-data boundaries.

## Schemas, events, exports, and blast radius

- New or changed database schemas: none.
- New or changed migrations: none.
- New or changed events: none.
- New or changed public write APIs: none.
- New or changed background tasks: none.
- New public component export: none; the route continues to import `OrganizationIntelligenceCockpit` from its existing path.
- Changed application types: Overview-only presentation unions in `src/modules/organizations/application/overview.ts`.
- Callers affected: the organization Overview route and its focused component tests only.
- Existing repositories consumed: Organization/Digital Twin, Channel Economics, Integration Hub, and Decisions/Opportunities.
- RLS policies affected: none; existing session-bound reads remain authoritative.
- Consumers deliberately not affected: full Channel Economics, channel analysis, Opportunities, Integration Hub, Guided Onboarding, Campaigns, workers, and provider adapters.

## Task 1: Lock the pure Overview read models

- **Files:** modify `src/modules/organizations/application/overview.ts` and `src/modules/organizations/application/overview.test.ts`.
- **Consumes:** `EconomicsView`, `LedgerEntry`, `enumeratePeriodStarts`, `OpportunityFeed`, `DigitalTwinSnapshot`, `IntegrationHubSnapshot`, and existing overview permission rules.
- **Produces:** `resolveOverviewWindowPreset`, a sparse `OverviewEconomics.timeline`, `OverviewRevenueSummary`, `OverviewOpportunitySummary`, and `OverviewEvidenceStep[]`.
- [ ] Add failing tests showing that missing days across a selected complete-local-day window become explicit `absent` timeline entries with null financial values rather than zeroes.
- [ ] Add failing tests for empty, failed, indicative, partial, and complete revenue headline/copy states.
- [ ] Add failing tests that total recorded revenue, recorded-day count, leading channel, cost coverage, and optional connection counts are derived only from existing read models.
- [ ] Add failing tests that the first open opportunity follows the already evidence-tiered `OpportunityFeed` ordering and carries its low/high range, currency, evidence tier, and expiry.
- [ ] Add failing tests for the opportunity empty and failed states so failed reads never become an all-clear.
- [ ] Add failing tests for four evidence steps across enabled-ready, enabled-failed, disabled, economics-empty, and opportunity-empty combinations.
- [ ] Add a failing test that only `7d`, `30d`, and `90d` are accepted and every missing or unknown value falls back to `30d`.
- [ ] Run `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/modules/organizations/application/overview.test.ts` and confirm the new expectations fail for missing presentation contracts.
- [ ] Implement the smallest pure builders, reusing `rollUpWindow` and `enumeratePeriodStarts`; do not add a financial formula or derive connection health.
- [ ] Keep `OverviewEconomics.trend` as recorded-only evidence for existing rollup semantics and add a separate discriminated `timeline` for full-window chart rendering.
- [ ] Remove `DemoCampaignSummary`, `selectRecentCampaigns`, and Campaign fixture imports from the Overview application module.
- [ ] Re-run the focused test and confirm it passes.
- [ ] Commit with `git commit -m "refactor(overview): shape growth intelligence read models"` after reviewing the diff.

## Task 2: Extend the authenticated route composition

- **Files:** modify `src/app/(platform)/organizations/[organizationId]/overview/page.tsx`; create `src/app/(platform)/organizations/[organizationId]/overview/page.test.tsx`.
- **Consumes:** Task 1 builders, `getOrganizationContext`, `getDigitalTwin`, existing economics repositories, enabled Integration Hub service, `createDecisionRepository`, and `buildOpportunityFeed`.
- **Produces:** `OrganizationIntelligenceCockpit` props for economics, integration, opportunities, readiness, actions, evidence path, reporting window, and permissions.
- [ ] Add route tests that mock the real boundaries and assert every repository receives the organization ID returned by `getOrganizationContext`, never the raw parameter independently.
- [ ] Add a route test that an authorization/context rejection prevents economics, integration, and opportunity reads.
- [ ] Add tests for `?window=7d`, `?window=90d`, and invalid-window fallback to `30d` in the organization timezone.
- [ ] Add tests that economics, enabled Integration Hub, and opportunity failures settle independently and pass explicit failed states without removing the foundational Digital Twin render.
- [ ] Add a test that a disabled Integration Hub starts no Integration Hub service read and passes `disabled`, not zero counts.
- [ ] Run the new route suite and confirm it fails before the loader changes.
- [ ] Start the optional Integration Hub and opportunity reads immediately after authorization; resolve the Digital Twin for timezone and then load ledger entries and governed coverage together.
- [ ] Build the Opportunity Feed with the effective organization role and current time, then reduce it to the Task 1 Overview summary.
- [ ] Keep safe warning logs for economics, coverage, integration, and opportunity failures with `organizationId` and `correlationId` only.
- [ ] Remove every `demoCampaigns` and `selectRecentCampaigns` import, prop, and local fixture read from the route.
- [ ] Re-run the route and Task 1 suites and confirm they pass.
- [ ] Commit with `git commit -m "feat(overview): load real opportunity and evidence state"` after reviewing the diff.

## Task 3: Build the light revenue canvas and channel comparison

- **Files:** create `src/components/organizations/overview/overview-formatters.ts`, `revenue-picture.tsx`, `revenue-picture.test.tsx`, `channel-performance.tsx`, and `channel-performance.test.tsx`.
- **Consumes:** `OverviewEconomics`, `OverviewRevenueSummary`, organization ID, selected window, and existing shadcn Chart primitives.
- **Produces:** a narrow client `RevenuePicture` chart boundary and a responsive server-renderable `ChannelPerformance` section.
- [ ] Add component tests for the five revenue states and assert the ready/indicative heading and cost/connection summaries use provided values.
- [ ] Add a semantic-surface regression assertion through a stable `data-slot="overview-revenue-picture"` hook: the section includes the pale primary surface class and no dark foreground-background class.
- [ ] Add chart tests proving absent timeline entries remain null, indicative values are labelled `at most`, and a visually hidden summary lists only recorded values.
- [ ] Add channel tests for complete, partial, indicative, no-currency, and zero-total-share states.
- [ ] Add a narrow-layout test that every channel row exposes explicit labels rather than relying on a desktop-only header.
- [ ] Run both new suites and confirm they fail because the components do not exist.
- [ ] Implement `RevenuePicture` with `Card`, `Badge`, `Alert`, `Empty`, `ChartContainer`, Recharts `AreaChart`, `accessibilityLayer`, null gaps, and semantic emerald chart tokens.
- [ ] Implement `ChannelPerformance` with real rollup rows, readable grade copy, bounded margin copy, and a link to `/organizations/[organizationId]/economics`.
- [ ] Keep all amount formatting in the focused formatter module; format only presentation values and never mutate minor units.
- [ ] Re-run both suites and confirm they pass.
- [ ] Commit with `git commit -m "feat(overview): add light revenue and channel sections"` after reviewing the diff.

## Task 4: Build the attention, opportunity, and evidence surfaces

- **Files:** create `src/components/organizations/overview/attention-rail.tsx`, `attention-rail.test.tsx`, `evidence-health.tsx`, and `evidence-health.test.tsx`.
- **Consumes:** `OverviewActionItem[]`, `OverviewOpportunitySummary` result, `OverviewEvidenceStep[]`, organization ID, permissions already encoded in action links, and shadcn Card/Alert/Badge/Button compositions.
- **Produces:** `AttentionRail` and `EvidenceHealth` without any mutation or financial inference.
- [ ] Add tests that the first deterministic action is emphasized, at most three actions render, and viewer items with no valid action render as read-only information.
- [ ] Add tests that a real open opportunity shows its impact range and evidence tier and links only to the Opportunities workspace.
- [ ] Add tests that empty opportunity state says `No open supported recommendation` while failure says `Opportunities are temporarily unavailable`.
- [ ] Add tests for source, economics, finding, and decision step order, including disabled Integration Hub not rendering `0 of 0 healthy`.
- [ ] Run the suites and confirm they fail before the components exist.
- [ ] Implement the components with no approve, edit, reject, snooze, sync, connect, or execute control.
- [ ] Use explicit text and icons for every state and route recovery to the existing responsible workspace.
- [ ] Re-run both suites and confirm they pass.
- [ ] Commit with `git commit -m "feat(overview): add governed attention and evidence rail"` after reviewing the diff.

## Task 5: Preserve activity and foundation through progressive disclosure

- **Files:** create `src/components/organizations/overview/latest-authoritative-change.tsx`, `organization-foundation.tsx`, and `organization-foundation.test.tsx`; modify `src/components/organizations/digital-twin-workspace.test.tsx` only if shared behavior needs a regression assertion.
- **Consumes:** newest-first `DigitalTwinSnapshot.auditEvents`, `DigitalTwinReadiness`, existing `CurrentDigitalTwinData`, existing `OrganizationManagement`, and overview permissions.
- **Produces:** a safe `LatestAuthoritativeChange` card and a collapsed `OrganizationFoundation` wrapper.
- [ ] Add tests that activity displays event name, entity type, actor type, and organization-local time but never serializes `payload` content.
- [ ] Add tests for an empty audit list and the full read-only timeline dialog.
- [ ] Add tests that foundation is collapsed initially, announces grounded count and the next missing section, and reveals all seven Digital Twin rows when opened.
- [ ] Add role tests: viewer has no management controls, operator cannot reach policies/lifecycle, and owner/admin retain them.
- [ ] Run the new and existing Digital Twin workspace suites and confirm the new expectations fail before composition.
- [ ] Implement the activity card with safe allowlisted fields and the existing dialog pattern.
- [ ] Implement the foundation wrapper with shadcn Collapsible and reuse existing Digital Twin/management components rather than copying their forms or authorization logic.
- [ ] Re-run the suites and confirm they pass.
- [ ] Commit with `git commit -m "feat(overview): add activity and organization foundation"` after reviewing the diff.

## Task 6: Compose the locked page and remove the obsolete cockpit

- **Files:** modify `src/components/organizations/organization-intelligence-cockpit.tsx`, `organization-intelligence-cockpit.test.tsx`, and `src/app/(platform)/organizations/[organizationId]/overview/loading.tsx`; delete `src/components/organizations/channel-economics-overview.tsx` and its test.
- **Consumes:** Tasks 2 through 5 component contracts and the existing application shell.
- **Produces:** the final Growth Intelligence hierarchy at the route's existing public component boundary.
- [ ] Rewrite the cockpit test first to assert one `Growth intelligence` heading and document order: revenue/attention hero, channel performance, evidence health, latest authoritative change, then organization foundation.
- [ ] Assert the page contains no `Strategic Campaign Ideas`, `Preview data`, Campaign fixture title, or old `Strategic Briefing` heading.
- [ ] Assert optional failures retain the other sections and that the Manage control appears only for a role with a valid management target.
- [ ] Run the cockpit suite and confirm the locked-hierarchy expectations fail against the current component.
- [ ] Reduce `OrganizationIntelligenceCockpit` to header/navigation plus focused section composition; remove the old inline briefing, campaigns, integration card, chart-tabs, and duplicate formatters.
- [ ] Use Button-as-Link compositions for in-page navigation and the existing shadcn dropdown/menu primitives for the window control.
- [ ] Update the loading skeleton to preserve the same visual rhythm without rendering fake metrics or statuses.
- [ ] Delete the obsolete Channel Economics overview component only after the new component suites are green and `rg` proves no remaining import.
- [ ] Run `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/components/organizations/organization-intelligence-cockpit.test.tsx src/components/organizations/overview src/components/organizations/digital-twin-workspace.test.tsx` and confirm it passes.
- [ ] Run `rg -n "demoCampaigns|selectRecentCampaigns|Strategic Campaign Ideas|Preview data|ChannelEconomicsOverview" 'src/app/(platform)/organizations/[organizationId]/overview' src/components/organizations src/modules/organizations/application/overview.ts` and expect no Overview dependency on those symbols.
- [ ] Commit with `git commit -m "refactor(overview): compose locked growth intelligence page"` after reviewing the diff.

## Task 7: Document and verify the complete slice

- **Files:** create `e2e/organization-overview.spec.ts`; modify `e2e/shell.spec.ts` only for stale copy; modify `README.md` and `context/13-ui-ux-context.md`.
- **Consumes:** the completed route, existing `e2e/support/authenticated.ts`, and the locked design spec.
- **Produces:** automated regression evidence plus an exact authenticated browser walkthrough when credentials are unavailable.
- [ ] Add an authenticated operator scenario that opens Overview and sees Growth intelligence, Current revenue picture, Channel performance, Evidence health, Latest authoritative change or its empty state, and Organization foundation.
- [ ] Add an authenticated viewer scenario proving read access while Manage and mutation controls are absent.
- [ ] Add an authenticated cross-tenant scenario proving the seeded other organization reveals neither its name nor Overview data.
- [ ] Add a 390-pixel scenario asserting no horizontal page overflow and that the foundation trigger remains keyboard reachable.
- [ ] Add a range-control scenario proving a 90-day choice updates the URL and rendered date label without client-side fabricated data.
- [ ] Keep authenticated scenarios conditionally skipped with the existing explicit missing-environment reason; unauthenticated tenancy protection must always run.
- [ ] Update README and the canonical UI/UX context with the locked hierarchy, light revenue surface, real opportunity state, no demo fixtures, and read-only recommendation boundary.
- [ ] Run focused unit/component/route tests with `PATH=/home/spy/.local/node/bin:$PATH pnpm exec vitest run src/modules/organizations/application/overview.test.ts 'src/app/(platform)/organizations/[organizationId]/overview/page.test.tsx' src/components/organizations/organization-intelligence-cockpit.test.tsx src/components/organizations/overview`.
- [ ] Run `PATH=/home/spy/.local/node/bin:$PATH pnpm format:check`.
- [ ] Run `PATH=/home/spy/.local/node/bin:$PATH pnpm lint` and separate unrelated baseline warnings from Overview failures.
- [ ] Run `PATH=/home/spy/.local/node/bin:$PATH pnpm typecheck`.
- [ ] Run `PATH=/home/spy/.local/node/bin:$PATH pnpm test --reporter=dot`.
- [ ] Run `PATH=/home/spy/.local/node/bin:$PATH pnpm build`; inspect `next-env.d.ts` and `tsconfig.tsbuildinfo` afterward and do not retain generated churn belonging outside the feature.
- [ ] Run `PATH=/home/spy/.local/node/bin:$PATH pnpm test:e2e -- e2e/shell.spec.ts e2e/organization-overview.spec.ts`.
- [ ] When seeded authenticated credentials are unavailable, report the skipped scenarios and provide the exact operator/viewer/cross-tenant/mobile walkthrough instead of claiming browser acceptance.
- [ ] Run a final path-scoped `git diff --check` and inspect only the Overview, plan/spec, README, and UI-context diffs.
- [ ] Commit with `git commit -m "test(overview): verify growth intelligence workspace"` after every required check that can run is green.

## Open assumptions

- The locked date control maps to the existing 7-, 30-, and 90-day economics presets; no arbitrary overview calendar is introduced in this slice.
- The Overview summarizes the existing Decision Engine Opportunity Feed, not channel-level narrated recommendations; cross-channel recommendation aggregation remains out of scope.
- The existing economics ledger reader remains usable as a read contract; this slice adds no authority to implement draft economics writes or formulas from `specs/012-channel-economics-ledger.md`.
- The latest audit event is authoritative because `getDigitalTwin` already orders `audit_events.occurred_at` descending.
- The current Organization management forms remain the only mutation path; the new foundation wrapper does not duplicate them.
- No new specification or ADR is needed beyond the locked design amendment because all persistence and authority boundaries remain unchanged.

## Test plan and tenant isolation

- Pure tests prove absent periods, bounded indicative values, stable opportunity ordering, deterministic action priority, and exact failure-state copy.
- Component tests prove the locked hierarchy, light revenue treatment, no preview fixtures, accessible statuses, role-valid controls, and progressive disclosure.
- Route tests prove every read is scoped to `context.organizationId`, authorization failure stops downstream reads, and optional failures are contained.
- Existing repository/RLS tests remain the database authority because this plan changes no query predicate, grant, table, or RPC.
- Authenticated Playwright proves operator/viewer behavior and cross-tenant refusal when staging credentials are configured.
- No pgTAP or migration command is required because the slice changes no database artifact.

## Risks and rollback

- **Financial drift:** a new summary could disagree with full Channel Economics; reuse existing rollups and assert total equality and weakest-grade behavior.
- **False continuity:** chart densification could turn absence into zero; use a discriminated absent point and null Recharts values, with regression tests.
- **Recommendation overclaim:** an empty or failed feed could read as no opportunity; keep empty and failed distinct and retain impact range plus tier for a real item.
- **Tenant leakage:** combining more reads increases scoping opportunities; derive every identifier from one authorized context and test that raw route input never scopes a repository independently.
- **Page latency:** added opportunity read increases work; start optional reads early, settle independently, and keep the browser payload presentation-only.
- **Permission drift:** the visual hierarchy could expose dead actions; reuse existing permission-derived actions and keep all server/API authorization unchanged.
- **Responsive density:** the desktop comparison could overflow mobile; use labelled stacked rows under the breakpoint and test at 390 pixels and 200 percent zoom.
- **Documentation contradiction:** the older cockpit spec requires demo campaigns; the new locked spec explicitly supersedes it and the old document carries a superseded notice.
- **Rollback:** revert the route and component commits, restore the old cockpit and Channel Economics overview component, and retain all existing data. No migration, worker, credential, or provider cleanup is required.
