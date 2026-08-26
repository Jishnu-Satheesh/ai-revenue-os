import { nav, WALKTHROUGH_MAILTO } from "@/components/marketing/content";
import { Button } from "@/components/ui/button";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <span className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground"
          >
            R
          </span>
          <span className="text-sm font-semibold tracking-tight">{nav.productName}</span>
        </span>
        <div className="flex items-center gap-6">
          <a
            href={nav.signInHref}
            className="text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            {nav.signInLabel}
          </a>
          <Button asChild>
            <a href={WALKTHROUGH_MAILTO}>{nav.ctaLabel}</a>
          </Button>
        </div>
      </div>
    </header>
  );
}
