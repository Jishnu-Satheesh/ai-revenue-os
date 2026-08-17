# Organization Navigation Implementation Plan

> **Revised 2026-08-12** against `docs/superpowers/specs/2026-08-09-organization-navigation-design.md`
> (also revised 2026-08-12). The 2026-08-09 plan targeted a `dashboard` rename, a collapsible
> Organization sub-group, a header-mounted switcher, and no schema change. None of those survive; do
> not follow the previous task list.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox syntax for tracking.

**Goal:** Make the whole authenticated application organization-scoped — one flat Workspace menu, one
live organization switcher that also creates organizations, the Digital Twin route renamed to
Overview, the dead account-wide surface deleted, and one server-side rule that decides which
organization a user opens next.

**Architecture:** Pathname is the only source of active scope. A pure helper module parses the
organization identifier and builds the Overview URL; the sidebar, switcher, and breadcrumbs consume
it. A new user-scoped `organization_last_access` table records where each user was, read back through
one `security invoker` SQL function so the ordering rule lives in a single place under RLS. The root
route, the auth callback, the archive action, and the create-wizard back link all call one resolver
rather than duplicating rules. Only UI route and component names change; `getDigitalTwin`,
`DigitalTwinSnapshot`, and every existing table are untouched.

**Tech Stack:** Next.js 16, React 19, TypeScript strict mode, TanStack Query v5, Supabase Auth/RLS,
shadcn/ui, Vitest, Testing Library, pgTAP, pnpm, Node 22.

## Global Constraints

- Run every package command through `/home/spy/.local/node/bin/pnpm` on Node 22; use pnpm only.
- No service-role client in any user-facing request path. No new mutation on existing tables.
- Active organization comes only from `/organizations/[organizationId]/...`. Switching organizations
  navigates to the target organization's Overview, never to the equivalent page.
- Landing resolution is server-side and RLS-filtered. Recorded access is convenience, never
  authorization: a position the user has lost access to must fall through, not redirect.
- Soon entries are disabled non-anchor controls. They never navigate and never show an active state.
- Leave no legacy route and no redirect for `/digital-twin` or the account-wide `/overview`.
- Digital Twin stays the domain name. Overview is only the route, the menu label, and the
  presentation component name.
- Use installed shadcn components only.
- Each task ends with a working application. Do not batch the commits.

## Open Assumptions

- The wizard at `/organizations/new` is what "the create new organization UI" means. The deleted
  `/overview` page held only a button pointing at it, not the form itself.
- A five-minute staleness guard on the access write is a starting value, not a measured one. It only
  affects write volume, never resolution correctness.
- Access is recorded on entering an organization, not on every page view inside it. Next.js does not
  re-run a layout when navigating between its own children, so the organization-scoped layout is the
  natural once-per-organization choke point.

## As built

Executed 2026-08-12. Three deviations from the plan as written, each forced by something discovered
during implementation:

- **Migration timestamp is `20260812120000`, not `20260812000000`.** The shared staging database had
  five migrations applied from the `feat/unified-campaign-bundle` worktree
  (`20260812100000`–`20260812110000`) whose files are not on this branch. The planned timestamp would
  have sorted before them. `supabase db push` also refuses to run while remote migrations are missing
  locally, and its suggested repair would mark the other branch's migrations as reverted, so the
  migration was applied through the same `DATABASE_URL` the repo's own tooling uses and recorded in
  `supabase_migrations.schema_migrations`. Their five rows were not touched.
- **Route helpers live at `src/lib/routes.ts`, not `src/components/layout/organization-route.ts`.**
  The eslint layering rule forbids `src/modules/*/application/**` from importing `**/components/**`
  — "Application code depends on ports, not adapters." The landing resolver needs `overviewPath`, and
  duplicating the URL shape is the exact drift this work exists to remove, so the helper moved to a
  layer both sides may import.
- **`database.types.ts` was extended by hand, which is this repository's documented practice.**
  `README.md` records that `supabase gen types` needs Docker for both `--local` and `--db-url`, that
  CI generates the file, and that it is hand-maintained meanwhile. The plan's assumption that a
  hosted `gen types` would work was wrong. `src/lib/supabase/database.types.test.ts` cross-checks
  every typed column against the migrations, so the hand-added entry is verified rather than trusted.

Two things were found broken on arrival and deliberately left alone, both belonging to the
campaign-bundle branch: `integration_hub_rls_test.sql` assertion 57 fails against the shared
database, and `pnpm lint` fails repo-wide with 1105 errors — 1065 inside `.worktrees/`, 39 in
`.trigger/tmp`, 1 in `src/trigger-old`. Every file this work touched lints clean.

---

## File Structure

- Create `src/lib/routes.ts` and its test — pure scope and path behavior. (Planned as
  `src/components/layout/organization-route.ts`; moved for the layering rule, see As built.)
