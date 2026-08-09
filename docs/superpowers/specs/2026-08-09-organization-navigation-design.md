# Organization Navigation Design

## Purpose

Make organization-scoped workspaces immediately distinguishable from account-wide views while keeping the planned workspace information architecture visible.

## Scope

This change is limited to the application shell, its navigation, the organization-list read used by the switcher, and the UI context that documents shell composition. It introduces no database migration, mutation, or new permission.

## Navigation model

The sidebar's account-wide navigation is limited to **Overview**. On an organization-scoped route, it renders an **Organization** group immediately after Overview. The group is expanded by default and can be collapsed by the user. Account-wide routes do not render the group because no organization is in scope.

The group order is fixed:

1. **Dashboard** — links to `/organizations/[organizationId]/dashboard`.
2. **Campaigns** — disabled and marked **Soon**.
3. **Agents** — disabled and marked **Soon**.
4. **Executions** — disabled and marked **Soon**.
5. **Guided Onboarding** — links to the existing onboarding route.
6. **Integration Hub** — links to the existing integrations route.

Disabled entries communicate planned information architecture but must not navigate or present a false active state. The group uses the installed shadcn `Collapsible` composition so keyboard and screen-reader behavior remains provided by the shared primitive.

## Organization switcher

`OrganizationSwitcher` moves out of the sidebar and becomes the leftmost visual header item, before the sidebar trigger and breadcrumb. It is rendered only when the active route is organization-scoped (`/organizations/[organizationId]/...`). Account-wide views, including Overview and other workspace-wide routes, do not render it because their information combines organizations.

The switcher loads the authenticated user's accessible organizations from the existing `GET /api/organizations` endpoint, which uses the session-bound Supabase client and RLS-filtered `organizations` query. It displays each returned organization's name and slug, marks the route organization as selected, and has explicit loading, empty, and safe generic-error states. Selecting an organization navigates to that organization's Dashboard rather than retaining a path that may be feature-gated for the target organization. A separate Portfolio overview link returns to the account-wide page.

The existing dropdown is adapted for the header and retains an accessible trigger. The switcher must not be used as authorization: every organization route retains its existing server-side membership and feature checks. It stores neither a selected organization nor the organization list in global state; the route remains the source of active scope.

## Route and active-state behavior

The shell derives whether it is organization-scoped from the pathname. For scoped paths it passes the route's organization identifier to the sidebar and header context. Dashboard, Guided Onboarding, and Integration Hub are active only for their corresponding organization routes. Overview remains active only for the account-wide route. Existing account-wide entries for Opportunities, Agents, Campaigns, Executions, and Organizations are removed from the sidebar because their planned destinations now belong in the organization group.

## Dashboard rename

The existing Digital Twin presentation becomes Dashboard. The canonical route changes from `/organizations/[organizationId]/digital-twin` to `/organizations/[organizationId]/dashboard`; all application links, breadcrumbs, tests, route mocks, page export names, and presentation component names move with it. User-facing references to the page change to Dashboard.

The organization domain remains a Digital Twin: its database schema, domain types, repository names, service APIs, and conceptual documentation stay unchanged. Dashboard is the organization workspace that presents and edits that authoritative Digital Twin. This avoids an unrelated persistence-domain migration while removing the old route and UI naming completely.

## Documentation

`context/13-ui-ux-context.md` will be updated to replace the old sidebar-switcher instruction and shell diagram with this scoped header-switcher model and Dashboard navigation label. `README.md` will document the new Dashboard route. The broader UI guidance continues to require an explicit organization scope on organization-level pages.

## Error handling and safety

The switcher adds only a session-authenticated, RLS-filtered read through the existing organization API; it introduces no mutation, tenant state, or authorization bypass. If the route does not contain a valid organization identifier, the switcher remains hidden. Failed reads expose no database details and do not affect the route's existing authorization behavior.

## Verification

Add focused component tests for:

- account-wide routes hiding the switcher;
- organization routes showing it at the start of the header context;
- RLS-filtered organization data rendering in the switcher, including loading, empty, and error states;
- selecting another organization navigating to its Dashboard;
- the Organization group being expanded initially and collapsible;
- requested order, links, and disabled Soon entries;
- active-state behavior for Dashboard, Guided Onboarding, and Integration Hub.

Run the focused tests, then `pnpm lint`, `pnpm typecheck`, and the relevant complete unit-test suite using Node 22 and pnpm.
