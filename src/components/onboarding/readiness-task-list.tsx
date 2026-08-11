"use client";

import { ArrowRight, CircleAlert, CircleDot } from "lucide-react";

import { useOnboardingWorkspace } from "@/components/onboarding/onboarding-workspace";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { getOnboardingSectionDefinition } from "@/domain/onboarding/section-registry";
import type { ReadinessAction } from "@/domain/onboarding/readiness";

/**
 * The highest-impact next setup actions, per `specs/008-ai-readiness-score.md`.
 *
 * Every row names the task, says who owns it and roughly what it costs, and
 * goes to the section where it is actually done. Until now this rendered the
 * bare reason id — `cost_structure_required` — with nowhere to click, which is
 * a list of identifiers rather than a guide.
 *
 * Blockers come first because they gate confirmation; the rest follow by how
 * much the score has to gain, which is the ordering the domain applies.
 */
export function ReadinessTaskList({ actions }: { actions: readonly ReadinessAction[] }) {
  const workspace = useOnboardingWorkspace();

  if (actions.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        Nothing is outstanding. Every requirement in the rubric is satisfied.
      </p>
    );

  return (
    <ul className="flex flex-col gap-2">
      {actions.map((action) => {
        const section = getOnboardingSectionDefinition(action.sectionKey);

        return (
          <li
            key={action.reasonId}
            className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3"
          >
            <div className="flex min-w-0 items-start gap-2.5">
              {action.critical ? (
                <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
              ) : (
                <CircleDot
                  aria-hidden="true"
                  className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                />
              )}
              <div className="flex min-w-0 flex-col gap-1">
                <span className="text-sm font-medium">{action.label}</span>
                <span className="text-xs text-muted-foreground">
                  {section?.label ?? action.sectionKey} · {EFFORT_LABEL[action.effort]} ·{" "}
                  {OWNER_LABEL[action.owner]}
                </span>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {action.critical ? <StatusBadge label="Blocker" tone="warning" /> : null}
              {/* Navigating rather than linking: the workspace keeps the section
                  in local state, so a href would reload the whole session. */}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => workspace?.goToSection(action.sectionKey)}
              >
                Open
                <ArrowRight data-icon="inline-end" />
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

const EFFORT_LABEL: Readonly<Record<ReadinessAction["effort"], string>> = {
  small: "a few minutes",
  medium: "half an hour",
  large: "needs a session",
};

const OWNER_LABEL: Readonly<Record<ReadinessAction["owner"], string>> = {
  agency_operator: "you",
  client_contact: "the client",
};
