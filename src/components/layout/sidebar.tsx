"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  BrainCircuit,
  Cable,
  ChevronRight,
  Compass,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Settings,
  Sparkles,
  Waypoints,
} from "lucide-react";

import {
  growthIntelligencePath,
  organizationIdFromPathname,
  organizationSettingsPath,
  overviewPath,
} from "@/lib/routes";
import { OrganizationSwitcher } from "@/components/layout/organization-switcher";
import { SidebarIdentity } from "@/components/accounts/sidebar-identity";
import {
  Sidebar as SidebarPrimitive,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

type WorkspaceChild = {
  label: string;
  path: (organizationId: string) => string;
};

type WorkspaceEntry = {
  label: string;
  icon: LucideIcon;
  /** Absent while the destination does not exist yet. */
  path?: (organizationId: string) => string;
  /**
   * Destinations nested under this one.
   *
   * A parent with children still navigates: the chevron opens the group, and
   * the row itself goes where it always went. Turning a working link into a
   * pure toggle would take a destination away to add a menu.
   */
  children?: readonly WorkspaceChild[];
};

/**
 * Every destination is organization-scoped: there is no account-wide surface.
 * The order leads with decision value rather than setup order, so the entries
 * that will carry revenue sit above the ones that configure it.
 */
const workspaceEntries: readonly WorkspaceEntry[] = [
  { label: "Overview", icon: LayoutDashboard, path: overviewPath },
  {
    label: "Growth Intelligence",
    icon: Sparkles,
    path: growthIntelligencePath,
  },
  {
    label: "Campaigns",
    icon: Megaphone,
    path: (id) => `/organizations/${id}/campaigns`,
    children: [
      // "Overview" is the portfolio itself — the same page the parent opens,
      // named so the group has an explicit way back to it once a campaign,
      // or the library, is what you are looking at.
      { label: "Overview", path: (id) => `/organizations/${id}/campaigns` },
      // "Asset Library", matching that page's own heading. A nav label that
      // disagrees with the title it opens is a small, constant friction.
      { label: "Asset Library", path: (id) => `/organizations/${id}/assets` },
      // Where the money fence on research is set. Beside the work it governs
      // rather than in a general settings page, because the question it answers
      // — "why can't I request a campaign?" — is asked from here.
      {
        label: "Research settings",
        path: (id) => `/organizations/${id}/campaign-research`,
      },
    ],
  },
  { label: "Business Memory", icon: BrainCircuit, path: (id) => `/organizations/${id}/memory` },
  { label: "Channels", icon: Waypoints, path: (id) => `/organizations/${id}/channels` },
  // Setup sits last: the entries above carry revenue, this one configures it.
  { label: "Settings", icon: Settings, path: organizationSettingsPath },
  { label: "Integration Hub", icon: Cable, path: (id) => `/organizations/${id}/integrations` },
  { label: "Guided onboarding", icon: Compass, path: (id) => `/organizations/${id}/onboarding` },
  { label: "Agents", icon: Bot },
  { label: "Executions", icon: Activity },
];

function UpcomingBadge() {
  return (
    <Badge
      variant="secondary"
      className="ml-auto text-[10px] uppercase group-data-[collapsible=icon]:hidden"
    >
      Soon
    </Badge>
  );
}

/** Active for the page itself and for anything nested under it. */
function matches(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function WorkspaceItem({
  entry,
  organizationId,
  pathname,
}: Readonly<{ entry: WorkspaceEntry; organizationId: string; pathname: string }>) {
  const { label, icon: Icon, path, children } = entry;
  const href = path?.(organizationId);

  const childHrefs = (children ?? []).map((child) => ({
    ...child,
    href: child.path(organizationId),
  }));
  // The parent is active when the page it opens is, or when any child's is —
  // otherwise opening the Asset Library would leave Campaigns looking unvisited
  // while its own sub-item is highlighted.
  const active =
    (href !== undefined && matches(pathname, href)) ||
    childHrefs.some((child) => matches(pathname, child.href));

  if (!href) {
    return (
      <SidebarMenuItem>
        {/* Never an anchor: a link to a route that does not exist is a 404
            dressed up as navigation. */}
        <SidebarMenuButton
          data-testid="workspace-entry"
          disabled
          tooltip={`${label} — not available yet`}
          className="cursor-default"
        >
          <Icon />
          <span>{label}</span>
          <UpcomingBadge />
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  if (childHrefs.length === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild data-testid="workspace-entry" isActive={active} tooltip={label}>
          <Link href={href}>
            <Icon />
            <span>{label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    /**
     * Open when you are inside the group, and yours to close once you are.
     *
     * Uncontrolled, so a group you collapse by hand stays collapsed as you move
     * between pages inside it. The key remounts it only when you cross the
     * boundary in or out, which is the one moment `defaultOpen` should be
     * consulted again — entering Campaigns should reveal what is under it.
     */
    <Collapsible
      key={active ? "inside" : "outside"}
      defaultOpen={active}
      className="group/collapsible"
    >
      <SidebarMenuItem>
        <SidebarMenuButton asChild data-testid="workspace-entry" isActive={active} tooltip={label}>
          <Link href={href}>
            <Icon />
            <span>{label}</span>
          </Link>
        </SidebarMenuButton>

        {/* A separate control from the link, so opening the group and going to
            the page stay two different intentions. Hidden when the rail is
            collapsed to icons, where there is no room to show a sub-menu. */}
        <CollapsibleTrigger asChild>
          <SidebarMenuAction
            className="group-data-[collapsible=icon]:hidden"
            // Stable label; the trigger carries the open state in aria-expanded.
            aria-label={`${label} sections`}
          >
            <ChevronRight className="transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuAction>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <SidebarMenuSub>
            {childHrefs.map((child) => (
              <SidebarMenuSubItem key={child.label}>
                <SidebarMenuSubButton
                  asChild
                  data-testid="workspace-child-entry"
                  // The parent page and its "Overview" child are the same URL,
                  // so an exact match keeps Overview from staying lit while you
                  // are reading one campaign.
                  isActive={pathname === child.href}
                >
                  <Link href={child.href}>
                    <span>{child.label}</span>
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const organizationId = organizationIdFromPathname(pathname);

  return (
    <SidebarPrimitive variant="floating" collapsible="icon">
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="Lunes AI">
              <Link href="/">
                <span className="flex aspect-square size-8 shrink-0 items-center justify-center overflow-hidden rounded-md">
                  <Image
                    src="/assets/logo/logo.png"
                    alt="Lunes AI"
                    width={32}
                    height={32}
                    className="size-8 object-contain"
                  />
                </span>
                <span className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    The Revenue Intelligence
                  </span>
                  <span className="truncate text-sm font-semibold">Lunes AI</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        {/* Rendered even without scope so the create page is never a dead end. */}
        <OrganizationSwitcher />
      </SidebarHeader>
      <SidebarContent>
        {organizationId ? (
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {workspaceEntries.map((entry) => (
                  <WorkspaceItem
                    key={entry.label}
                    entry={entry}
                    organizationId={organizationId}
                    pathname={pathname}
                  />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarIdentity />
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </SidebarPrimitive>
  );
}
