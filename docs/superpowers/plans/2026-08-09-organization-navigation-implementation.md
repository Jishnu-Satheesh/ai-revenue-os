# Organization Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Deliver a scoped Organization navigation group, a database-backed header organization switcher, and the Dashboard route that replaces the Digital Twin presentation route.

**Architecture:** Use the existing session-authenticated GET /api/organizations endpoint for the interactive switcher. Extract organization path parsing and Dashboard URL construction into a pure layout helper shared by layout components. Rename only the UI route and presentation component names; preserve Digital Twin database, repository, and domain identifiers.

**Tech Stack:** Next.js 16, React 19, TypeScript strict mode, TanStack Query v5, Supabase Auth/RLS, shadcn/ui, Vitest, Testing Library, pnpm 11, Node 22.

## Global Constraints

- Run every package command through /home/spy/.local/node/bin/pnpm on Node 22; use pnpm only.
- Do not add a service-role client, migration, mutation, or global organization-selection state.
- GET /api/organizations remains the only switcher data boundary; its session-bound Supabase query is RLS filtered.
- The active organization comes only from /organizations/[organizationId]/...; switches navigate to /organizations/[organizationId]/dashboard.
- Account-wide routes show neither the Organization group nor the switcher.
- Scoped routes show a group after Overview, open by default and collapsible: Dashboard, Campaigns Soon, Agents Soon, Executions Soon, Guided Onboarding, Integration Hub.
- Dashboard replaces presentation route, component names, links, breadcrumbs, tests, and user-facing copy. Digital Twin remains the domain/data model.
- Use installed shadcn components and preserve unrelated Business Memory working-tree changes.

---

## File Structure

- Create src/components/layout/organization-route.ts and organization-route.test.ts for pure scope/path behavior.
- Modify organization-switcher.tsx and create organization-switcher.test.tsx for the live organization list and safe states.
- Modify sidebar.tsx and create sidebar.test.tsx for the nested Organization menu.
- Modify app-shell.tsx and create app-shell.test.tsx for header placement.
- Modify route-context.tsx for Dashboard breadcrumbs.
- Rename the Digital Twin page directory to dashboard and digital-twin-editor.tsx to dashboard-editor.tsx.
- Update direct links, route mocks, page names, and user-facing strings under src.
- Update README.md and context/13-ui-ux-context.md.

### Task 1: Establish the organization-route contract

**Files:**
- Create: src/components/layout/organization-route.test.ts
- Create: src/components/layout/organization-route.ts

**Interfaces:**
- Produces organizationIdFromPathname(pathname: string): string | null.
- Produces isOrganizationPath(pathname: string): boolean.
- Produces dashboardPath(organizationId: string): string.

- [ ] **Step 1: Write failing tests**

~~~ts
import { describe, expect, it } from "vitest";
import {
  dashboardPath,
  isOrganizationPath,
  organizationIdFromPathname,
} from "@/components/layout/organization-route";

const organizationId = "11111111-1111-4111-8111-111111111111";

describe("organization route helpers", () => {
  it("extracts scope only from valid organization routes", () => {
    expect(organizationIdFromPathname("/organizations/" + organizationId + "/dashboard")).toBe(
      organizationId,
    );
    expect(organizationIdFromPathname("/overview")).toBeNull();
    expect(organizationIdFromPathname("/organizations/not-a-uuid/dashboard")).toBeNull();
  });

  it("builds the canonical Dashboard URL", () => {
    expect(dashboardPath(organizationId)).toBe("/organizations/" + organizationId + "/dashboard");
    expect(isOrganizationPath("/organizations/" + organizationId + "/integrations")).toBe(true);
  });
});
~~~

- [ ] **Step 2: Verify red**

Run: /home/spy/.local/node/bin/pnpm vitest run src/components/layout/organization-route.test.ts

Expected: FAIL because organization-route does not exist.

- [ ] **Step 3: Write minimal implementation**

~~~ts
const organizationIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function organizationIdFromPathname(pathname: string): string | null {
  const [collection, organizationId] = pathname.split("/").filter(Boolean);
  return collection === "organizations" && organizationIdPattern.test(organizationId ?? "")
    ? organizationId
    : null;
}

export function isOrganizationPath(pathname: string): boolean {
  return organizationIdFromPathname(pathname) !== null;
}

export function dashboardPath(organizationId: string): string {
  return "/organizations/" + organizationId + "/dashboard";
}
~~~

- [ ] **Step 4: Verify green**

Run: /home/spy/.local/node/bin/pnpm vitest run src/components/layout/organization-route.test.ts

