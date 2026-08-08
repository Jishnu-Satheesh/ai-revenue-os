"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { AnimatedPhaseStepper } from "@/components/onboarding/animated-phase-stepper";
import {
  OnboardingSectionRail,
  type RailSection,
} from "@/components/onboarding/onboarding-section-rail";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { OnboardingSectionKey } from "@/domain/onboarding/types";

const emptyContents: Partial<Record<OnboardingSectionKey, React.ReactNode>> = {};

type OnboardingWorkspaceControls = {
  goToNextSection: () => void;
};

const OnboardingWorkspaceContext = createContext<OnboardingWorkspaceControls | null>(null);

export function useOnboardingWorkspace() {
  return useContext(OnboardingWorkspaceContext);
}

export function OnboardingWorkspace({
  sections,
  contents = emptyContents,
  initialSectionKey,
  onSectionChange,
}: {
  sections: readonly RailSection[];
  contents?: Partial<Record<OnboardingSectionKey, React.ReactNode>>;
  initialSectionKey?: OnboardingSectionKey;
  onSectionChange?: (sectionKey: OnboardingSectionKey) => void;
}) {
  const firstSection = sections[0]?.key ?? "business_identity";
  const [currentSectionKey, setCurrentSectionKey] = useState<OnboardingSectionKey>(
    initialSectionKey ?? firstSection,
  );
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reduceMotion = useReducedMotion();
  const activeSection = useMemo(
    () => sections.find((section) => section.key === currentSectionKey) ?? sections[0],
    [currentSectionKey, sections],
  );

  useEffect(() => {
    headingRef.current?.focus();
  }, [currentSectionKey]);

  function selectSection(sectionKey: OnboardingSectionKey) {
    setCurrentSectionKey(sectionKey);
    onSectionChange?.(sectionKey);
  }

  function goToNextSection() {
    const currentIndex = sections.findIndex((section) => section.key === currentSectionKey);
    const nextSection = sections[currentIndex + 1];
    if (!nextSection) return;
    selectSection(nextSection.key);
  }

  if (!activeSection) return null;

  return (
    <OnboardingWorkspaceContext.Provider value={{ goToNextSection }}>
      {/* Both panes are height-bounded by the grid row, so each one scrolls its
          own body while its header, and the editor's actions, stay in place. */}
      <div className="flex min-h-0 flex-1 flex-col gap-6 lg:grid lg:grid-cols-[minmax(17rem,23rem)_minmax(0,1fr)]">
        <Card className="flex max-h-80 flex-col gap-0 py-0 lg:max-h-none lg:min-h-0">
          <CardHeader className="shrink-0 border-b py-4">
            <CardTitle>Onboarding map</CardTitle>
            <CardDescription>
              Complete the trusted context needed for safe revenue work.
            </CardDescription>
          </CardHeader>
          <ScrollArea className="min-h-0 flex-1">
            <div className="px-2 py-3">
              <OnboardingSectionRail
                sections={sections}
                currentSectionKey={currentSectionKey}
                onSelect={selectSection}
              />
            </div>
          </ScrollArea>
        </Card>

        <Card className="flex min-h-0 min-w-0 flex-col gap-0 py-0 max-lg:min-h-[36rem]">
          <CardHeader className="shrink-0 gap-4 border-b py-4">
            <AnimatedPhaseStepper sections={sections} currentSectionKey={currentSectionKey} />
            <Separator />
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {activeSection.phase.replaceAll("_", " ")}
              </p>
              <h2
                ref={headingRef}
                tabIndex={-1}
                className="text-2xl font-semibold tracking-tight outline-none"
              >
                {activeSection.label}
              </h2>
              <p className="text-sm text-muted-foreground">{activeSection.description}</p>
            </div>
          </CardHeader>
          <AnimatePresence initial={false} mode="wait">
            <motion.div
              key={currentSectionKey}
              className="flex min-h-0 flex-1 flex-col"
              initial={{ x: reduceMotion ? 0 : 20, opacity: reduceMotion ? 1 : 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: reduceMotion ? 0 : -20, opacity: reduceMotion ? 1 : 0 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : {
                      x: { type: "spring", stiffness: 300, damping: 30 },
                      opacity: { duration: 0.2 },
                    }
              }
            >
              {contents[currentSectionKey] ?? (
                <p className="px-(--card-spacing) py-5 text-sm text-muted-foreground">
                  This section is ready for input.
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </Card>
      </div>
    </OnboardingWorkspaceContext.Provider>
  );
}
