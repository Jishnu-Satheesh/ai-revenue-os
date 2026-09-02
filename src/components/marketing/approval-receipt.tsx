import { CircleCheck, TrendingUp } from "lucide-react";

import { receipt } from "@/components/marketing/content";

function StepIcon({ label }: { label: string }) {
  if (label === "Approved" || label === "Executed") {
    return <CircleCheck aria-hidden="true" className="size-3.5 text-success" />;
  }
  if (label === "Measured") {
    return <TrendingUp aria-hidden="true" className="size-3.5 text-primary" />;
  }
  return <span aria-hidden="true" className="size-1.5 rounded-full bg-muted-foreground/50" />;
}

export function ApprovalReceipt() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Decision · {receipt.id}
        </span>
        <span className="text-sm font-medium tracking-tight">{receipt.title}</span>
      </div>
      <div className="px-5 py-4">
        {receipt.steps.map((step, index) => (
          <div key={step.label} className="flex gap-3.5">
            <div className="flex flex-col items-center">
              <span className="flex size-6 items-center justify-center rounded-full border border-border bg-background/40">
                <StepIcon label={step.label} />
              </span>
              {index < receipt.steps.length - 1 && (
                <span
                  aria-hidden="true"
                  className="min-h-5 w-px flex-1 border-l border-dashed border-border"
                />
              )}
            </div>
            <div className="min-w-0 flex-1 pb-5">
              <p className="text-sm font-medium tracking-tight">{step.label}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{step.detail}</p>
            </div>
            <span className="shrink-0 pt-0.5 font-mono text-[10px] text-muted-foreground">
              {step.time}
            </span>
          </div>
        ))}
      </div>
      <p className="border-t border-border px-5 py-3.5 text-xs text-muted-foreground">
        {receipt.caption}
      </p>
    </div>
  );
}
