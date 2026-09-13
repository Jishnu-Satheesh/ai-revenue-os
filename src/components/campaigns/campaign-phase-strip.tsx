import { AlertTriangle, Check, CircleSlash, Flag } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  PHASE_SEQUENCE,
  phaseLabel,
  phasePosition,
  type CampaignPhaseVerdict,
} from "@/domain/campaigns/phase";

/**
 * Where this campaign stands, and the one thing worth doing next.
 *
 * The strip exists because "approved" is not an answer. The same word covers
 * creative that has not been made, creative that has not been reviewed, and
 * creative nobody has authorized to publish — three situations that need three
 * different responses. Showing the two gates as separate steps is what makes
 * the difference visible without reading anything.
 *
 * A campaign that stopped or settled gets an ending rather than a position on
 * the path. Drawing "Publishing" as an upcoming step for a cancelled campaign
 * would promise something that is not going to happen.
 */

const UNDETERMINED_LABEL: Readonly<Record<string, string>> = {
  deliverables: "the finished outputs",
  launch: "whether publication is authorized",
};

function Step({
  label,
  status,
}: Readonly<{ label: string; status: "done" | "current" | "upcoming" }>) {
  return (
    <li
      className="flex min-w-0 flex-1 items-center gap-2"
      aria-current={status === "current" ? "step" : undefined}
    >
      <span
        aria-hidden="true"
        className={
          status === "done"
            ? "flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
            : status === "current"
              ? "size-5 shrink-0 rounded-full border-2 border-primary bg-primary/15"
              : "size-5 shrink-0 rounded-full border border-dashed"
        }
      >
        {status === "done" ? <Check className="size-3" /> : null}
      </span>
      <span
        className={
          status === "upcoming"
            ? "truncate text-xs text-muted-foreground"
            : "truncate text-xs font-medium"
        }
      >
        {label}
      </span>
    </li>
  );
}

export function CampaignPhaseStrip({
  verdict,
  canAct,
}: Readonly<{
  verdict: CampaignPhaseVerdict;
  /**
   * Whether this viewer holds the capability the next action needs. False turns
   * the action into a statement of what is waiting and who it is waiting on,
   * rather than a control that would refuse them.
   */
  canAct: boolean;
}>) {
  const position = phasePosition(verdict.phase);
  const ended = position === null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border bg-card p-4" aria-label="Progress">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex items-center gap-2">
          {verdict.phase === "stopped" ? (
            <CircleSlash className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : verdict.phase === "settled" ? (
            <Flag className="size-4 text-muted-foreground" aria-hidden="true" />
          ) : null}
          <h2 className="text-base font-semibold">{verdict.label}</h2>
        </div>
        {verdict.undetermined.length > 0 ? (
          <Badge variant="outline" className="gap-1">
            <AlertTriangle className="size-3" aria-hidden="true" />
            Incomplete
          </Badge>
        ) : null}
      </div>

      <p className="text-sm text-muted-foreground">{verdict.summary}</p>

      {ended ? null : (
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:flex-nowrap">
          {PHASE_SEQUENCE.map((phase, index) => (
            <Step
              key={phase}
              label={phaseLabel(phase)}
              status={index < position ? "done" : index === position ? "current" : "upcoming"}
            />
          ))}
        </ol>
      )}

      {verdict.facts.length === 0 ? null : (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {verdict.facts.map((fact) => (
            <div key={fact.label} className="flex min-w-0 flex-col gap-0.5">
              <dt className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
                {fact.label}
              </dt>
              <dd
                className={
                  fact.value === null
                    ? "text-sm text-muted-foreground italic"
                    : "text-sm font-medium"
                }
              >
                {/* Never a dash or a zero. An unread value says it is unread. */}
                {fact.value ?? "Could not be read"}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {verdict.undetermined.length > 0 ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Some of this could not be read</AlertTitle>
          <AlertDescription>
            This panel could not read{" "}
            {verdict.undetermined.map((signal) => UNDETERMINED_LABEL[signal] ?? signal).join(" or ")}
            . What is shown is incomplete rather than empty, so treat any count here as unknown and
            reload before acting on it.
          </AlertDescription>
        </Alert>
      ) : null}

      {verdict.nextAction === null ? null : (
        <div className="flex flex-col gap-1 rounded-md border border-dashed p-3">
          <span className="text-[10px] font-bold tracking-widest text-muted-foreground uppercase">
            Next
          </span>
          <span className="text-sm font-medium">{verdict.nextAction.label}</span>
          <span className="text-xs text-muted-foreground">{verdict.nextAction.detail}</span>
          {canAct ? null : (
            // Said rather than hidden. Somebody who cannot do this still needs
            // to know what the campaign is waiting on, and who it waits for.
            <span className="text-xs text-muted-foreground">
              This needs the{" "}
              <span className="font-medium text-foreground">{verdict.nextAction.permission}</span>{" "}
              capability, which your role does not hold. Someone who does can take it from here.
            </span>
          )}
        </div>
      )}
    </section>
  );
}
