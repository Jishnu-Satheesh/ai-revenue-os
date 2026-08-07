"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AnimatedPhaseStepper } from "@/components/onboarding/animated-phase-stepper";
import {
  OnboardingSectionRail,
  type RailSection,
} from "@/components/onboarding/onboarding-section-rail";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { OnboardingSectionKey } from "@/domain/onboarding/types";

const emptyContents: Partial<Record<OnboardingSectionKey, React.ReactNode>> = {};

type OnboardingWorkspaceControls = {
  completeCurrentSection: () => void;
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
  const [visitedSectionKeys, setVisitedSectionKeys] = useState<OnboardingSectionKey[]>(() => {
    const persisted = sections
      .filter((section) => section.status !== "not_started")
      .map((section) => section.key);
    return persisted.includes(initialSectionKey ?? firstSection)
      ? persisted
      : [initialSectionKey ?? firstSection, ...persisted];
  });
  const [contentHeight, setContentHeight] = useState<number | "auto">("auto");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const activeSection = useMemo(
    () => sections.find((section) => section.key === currentSectionKey) ?? sections[0],
    [currentSectionKey, sections],
  );

  useLayoutEffect(() => {
    if (!contentRef.current || reduceMotion) {
      setContentHeight("auto");
      return;
    }
    setContentHeight(contentRef.current.offsetHeight);
  }, [currentSectionKey, reduceMotion]);

  useEffect(() => {
    headingRef.current?.focus();
  }, [currentSectionKey]);

  function selectSection(sectionKey: OnboardingSectionKey) {
    if (!visitedSectionKeys.includes(sectionKey)) return;
    setCurrentSectionKey(sectionKey);
    onSectionChange?.(sectionKey);
  }

  function completeCurrentSection() {
    const currentIndex = sections.findIndex((section) => section.key === currentSectionKey);
    const nextSection = sections[currentIndex + 1];
    if (!nextSection) return;
    setVisitedSectionKeys((current) =>
      current.includes(nextSection.key) ? current : [...current, nextSection.key],
    );
    setCurrentSectionKey(nextSection.key);
    onSectionChange?.(nextSection.key);
  }

  if (!activeSection) return null;

  return (
    <OnboardingWorkspaceContext.Provider value={{ completeCurrentSection }}>
      <div className="grid gap-6 lg:grid-cols-[minmax(15rem,20rem)_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle>Onboarding map</CardTitle>
            <CardDescription>
              Complete the trusted context needed for safe revenue work.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingSectionRail
              sections={sections}
              currentSectionKey={currentSectionKey}
              visitedSectionKeys={visitedSectionKeys}
              onSelect={selectSection}
            />
          </CardContent>
        </Card>

        <Card className="min-w-0 overflow-hidden">
          <CardHeader className="gap-5">
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
          <motion.div
            animate={{ height: reduceMotion ? "auto" : contentHeight }}
            transition={
              reduceMotion ? { duration: 0 } : { type: "spring", damping: 25, stiffness: 200 }
            }
            className="overflow-hidden"
          >
            <AnimatePresence initial={false} mode="wait" custom={1}>
              <motion.div
                key={currentSectionKey}
                ref={contentRef}
                custom={1}
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
                <CardContent>
                  {contents[currentSectionKey] ?? (
                    <p className="text-sm text-muted-foreground">
                      This section is ready for input.
                    </p>
                  )}
                </CardContent>
              </motion.div>
            </AnimatePresence>
          </motion.div>
        </Card>
      </div>
    </OnboardingWorkspaceContext.Provider>
  );
}
