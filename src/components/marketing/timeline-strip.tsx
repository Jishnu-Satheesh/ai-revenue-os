import { timeline } from "@/components/marketing/content";

type PhaseState = (typeof timeline.phases)[number]["state"];

const stateClasses: Record<PhaseState, string> = {
  done: "bg-primary",
  active: "bg-primary/40 ring-1 ring-primary/50",
  upcoming: "border border-border bg-transparent",
};

const legend = [
  { label: "Complete", dot: "bg-primary" },
  { label: "In progress", dot: "bg-primary/40 ring-1 ring-primary/50" },
  { label: "Upcoming", dot: "border border-border" },
] as const;

export function TimelineStrip() {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[560px] overflow-hidden rounded-xl border border-border bg-card">
        <div className="grid grid-cols-8 border-b border-border">
          {timeline.weeks.map((week, index) => (
            <span
              key={week}
              className={`px-2 py-2 text-center font-mono text-[10px] uppercase text-muted-foreground ${index > 0 ? "border-l border-border" : ""}`}
            >
              {week}
            </span>
          ))}
        </div>
        <div>
          {timeline.phases.map((phase, index) => (
            <div
              key={phase.label}
              className={`grid grid-cols-[7.5rem_1fr] items-center gap-4 px-4 py-3 ${index > 0 ? "border-t border-border" : ""}`}
            >
              <span className="flex items-center gap-2">
                <span
                  aria-hidden="true"
                  className={`size-1.5 rounded-full ${stateClasses[phase.state]}`}
                />
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {phase.label}
                </span>
              </span>
              <span className="relative block h-3">
                <span
                  aria-hidden="true"
                  className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${stateClasses[phase.state]}`}
                  style={{
                    left: `${(phase.start / timeline.weeks.length) * 100}%`,
                    width: `${(phase.span / timeline.weeks.length) * 100}%`,
                  }}
                />
                {phase.state === "done" && (
                  <span
                    aria-hidden="true"
                    className="absolute top-1/2 size-1.5 -translate-y-1/2 rotate-45 bg-primary"
                    style={{
                      left: `calc(${((phase.start + phase.span) / timeline.weeks.length) * 100}% - 3px)`,
                    }}
                  />
                )}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-5 border-t border-border px-4 py-3">
          {legend.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
              <span aria-hidden="true" className={`size-1.5 rounded-full ${item.dot}`} />
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {item.label}
              </span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
