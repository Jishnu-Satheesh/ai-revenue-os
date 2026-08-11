"use client";

import { useState } from "react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  CircleDot,
  LockKeyhole,
  TriangleAlert,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type {
  OnboardingPhase,
  OnboardingSectionKey,
  OnboardingSectionStatus,
} from "@/domain/onboarding/types";
import { cn } from "@/lib/utils";

export type RailSection = {
  key: OnboardingSectionKey;
  phase: OnboardingPhase;
  label: string;
  description: string;
  status: OnboardingSectionStatus;
  /**
   * Carries an unsatisfied critical requirement.
   *
   * Distinct from being incomplete. The rail's completed count already says how
   * much is left; it says nothing about what is stopping the review from being
   * confirmed, and those are different questions with different urgency.
   */
  blocking?: boolean;
};

const phaseLabels: Record<OnboardingPhase, string> = {
  foundation: "Foundation",
  commercial_context: "Commercial context",
  customer_context: "Customer context",
  governance: "Governance",
  data_intake: "Data intake",
  review: "Review",
};

const statusLabels: Record<OnboardingSectionStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  complete: "Complete",
  needs_attention: "Needs attention",
  blocked: "Blocked",
};

function StatusIcon({ status }: { status: OnboardingSectionStatus }) {
  if (status === "complete") return <Check aria-hidden="true" data-icon="inline-start" />;
  if (status === "needs_attention")
    return <CircleAlert aria-hidden="true" data-icon="inline-start" />;
  if (status === "blocked") return <LockKeyhole aria-hidden="true" data-icon="inline-start" />;
  if (status === "in_progress") return <CircleDot aria-hidden="true" data-icon="inline-start" />;
  return <CircleDashed aria-hidden="true" data-icon="inline-start" />;
}

/**
 * Every section is reachable at any time: onboarding is a data-gathering job
 * that moves back and forth, and completion is decided by the payload rather
 * than by the order the operator visited things in.
 */
export function OnboardingSectionRail({
  sections,
  currentSectionKey,
  onSelect,
}: {
  sections: readonly RailSection[];
  currentSectionKey: OnboardingSectionKey;
  onSelect: (sectionKey: OnboardingSectionKey) => void;
}) {
  const phases = [...new Set(sections.map((section) => section.phase))];
  const currentPhase = sections.find((section) => section.key === currentSectionKey)?.phase;
  const [openPhases, setOpenPhases] = useState<OnboardingPhase[]>(() => [
    currentPhase ?? phases[0],
  ]);
  const [lastPhase, setLastPhase] = useState(currentPhase);

  // Advancing past a phase boundary must reveal the section that just became
  // active, even when the operator had collapsed that phase earlier. Adjusting
  // during render rather than in an effect avoids a frame with the new section
  // hidden.
  if (currentPhase && currentPhase !== lastPhase) {
    setLastPhase(currentPhase);
    if (!openPhases.includes(currentPhase)) setOpenPhases([...openPhases, currentPhase]);
  }

  const blocking = sections.filter((section) => section.blocking).length;
  const outstanding = sections.filter((section) => section.status !== "complete").length;

  return (
    <nav aria-label="Onboarding sections" className="flex flex-col gap-2">
      {/* What is left, and what is stopping confirmation, without having to
          reach the last section to find out. */}
      {outstanding > 0 ? (
        <p className="flex flex-wrap items-center gap-1.5 px-2 pb-1 text-xs text-muted-foreground">
          <span>
            {outstanding} section{outstanding === 1 ? "" : "s"} outstanding
          </span>
          {blocking > 0 ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex items-center gap-1 font-medium text-foreground">
                <TriangleAlert aria-hidden="true" className="size-3.5 text-warning" />
                {blocking} blocking review
              </span>
            </>
          ) : null}
        </p>
      ) : null}
      {phases.map((phase) => {
        const phaseSections = sections.filter((section) => section.phase === phase);
        const completed = phaseSections.filter((section) => section.status === "complete").length;
        const open = openPhases.includes(phase);

        return (
          <Collapsible
            key={phase}
            open={open}
            onOpenChange={(next) =>
              setOpenPhases((current) =>
                next ? [...current, phase] : current.filter((entry) => entry !== phase),
              )
            }
          >
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                className="h-9 w-full justify-start gap-2 px-2"
                aria-label={`${phaseLabels[phase]}: ${completed} of ${phaseSections.length} complete`}
              >
                <ChevronDown
                  aria-hidden="true"
                  className={cn("transition-transform duration-200", !open && "-rotate-90")}
                />
                <span className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {phaseLabels[phase]}
                </span>
                <span className="ml-auto text-xs text-muted-foreground tabular-nums">
                  {completed}/{phaseSections.length}
                </span>
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="overflow-hidden data-closed:animate-collapsible-up data-open:animate-collapsible-down">
              <div className="flex flex-col gap-1 pt-1 pb-2 pl-3">
                {phaseSections.map((section) => {
                  const active = section.key === currentSectionKey;
                  return (
                    <Button
                      key={section.key}
                      type="button"
                      variant={active ? "outline" : "ghost"}
                      className={cn(
                        "h-auto min-h-12 w-full justify-start px-3 py-2 text-left",
                        active && "border-primary/60 bg-primary/5",
                      )}
                      aria-current={active ? "step" : undefined}
                      aria-label={`${section.label}: ${statusLabels[section.status]}`}
                      onClick={() => onSelect(section.key)}
                    >
                      <StatusIcon status={section.status} />
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="truncate font-medium">{section.label}</span>
                          {section.blocking ? (
                            <TriangleAlert
                              aria-label="Blocks review"
                              className="size-3.5 shrink-0 text-warning"
                            />
                          ) : null}
                        </span>
                        <span className="text-xs whitespace-normal text-muted-foreground">
                          {section.description}
                        </span>
                      </span>
                      <Badge variant={active ? "outline" : "secondary"} className="shrink-0">
                        {statusLabels[section.status]}
                      </Badge>
                    </Button>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </nav>
  );
}
