"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  BrainCircuit,
  Building2,
  Cable,
  Coins,
  Compass,
  LayoutDashboard,
  Settings2,
  Sparkles,
  Waypoints,
} from "lucide-react";

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

const navigation = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard },
  { label: "Opportunities", href: "/opportunities", icon: Sparkles },
  { label: "Agents", href: "/agents", icon: Bot, upcoming: true },
  { label: "Campaigns", href: "/campaigns", icon: BarChart3, upcoming: true },
  { label: "Executions", href: "/executions", icon: Activity, upcoming: true },
  { label: "Organizations", href: "/organizations", icon: Building2, upcoming: true },
];

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The organization group only exists while the reader is inside one. */
function organizationNavigation(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  const organizationId =
    segments[0] === "organizations" && uuidPattern.test(segments[1] ?? "") ? segments[1] : null;
  if (!organizationId) return null;
  return {
    organizationId,
    items: [
      {
        label: "Overview",
        href: `/organizations/${organizationId}/overview`,
        icon: Boxes,
      },
      {
        label: "Guided onboarding",
        href: `/organizations/${organizationId}/onboarding`,
        icon: Compass,
      },
      { label: "Integrations", href: `/organizations/${organizationId}/integrations`, icon: Cable },
      {
        label: "Business Memory",
        href: `/organizations/${organizationId}/memory`,
        icon: BrainCircuit,
      },
      {
        label: "Channel economics",
        href: `/organizations/${organizationId}/economics`,
        icon: Coins,
      },
    ],
  };
}

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const organization = organizationNavigation(pathname);

  return (
    <SidebarPrimitive variant="floating" collapsible="icon">
      <SidebarHeader className="gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild tooltip="AI Revenue OS">
              <Link href="/overview">
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
        <OrganizationSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map(({ label, href, icon: Icon, upcoming }) => (
                <SidebarMenuItem key={label}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === href || pathname.startsWith(`${href}/`)}
                    tooltip={label}
                  >
                    <Link href={href}>
                      <Icon />
                      <span>{label}</span>
                      {upcoming && (
                        <Badge
                          variant="secondary"
                          className="ml-auto text-[10px] uppercase group-data-[collapsible=icon]:hidden"
                        >
                          Soon
                        </Badge>
                      )}
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {organization ? (
          <SidebarGroup>
            <SidebarGroupLabel>Organization</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {organization.items.map(({ label, href, icon: Icon }) => (
                  <SidebarMenuItem key={label}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname === href || pathname.startsWith(`${href}/`)}
                      tooltip={label}
                    >
                      <Link href={href}>
                        <Icon />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
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
              asChild
              isActive={pathname.startsWith("/settings")}
              tooltip="Settings"
            >
              <Link href="/settings">
                <Settings2 />
                <span>Settings</span>
              </Link>
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
