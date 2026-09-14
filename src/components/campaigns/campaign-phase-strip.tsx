import { AlertTriangle, CheckCircle2, Circle, CircleDot, CircleSlash } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  PHASE_SEQUENCE,
  phaseLabel,
  phasePosition,
  type CampaignPhaseVerdict,
} from "@/domain/campaigns/phase";

/**
 * Where this campaign stands, as the five steps the client sees.
 *
 * The strip exists because "approved" is not an answer. The same word covers
 * creative that has not been made, creative that has not been reviewed, and
 * creative nobody has authorized to publish. Showing the journey as named
 * stages is what makes the difference visible without reading anything.
 *
 * Completed marks come from saved records only. A failed generation does not
 * advance to Review, and a stopped campaign gets an ending rather than a
 * position on the path — drawing "Scheduled / Live" as an upcoming step for a
 * cancelled campaign would promise something that is not going to happen.
 */

const UNDETERMINED_LABEL: Readonly<Record<string, string>> = {
  deliverables: "the finished outputs",
  launch: "whether publication is authorized",
};

function Step({
  label,
  status,
  last,
}: Readonly<{ label: string; status: "done" | "current" | "upcoming"; last: boolean }>) {
  return (
    <li
      className="flex min-w-0 items-center gap-2"
      aria-current={status === "current" ? "step" : undefined}
    >
      {status === "done" ? (
        <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden="true" />
      ) : status === "current" ? (
        <CircleDot className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <Circle className="size-4 shrink-0 text-muted-foreground/60" aria-hidden="true" />
      )}
      <span
        className={
          status === "upcoming"
            ? "text-sm whitespace-nowrap text-muted-foreground"
            : status === "current"
              ? "text-sm font-semibold whitespace-nowrap"
              : "text-sm font-medium whitespace-nowrap text-primary"
        }
      >
        {label}
      </span>
      {/* The connector is decorative and drops out when the row wraps, so a
          two-line strip on a phone never shows a rule pointing at nothing. */}
      {last ? null : (
        <span aria-hidden="true" className="hidden h-px w-6 shrink bg-border sm:block" />
      )}
    </li>
  );
}

export function CampaignPhaseStrip({
  verdict,
}: Readonly<{ verdict: CampaignPhaseVerdict }>) {
  const position = phasePosition(verdict.phase);

  return (
    <section className="flex flex-col gap-3" aria-label="Progress">
      <div className="rounded-lg border bg-card px-4 py-3">
        {position === null ? (
          <p className="flex items-center gap-2 text-sm font-medium">
            <CircleSlash className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {verdict.label} — {verdict.summary}
          </p>
        ) : (
          <ol className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {PHASE_SEQUENCE.map((phase, index) => (
              <Step
                key={phase}
                label={phaseLabel(phase)}
                status={index < position ? "done" : index === position ? "current" : "upcoming"}
                last={index === PHASE_SEQUENCE.length - 1}
              />
            ))}
          </ol>
        )}
      </div>

      {verdict.undetermined.length > 0 ? (
        <Alert>
          <AlertTriangle />
          <AlertTitle>Some of this could not be read</AlertTitle>
          <AlertDescription>
            This page could not read{" "}
            {verdict.undetermined.map((signal) => UNDETERMINED_LABEL[signal] ?? signal).join(" or ")}
            . What is shown is incomplete rather than empty, so treat any count here as unknown and
            reload before acting on it.
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
