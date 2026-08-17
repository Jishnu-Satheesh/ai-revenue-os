import Link from "next/link";
import { CircleDashed, TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import type { CostCoverage, TrustGap } from "@/modules/economics/application/read-model";

/**
 * What would I have to fix to trust this — the third question in `specs/012`
 * section 7, and the one that turns a data-quality problem into a task list.
 *
 * The distinction that matters here is between a gap the operator can close and
 * one they cannot. An unpriced commission is a task with a button. Packaging
 * needing an item count is not: no rate they could type would fix it, and
 * offering an action nobody can complete is worse than offering none, so those
 * rows are quieter and carry no button at all.
 */
export function TrustPanel({
  gaps,
  coverage,
  catalogAvailable,
  costStructureHref,
}: {
  gaps: readonly TrustGap[];
  coverage: CostCoverage;
  catalogAvailable: boolean;
  costStructureHref: string;
}) {
  // Counts rather than a bare percentage: "3 of 6" tells the operator how much
  // work is left, where "50%" only tells them how they are doing.
  const percent =
    coverage.applicable === 0 ? 0 : Math.round((coverage.measured / coverage.applicable) * 100);

  if (!catalogAvailable)
    return (
      <p className="text-sm text-muted-foreground">
        The cost component catalog could not be read, so nothing here has been checked. This is not
        the same as having nothing left to fix.
      </p>
    );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            Costs priced from a document, rather than estimated or unknown
          </span>
          <span className="text-sm font-medium tabular-nums">
            {coverage.measured} of {coverage.applicable}
          </span>
        </div>
        <Progress value={percent} />
      </div>

      {gaps.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Every applicable cost is priced from a document. Nothing is holding these margins back.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-border/60">
          {gaps.map((gap) => {
            const actionable = gap.state !== "not_yet_possible";

            return (
              <li key={gap.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
                {actionable ? (
                  <TriangleAlert
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-warning"
                  />
                ) : (
                  <CircleDashed
                    aria-hidden="true"
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                  />
                )}

                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        actionable
                          ? "text-sm font-medium"
                          : "text-sm font-medium text-muted-foreground"
                      }
                    >
                      {gap.label}
                    </span>
                    <StatusBadge
                      label={STATE_LABEL[gap.state]}
                      tone={gap.state === "weak" ? "warning" : "neutral"}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{gap.reason}</p>
                </div>

                {actionable ? (
                  <Button asChild variant="outline" size="sm">
                    <Link href={costStructureHref}>
                      {gap.state === "unpriced" ? "Price this" : "Update"}
                    </Link>
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const STATE_LABEL: Readonly<Record<TrustGap["state"], string>> = {
  unpriced: "Unpriced",
  not_yet_possible: "Not yet possible",
  weak: "Needs confirming",
};