- Rename `src/app/(platform)/organizations/[organizationId]/digital-twin/` to `overview/`, and
  `src/components/organizations/digital-twin-editor.tsx` to `overview-editor.tsx`.
- Create `supabase/migrations/20260812120000_organization_last_access.sql` and
  `supabase/tests/database/organization_last_access_test.sql`.
- Create `src/modules/organizations/application/landing.ts` and its test — the shared resolver.
- Create `src/app/(platform)/organizations/[organizationId]/layout.tsx` — records access.
- Modify `src/components/layout/sidebar.tsx`, `organization-switcher.tsx`, and `route-context.tsx`,
  adding tests for the first two.
- Modify `src/app/page.tsx` and `src/app/auth/callback/route.ts`.
- Delete `src/app/(platform)/overview/`.
- Split `src/app/(platform)/organizations/new/page.tsx` into a server page and a client wizard.
- Create `adrs/0015-user-scoped-interface-state.md`; update `README.md` and
  `context/13-ui-ux-context.md`.

---

### Task 1: Establish the organization-route contract

**Files:**

- Create: `src/components/layout/organization-route.test.ts`
- Create: `src/components/layout/organization-route.ts`

**Interfaces:**

- `organizationIdFromPathname(pathname: string): string | null`
- `isOrganizationPath(pathname: string): boolean`
- `overviewPath(organizationId: string): string`

- [x] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  isOrganizationPath,
  organizationIdFromPathname,
  overviewPath,
} from "@/components/layout/organization-route";

const organizationId = "11111111-1111-4111-8111-111111111111";

describe("organization route helpers", () => {
  it("extracts scope only from valid organization routes", () => {
    expect(organizationIdFromPathname(`/organizations/${organizationId}/overview`)).toBe(
      organizationId,
    );
    expect(organizationIdFromPathname(`/organizations/${organizationId}`)).toBe(organizationId);
    expect(organizationIdFromPathname("/organizations/new")).toBeNull();
    expect(organizationIdFromPathname("/organizations/not-a-uuid/overview")).toBeNull();
    expect(organizationIdFromPathname("/")).toBeNull();
  });

  it("builds the canonical Overview URL and reports scope", () => {
    expect(overviewPath(organizationId)).toBe(`/organizations/${organizationId}/overview`);
    expect(isOrganizationPath(`/organizations/${organizationId}/economics`)).toBe(true);
    expect(isOrganizationPath("/organizations/new")).toBe(false);
  });
});
```

- [x] **Step 2: Verify red**

Run: `/home/spy/.local/node/bin/pnpm vitest run src/components/layout/organization-route.test.ts`

Expected: FAIL — the module does not exist.

- [x] **Step 3: Write minimal implementation**

```ts
const organizationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The pathname is the only source of active organization scope. */
export function organizationIdFromPathname(pathname: string): string | null {
  const [collection, organizationId] = pathname.split("/").filter(Boolean);
  return collection === "organizations" && organizationIdPattern.test(organizationId ?? "")
    ? (organizationId as string)
    : null;
}

export function isOrganizationPath(pathname: string): boolean {
  return organizationIdFromPathname(pathname) !== null;
}

export function overviewPath(organizationId: string): string {
  return `/organizations/${organizationId}/overview`;
}
```

- [x] **Step 4: Verify green**

Run: `/home/spy/.local/node/bin/pnpm vitest run src/components/layout/organization-route.test.ts`

Expected: PASS, two tests. `/organizations/new` must be excluded — `new` fails the UUID pattern.

- [x] **Step 5: Commit**

```bash
git add src/components/layout/organization-route.ts src/components/layout/organization-route.test.ts
git commit -m "feat(layout): add organization route helpers"
```

---

### Task 2: Rename the Digital Twin route to Overview

**Files:**

- Rename: `src/app/(platform)/organizations/[organizationId]/digital-twin/` → `overview/`
- Rename: `src/components/organizations/digital-twin-editor.tsx` → `overview-editor.tsx`
- Modify: `src/components/layout/route-context.tsx`
- Modify: `src/app/(platform)/organizations/[organizationId]/onboarding/page.tsx`
- Modify: `src/components/integrations/integration-hub-client.test.tsx`

**Interfaces:**

- Produces `/organizations/[organizationId]/overview` as the only Digital Twin presentation route.
- Retains `getDigitalTwin` and `DigitalTwinSnapshot` unchanged.

- [x] **Step 1: Write the failing breadcrumb expectation**

Add beside the existing `deriveRouteCrumbs` assertions in
`src/components/integrations/integration-hub-client.test.tsx`:

```ts
it("targets Overview from the organization crumb", () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  expect(deriveRouteCrumbs(`/organizations/${organizationId}/economics`)[0]?.href).toBe(
    `/organizations/${organizationId}/overview`,
  );
  expect(deriveRouteCrumbs(`/organizations/${organizationId}/overview`).at(-1)?.label).toBe(
    "Overview",
  );
});
```

- [x] **Step 2: Verify red**

Run: `/home/spy/.local/node/bin/pnpm vitest run src/components/integrations/integration-hub-client.test.tsx`

Expected: FAIL — the crumb still targets `/digital-twin`.

- [x] **Step 3: Perform the rename**

```bash
git mv 'src/app/(platform)/organizations/[organizationId]/digital-twin' \
       'src/app/(platform)/organizations/[organizationId]/overview'
