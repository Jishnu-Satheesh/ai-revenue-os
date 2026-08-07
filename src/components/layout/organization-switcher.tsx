import { ChevronDown, Building2 } from "lucide-react";

export function OrganizationSwitcher() {
  return (
    <button className="flex min-w-0 items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted" type="button" aria-label="Switch organization">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground"><Building2 size={16} /></span>
      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">Portfolio workspace</span><span className="block truncate text-xs text-muted-foreground">Agency</span></span>
      <ChevronDown size={15} className="text-muted-foreground" />
    </button>
  );
}