Expected: PASS with two tests.

- [ ] **Step 5: Commit**

~~~bash
git add src/components/layout/organization-route.ts src/components/layout/organization-route.test.ts
git commit -m "feat(layout): add organization route helpers"
~~~

### Task 2: Load real organizations in OrganizationSwitcher

**Files:**
- Create: src/components/layout/organization-switcher.test.tsx
- Modify: src/components/layout/organization-switcher.tsx

**Interfaces:**
- Consumes organizationIdFromPathname and dashboardPath from Task 1.
- Reads GET /api/organizations as { organizations: Array<{ id: string; name: string; slug: string }> }.
- Produces a null render for account-wide paths and a header-safe shadcn dropdown on scoped paths.

- [ ] **Step 1: Write failing component tests**

~~~tsx
// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/organizations/11111111-1111-4111-8111-111111111111/dashboard",
  push: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: mocks.push }),
}));

import { OrganizationSwitcher } from "@/components/layout/organization-switcher";

const currentId = "11111111-1111-4111-8111-111111111111";
const nextId = "22222222-2222-4222-8222-222222222222";

function renderSwitcher() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <OrganizationSwitcher />
    </QueryClientProvider>,
  );
}

describe("OrganizationSwitcher", () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(() => cleanup());

  it("uses returned organizations and switches to Dashboard", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      organizations: [
        { id: currentId, name: "North Star Cafe", slug: "north-star-cafe" },
        { id: nextId, name: "Harbor Bakery", slug: "harbor-bakery" },
      ],
    }), { status: 200 }));
    renderSwitcher();
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledWith("/api/organizations"));
    fireEvent.click(await screen.findByRole("button", { name: /North Star Cafe/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Harbor Bakery/i }));
    expect(mocks.push).toHaveBeenCalledWith("/organizations/" + nextId + "/dashboard");
  });

  it("hides on Overview and uses a generic read error", async () => {
    mocks.pathname = "/overview";
    const accountWide = renderSwitcher();
    expect(accountWide.container).toBeEmptyDOMElement();
    accountWide.unmount();
    mocks.pathname = "/organizations/" + currentId + "/dashboard";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("", { status: 500 }));
    renderSwitcher();
    expect(await screen.findByText(/organizations could not be loaded/i)).toBeInTheDocument();
  });
});
~~~

- [ ] **Step 2: Verify red**

Run: /home/spy/.local/node/bin/pnpm vitest run src/components/layout/organization-switcher.test.tsx

Expected: FAIL because the current switcher is dummy data and does not query the API.

- [ ] **Step 3: Implement the smallest authenticated read**

~~~tsx
const organizationListSchema = z.object({
  organizations: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string().min(1),
      slug: z.string().min(1),
    }),
  ),
});
const organizationsQueryKey = ["organizations"] as const;

async function fetchOrganizations(): Promise<OrganizationOption[]> {
  const response = await fetch("/api/organizations");
  if (!response.ok) throw new Error("ORGANIZATION_LIST_UNAVAILABLE");
  return organizationListSchema.parse(await response.json()).organizations;
}
~~~

Use the query with `enabled: Boolean(organizationId)` after deriving scope, then return null when no organization id exists. In the existing shadcn DropdownMenu render loading, empty, and generic error items; list each returned organization with name and slug; mark the route organization selected; add a Portfolio overview link; and navigate with router.push(dashboardPath(organization.id)). Do not expose raw API errors or retain fake Portfolio workspace data.

- [ ] **Step 4: Verify green**

Run: /home/spy/.local/node/bin/pnpm vitest run src/components/layout/organization-switcher.test.tsx

Expected: PASS; fetch, hidden account-wide state, generic error, selection, and Dashboard navigation pass.

- [ ] **Step 5: Commit**

~~~bash
git add src/components/layout/organization-switcher.tsx src/components/layout/organization-switcher.test.tsx
git commit -m "feat(layout): load organization switcher data"
~~~

### Task 3: Build the scoped sidebar hierarchy

**Files:**
- Create: src/components/layout/sidebar.test.tsx
- Modify: src/components/layout/sidebar.tsx

**Interfaces:**
- Consumes Task 1 helpers.
- Uses shadcn Collapsible, Button, Badge, and Sidebar primitives.
- Produces an Organization group only for validated organization paths.

- [ ] **Step 1: Write failing behavior tests**

~~~tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/organizations/11111111-1111-4111-8111-111111111111/dashboard",
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));

import { Sidebar } from "@/components/layout/sidebar";
import { SidebarProvider } from "@/components/ui/sidebar";