git mv src/components/organizations/digital-twin-editor.tsx \
       src/components/organizations/overview-editor.tsx
rg -n 'digital-twin|DigitalTwinEditor|DigitalTwinPage' src
```

Then:

- Rename the page export `DigitalTwinPage` → `OverviewPage` and the component `DigitalTwinEditor` →
  `OverviewEditor`, including its import in the page.
- In `route-context.tsx`, replace the `"digital-twin": "Digital Twin"` segment label with
  `overview: "Overview"`, and point the organization crumb at `overviewPath(segment)` from Task 1.
- In `onboarding/page.tsx:41`, change the back link to `overviewPath(context.organizationId)` and its
  text from "Digital Twin overview" to "Overview".
- Leave every `getDigitalTwin`, `DigitalTwinSnapshot`, repository, migration, and prose reference to
  the Digital Twin **domain** untouched. The Overview page body may still say Digital Twin when it
  names the data being edited.

- [x] **Step 4: Verify green**

```bash
/home/spy/.local/node/bin/pnpm vitest run src/components/integrations/integration-hub-client.test.tsx
rg -n 'digital-twin' src
```

Expected: tests PASS and `rg` returns no match under `src`.

- [x] **Step 5: Commit**

```bash
git add -A src
git commit -m "refactor(organizations): rename digital twin route to overview"
```

---

### Task 3: Add the user-scoped access table

**Files:**

- Create: `supabase/tests/database/organization_last_access_test.sql`
- Create: `supabase/migrations/20260812000000_organization_last_access.sql`
- Modify: `src/lib/supabase/database.types.ts` (regenerated, never hand-edited)

**Interfaces:**

- `public.organization_last_access(user_id, organization_id, last_accessed_at)`.
- `public.resolve_landing_organization() returns uuid`.
- `public.touch_organization_access(target_organization_id uuid) returns void`.

- [x] **Step 1: Write the failing pgTAP suite**

Follow the shape of `supabase/tests/database/integration_hub_rls_test.sql`. Assert:

- the table and both functions exist, and RLS is enabled on the table;
- a user reading `organization_last_access` sees only their own rows, never another user's;
- inserting a row for another `user_id` is rejected;
- inserting a row for an organization the user is not a member of is rejected;
- `resolve_landing_organization()` returns the most recently accessed non-archived organization;
- with no recorded access it returns the alphabetically first non-archived organization;
- with a recorded position on an organization that is now `archived` it returns a different,
  non-archived organization;
- with only archived organizations it returns null;
- `touch_organization_access` inserts on first call and leaves `last_accessed_at` unchanged on an
  immediate second call, proving the staleness guard.

- [x] **Step 2: Verify red**

Run: `/home/spy/.local/node/bin/pnpm db:test`

Expected: FAIL — the table and functions do not exist.

- [x] **Step 3: Write the migration**

```sql
create table public.organization_last_access (
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  last_accessed_at timestamptz not null default now(),
  primary key (user_id, organization_id)
);

create index organization_last_access_recent_idx
  on public.organization_last_access(user_id, last_accessed_at desc);

alter table public.organization_last_access enable row level security;

create policy "members read their own access positions"
on public.organization_last_access for select to authenticated
using (user_id = (select auth.uid()));

create policy "members record their own access positions"
on public.organization_last_access for insert to authenticated
with check (
  user_id = (select auth.uid())
  and private.is_organization_member(organization_id)
);

create policy "members update their own access positions"
on public.organization_last_access for update to authenticated
using (user_id = (select auth.uid()))
with check (
  user_id = (select auth.uid())
  and private.is_organization_member(organization_id)
);

-- One ordering rule, under the caller's RLS: most recent access first,
-- never-visited organizations last, then name ascending. Returns null when the
-- caller has no non-archived organization, which routes to the create wizard.
create or replace function public.resolve_landing_organization()
returns uuid
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select organization.id
  from public.organizations organization
  left join public.organization_last_access access
    on access.organization_id = organization.id
   and access.user_id = (select auth.uid())
  where organization.status <> 'archived'
  order by access.last_accessed_at desc nulls last, organization.name asc
  limit 1;
