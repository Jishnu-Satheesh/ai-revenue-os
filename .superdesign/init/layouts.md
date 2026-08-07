# Shared Layouts

## Root layout — `src/app/layout.tsx`

```tsx
import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "AI Revenue OS", description: "A trustworthy operating cockpit for measurable revenue growth." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
```

## Platform layout — `src/app/(platform)/layout.tsx`

```tsx
import { AppShell } from "@/components/layout/app-shell";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
export default async function PlatformLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
```

## App shell — `src/components/layout/app-shell.tsx`

```tsx
import { Bell, Search } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { Button } from "@/components/ui/button";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
export function AppShell({ children }: Readonly<{ children: React.ReactNode }>) {
  return <SidebarProvider><Sidebar /><SidebarInset><header className="flex h-16 items-center justify-between border-b border-border bg-card/80 px-4 backdrop-blur sm:px-8"><div className="flex items-center gap-3"><SidebarTrigger className="md:hidden" /><div className="flex items-center gap-2 text-sm text-muted-foreground"><span>Agency</span><span>/</span><span className="font-medium text-foreground">Overview</span></div></div><div className="flex items-center gap-2"><Button variant="outline" className="hidden text-muted-foreground md:flex"><Search data-icon="inline-start" />Search <span className="ml-2 text-xs">⌘K</span></Button><Button variant="ghost" size="icon" aria-label="Notifications"><Bell /></Button></div></header><main className="mx-auto w-full max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10">{children}</main></SidebarInset></SidebarProvider>;
}
```

## Sidebar — `src/components/layout/sidebar.tsx`

The layout uses the generated shadcn `Sidebar`, `SidebarMenu`, `SidebarMenuButton`, `Badge`, `DropdownMenu`, and `Link`. It contains organization switching, workspace navigation, settings, and the operator identity. The organization switcher is `src/components/layout/organization-switcher.tsx` and composes `DropdownMenu` with `Button`.
