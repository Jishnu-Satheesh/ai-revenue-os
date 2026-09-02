import type { capabilities } from "@/components/marketing/content";

type RankedArtifact = Extract<(typeof capabilities)[number]["artifact"], { kind: "ranked" }>;

export function FigOpportunityList({ artifact }: { artifact: RankedArtifact }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="border-b border-border px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Ranked opportunities
        </span>
      </div>
      <ul>
        {artifact.rows.map((row) => (
          <li key={row.title} className="border-b border-border px-4 py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-3">
              <p className="truncate text-xs font-medium">{row.title}</p>
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                {row.score}
              </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
              <div
                aria-hidden="true"
                className="h-full rounded-full bg-primary"
                style={{ width: `${row.score}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{row.impact}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
