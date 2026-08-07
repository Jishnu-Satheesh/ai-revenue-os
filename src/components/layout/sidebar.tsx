import Link from "next/link";
import { Activity, BarChart3, Bot, Building2, CircleDollarSign, LayoutDashboard, Settings2, Sparkles } from "lucide-react";
import { OrganizationSwitcher } from "@/components/layout/organization-switcher";

const navigation = [
  { label: "Overview", href: "/overview", icon: LayoutDashboard, active: true },
  { label: "Opportunities", href: "/opportunities", icon: Sparkles },
  { label: "Agents", href: "/agents", icon: Bot, upcoming: true },
  { label: "Campaigns", href: "/campaigns", icon: BarChart3, upcoming: true },
  { label: "Executions", href: "/executions", icon: Activity, upcoming: true },
  { label: "Organizations", href: "/organizations", icon: Building2, upcoming: true },
];

export function Sidebar() {
  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-surface px-3 py-4 md:flex">
      <div className="mb-6 px-2"><p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Revenue Intelligence</p><h1 className="mt-1 text-lg font-semibold tracking-tight">AI Revenue OS</h1></div>
      <div className="mb-5"><OrganizationSwitcher /></div>
      <nav className="space-y-1" aria-label="Main navigation">
        {navigation.map(({ label, href, icon: Icon, active, upcoming }) => (
          <Link key={label} href={href} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm ${active ? "bg-muted font-semibold" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <Icon size={17} strokeWidth={active ? 2.2 : 1.8} /><span className="flex-1">{label}</span>{upcoming && <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70">Soon</span>}
          </Link>
        ))}
      </nav>
      <div className="mt-auto border-t border-border pt-3"><Link href="/settings" className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"><Settings2 size={17} />Settings</Link><div className="mt-4 flex items-center gap-3 px-3"><span className="flex size-8 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background">AR</span><div className="min-w-0"><p className="truncate text-sm font-medium">Agency operator</p><p className="truncate text-xs text-muted-foreground">Workspace admin</p></div></div></div>
    </aside>
  );
}
