"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

export function OrganizationSwitcher() {
  const { isMobile, state } = useSidebar();

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip="Portfolio workspace"
              className="data-[state=open]:bg-sidebar-accent"
            >
              <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Building2 />
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">Portfolio workspace</span>
                <span className="truncate text-xs text-muted-foreground">Agency</span>
              </span>
              <ChevronsUpDown className="ml-auto text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side={isMobile ? "bottom" : state === "collapsed" ? "right" : "bottom"}
            sideOffset={4}
            className="w-64"
          >
            <DropdownMenuLabel className="flex items-center justify-between gap-2">
              Organizations
              <Badge variant="outline">Agency</Badge>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem>
                <Check />
                Portfolio workspace
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Building2 />
                Add organization after onboarding
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
