"use client";

import { Check, CircleAlert, CircleDashed, CircleDot, LockKeyhole } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
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

export function OnboardingSectionRail({
  sections,
  currentSectionKey,
  visitedSectionKeys,
  onSelect,
}: {
  sections: readonly RailSection[];
  currentSectionKey: OnboardingSectionKey;
  visitedSectionKeys: readonly OnboardingSectionKey[];
  onSelect: (sectionKey: OnboardingSectionKey) => void;
}) {
  const visited = new Set(visitedSectionKeys);
  const phases = [...new Set(sections.map((section) => section.phase))];

  return (
    <ScrollArea className="max-h-[calc(100vh-12rem)] pr-3">
      <nav aria-label="Onboarding sections" className="flex flex-col gap-5">
        {phases.map((phase) => (
          <section
            key={phase}
            aria-labelledby={`onboarding-phase-${phase}`}
            className="flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2 px-2">
              <h3
                id={`onboarding-phase-${phase}`}
                className="text-xs font-semibold tracking-wide text-muted-foreground uppercase"
              >
                {phaseLabels[phase]}
              </h3>
              <span className="text-xs text-muted-foreground">
                {
                  sections.filter(
                    (section) => section.phase === phase && section.status === "complete",
                  ).length
                }
                /{sections.filter((section) => section.phase === phase).length}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {sections
                .filter((section) => section.phase === phase)
                .map((section) => {
                  const active = section.key === currentSectionKey;
                  const navigable = visited.has(section.key);
                  return (
                    <Button
                      key={section.key}
                      type="button"
                      variant={active ? "outline" : "ghost"}
                      className={cn(
                        "h-auto min-h-12 justify-start px-3 py-2 text-left",
                        active && "border-primary/60 bg-primary/5",
                      )}
                      disabled={!navigable}
                      aria-current={active ? "step" : undefined}
                      aria-label={`${section.label}: ${statusLabels[section.status]}`}
                      onClick={() => onSelect(section.key)}
                    >
                      <StatusIcon status={section.status} />
                      <span className="flex min-w-0 flex-1 flex-col items-start gap-0.5">
                        <span className="truncate font-medium">{section.label}</span>
                        <span className="truncate text-xs text-muted-foreground">
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
          </section>
        ))}
      </nav>
    </ScrollArea>
  );
}
