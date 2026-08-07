import { Search, Bell } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";

export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return <div className="flex min-h-screen bg-background"><Sidebar /><div className="min-w-0 flex-1"><header className="flex h-16 items-center justify-between border-b border-border bg-surface/80 px-4 backdrop-blur sm:px-8"><div className="flex items-center gap-2 text-sm text-muted-foreground"><span>Agency</span><span>/</span><span className="font-medium text-foreground">Overview</span></div><div className="flex items-center gap-2"><button className="hidden items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-muted md:flex" type="button"><Search size={15} />Search<span className="ml-4 text-xs">⌘K</span></button><button className="rounded-lg p-2 text-muted-foreground hover:bg-muted" type="button" aria-label="Notifications"><Bell size={17} /></button></div></header><main className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10">{children}</main></div></div>;
}
