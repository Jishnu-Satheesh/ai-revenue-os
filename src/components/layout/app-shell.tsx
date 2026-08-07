import { Bell, Search } from "lucide-react";

import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <SidebarProvider>
      <Sidebar />
      <SidebarInset>
        <header className="flex h-16 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3">
            <SidebarTrigger className="md:hidden" />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Agency</span>
              <span>/</span>
              <span className="font-medium text-foreground">Overview</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" className="hidden text-muted-foreground md:flex">
              <Search data-icon="inline-start" />
              Search <span className="ml-2 text-xs">⌘K</span>
            </Button>
            <Button variant="ghost" size="icon" aria-label="Notifications">
              <Bell />
            </Button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
