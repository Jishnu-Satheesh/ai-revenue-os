import { howItWorks, howItWorksIntro } from "@/components/marketing/content";

import { TimelineStrip } from "./timeline-strip";

export default function HowItWorks() {
  return (
    <section className="border-y border-border bg-muted/25 px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-start lg:gap-20">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              How it works
            </p>
            <h2 className="mt-4 max-w-xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
              From fragmented data to measured actions.
            </h2>
          </div>
          <div>
            <p className="text-lg leading-relaxed text-muted-foreground text-pretty">
              {howItWorksIntro}
            </p>
            <ol className="mt-8 space-y-7">
              {howItWorks.map((step) => (
                <li key={step.step} className="flex gap-4">
                  <span className="font-mono text-sm text-muted-foreground">{step.step}</span>
                  <div>
                    <h3 className="text-base font-medium tracking-tight">{step.title}</h3>
                    <p className="mt-1.5 text-base leading-relaxed text-muted-foreground">
                      {step.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="mt-16">
          <TimelineStrip />
        </div>
      </div>
    </section>
  );
}
