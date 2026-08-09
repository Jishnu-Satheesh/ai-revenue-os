# Organization Navigation Design

## Purpose

Make organization-scoped workspaces immediately distinguishable from account-wide views while keeping the planned workspace information architecture visible.

## Scope

This change is limited to the application shell, its navigation, and the UI context that documents shell composition. It introduces no routes, data access, or permissions.

## Navigation model

The sidebar's account-wide navigation is limited to **Overview**. On an organization-scoped route, it renders an **Organization** group immediately after Overview. The group is expanded by default and can be collapsed by the user. Account-wide routes do not render the group because no organization is in scope.

The group order is fixed:

1. **Dashboard** — links to the existing Digital Twin route; the route name remains unchanged in this change.
2. **Campaigns** — disabled and marked **Soon**.
3. **Agents** — disabled and marked **Soon**.
4. **Executions** — disabled and marked **Soon**.
5. **Guided Onboarding** — links to the existing onboarding route.
6. **Integration Hub** — links to the existing integrations route.

Disabled entries communicate planned information architecture but must not navigate or present a false active state. The group uses the installed shadcn `Collapsible` composition so keyboard and screen-reader behavior remains provided by the shared primitive.

## Organization switcher

`OrganizationSwitcher` moves out of the sidebar and becomes the leftmost visual header item, before the sidebar trigger and breadcrumb. It is rendered only when the active route is organization-scoped (`/organizations/[organizationId]/...`). Account-wide views, including Overview and other workspace-wide routes, do not render it because their information combines organizations.

The existing switcher's dropdown and sidebar-responsive behavior will be adapted for the header; its selection semantics and accessible trigger remain intact. The switcher must not be used as authorization: every organization route retains its existing server-side membership and feature checks.

## Route and active-state behavior

The shell derives whether it is organization-scoped from the pathname. For scoped paths it passes the route's organization identifier to the sidebar and header context. Dashboard, Guided Onboarding, and Integration Hub are active only for their corresponding organization routes. Overview remains active only for the account-wide route. Existing account-wide entries for Opportunities, Agents, Campaigns, Executions, and Organizations are removed from the sidebar because their planned destinations now belong in the organization group.

## Documentation

`context/13-ui-ux-context.md` will be updated to replace the old sidebar-switcher instruction and shell diagram with this scoped header-switcher model. The broader UI guidance continues to require an explicit organization scope on organization-level pages.

## Error handling and safety

This is presentational only. No new API calls, mutations, tenant state, or authorization paths are introduced. If the route does not contain a valid organization identifier, the switcher remains hidden.

## Verification

Add focused component tests for:

- account-wide routes hiding the switcher;
- organization routes showing it at the start of the header context;
- the Organization group being expanded initially and collapsible;
- requested order, links, and disabled Soon entries;
- active-state behavior for Dashboard, Guided Onboarding, and Integration Hub.

Run the focused tests, then `pnpm lint`, `pnpm typecheck`, and the relevant complete unit-test suite using Node 22 and pnpm.
