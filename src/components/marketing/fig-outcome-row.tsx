import type { capabilities } from "@/components/marketing/content";

type OutcomeArtifact = Extract<(typeof capabilities)[number]["artifact"], { kind: "outcome" }>;

export function FigOutcomeRow({ artifact }: { artifact: OutcomeArtifact }) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Outcome ledger
          </span>
          <p className="mt-1 truncate text-sm font-medium">{artifact.action}</p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] font-medium text-success">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
          {artifact.status}
        </span>
      </div>
      <dl>
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5">
          <dt className="text-xs text-muted-foreground">Baseline</dt>
          <dd className="text-sm font-medium tabular-nums">{artifact.baseline}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-2.5">
          <dt className="text-xs text-muted-foreground">Measured</dt>
          <dd className="text-sm font-medium tabular-nums">{artifact.measured}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-3 px-4 py-2.5">
          <dt className="text-xs text-muted-foreground">Delta</dt>
          <dd className="text-sm font-semibold tabular-nums text-primary">{artifact.delta}</dd>
        </div>
      </dl>
    </div>
  );
}
