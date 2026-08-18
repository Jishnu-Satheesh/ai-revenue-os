"use client";

import { useAccountSession } from "@/components/accounts/account-session";
import { SidebarMenuButton } from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";

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

/**
 * Who is actually signed in.
 *
 * This footer previously rendered the literal strings "Agency operator" and
 * "Workspace admin" to every user regardless of who they were. That was
 * harmless while the product had one user; with a second person in the agency it
 * is a lie about identity in the one place a person checks it.
 */
export function SidebarIdentity() {
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
    <SidebarMenuButton
      size="lg"
      tooltip={`${name} — ${session.account.name}`}
      className="cursor-default"
      data-testid="sidebar-identity"
    >
      <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">
        {initialsFrom(name)}
      </span>
      <span className="grid min-w-0 flex-1 text-left leading-tight">
        <span className="truncate text-sm font-medium">{name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {subtitle} · {session.account.name}
        </span>
      </span>
    </SidebarMenuButton>
  );
}