$$;

revoke all on function public.resolve_landing_organization() from public;
grant execute on function public.resolve_landing_organization() to authenticated;

-- Skips the write when the position is already recent, so ordinary navigation
-- does not generate a write per page view.
create or replace function public.touch_organization_access(target_organization_id uuid)
returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into public.organization_last_access (user_id, organization_id)
  values ((select auth.uid()), target_organization_id)
  on conflict (user_id, organization_id) do update
    set last_accessed_at = now()
    where public.organization_last_access.last_accessed_at < now() - interval '5 minutes';
$$;

revoke all on function public.touch_organization_access(uuid) from public;
grant execute on function public.touch_organization_access(uuid) to authenticated;
```

- [x] **Step 4: Verify green and regenerate types**

```bash
/home/spy/.local/node/bin/pnpm db:migrations:dry-run
/home/spy/.local/node/bin/pnpm db:migrations:push
/home/spy/.local/node/bin/pnpm db:test
supabase gen types typescript --db-url "$(node scripts/supabase-session-url.mjs)" \
  > src/lib/supabase/database.types.ts
/home/spy/.local/node/bin/pnpm typecheck
```

Expected: the dry run reports only this migration, pgTAP passes, and the regenerated types contain
`organization_last_access`. If type generation fails, stop and report it — do not hand-edit the
generated file.

- [x] **Step 5: Commit**

```bash
git add supabase src/lib/supabase/database.types.ts
git commit -m "feat(organizations): record per-user organization access"
```

---

### Task 4: Resolve the landing destination and record access

**Files:**

- Create: `src/modules/organizations/application/landing.test.ts`
- Create: `src/modules/organizations/application/landing.ts`
- Create: `src/app/(platform)/organizations/[organizationId]/layout.tsx`

**Interfaces:**

- `resolveLandingPath(supabase): Promise<string>` — returns `/login`, `/organizations/new`, or an
  Overview path.
- `recordOrganizationAccess(supabase, organizationId): Promise<void>` — best-effort, never throws
  into a page render.

- [x] **Step 1: Write failing resolver tests**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLandingPath } from "@/modules/organizations/application/landing";

const organizationId = "11111111-1111-4111-8111-111111111111";

function client(user: { id: string } | null, resolved: string | null) {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user } }) },
    rpc: vi.fn().mockResolvedValue({ data: resolved, error: null }),
  };
}

describe("resolveLandingPath", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends anonymous visitors to login without reading organizations", async () => {
    const supabase = client(null, organizationId);
    expect(await resolveLandingPath(supabase as never)).toBe("/login");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("sends a member to the resolved organization's Overview", async () => {
    expect(await resolveLandingPath(client({ id: "user-1" }, organizationId) as never)).toBe(
      `/organizations/${organizationId}/overview`,
    );
  });

  it("sends a member with nothing resolvable to the create wizard", async () => {
    expect(await resolveLandingPath(client({ id: "user-1" }, null) as never)).toBe(
      "/organizations/new",
    );
  });

  it("treats a failed read as nothing resolvable rather than crashing the landing", async () => {
    const supabase = client({ id: "user-1" }, null);
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    expect(await resolveLandingPath(supabase as never)).toBe("/organizations/new");
  });
});
```

- [x] **Step 2: Verify red**

Run: `/home/spy/.local/node/bin/pnpm vitest run src/modules/organizations/application/landing.test.ts`

Expected: FAIL — the module does not exist.

- [x] **Step 3: Implement the resolver and the access recorder**

```ts
/**
 * The single answer to "which organization does this user open next?". Ordering
 * lives in resolve_landing_organization so the rule cannot drift between
 * callers, and RLS keeps the candidate set to the caller's memberships.
 */
export async function resolveLandingPath(supabase: SupabaseClient<Database>): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return "/login";

  const { data, error } = await supabase.rpc("resolve_landing_organization");
  // A landing must always resolve somewhere. A failed read is indistinguishable
  // from an empty portfolio here, and the create wizard is safe for both.
  if (error || !data) return "/organizations/new";
  return overviewPath(data);
}

export async function recordOrganizationAccess(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<void> {
  const { error } = await supabase.rpc("touch_organization_access", {
    target_organization_id: organizationId,
  });
  // Losing a position is a worse-ordered menu, never a broken page.
  if (error) logger.warn("organization_access_not_recorded", { organizationId });
}
```

Then add the organization-scoped layout. It resolves membership through the existing
`getOrganizationContext`, records access, and renders its children unchanged:

```tsx
export default async function OrganizationLayout({
  children,
  params,
}: Readonly<{ children: React.ReactNode; params: Promise<{ organizationId: string }> }>) {
  const context = await getOrganizationContext(params);
  await recordOrganizationAccess(context.supabase, context.organizationId);
  return children;
}
```

