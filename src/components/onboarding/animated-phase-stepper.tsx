"use client";

import { motion } from "framer-motion";
import { Check } from "lucide-react";

import type { OnboardingPhase, OnboardingSectionKey } from "@/domain/onboarding/types";
import type { RailSection } from "@/components/onboarding/onboarding-section-rail";

const phaseOrder: OnboardingPhase[] = [
  "foundation",
  "commercial_context",
  "customer_context",
  "governance",
  "data_intake",
  "review",
];

const phaseLabels: Record<OnboardingPhase, string> = {
  foundation: "Foundation",
  commercial_context: "Commercial",
  customer_context: "Customer",
  governance: "Governance",
  data_intake: "Data intake",
  review: "Review",
};

export function AnimatedPhaseStepper({
  sections,
  currentSectionKey,
}: {
  sections: readonly RailSection[];
  currentSectionKey: OnboardingSectionKey;
}) {
  const currentPhase = sections.find((section) => section.key === currentSectionKey)?.phase;

  return (
    <div aria-label="Onboarding phase progress" className="flex items-center gap-2">
      {phaseOrder.map((phase, index) => {
        const phaseSections = sections.filter((section) => section.phase === phase);
        const complete =
          phaseSections.length > 0 &&
          phaseSections.every((section) => section.status === "complete");
        const active = phase === currentPhase;
        return (
          <div key={phase} className="flex min-w-0 flex-1 items-center gap-2">
            <div className="flex min-w-0 flex-col items-center gap-1">
              <motion.div
                animate={{ scale: active ? 1.05 : 1 }}
                transition={{ duration: 0.2 }}
                className={
                  complete
                    ? "flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground"
                    : active
                      ? "flex size-7 items-center justify-center rounded-full border-2 border-primary text-primary"
                      : "flex size-7 items-center justify-center rounded-full border bg-muted text-muted-foreground"
                }
                aria-current={active ? "step" : undefined}
              >
                {complete ? (
                  <Check aria-hidden="true" />
                ) : (
                  <span className="text-xs font-semibold">{index + 1}</span>
                )}
              </motion.div>
              <span className="hidden truncate text-[11px] text-muted-foreground sm:block">
                {phaseLabels[phase]}
              </span>
            </div>
            {index < phaseOrder.length - 1 ? (
              <div className="relative h-px min-w-3 flex-1 overflow-hidden bg-border">
                <motion.div
                  className="absolute inset-0 origin-left bg-primary"
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: complete ? 1 : 0 }}
                  transition={{ duration: 0.35, ease: [0.33, 1, 0.68, 1] }}
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
