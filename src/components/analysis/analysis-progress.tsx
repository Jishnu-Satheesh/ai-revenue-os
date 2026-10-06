"use client";

import {
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  CheckIcon,
  CircleCheckIcon,
  FileTextIcon,
  ScanSearchIcon,
  SparklesIcon,
  TriangleAlertIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

export type AnalysisStage = "queued" | "running" | "narrating" | "ready" | "failed";

type StageEntry = {
  stage: Exclude<AnalysisStage, "failed">;
  line: string;
  icon: ComponentType<{ className?: string }>;
};

const PROGRESS_STAGES: StageEntry[] = [
  { stage: "queued", line: "Reading approved reports", icon: FileTextIcon },
  { stage: "running", line: "Running the checks", icon: ScanSearchIcon },
  { stage: "narrating", line: "Writing recommendations", icon: SparklesIcon },
  { stage: "ready", line: "Ready", icon: CircleCheckIcon },
];

const KNOWN_STAGES: readonly string[] = ["queued", "running", "narrating", "ready", "failed"];

const FAILED_LINE =
  "This analysis could not be completed. Nothing was changed; try again in a moment.";

/**
 * The loader covers the whole page, so it is portalled to the body rather than
 * left in the workspace tree: a `fixed` overlay is positioned against the
 * nearest ancestor that has a transform or filter, and the workspace above it
 * is free to grow one without anybody noticing this had been depending on it.
 */
function AnalysisOverlay(props: {
  window: { from: string; to: string };
  children: ReactNode;
}): ReactElement | null {
  const { window: range, children } = props;
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Nothing behind the overlay is actionable while it is up, and a page that
    // scrolls under a fixed sheet reads as a broken one.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      data-slot="analysis-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-6 backdrop-blur-sm"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-lg">
        <p className="text-sm font-medium text-foreground">Analysing this window</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {range.from} to {range.to}
        </p>
        <div className="mt-5">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

export function AnalysisProgress(props: {
  organizationId: string;
  channelId: string;
  window: { from: string; to: string };
  onReady: () => void;
  onDismiss?: () => void;
  pollMs?: number;
}): ReactElement | null {
  const { organizationId, channelId, window: range, onReady, onDismiss, pollMs = 1500 } = props;
  const [stage, setStage] = useState<AnalysisStage>("queued");
  const onReadyRef = useRef(onReady);

  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  useEffect(() => {
    const url =
      `/api/organizations/${organizationId}/channels/${channelId}/analysis/status` +
      `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;
    const controller = new AbortController();
    let stopped = false;

    async function poll(): Promise<void> {
      if (stopped) {
        return;
      }
      let next: AnalysisStage;
      try {
        const response = await fetch(url, { signal: controller.signal });
        const body = (await response.json()) as { stage: AnalysisStage };
        if (!KNOWN_STAGES.includes(body.stage)) {
          return;
        }
        next = body.stage;
      } catch {
        // A dropped poll is not a failed analysis: keep the previous stage
        // and keep polling.
        return;
      }
      if (stopped) {
        return;
      }
      setStage(next);
      if (next === "ready") {
        stopped = true;
        clearInterval(timer);
        onReadyRef.current();
      } else if (next === "failed") {
        stopped = true;
        clearInterval(timer);
      }
    }

    const timer = setInterval(() => {
      void poll();
    }, pollMs);
    void poll();

    return () => {
      stopped = true;
      clearInterval(timer);
      controller.abort();
    };
  }, [organizationId, channelId, range.from, range.to, pollMs]);

  if (stage === "failed") {
    return (
      <AnalysisOverlay window={range}>
        <Marker className="items-start text-destructive">
          <MarkerIcon className="mt-0.5">
            <TriangleAlertIcon />
          </MarkerIcon>
          <MarkerContent role="status" aria-live="polite">
            {FAILED_LINE}
          </MarkerContent>
        </Marker>
        {onDismiss ? (
          <div className="mt-5 flex justify-end">
            <Button type="button" variant="outline" size="sm" onClick={onDismiss}>
              Close
            </Button>
          </div>
        ) : null}
      </AnalysisOverlay>
    );
  }

  const currentIndex = PROGRESS_STAGES.findIndex((entry) => entry.stage === stage);

  return (
    <AnalysisOverlay window={range}>
      <ol role="status" aria-live="polite" aria-busy={stage !== "ready"} className="space-y-3">
        {PROGRESS_STAGES.map((entry, index) => {
          const state =
            index < currentIndex ? "done" : index === currentIndex ? "current" : "pending";
          const Icon = entry.icon;
          return (
            <Marker asChild key={entry.stage}>
              <li data-state={state} aria-current={state === "current" ? "step" : undefined}>
                <MarkerIcon
                  className={cn(
                    state === "done" && "text-primary",
                    state === "current" && "text-foreground",
                    state === "pending" && "opacity-40",
                  )}
                >
                  <Icon />
                </MarkerIcon>
                {/* Only the live stage shimmers. A page where every line moves
                    says nothing about which one is actually running. */}
                <MarkerContent
                  className={cn(
                    state === "done" && "text-foreground/70",
                    state === "current" && "shimmer text-foreground",
                    state === "pending" && "opacity-50",
                  )}
                >
                  {entry.line}
                </MarkerContent>
                {state === "current" ? (
                  <Spinner
                    role="presentation"
                    aria-label={undefined}
                    className="ml-auto shrink-0 text-muted-foreground"
                  />
                ) : null}
                {state === "done" ? (
                  <CheckIcon aria-hidden="true" className="ml-auto size-4 shrink-0 text-primary" />
                ) : null}
              </li>
            </Marker>
          );
        })}
      </ol>
    </AnalysisOverlay>
  );
}
