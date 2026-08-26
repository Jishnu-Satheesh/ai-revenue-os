import type { capabilities } from "@/components/marketing/content";

type FactsArtifact = Extract<(typeof capabilities)[number]["artifact"], { kind: "facts" }>;

export function FigTwinCard({ artifact }: { artifact: FactsArtifact }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Digital twin
        </span>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-primary" />
      </div>
      <dl>
        {artifact.rows.map((row) => (
          <div key={row.label} className="border-b border-border px-4 py-3 last:border-b-0">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className="text-right text-sm font-medium tabular-nums">{row.value}</dd>
            </div>
            <span className="mt-2 inline-block rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              {row.source}
            </span>
          </div>
        ))}
      </dl>
    </div>
  );
}
