import Link from "next/link";
import { CircleCheck, CircleDashed, CircleSlash, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { StatusBadge } from "@/components/ui/status-badge";
import type { EvidenceReadinessState } from "@/domain/economics/readiness";
import type {
  EvidenceReadinessView,
  ReadinessTupleView,
} from "@/modules/economics/application/readiness-service";

/**
 * What evidence is ready, what stops an honest contribution margin, and what to
 * provide next — the three questions in `specs/012` section 7.5.
 *
 * Nothing here states a figure. The panel has none: it is handed periods,
 * states, and reasons, so there is no number available to render even by
 * mistake, and no workbook value, row, cell, filename, URL, or model output
 * reaches this component.
 *
 * Server-rendered on purpose. There is no interaction to hydrate for, and a
 * client component would mean shipping the readiness of an organization's
 * finances into a bundle that outlives the request.
 */

const TONE: Readonly<Record<EvidenceReadinessState, "success" | "warning" | "neutral" | "danger">> =
  {
    ready_for_economics: "success",
    partial_evidence: "warning",
    needs_data: "neutral",
    not_comparable: "warning",
    blocked: "danger",
  };

function StateIcon({ state }: { state: EvidenceReadinessState }) {
  if (state === "ready_for_economics")
    return <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-success" />;
  if (state === "blocked")
    return <CircleSlash aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />;
  if (state === "needs_data")
    return (
      <CircleDashed aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
    );
  return <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />;
}

/**
 * The exact dates as recorded, never a month name.
 *
 * "August" would be a claim about a calendar period this evidence does not
 * make. A marketplace export covering the 3rd to the 29th is exactly that, and
 * rounding it in the label is the first step toward rounding it in the maths.
 */
function periodLabel(tuple: ReadinessTupleView): string {
  return `${tuple.periodStart} to ${tuple.periodEnd} · ${tuple.periodTimezone}${
    tuple.currency ? ` · ${tuple.currency}` : ""
  }`;
}

function ReadinessRow({
  tuple,
  costStructureHref,
  reportsHref,
}: {
  tuple: ReadinessTupleView;
  costStructureHref: string;
  reportsHref: string;
}) {
  return (
    <li className="flex flex-col gap-2 py-4 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start gap-3">
        <StateIcon state={tuple.state} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">
              {tuple.channelName} · {tuple.branchName}
            </span>
            <StatusBadge label={tuple.stateLabel} tone={TONE[tuple.state]} />
          </div>
          <p className="text-xs tabular-nums text-muted-foreground">{periodLabel(tuple)}</p>
          <p className="text-sm text-muted-foreground">{tuple.stateSummary}</p>
        </div>
      </div>

      {tuple.blockers.length > 0 ? (
        <ul className="ml-7 flex flex-col gap-2 border-l border-border/60 pl-4">
          {tuple.blockers.map((blocker) => (
            <li key={blocker.explanation} className="flex flex-col gap-1">
              <p className="text-sm">{blocker.explanation}</p>
              {blocker.nextStep ? (
                <p className="text-xs text-muted-foreground">{blocker.nextStep}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {tuple.state === "blocked" || tuple.state === "not_comparable" ? (
        <div className="ml-7 pl-4">
          <Button asChild variant="outline" size="sm">
            <Link href={reportsHref}>Open reports</Link>
          </Button>
        </div>
      ) : null}

      {tuple.state === "needs_data" || tuple.state === "partial_evidence" ? (
        <div className="ml-7 pl-4">
          <Button asChild variant="outline" size="sm">
            <Link href={costStructureHref}>Add cost structure</Link>
          </Button>
        </div>
      ) : null}
    </li>
  );
}

export function EvidenceReadinessPanel({
  view,
  costStructureHref,
  reportsHref,
}: {
  view: EvidenceReadinessView;
  costStructureHref: string;
  reportsHref: string;
}) {
  const uncoveredComponents =
    view.costCoverage.outcome === "checked"
      ? view.costCoverage.components.filter((component) => !component.covered)
      : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence readiness</CardTitle>
        <CardDescription>
          Whether the reports you have uploaded are enough to work out what each channel earns. This
          calculates nothing on its own.
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-6">
        {view.costSummary ? (
          <p className="rounded-lg bg-muted px-4 py-3 text-sm">{view.costSummary}</p>
        ) : null}

        {view.tuples.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <CircleDashed />
              </EmptyMedia>
              <EmptyTitle>No governed report evidence yet</EmptyTitle>
              <EmptyDescription>
                Upload a channel report in the Integration Hub. Nothing here has been checked, which
                is not the same as nothing being wrong.
              </EmptyDescription>
            </EmptyHeader>
            <Button asChild variant="outline" size="sm">
              <Link href={reportsHref}>Go to reports</Link>
            </Button>
          </Empty>
        ) : (
          <ul className="flex flex-col divide-y divide-border/60">
            {view.tuples.map((tuple) => (
              <ReadinessRow
                key={`${tuple.channelId}:${tuple.branchId}:${tuple.periodStart}:${tuple.periodEnd}:${tuple.periodTimezone}`}
                tuple={tuple}
                costStructureHref={costStructureHref}
                reportsHref={reportsHref}
              />
            ))}
          </ul>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Costs</h3>
          {view.costCoverage.outcome === "unchecked" ? (
            <p className="text-sm text-muted-foreground">
              Your cost setup could not be read, so nothing here has been checked. This is not the
              same as having nothing left to fix.
            </p>
          ) : uncoveredComponents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Every cost the platform knows about has a source recorded.
            </p>
          ) : (
            <ul className="flex flex-col gap-1">
              {uncoveredComponents.map((component) => (
                <li
                  key={component.key}
                  className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
                >
                  <span>{component.label}</span>
                  <StatusBadge
                    label={component.operatorCanResolve ? "Missing" : "Not yet possible"}
                    tone="neutral"
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
