"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  Bot,
  BrainCircuit,
  Cable,
  Compass,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  Sparkles,
  Waypoints,
} from "lucide-react";

import { growthIntelligencePath, organizationIdFromPathname, overviewPath } from "@/lib/routes";
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
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";

type WorkspaceEntry = {
  label: string;
  icon: LucideIcon;
  /** Absent while the destination does not exist yet. */
  path?: (organizationId: string) => string;
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
  { label: "Campaigns", icon: Megaphone, path: (id) => `/organizations/${id}/campaigns` },
  { label: "Business Memory", icon: BrainCircuit, path: (id) => `/organizations/${id}/memory` },
  { label: "Channels", icon: Waypoints, path: (id) => `/organizations/${id}/channels` },
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

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const organizationId = organizationIdFromPathname(pathname);

  return (
    <SidebarPrimitive variant="floating" collapsible="icon">
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="AI Revenue OS">
              <Link href="/">
                <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-foreground text-background">
                  <Waypoints />
                </span>
                <span className="grid min-w-0 flex-1 text-left leading-tight">
                  <span className="truncate text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                    Revenue Intelligence
                  </span>
                  <span className="truncate text-sm font-semibold">AI Revenue OS</span>
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
                {workspaceEntries.map(({ label, icon: Icon, path }) => {
                  const href = path?.(organizationId);
                  return (
                    <SidebarMenuItem key={label}>
                      {href ? (
                        <SidebarMenuButton
                          asChild
                          data-testid="workspace-entry"
                          isActive={pathname === href || pathname.startsWith(`${href}/`)}
                          tooltip={label}
                        >
                          <Link href={href}>
                            <Icon />
                            <span>{label}</span>
                          </Link>
                        </SidebarMenuButton>
                      ) : (
                        // Never an anchor: a link to a route that does not exist
                        // is a 404 dressed up as navigation.
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
                      )}
                    </SidebarMenuItem>
                  );
                })}
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
