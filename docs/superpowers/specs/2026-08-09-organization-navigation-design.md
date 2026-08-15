# Organization Navigation Design

> **Revised 2026-08-12.** This replaces the 2026-08-09 draft, which was written before the
> Business Memory, Channel Economics, and Campaign work landed or was planned. See
> [What changed](#what-changed-since-the-2026-08-09-draft) for the reversals.

## Purpose

Make the entire authenticated application organization-scoped. One switcher sets the active
organization, one flat menu lists everything you can do inside it, and the URL stays the single
source of truth for which organization you are looking at. Removing the account-wide surface means
the application must always be able to answer one question — _which organization does this user open
next?_ — so this design also defines that resolution and the state it needs.

## What changed since the 2026-08-09 draft

| The draft said                                                                                  | It now says                                                                             | Why                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep an account-wide Portfolio overview alongside a scoped Organization group                   | Delete the account-wide overview entirely; every workspace route is organization-scoped | The portfolio page is hardcoded zeros with no data behind it, and a cross-organization roll-up is not being built now                                                                                 |
| A two-level sidebar: account-wide **Workspace** group plus a collapsible **Organization** group | One flat **Workspace** group, entirely organization-scoped                              | With no account-wide destinations left, the parent group and its collapse behavior carry no information                                                                                               |
| Rename `digital-twin` to `dashboard`                                                            | Rename `digital-twin` to `overview`                                                     | "Overview" is the plain-English name for the organization's landing page                                                                                                                              |
| Move the switcher into the application header                                                   | Keep the switcher at the top of the sidebar, directly above the menu it scopes          | It already lives there, and `context/13-ui-ux-context.md` §5.3 already requires it there — the header move would have contradicted approved guidance for no gain now that there are no unscoped views |
| Six organization entries                                                                        | Nine Workspace entries, including Business Memory and Channel Economics                 | Both shipped after the draft                                                                                                                                                                          |
| Switcher lists organizations only                                                               | Switcher also offers **Create organization**                                            | Deleting the portfolio page removes the only existing entry point to `/organizations/new`                                                                                                             |
| `/` redirects to a fixed account-wide page                                                      | `/` resolves per user against last-accessed organization state                          | There is no fixed page left to land on                                                                                                                                                                |

## Scope

The application shell, its sidebar and switcher, breadcrumb targets, the landing resolution and every
redirect that depended on the deleted account-wide route, the rename of one presentation route, and
one new table with its RLS policies and read/write functions.

No change to organization authorization, roles, or the organization lifecycle. Organization creation
continues to use the existing `/organizations/new` wizard and its `POST /api/organizations` handler.

## Route inventory

Current state of `src/app`, and what this change does to each entry.

| Route                                                                                   | Today                                                        | After                                                           |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------------------------------------- |
| `/`                                                                                     | Redirects to `/overview` unconditionally                     | Resolves the landing per user (see below)                       |
| `/auth/callback`                                                                        | Redirects to `/overview`                                     | Redirects to `/` and lets the resolver decide                   |
| `/overview`                                                                             | Account-wide portfolio page, hardcoded zeros                 | **Deleted**                                                     |
| `/organizations/new`                                                                    | Create-organization wizard                                   | Same wizard; its back link becomes conditional                  |
| `/organizations/[organizationId]/digital-twin`                                          | Digital Twin workspace                                       | **Renamed** to `/organizations/[organizationId]/overview`       |
| `/organizations/[organizationId]/onboarding`                                            | Guided onboarding                                            | Unchanged                                                       |
| `/organizations/[organizationId]/integrations`                                          | Integration Hub                                              | Unchanged                                                       |
| `/organizations/[organizationId]/memory`                                                | Business Memory                                              | Unchanged                                                       |
| `/organizations/[organizationId]/economics`                                             | Channel Economics                                            | Unchanged                                                       |
| `/opportunities`, `/agents`, `/campaigns`, `/executions`, `/organizations`, `/settings` | Linked from the sidebar, **none exist** — every one is a 404 | Removed as links; the planned ones become disabled Soon entries |

Six of the current sidebar's eleven destinations do not exist. Removing them is a correctness fix,
not a cosmetic one.

## Landing resolution

One rule set, evaluated on the server, is the only answer to "which organization next?". It is used
by the root route, the post-authentication callback, the archive action, and the create-wizard back
link, so all four behave identically.

1. No authenticated session → `/login`.
2. Candidate set = the user's organizations whose `status` is not `archived`, RLS-filtered to
   memberships. Both `draft_onboarding` and `active` organizations qualify.
3. Candidate set empty → `/organizations/new`. This covers a first-time user with no organizations
   **and** a user whose only organizations are archived.
4. Otherwise, choose the candidate with the most recent recorded access.
5. If no candidate has any recorded access, choose the first candidate in ascending name order.

Rules 4 and 5 collapse into one deterministic ordering — most recent access first with unrecorded
organizations last, then name ascending — so there is no branch to keep in sync.

The destination is always that organization's **Overview**, regardless of status. A
`draft_onboarding` organization lands on Overview because Overview already reports readiness
section-by-section and links onward to Guided onboarding. There is no status branch in the resolver.

### Archiving

Archiving is already restricted to `draft_onboarding` organizations, in the UI and in the database
(`only_draft_organizations_can_be_archived`). An activated organization cannot be archived at all, so
this path only ever fires for a draft that was never activated.

The archive action navigates to `/` and lets the resolver run. Because the just-archived organization
now fails rule 2, the user is routed to their next most recently accessed organization, or to
`/organizations/new` when it was their only one. No separate post-archive logic exists.

### The breadcrumb fallback

`deriveRouteCrumbs` currently returns an account-wide Overview crumb for the empty path. It is a
synchronous client-side function and cannot perform the resolver's authenticated read, and it does
not need to: the empty path is `/`, which now redirects on the server and never renders the shell.
That branch returns an empty trail instead. This is the one place where the landing rules are
deliberately _not_ applied, because the code path is unreachable.

### The create-wizard back link

`/organizations/new` is reachable two ways: from the switcher while inside an organization, and as
the landing destination for a user who has none. The back link is rendered only when the resolver
finds a candidate organization, and points at that organization's Overview. A user with no
organizations sees no back link, because sending them back would resolve straight to the wizard they
are already on.

## Recording organization access

Last-accessed is per user, not per organization, and no existing table holds per-user state.
`organization_memberships` is not the place for it: its `UPDATE` policy is deliberately restricted to
owners and admins, so operators and viewers could not record their own position without widening
write access to the row that stores `role`.

A dedicated table carries it instead:

- `organization_last_access` keyed by `(user_id, organization_id)`, with `last_accessed_at`.
- RLS restricts every operation to `user_id = auth.uid()`, and insert additionally requires
  membership of the target organization, so a user can neither read another user's position nor
  record access to an organization they do not belong to.
- Reads go through a `security invoker` function that returns the resolved landing organization, so
  the ordering rule lives in one place and stays subject to the caller's RLS.
- Writes go through a `security invoker` function that upserts the row and skips the update when the
  stored timestamp is recent, so ordinary navigation does not generate a write per page view.

Access is recorded from a new organization-scoped layout. Next.js re-renders that layout when the
organization identifier changes but not when navigating between pages inside the same organization,
so entering an organization records once and moving around inside it records nothing further.

This is the first user-scoped table in a schema where every other table is tenant-scoped, so it
establishes the pattern for future per-user interface state. It is recorded in
`adrs/0015-user-scoped-interface-state.md`.

Access position is convenience, never authorization. Every organization route keeps its existing
server-side membership and feature checks. A recorded position that the user has lost access to
simply fails the RLS-filtered candidate query and falls through to the next rule.

## Navigation model

The sidebar renders a single **Workspace** group. Every entry is organization-scoped and is built
from the organization identifier in the current pathname. Order is fixed:

| #   | Entry             | Destination                                     | State                                   |
| --- | ----------------- | ----------------------------------------------- | --------------------------------------- |
| 1   | Overview          | `/organizations/[organizationId]/overview`      | Live                                    |
| 2   | Opportunities     | `/organizations/[organizationId]/opportunities` | **Soon** — route not built              |
| 3   | Campaigns         | `/organizations/[organizationId]/campaigns`     | **Soon** — route not built              |
| 4   | Business Memory   | `/organizations/[organizationId]/memory`        | Live                                    |
| 5   | Channel economics | `/organizations/[organizationId]/economics`     | Live                                    |
| 6   | Integration Hub   | `/organizations/[organizationId]/integrations`  | Live                                    |
| 7   | Guided onboarding | `/organizations/[organizationId]/onboarding`    | Live                                    |
| 8   | Agents            | —                                               | **Soon** — module planned, no route yet |
| 9   | Executions        | —                                               | **Soon** — module planned, no route yet |

The order leads with decision value rather than setup order, matching the organization-level
navigation intent in `context/13-ui-ux-context.md` §5.2.

Soon entries communicate planned information architecture. They must render as disabled controls,
never as anchors, and must never present an active state. The current sidebar renders its Soon
entries as real links to routes that do not exist; that is the defect being fixed. The sidebar
footer's Settings link is the same defect and gets the same treatment.

The group renders only when the pathname carries a valid organization identifier. On
`/organizations/new` — the only remaining platform route without an organization in scope — the
group is absent, but the switcher still renders so the user is never stranded on the create page with
no way back.

## Organization switcher

`OrganizationSwitcher` stays where it is: the sidebar header, directly beneath the product mark and
directly above the Workspace group it scopes. This preserves the rule already recorded in
`context/13-ui-ux-context.md` §5.3.

It loads the authenticated user's accessible organizations from the existing
`GET /api/organizations` endpoint, which uses the session-bound Supabase client and an RLS-filtered
`organizations` query. That query currently returns archived organizations; it is narrowed to the
same non-archived candidate set the resolver uses, because an archived organization is an abandoned
draft that cannot be worked in. The switcher and the landing therefore never disagree about which
organizations exist.

Four presentation states:

- **Loading** — a non-interactive placeholder in the trigger; the menu does not open onto a lie.
- **Empty** — "No organizations yet", with the create action as the only path forward.
- **Error** — one generic sentence. No status code, no database detail, no table name.
- **Loaded** — every returned organization by name and slug, with the pathname's organization marked
  selected.

Selecting an organization navigates to that organization's **Overview**, not to the equivalent page
under the new organization. A user reading Channel Economics for one client and switching to another
lands on that client's Overview, because the second client may not have economics data or the same
feature access. Because every workspace route embeds the organization identifier, that single
navigation moves the entire context — sidebar links, breadcrumbs, page data, the recorded access
position, and every query key that includes the organization identifier.

A **Create organization** action sits below the list, separated, and navigates to
`/organizations/new`. It replaces the disabled "Add organization after onboarding" placeholder and
the deleted portfolio page's create button.

The switcher stores neither the selected organization nor the organization list in global state; the
route remains the only source of active scope.

## Route rename

The Digital Twin presentation route becomes Overview. The canonical route changes from
`/organizations/[organizationId]/digital-twin` to `/organizations/[organizationId]/overview`. The
page export, the editor component, every link, breadcrumb label, test expectation, route mock, and
user-facing page reference move with it. No legacy route and no redirect is left behind.

The organization domain remains a Digital Twin. Its database schema, domain types, repository
functions (`getDigitalTwin`), service APIs (`DigitalTwinSnapshot`), migrations, and conceptual
documentation are unchanged. Overview is the workspace that presents and edits that authoritative
Digital Twin, and the page body may continue to name the Digital Twin as the thing being edited.
This removes the confusing URL and menu label without dragging an unrelated persistence-domain
migration along with it.

## Active state and breadcrumbs

Scope derives from the pathname. An entry is active when the pathname equals its destination or is
nested beneath it. Soon entries are never active.

`deriveRouteCrumbs` currently points the organization crumb at `/digital-twin`. It points at that
organization's Overview instead. Segment labels drop the entries for deleted account-wide
destinations and gain `overview`, plus `opportunities` and `campaigns` under their new
organization-scoped meanings.

## Cross-plan conflict

`docs/superpowers/plans/2026-08-11-unified-campaign-bundle-release-train-implementation.md` Task 6
creates an account-wide `src/app/(platform)/opportunities/page.tsx`. Under this design Opportunities
is organization-scoped at `/organizations/[organizationId]/opportunities`. That plan's Task 6 must be
amended before it is executed. This design does not edit that file; it records the conflict so the
contradiction is resolved deliberately rather than discovered mid-implementation.

## Error handling and safety

The switcher adds one session-authenticated, RLS-filtered read through an endpoint that already
exists. When the pathname carries no valid organization identifier the Workspace group is hidden and
no organization link is constructed. Failed reads surface a generic message and never affect a
route's existing authorization behavior.

The resolver and the access write run on the server against the session-bound client. Both are
RLS-filtered, so an unauthenticated user is redirected and a membership-less user cannot be routed
into, or record access against, an organization they do not belong to. Neither introduces a
service-role client. The resolver returning nothing is a valid outcome, not an error, and routes to
the create wizard.

## Verification

Component and unit tests cover:

- pathname parsing: valid organization routes, `/organizations/new`, and malformed identifiers;
- the Workspace group in the requested order, with the Soon entries disabled and non-navigable;
- the group absent, and the switcher still present, on `/organizations/new`;
- active state for each live entry, and no active state for any Soon entry;
- switcher loading, empty, error, and loaded states against a mocked `GET /api/organizations`;
- the route organization marked selected, switching navigating to the target's Overview, and the
  create action navigating to `/organizations/new`;
- landing resolution for every rule: no session, no organizations, only-archived organizations, a
  recorded access position, no recorded position falling back to name order, and a recorded position
  on an organization that has since been archived;
- the create-wizard back link present with a candidate and absent without one;
- breadcrumbs targeting Overview for the organization crumb, and an empty trail for the empty path;
- no remaining reference to `/digital-twin` or the account-wide `/overview` anywhere in `src`.

pgTAP covers the new table's tenant isolation: a user cannot read another user's access rows, cannot
record access to an organization they do not belong to, the resolver returns only the caller's
non-archived organizations in the specified order, and the write function's staleness guard suppresses
a repeat write.

Run the focused tests, then `pnpm lint`, `pnpm typecheck`, the complete unit suite, and `pnpm db:test`
on Node 22 with pnpm.

## Documentation

`context/13-ui-ux-context.md` §5.1 currently describes an agency-level navigation list that this
change removes; §5.2 lists an organization-level order that this change partially implements. Both
are updated to record the single flat Workspace group, its nine entries, the four Soon states, and
the absence of an account-wide surface for now. §5.3's sidebar-switcher rule is retained and extended
with the create action.

`README.md` replaces `/organizations/:organizationId/digital-twin` with
`/organizations/:organizationId/overview` while keeping Digital Twin as the described domain content,
and documents the landing resolution.

`adrs/0015-user-scoped-interface-state.md` records the decision to hold per-user interface state in
its own user-scoped table rather than on the tenant membership row.
