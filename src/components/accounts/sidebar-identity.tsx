"use client";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useAccountSession } from "@/components/accounts/account-session";
import { InviteMemberDialog } from "@/components/accounts/invite-member-dialog";
import { SidebarMenuButton, useSidebar } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BadgeCheck,
  Bell,
  ChevronsUpDown,
  CreditCard,
  LogOut,
  Settings2,
  Sparkles,
} from "lucide-react";

const accountRoleLabels: Readonly<Record<string, string>> = {
  owner: "Agency owner",
  admin: "Agency admin",
  member: "Agency member",
};

function initialsFrom(name: string): string {
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  const letters = parts.slice(0, 2).map((part) => part[0]);
  return (letters.join("") || name.slice(0, 2)).toUpperCase();
}

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

/**
 * Who is actually signed in.
 *
 * This footer previously rendered the literal strings "Agency operator" and
 * "Workspace admin" to every user regardless of who they were. That was
 * harmless while the product had one user; with a second person in the agency it
 * is a lie about identity in the one place a person checks it.
 */
export function SidebarIdentity() {
  const { isMobile } = useSidebar();
  const { data: session, isPending } = useAccountSession();

  if (isPending) {
    return (
      <SidebarMenuButton size="lg" className="cursor-default">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        <span className="grid min-w-0 flex-1 gap-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-16" />
        </span>
      </SidebarMenuButton>
    );
  }

  // A signed-in user with no agency is a real state, not an error to shout
  // about. The sidebar simply has no identity to show.
  if (!session) return null;

  const name = session.profile.displayName ?? session.profile.email ?? "Signed in";
  const subtitle = accountRoleLabels[session.membership.accountRole] ?? session.account.name;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          tooltip={`${name} — ${session.account.name}`}
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          data-testid="sidebar-identity"
        >
          <Avatar className="h-8 w-8 rounded-full">
            <AvatarFallback className="rounded-full bg-foreground text-xs font-semibold text-background">
              {initialsFrom(name)}
            </AvatarFallback>
          </Avatar>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-medium">{name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {subtitle} · {session.account.name}
            </span>
          </div>
          <ChevronsUpDown className="ml-auto size-4" />
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
        side={isMobile ? "bottom" : "right"}
        align="end"
        sideOffset={4}
      >
        <DropdownMenuLabel className="p-0 font-normal">
          <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
            <Avatar className="h-8 w-8 rounded-full">
              <AvatarFallback className="rounded-full bg-foreground text-xs font-semibold text-background">
                {initialsFrom(name)}
              </AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-medium">{name}</span>
              <span className="truncate text-xs text-muted-foreground">
                {subtitle} · {session.account.name}
              </span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <InviteMemberDialog />
          <DropdownMenuItem disabled>
            <Sparkles />
            Upgrade to Pro
            <UpcomingBadge />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem disabled>
            <BadgeCheck />
            Account
            <UpcomingBadge />
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <CreditCard />
            Billing
            <UpcomingBadge />
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Bell />
            Notifications
            <UpcomingBadge />
          </DropdownMenuItem>
          <DropdownMenuItem disabled>
            <Settings2 />
            <span>Settings</span>
            <UpcomingBadge />
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <LogOut />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
