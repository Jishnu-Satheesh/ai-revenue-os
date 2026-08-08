import { Bell, Search } from "lucide-react";

import { RouteBreadcrumb, RouteContextProvider } from "@/components/layout/route-context";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    // The shell owns the viewport: the document never scrolls, the header stays
    // pinned, and `main` is the scroll container. Pages that want to fill the
    // remaining height claim it with `flex-1 min-h-0` instead of measuring the
    // header in CSS.
    <RouteContextProvider>
      <SidebarProvider className="h-svh min-h-svh overflow-hidden">
        <Sidebar />
        <SidebarInset className="min-h-0 overflow-hidden">
          <header className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border bg-card/80 px-4 backdrop-blur sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <SidebarTrigger />
              <RouteBreadcrumb />
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button variant="outline" className="hidden text-muted-foreground md:flex">
                <Search data-icon="inline-start" />
                Search <span className="ml-2 text-xs">⌘K</span>
              </Button>
              <Button variant="ghost" size="icon" aria-label="Notifications">
                <Bell />
              </Button>
            </div>
          </header>
          <main className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {/* min-h-0 overrides this flex item's default min-height: auto, which
                would otherwise let it grow to its content's height and make this
                `main` scroll instead of a page's own internal scroll areas. */}
            <div className="mx-auto flex w-full min-h-0 max-w-[1440px] flex-1 flex-col px-4 py-8 sm:px-8 sm:py-10">
              {children}
            </div>
          </main>
        </SidebarInset>
      </SidebarProvider>
    </RouteContextProvider>
  );
}
