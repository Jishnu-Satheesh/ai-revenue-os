"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  BrainCircuit,
  Cable,
  Coins,
  Compass,
  LayoutDashboard,
  type LucideIcon,
  Settings2,
  Sparkles,
  Waypoints,
} from "lucide-react";

import { organizationIdFromPathname, overviewPath } from "@/lib/routes";
import { OrganizationSwitcher } from "@/components/layout/organization-switcher";
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
  SidebarSeparator,
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
  { label: "Opportunities", icon: Sparkles },
  { label: "Campaigns", icon: BarChart3 },
  { label: "Business Memory", icon: BrainCircuit, path: (id) => `/organizations/${id}/memory` },
  { label: "Channel economics", icon: Coins, path: (id) => `/organizations/${id}/economics` },
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
        <SidebarSeparator className="group-data-[collapsible=icon]:hidden" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              disabled
              tooltip="Settings — not available yet"
              className="cursor-default"
            >
              <Settings2 />
              <span>Settings</span>
              <UpcomingBadge />
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" tooltip="Agency operator" className="cursor-default">
              <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
                AR
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-medium">Agency operator</span>
                <span className="truncate text-xs text-muted-foreground">Workspace admin</span>
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </SidebarPrimitive>
  );
}