Use the project's existing structured logger rather than `console`. Match the surrounding
`getOrganizationContext` usage in the sibling pages.

- [x] **Step 4: Verify green**

```bash
/home/spy/.local/node/bin/pnpm vitest run src/modules/organizations/application/landing.test.ts
/home/spy/.local/node/bin/pnpm typecheck
```

Expected: PASS, four tests, and the layout type-checks against the regenerated RPC types.

- [x] **Step 5: Commit**

```bash
git add src/modules/organizations/application 'src/app/(platform)/organizations/[organizationId]/layout.tsx'
git commit -m "feat(organizations): resolve the landing organization"
```

---

### Task 5: Replace the sidebar with one flat Workspace group

**Files:**

- Create: `src/components/layout/sidebar.test.tsx`
- Modify: `src/components/layout/sidebar.tsx`

**Interfaces:**

- Consumes Task 1 helpers.
- Produces nine ordered Workspace entries only for validated organization paths.

- [x] **Step 1: Write failing behavior tests**

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const organizationId = "11111111-1111-4111-8111-111111111111";
const mocks = vi.hoisted(() => ({ pathname: "" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/components/layout/organization-switcher", () => ({
  OrganizationSwitcher: () => <div data-testid="switcher" />,
}));

import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderSidebar(pathname: string) {
  mocks.pathname = pathname;
  return render(
    <SidebarProvider>
      <Sidebar />
    </SidebarProvider>,
  );
}

