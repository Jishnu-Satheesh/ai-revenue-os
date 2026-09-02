import { capabilities, capabilitiesIntro } from "@/components/marketing/content";

import { FigOpportunityList } from "./fig-opportunity-list";
import { FigOutcomeRow } from "./fig-outcome-row";
import { FigTwinCard } from "./fig-twin-card";

function Artifact({ artifact }: { artifact: (typeof capabilities)[number]["artifact"] }) {
  if (artifact.kind === "facts") {
    return <FigTwinCard artifact={artifact} />;
  }
  if (artifact.kind === "ranked") {
    return <FigOpportunityList artifact={artifact} />;
  }
  return <FigOutcomeRow artifact={artifact} />;
}

export default function Capabilities() {
  return (
    <section className="px-6 py-24 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:items-end lg:gap-20">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              What it does
            </p>
            <h2 className="mt-4 max-w-xl text-5xl font-semibold tracking-tight text-balance sm:text-6xl">
              Built around decisions, not dashboards.
            </h2>
          </div>
          <p className="max-w-md text-lg leading-relaxed text-muted-foreground text-pretty">
            {capabilitiesIntro}
          </p>
        </div>
        <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-6 lg:gap-8">
          {capabilities.map((capability) => (
            <div key={capability.title} className="flex flex-col">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                {capability.fig}
              </p>
              <div className="mt-4">
                <Artifact artifact={capability.artifact} />
              </div>
              <h3 className="mt-5 text-lg font-medium tracking-tight">{capability.title}</h3>
              <p className="mt-2.5 text-base leading-relaxed text-muted-foreground">
                {capability.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
