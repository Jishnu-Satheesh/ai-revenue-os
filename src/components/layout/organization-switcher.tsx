"use client";

import { useQuery } from "@tanstack/react-query";
import { Building2, Check, ChevronsUpDown, Plus } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { z } from "zod";

import {
  organizationIdFromPathname,
  overviewPath,
} from "@/components/layout/organization-route";
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

const organizationListSchema = z.object({
  organizations: z.array(
    z.object({ id: z.string().uuid(), name: z.string().min(1), slug: z.string().min(1) }),
  ),
});

type OrganizationOption = z.infer<typeof organizationListSchema>["organizations"][number];

async function fetchOrganizations(): Promise<readonly OrganizationOption[]> {
  const response = await fetch("/api/organizations");
  if (!response.ok) throw new Error("ORGANIZATION_LIST_UNAVAILABLE");
  return organizationListSchema.parse(await response.json()).organizations;
}

export function OrganizationSwitcher() {
  const { isMobile, state } = useSidebar();
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  // The route is the only source of active scope; nothing is stored here.
  const organizationId = organizationIdFromPathname(pathname);

  const { data, isPending, isError } = useQuery({
    queryKey: ["organizations"],
    queryFn: fetchOrganizations,
  });

  const active = data?.find((organization) => organization.id === organizationId) ?? null;
  const triggerLabel = isPending ? "Loading organizations" : (active?.name ?? "Select organization");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              tooltip={triggerLabel}
              className="data-[state=open]:bg-sidebar-accent"
            >
              <span className="flex aspect-square size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground">
                <Building2 />
              </span>
              <span className="grid min-w-0 flex-1 text-left leading-tight">
                <span className="truncate text-sm font-semibold">{triggerLabel}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {active?.slug ?? "Organization"}
                </span>
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
            <DropdownMenuLabel>Organizations</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {isPending ? (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">Loading organizations…</p>
              ) : isError ? (
                // Generic on purpose: a switcher must not leak why a read failed.
                <p className="px-2 py-1.5 text-sm text-muted-foreground">
                  Organizations could not be loaded.
                </p>
              ) : data && data.length > 0 ? (
                data.map((organization) => (
                  <DropdownMenuItem
                    key={organization.id}
                    onSelect={() => router.push(overviewPath(organization.id))}
                  >
                    {organization.id === organizationId ? <Check /> : <Building2 />}
                    <span className="grid min-w-0 flex-1 leading-tight">
                      <span className="truncate">{organization.name}</span>
                      <span className="truncate text-xs text-muted-foreground">
                        {organization.slug}
                      </span>
                    </span>
                  </DropdownMenuItem>
                ))
              ) : (
                <p className="px-2 py-1.5 text-sm text-muted-foreground">No organizations yet.</p>
              )}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push("/organizations/new")}>
              <Plus />
              Create organization
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