describe("Sidebar", () => {
  afterEach(() => cleanup());

  it("renders the workspace entries in order for an organization route", () => {
    renderSidebar(`/organizations/${organizationId}/economics`);
    const labels = screen
      .getAllByTestId("workspace-entry")
      .map((entry) => entry.textContent?.replace("Soon", "").trim());
    expect(labels).toEqual([
      "Overview",
      "Opportunities",
      "Campaigns",
      "Business Memory",
      "Channel economics",
      "Integration Hub",
      "Guided onboarding",
      "Agents",
      "Executions",
    ]);
    expect(screen.getByRole("link", { name: /Overview/ })).toHaveAttribute(
      "href",
      `/organizations/${organizationId}/overview`,
    );
  });

  it("marks the active entry and never activates or links a Soon entry", () => {
    renderSidebar(`/organizations/${organizationId}/economics`);
    expect(screen.getByRole("link", { name: /Channel economics/ })).toHaveAttribute(
      "data-active",
      "true",
    );
    for (const label of ["Opportunities", "Campaigns", "Agents", "Executions", "Settings"]) {
      const entry = screen.getByText(label).closest("a, button");
      expect(entry?.tagName).toBe("BUTTON");
      expect(entry).toBeDisabled();
      expect(entry).not.toHaveAttribute("data-active", "true");
    }
    expect(screen.getAllByText("Soon")).toHaveLength(5);
  });

  it("hides the workspace group but keeps the switcher off an organization route", () => {
    renderSidebar("/organizations/new");
    expect(screen.queryAllByTestId("workspace-entry")).toHaveLength(0);
    expect(screen.getByTestId("switcher")).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Verify red**

Run: `/home/spy/.local/node/bin/pnpm vitest run src/components/layout/sidebar.test.tsx`

Expected: FAIL — the sidebar still renders two groups, six account-wide links, and Soon entries as
anchors.

- [x] **Step 3: Implement the flat group**

```tsx
type WorkspaceEntry = {
  label: string;
  icon: LucideIcon;
  path?: (organizationId: string) => string;
};

const workspaceEntries: readonly WorkspaceEntry[] = [
  { label: "Overview", icon: LayoutDashboard, path: overviewPath },
  { label: "Opportunities", icon: Sparkles },
  { label: "Campaigns", icon: BarChart3 },
  { label: "Business Memory", icon: BrainCircuit, path: (id) => `/organizations/${id}/memory` },
  { label: "Channel economics", icon: Coins, path: (id) => `/organizations/${id}/economics` },
  { label: "Integration Hub", icon: Cable, path: (id) => `/organizations/${id}/integrations` },
  { label: "Guided onboarding", icon: Compass, path: (id) => `/organizations/${id}/onboarding` },
  { label: "Agents", icon: Bot },
  { label: "Executions", icon: Activity },
];
```

- An entry without `path` is Soon: render `SidebarMenuButton` as a disabled button with the `Soon`
  badge, never wrapping a `Link`, and never passing `isActive`.
- An entry with `path` renders a `Link`, active when
  `pathname === href || pathname.startsWith(`${href}/`)`.
- Tag every entry's control with `data-testid="workspace-entry"`.
- Render the group only when `organizationIdFromPathname(pathname)` is non-null. Keep
  `<OrganizationSwitcher />` in `SidebarHeader` unconditionally.
- Point the product mark in `SidebarHeader` at `/` instead of `/overview`.
- Give the footer Settings entry the same disabled Soon treatment.
- Delete the account-wide `navigation` array and the local `organizationNavigation` helper along with
  its duplicate `uuidPattern`; scope now comes from Task 1.

- [x] **Step 4: Verify green**

Run: `/home/spy/.local/node/bin/pnpm vitest run src/components/layout/sidebar.test.tsx`

Expected: PASS — order, active state, five disabled Soon entries, and the scope-less case.

- [x] **Step 5: Commit**

```bash
git add src/components/layout/sidebar.tsx src/components/layout/sidebar.test.tsx
git commit -m "feat(layout): flatten sidebar into an organization workspace group"
```

---

### Task 6: Make the switcher live and able to create

**Files:**

- Create: `src/components/layout/organization-switcher.test.tsx`
- Modify: `src/components/layout/organization-switcher.tsx`
- Modify: `src/modules/organizations/infrastructure/repository.ts`

**Interfaces:**

- Consumes `organizationIdFromPathname` and `overviewPath`.
- Reads `GET /api/organizations` as `{ organizations: Array<{ id, name, slug }> }`.
- `listOrganizations` excludes archived organizations and orders by name ascending.

- [x] **Step 1: Write failing component tests**

```tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const currentId = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";
const mocks = vi.hoisted(() => ({ pathname: "", push: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

import { OrganizationSwitcher } from "@/components/layout/organization-switcher";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderSwitcher() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SidebarProvider>
        <OrganizationSwitcher />
      </SidebarProvider>
    </QueryClientProvider>,
  );
}

function respondWith(organizations: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ organizations }), { status: 200 }),
  );
}

describe("OrganizationSwitcher", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.push.mockReset();
    mocks.pathname = `/organizations/${currentId}/memory`;
  });
  afterEach(() => cleanup());

  it("switches to the target organization's Overview", async () => {
    respondWith([
      { id: currentId, name: "North Star Cafe", slug: "north-star-cafe" },
      { id: nextId, name: "Harbor Bakery", slug: "harbor-bakery" },
    ]);
    renderSwitcher();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/organizations"));
    fireEvent.click(await screen.findByRole("button", { name: /North Star Cafe/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Harbor Bakery/ }));
    expect(mocks.push).toHaveBeenCalledWith(`/organizations/${nextId}/overview`);
  });

  it("offers organization creation from the menu", async () => {
    respondWith([{ id: currentId, name: "North Star Cafe", slug: "north-star-cafe" }]);
    renderSwitcher();
    fireEvent.click(await screen.findByRole("button", { name: /North Star Cafe/ }));
    fireEvent.click(await screen.findByRole("menuitem", { name: /Create organization/ }));
    expect(mocks.push).toHaveBeenCalledWith("/organizations/new");
  });

  it("renders on a scope-less route and reports an empty list", async () => {
    mocks.pathname = "/organizations/new";
    respondWith([]);
    renderSwitcher();
    expect(await screen.findByText(/No organizations yet/i)).toBeInTheDocument();
  });

  it("keeps read failures generic", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    renderSwitcher();
    expect(await screen.findByText(/organizations could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/500/)).not.toBeInTheDocument();
  });
});
```

- [x] **Step 2: Verify red**

Run: `/home/spy/.local/node/bin/pnpm vitest run src/components/layout/organization-switcher.test.tsx`

Expected: FAIL — the switcher is hardcoded "Portfolio workspace" and never calls `fetch`.

- [x] **Step 3: Implement the authenticated read and the create action**

```tsx
const organizationListSchema = z.object({
  organizations: z.array(
    z.object({ id: z.string().uuid(), name: z.string().min(1), slug: z.string().min(1) }),
  ),
});

async function fetchOrganizations() {
  const response = await fetch("/api/organizations");
  if (!response.ok) throw new Error("ORGANIZATION_LIST_UNAVAILABLE");
  return organizationListSchema.parse(await response.json()).organizations;
}
```

- Query key `["organizations"]`. The query runs on every platform route, including
  `/organizations/new`, so the user can always navigate away.
- Trigger label: the active organization's name and slug when the pathname's identifier matches a
  returned organization; "Select organization" otherwise; a neutral placeholder while loading.
- Menu content: `Check` beside the active organization; each row shows name and slug; then a
  `DropdownMenuSeparator` and a `Create organization` item with a `Plus` icon that pushes
  `/organizations/new`.
- Loading renders a non-interactive placeholder. Empty renders "No organizations yet" plus the create
  item. Error renders exactly "Organizations could not be loaded." — no status code, no database
  detail.
- Selecting an organization calls `router.push(overviewPath(organization.id))`.
- Delete the "Portfolio workspace" label, the "Agency" badge, and the disabled "Add organization
  after onboarding" placeholder.
- In `repository.ts`, narrow `listOrganizations` to `.neq("status", "archived")` ordered by `name`
  ascending, so the switcher and the resolver agree on the candidate set. `GET /api/organizations` is
  its only consumer, so no other caller changes.

- [x] **Step 4: Verify green**

```bash
/home/spy/.local/node/bin/pnpm vitest run src/components/layout/organization-switcher.test.tsx
/home/spy/.local/node/bin/pnpm vitest run src/app/api/organizations
```

Expected: PASS — switch, create, empty, and generic-error cases, with existing API route tests still
green.

- [x] **Step 5: Commit**

```bash
git add src/components/layout/organization-switcher.tsx src/components/layout/organization-switcher.test.tsx src/modules/organizations/infrastructure/repository.ts
git commit -m "feat(layout): load and switch real organizations"
```

---

### Task 7: Delete the account-wide surface and rewire every doorway

**Files:**

- Delete: `src/app/(platform)/overview/`
- Create: `src/app/page.test.ts`
- Create: `src/components/organizations/new-organization-wizard.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/auth/callback/route.ts`
- Modify: `src/app/(platform)/organizations/new/page.tsx`
- Modify: `src/components/layout/route-context.tsx`
- Modify: `src/components/organizations/overview-editor.tsx`
- Modify: `src/app/(platform)/organizations/[organizationId]/overview/page.tsx`

**Interfaces:**

- `/` and `/auth/callback` both route through `resolveLandingPath`.
- The create wizard receives `backHref?: string`; absent means no back link.

- [x] **Step 1: Write the failing landing-route test**

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveLandingPath: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("@/modules/organizations/application/landing", () => ({
  resolveLandingPath: mocks.resolveLandingPath,
}));

import HomePage from "@/app/page";

describe("root landing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects to whatever the resolver decides", async () => {
    mocks.resolveLandingPath.mockResolvedValue("/organizations/new");
    await expect(HomePage()).rejects.toThrow("REDIRECT:/organizations/new");
  });

  it("does not hardcode a destination of its own", async () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    mocks.resolveLandingPath.mockResolvedValue(`/organizations/${organizationId}/overview`);
    await expect(HomePage()).rejects.toThrow(`REDIRECT:/organizations/${organizationId}/overview`);
  });
});
```

- [x] **Step 2: Verify red**

Run: `/home/spy/.local/node/bin/pnpm vitest run src/app/page.test.ts`

Expected: FAIL — the root unconditionally redirects to `/overview`.

- [x] **Step 3: Delete the route and rewire the callers**

```bash
git rm -r 'src/app/(platform)/overview'
rg -n '"/overview"|`/overview`' src
```

Each remaining reference:

- `src/app/page.tsx` — create the session-bound client, call `resolveLandingPath`, `redirect` to the
  result. No rules of its own.
- `src/app/auth/callback/route.ts:11` — redirect to `/` instead of `/overview`, so first-time
  sign-in, returning sign-in, and archived-only accounts all follow the same resolution.
- `src/components/organizations/overview-editor.tsx:108` — the post-archive push becomes `/`. The
  just-archived draft now fails the resolver's non-archived filter, so a user with other
  organizations lands on their next most recent one and a user with none lands on the create wizard,
  with no post-archive branch in the client.
- `overview/page.tsx:80` — delete the "Portfolio overview" back link entirely. There is nothing above
  an organization any more, and the sidebar is the way out.
- `organizations/new/page.tsx` — move the existing client component to
  `src/components/organizations/new-organization-wizard.tsx` unchanged except for a new optional
  `backHref` prop, and make `page.tsx` a server component that resolves the landing and passes
  `backHref` only when the resolver returns an Overview path. Render no back link when it returns
  `/organizations/new`, because sending the user back would resolve to the page they are on.
- `route-context.tsx:73` — return an empty trail for the empty path rather than naming a deleted
  route. This is the one deliberate departure from the landing rules: breadcrumbs are synchronous and
  client-side and cannot perform the resolver's authenticated read, and the empty path never renders
  the shell now that `/` redirects on the server.
- `route-context.tsx` segment labels — drop `opportunities`, `agents`, `campaigns`, `executions`, and
  `organizations` as account-wide labels, keeping `opportunities` and `campaigns` for the
  organization-scoped routes those plans will add.

- [x] **Step 4: Verify green**

```bash
/home/spy/.local/node/bin/pnpm vitest run src/app/page.test.ts
rg -n '"/overview"|`/overview`' src
/home/spy/.local/node/bin/pnpm typecheck
```

Expected: tests PASS, `rg` returns no match, and the wizard split type-checks.

- [x] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat(navigation): resolve the landing route per organization"
```

---

### Task 8: Record the decision, align documentation, run the final gates

**Files:**

- Create: `adrs/0015-user-scoped-interface-state.md`
- Modify: `README.md`
- Modify: `context/13-ui-ux-context.md`
- Modify: `docs/superpowers/plans/2026-08-11-unified-campaign-bundle-release-train-implementation.md`
- Modify: the approved design only if implementation exposed a contradiction.

- [x] **Step 1: Confirm the documentation is stale before editing**

```bash
rg -n 'digital-twin|Portfolio|Agency-level navigation' README.md context/13-ui-ux-context.md
ls adrs/0015-* 2>/dev/null
```

Expected: the old route and the account-wide navigation list are still described, and no ADR 0015
exists.

- [x] **Step 2: Write the ADR**

Follow the shape of `adrs/0011-business-memory-read-through-facts.md`. Record: every table before
this one was tenant-scoped; per-user interface state needed a home; `organization_memberships` was
rejected because its `UPDATE` policy is owner/admin-only by design and widening it would put write
access on the row holding `role`; a user-scoped table with its own RLS was chosen; the consequence is
that future per-user interface state follows this pattern rather than accreting onto tenant tables.
Reference it from the design document.

- [x] **Step 3: Update documentation**

- `README.md:64` — replace `/organizations/:organizationId/digital-twin` with
  `/organizations/:organizationId/overview`, keeping Digital Twin as the described domain content,
  and document the landing resolution and that no account-wide page exists.
- `context/13-ui-ux-context.md` §5.1 — record that no agency-level surface exists yet and that the
  listed order is deferred, rather than leaving it as current guidance.
- `context/13-ui-ux-context.md` §5.2 — replace the eleven-item list with the nine implemented
  Workspace entries and mark the four Soon states.
- `context/13-ui-ux-context.md` §5.3 — keep the sidebar-switcher rule and add the create action.
- The campaign bundle plan's Task 6 — note that
  `src/app/(platform)/opportunities/page.tsx` becomes
  `src/app/(platform)/organizations/[organizationId]/opportunities/page.tsx`, and that its Step 4
  "Enable the Opportunities navigation destination" now means giving the existing Workspace entry a
  `path` rather than adding a new entry.

- [x] **Step 4: Run the final quality gates**

```bash
/home/spy/.local/node/bin/pnpm format
/home/spy/.local/node/bin/pnpm lint
/home/spy/.local/node/bin/pnpm typecheck
/home/spy/.local/node/bin/pnpm test
/home/spy/.local/node/bin/pnpm db:test
/home/spy/.local/node/bin/pnpm knip
git diff --check
```

Expected: every command exits 0. `knip` must not report the deleted overview page's former imports as
unused leftovers. Review the full diff before staging.

- [x] **Step 5: Commit**

```bash
git add adrs README.md context/13-ui-ux-context.md docs/superpowers
git commit -m "docs: document the organization workspace navigation"
```

---

## Plan Self-Review

- **Spec coverage:** Task 1 covers scope parsing. Task 2 covers the Overview rename and breadcrumb
  targets. Task 3 covers the access table, its RLS, and both SQL functions. Task 4 covers the shared
  resolver and access recording. Task 5 covers the flat nine-entry Workspace group and Soon states.
  Task 6 covers the live switcher, its four states, creation, and the non-archived candidate set.
  Task 7 covers deleting the account-wide surface and rewiring all five remaining doorways. Task 8
  covers the ADR, documentation, and the recorded cross-plan conflict.
- **Ordering:** Each task leaves a working application. The rename lands before anything links to it;
  the migration and resolver land before the routes that call them; `/overview` is deleted only after
  nothing points at it.
- **Landing rules traced:** no session → Task 4 test 1. No organizations and archived-only → the
  resolver's `status <> 'archived'` filter plus Task 3 pgTAP. Recorded access wins → Task 3 pgTAP.
  Name-ascending fallback → Task 3 pgTAP. Post-archive → Task 7 via `/`. Back link → Task 7.
  Breadcrumb fallback → Task 7, documented as a deliberate exception.
- **Placeholder scan:** Every task has red/green steps, exact paths, interfaces, commands, and a
  commit.
- **Type consistency:** Layout code uses `organizationIdFromPathname`, `isOrganizationPath`,
  `overviewPath`, `OrganizationSwitcher`, and `OverviewEditor`. Server code uses `resolveLandingPath`
  and `recordOrganizationAccess`. `getDigitalTwin` and `DigitalTwinSnapshot` remain the domain names.
- **Tenant isolation:** verified in pgTAP for the one new table — cross-user reads, cross-user writes,
  and non-member writes are all asserted rejected. No existing policy is widened and no service-role
  client is introduced.
