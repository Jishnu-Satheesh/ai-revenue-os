import { ArrowRight, CircleCheck, TrendingUp } from "lucide-react";

import {
  WALKTHROUGH_MAILTO,
  announcement,
  dashboardMock,
  hero,
  nav,
} from "@/components/marketing/content";
import { Button } from "@/components/ui/button";

import { DashboardMock } from "./dashboard-mock";

export function Hero() {
  return (
    <section className="relative overflow-hidden px-6 pt-28 pb-24 sm:pt-36 sm:pb-28">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[680px]"
        style={{
          background:
            "radial-gradient(ellipse 60% 46% at 50% -8%, var(--primary) 0%, transparent 68%)",
          opacity: 0.32,
        }}
      />
      <div className="mx-auto max-w-6xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          {hero.eyebrow}
        </p>
        <h1 className="mt-5 max-w-3xl bg-gradient-to-b from-foreground to-foreground/75 bg-clip-text text-balance text-5xl font-semibold tracking-tight text-transparent sm:text-6xl md:text-7xl">
          {hero.headline}
        </h1>
        <div className="mt-7 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-xl text-pretty text-lg leading-relaxed text-muted-foreground">
            {hero.subhead}
          </p>
          <span className="hidden shrink-0 items-center gap-2 text-sm sm:flex">
            <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              {announcement.badge}
            </span>
            <span className="text-muted-foreground">{announcement.text}</span>
            <ArrowRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
          </span>
        </div>
        <div className="mt-9 flex items-center gap-3">
          <Button size="lg" asChild>
            <a href={WALKTHROUGH_MAILTO}>{hero.primaryCta}</a>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <a href={nav.signInHref}>{nav.signInLabel}</a>
          </Button>
        </div>
      </div>

      <div className="relative mx-auto mt-16 max-w-6xl">
        <div
          aria-hidden="true"
          className="absolute -inset-x-10 top-10 bottom-12 -z-10 rounded-[2.5rem] bg-primary/20 blur-3xl"
        />
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl shadow-black/60">
          <div className="flex items-center gap-2 border-b border-border bg-background/60 px-4 py-2.5">
            <span aria-hidden="true" className="flex gap-1.5">
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
              <span className="size-2.5 rounded-full bg-muted-foreground/30" />
            </span>
            <span className="mx-auto rounded-md border border-border bg-card px-3 py-0.5 text-[11px] text-muted-foreground">
              app.airevenueos.com
            </span>
            <span aria-hidden="true" className="w-10" />
          </div>
          <DashboardMock />
        </div>

        <div className="absolute -left-5 bottom-20 hidden items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-xl shadow-black/40 backdrop-blur lg:flex">
          <CircleCheck aria-hidden="true" className="size-4 text-success" />
          <span className="text-xs text-muted-foreground">{dashboardMock.floatApproval}</span>
        </div>
        <div className="absolute -right-5 top-24 hidden items-center gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 shadow-xl shadow-black/40 backdrop-blur lg:flex">
          <TrendingUp aria-hidden="true" className="size-4 text-primary" />
          <span className="text-xs font-medium tabular-nums">{dashboardMock.floatImpact}</span>
        </div>

        <p className="mt-4 text-center text-xs text-muted-foreground">{dashboardMock.caption}</p>
      </div>
    </section>
  );
}
