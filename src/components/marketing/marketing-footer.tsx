import { footer, nav, WALKTHROUGH_MAILTO } from "@/components/marketing/content";

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-col justify-between gap-8 sm:flex-row sm:items-start">
          <div className="space-y-2">
            <p className="text-sm font-semibold">{nav.productName}</p>
            <p className="max-w-md text-sm text-muted-foreground">{footer.tagline}</p>
          </div>
          <div className="flex items-center gap-6">
            <a
              href={footer.signInHref}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {footer.signInLabel}
            </a>
            <a
              href={WALKTHROUGH_MAILTO}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {footer.contactLabel}
            </a>
          </div>
        </div>
        <p className="mt-10 text-xs text-muted-foreground">{footer.copyright}</p>
      </div>
    </footer>
  );
}