function renderSidebar() {
  return render(<SidebarProvider><Sidebar /></SidebarProvider>);
}

it("renders the requested expanded hierarchy and collapses", () => {
  renderSidebar();
  const trigger = screen.getByRole("button", { name: /organization/i });
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByRole("link", { name: /dashboard/i })).toHaveAttribute(
    "href", "/organizations/11111111-1111-4111-8111-111111111111/dashboard",
  );
  expect(screen.getAllByText("Soon")).toHaveLength(3);
  expect(screen.getByText("Campaigns").closest("a")).toBeNull();
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "false");
});

it("does not show the group on Overview", () => {
  mocks.pathname = "/overview";
  renderSidebar();
  expect(screen.getByRole("link", { name: /overview/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /organization/i })).not.toBeInTheDocument();
});
~~~

- [ ] **Step 2: Verify red**

Run: /home/spy/.local/node/bin/pnpm vitest run src/components/layout/sidebar.test.tsx

Expected: FAIL because legacy navigation has no collapsible Organization group.

- [ ] **Step 3: Implement the hierarchy**

~~~tsx
const organizationItems = [
  { label: "Dashboard", href: dashboardPath(organizationId), icon: Boxes },
  { label: "Campaigns", icon: BarChart3, upcoming: true },
  { label: "Agents", icon: Bot, upcoming: true },
  { label: "Executions", icon: Activity, upcoming: true },
  { label: "Guided Onboarding", href: "/organizations/" + organizationId + "/onboarding", icon: Compass },
  { label: "Integration Hub", href: "/organizations/" + organizationId + "/integrations", icon: Cable },
] as const;

<Collapsible defaultOpen>
  <SidebarGroup>
    <CollapsibleTrigger asChild>
      <Button type="button" variant="ghost" aria-label="Organization" className="w-full justify-start">
        <ChevronDown /> Organization
      </Button>
    </CollapsibleTrigger>
    <CollapsibleContent>{/* linked entries plus disabled Soon Button entries */}</CollapsibleContent>
  </SidebarGroup>
</Collapsible>
~~~

Keep Overview as the only account-wide primary item. Remove the sidebar switcher and account-wide Opportunities, Agents, Campaigns, Executions, and Organizations placeholders. Disabled Soon entries must be disabled shadcn Button compositions, never anchors and never active.

- [ ] **Step 4: Verify green**

Run: /home/spy/.local/node/bin/pnpm vitest run src/components/layout/sidebar.test.tsx

Expected: PASS; group order, three Soon items, links, initial state, collapse, and account-wide omission pass.

- [ ] **Step 5: Commit**

~~~bash
git add src/components/layout/sidebar.tsx src/components/layout/sidebar.test.tsx
git commit -m "feat(layout): add organization navigation group"
~~~

### Task 4: Move the switcher and rename the Dashboard presentation

**Files:**
- Create: src/components/layout/app-shell.test.tsx
- Modify: src/components/layout/app-shell.tsx
- Modify: src/components/layout/route-context.tsx
- Rename: src/app/(platform)/organizations/[organizationId]/digital-twin/page.tsx to dashboard/page.tsx
- Rename: src/components/organizations/digital-twin-editor.tsx to dashboard-editor.tsx
- Modify: onboarding page, overview page, tests, and route mocks.

**Interfaces:**
- Consumes Task 1 helpers and Task 2 switcher.
- Produces /organizations/[organizationId]/dashboard as the only workspace presentation route.
- Retains getDigitalTwin and DigitalTwinSnapshot as domain APIs.

- [ ] **Step 1: Write failing header and breadcrumb tests**

~~~tsx
// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/organizations/11111111-1111-4111-8111-111111111111/dashboard",
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("@/components/layout/sidebar", () => ({ Sidebar: () => <aside>Sidebar</aside> }));
vi.mock("@/components/layout/organization-switcher", () => ({
  OrganizationSwitcher: () => <button>Organization</button>,
}));

import { AppShell } from "@/components/layout/app-shell";
import { deriveRouteCrumbs } from "@/components/layout/route-context";

it("places the switcher before the sidebar trigger", () => {
  const { container } = render(<AppShell><p>Dashboard</p></AppShell>);
  expect(container.querySelector("header")?.firstElementChild?.textContent).toMatch(/Organization/);
});

it("targets Dashboard from organization crumbs", () => {
  expect(deriveRouteCrumbs("/organizations/11111111-1111-4111-8111-111111111111/integrations")[0]?.href)
    .toBe("/organizations/11111111-1111-4111-8111-111111111111/dashboard");
});
~~~

