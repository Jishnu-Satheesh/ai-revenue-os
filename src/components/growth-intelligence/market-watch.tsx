"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, CheckCircle2, Clock3, EyeOff, RotateCcw, Scale } from "lucide-react";

import { SourceEvidenceDrawer } from "@/components/growth-intelligence/source-evidence-drawer";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type {
  MarketWatchSignal,
  MarketWatchView,
} from "@/modules/growth-intelligence/application/market-watch";

const stateMeta: Record<MarketWatchSignal["state"], { label: string; Icon: typeof CheckCircle2 }> =
  {
    current: { label: "Current", Icon: CheckCircle2 },
    stale: { label: "Stale", Icon: Clock3 },
    withdrawn: { label: "Withdrawn", Icon: EyeOff },
    excluded: { label: "Excluded", Icon: Ban },
    conflicted: { label: "Conflicted", Icon: Scale },
    delayed: { label: "Delayed", Icon: Clock3 },
  };

function SignalCard({ signal }: { signal: MarketWatchSignal }) {
  const { label, Icon } = stateMeta[signal.state];
  return (
    <Card data-testid={`market-watch-signal-${signal.claimId}`}>
      <CardHeader>
        <CardTitle className="text-base">{signal.subjectRef}</CardTitle>
        <CardDescription>
          {signal.geographicLayer} · {signal.geographyRef}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm">{signal.paraphrase}</p>
        {signal.quotation ? (
          <blockquote className="border-l-2 pl-3 text-sm text-muted-foreground">
            {signal.quotation}
          </blockquote>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={signal.state === "current" ? "default" : "secondary"}>
            <Icon aria-hidden="true" />
            {signal.expired ? "Expired" : label}
          </Badge>
          <Badge variant="outline">
            {signal.supportGrade ? `${signal.supportGrade} support` : "Ungraded"}
          </Badge>
          <Badge variant="outline">{signal.freshness} evidence</Badge>
        </div>
        {signal.limitations.length > 0 ? (
          <ul className="flex flex-col gap-1 text-xs text-muted-foreground">
            {signal.limitations.map((limitation) => (
              <li key={limitation} className="flex items-center gap-1.5">
                <AlertTriangle aria-hidden="true" className="size-3 shrink-0" />
                {limitation}
              </li>
            ))}
          </ul>
        ) : null}
        <SourceEvidenceDrawer sources={signal.sources} />
      </CardContent>
    </Card>
  );
}

function RetryButton({ organizationId, requestId }: { organizationId: string; requestId: string }) {
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "working" | "succeeded" | "failed">("idle");
  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={status === "working" || status === "succeeded"}
        onClick={async () => {
          setStatus("working");
          try {
            const response = await fetch(
              `/api/organizations/${organizationId}/growth-intelligence/requests/${requestId}/retry`,
              {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
              },
            );
            if (!response.ok) {
              setStatus("failed");
              return;
            }
            // Success is explicit, not inferred from unmount: a slow
            // router.refresh() transition must never strand a control with
            // no feedback.
            setStatus("succeeded");
            router.refresh();
          } catch {
            setStatus("failed");
          }
        }}
      >
        <RotateCcw aria-hidden="true" />
        Retry request
      </Button>
      {status === "succeeded" ? (
        <span className="text-xs text-muted-foreground">Retry requested.</span>
      ) : null}
      {status === "failed" ? (
        <span className="text-xs text-destructive">Retry did not complete. Nothing changed.</span>
      ) : null}
    </div>
  );
}

export function MarketWatch({
  organizationId,
  watch,
  canRetry,
}: {
  organizationId: string;
  watch: MarketWatchView;
  canRetry: boolean;
}) {
  const delayedReason = watch.profileStatus.delayedReason;
  return (
    <section aria-label="Market Watch" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Market Watch</h2>
      {delayedReason ? (
        <Alert>
          <Clock3 aria-hidden="true" />
          <AlertTitle>Evidence delayed</AlertTitle>
          <AlertDescription>{delayedReason}</AlertDescription>
        </Alert>
      ) : null}
      {watch.signals.length === 0 && !delayedReason ? (
        <p className="text-sm text-muted-foreground">No eligible market evidence yet.</p>
      ) : null}
      {watch.signals.map((signal) => (
        <SignalCard key={signal.claimId} signal={signal} />
      ))}
      {canRetry && watch.retryableRequests.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Failed research requests</h3>
          {watch.retryableRequests.map((request) => (
            <div key={request.requestId} className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                {request.kind} · {request.safeFailureCode ?? "no code"}
              </span>
              <RetryButton organizationId={organizationId} requestId={request.requestId} />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