- [ ] **Step 2: Verify red**

Run: /home/spy/.local/node/bin/pnpm vitest run src/components/layout/app-shell.test.tsx src/components/integrations/integration-hub-client.test.tsx

Expected: FAIL because the shell does not mount the switcher and crumbs target /digital-twin.

- [ ] **Step 3: Implement the rename and direct-use migration**

~~~bash
git mv 'src/app/(platform)/organizations/[organizationId]/digital-twin' 'src/app/(platform)/organizations/[organizationId]/dashboard'
git mv src/components/organizations/digital-twin-editor.tsx src/components/organizations/dashboard-editor.tsx
rg -n "digital-twin|DigitalTwinEditor|Digital Twin" src
~~~

Rename DigitalTwinPage to DashboardPage and DigitalTwinEditor to DashboardEditor. Change page-facing labels/messages/headings to Dashboard. Change every UI link, breadcrumb default, test expectation, and route mock from /digital-twin to dashboardPath(organizationId). Update the onboarding handoff and Overview UI copy. Do not leave a legacy route or redirect. Do not rename getDigitalTwin, DigitalTwinSnapshot, database tables, migrations, or domain documentation.

Insert OrganizationSwitcher as the first header child in AppShell, before the SidebarTrigger/breadcrumb container. Its Task 2 null render keeps account-wide headers clean.

- [ ] **Step 4: Verify green**

Run: /home/spy/.local/node/bin/pnpm vitest run src/components/layout/app-shell.test.tsx src/components/layout/organization-route.test.ts src/components/layout/organization-switcher.test.tsx src/components/layout/sidebar.test.tsx src/components/integrations/integration-hub-client.test.tsx

Expected: PASS; Dashboard is the only presentation path in layout links and breadcrumb expectations.

- [ ] **Step 5: Commit**

~~~bash
git add src/app src/components src/domain src/lib
git commit -m "feat(organizations): rename digital twin workspace dashboard"
~~~

### Task 5: Align documentation and run final verification

**Files:**
- Modify: README.md
- Modify: context/13-ui-ux-context.md
- Modify: approved design only if implementation exposes a contradiction.

- [ ] **Step 1: Write the pre-change documentation acceptance command**

~~~bash
rg -n '/organizations/:organizationId/dashboard|header.*Organization switcher|Organization group' README.md context/13-ui-ux-context.md
~~~

Expected before edits: the new route and scoped-header guidance are absent.

- [ ] **Step 2: Update documentation**

In README.md, replace the workspace URL with /organizations/:organizationId/dashboard while retaining Digital Twin as the described domain content. In context/13-ui-ux-context.md, move switcher guidance from sidebar to scoped header, change the navigation label to Dashboard, and record the six-item Organization group and the three disabled Soon entries.

- [ ] **Step 3: Verify documentation**

Run: rg -n '/organizations/:organizationId/dashboard|header.*Organization switcher|Organization group' README.md context/13-ui-ux-context.md

Expected: matching Dashboard route and scoped-header guidance.

- [ ] **Step 4: Run final quality gates**

~~~bash
/home/spy/.local/node/bin/pnpm prettier --write README.md context/13-ui-ux-context.md 'src/**/*.{ts,tsx}'
/home/spy/.local/node/bin/pnpm lint
/home/spy/.local/node/bin/pnpm typecheck
/home/spy/.local/node/bin/pnpm vitest run src/components/layout/organization-route.test.ts src/components/layout/organization-switcher.test.tsx src/components/layout/sidebar.test.tsx src/components/layout/app-shell.test.tsx
/home/spy/.local/node/bin/pnpm test
git diff --check
~~~

Expected: every command exits 0. Review the full diff and stage no unrelated Business Memory files.

- [ ] **Step 5: Commit**

~~~bash
git add README.md context/13-ui-ux-context.md
git commit -m "docs: document dashboard navigation"
~~~

## Plan Self-Review

- **Spec coverage:** Tasks 1 through 4 cover safe scoped routing, RLS-backed switcher data, header placement, nested order, disabled Soon states, and the Dashboard rename. Task 5 covers documentation and verification.
- **Placeholder scan:** Each task has test-first red/green steps, exact paths, interfaces, commands, and a commit.
- **Type consistency:** All tasks use organizationIdFromPathname, dashboardPath, OrganizationSwitcher, and DashboardEditor. Dashboard is the UI route; getDigitalTwin and DigitalTwinSnapshot remain domain names.
